const { answerConversation } = require('../services/conversation');
const { FreeAstroError, getNatal, getNatalChart, searchCities } = require('../services/freeastro');
const { getGeminiErrorMessage } = require('../services/gemini');
const {
  getFirstQuestionPrompts,
  getFollowUpSuggestions,
  getLanguageName,
  getLanguageOptions,
  getLocale,
  getStarterSuggestions,
  refreshLocaleFromProfile,
  setManualLocale,
  syncLocaleFromEvent,
  t,
  translateUserError
} = require('../services/locale');
const persistence = require('../services/persistence');
const {
  clearSession,
  createNatalChartPayload,
  createSessionCheckpoint,
  createNatalPayload,
  getSession,
  isSessionCurrent,
  lockSession,
  parseDateInput,
  parseTimeInput,
  setSession,
  startNatalFlow,
  unlockSession
} = require('../services/natalFlow');
const {
  clearNatalProfile,
  consumePendingQuestion,
  getChoiceMap,
  getChatState,
  setChoiceMap,
  setNatalProfile,
  setPendingQuestion
} = require('../state/chatState');
const {
  formatNatalMessage,
  splitConversationReply
} = require('../utils/format');

const ACTIONS = {
  TIME_YES: 'NATAL_TIME_YES',
  TIME_NO: 'NATAL_TIME_NO',
  CITY_PREFIX: 'NATAL_CITY_',
  STARTER_QUESTION_PREFIX: 'STARTER_QUESTION_',
  FULL_QUESTION_PREFIX: 'FULL_QUESTION_',
  SHOW_MORE_QUESTIONS: 'SHOW_MORE_QUESTIONS',
  LANGUAGE_PREFIX: 'LANGUAGE_',
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  PROFILE_RESET: 'PROFILE_RESET',
  PROFILE_SHOW_CHART: 'PROFILE_SHOW_CHART'
};

function formatCityOption(city) {
  const bits = [city?.name, city?.admin1 || city?.region, city?.country].filter(Boolean);
  return bits.join(', ').slice(0, 60) || 'City option';
}

function chunkQuestions(questions, size = 3) {
  const chunks = [];

  for (let index = 0; index < questions.length; index += size) {
    chunks.push(questions.slice(index, index + size));
  }

  return chunks;
}

function formatSuggestionLine(locale, suggestions) {
  return t(locale, 'prompts.nextYouCanAsk', { suggestions: suggestions.join(', ') });
}

function getWelcomeBackMessage(locale) {
  return t(locale, 'prompts.welcomeBack');
}

function getOnboardingIntro(locale, source = 'start') {
  return source === 'chat'
    ? t(locale, 'prompts.onboardingChat')
    : t(locale, 'prompts.onboardingStart');
}

async function promptForBirthDate(event, channelApi, source = 'start') {
  const locale = getLocale(event);
  await channelApi.sendText(event, getOnboardingIntro(locale, source));
}

async function promptForCity(event, channelApi) {
  await channelApi.sendText(event, t(event, 'prompts.birthDateAccepted'));
}

async function promptForCityConfirmation(event, channelApi, candidates) {
  const choices = candidates.map((city, index) => ({
    id: `${ACTIONS.CITY_PREFIX}${index}`,
    title: formatCityOption(city)
  }));

  await channelApi.sendChoices(event, t(event, 'prompts.cityConfirm'), choices);
  setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
}

async function promptForBirthTimeKnown(event, channelApi) {
  const locale = getLocale(event);
  await channelApi.sendChoices(
    event,
    t(locale, 'prompts.cityAccepted'),
    [
      { id: ACTIONS.TIME_YES, title: t(locale, 'buttons.yes') },
      { id: ACTIONS.TIME_NO, title: t(locale, 'buttons.no') }
    ]
  );
}

async function promptForBirthTime(event, channelApi) {
  await channelApi.sendText(event, t(event, 'prompts.birthTimePrompt'));
}

async function sendConversationAnswer(event, channelApi, answerText) {
  const chunks = splitConversationReply(answerText);

  if (chunks.length === 0) {
    await channelApi.sendText(event, t(event, 'errors.noGroundedAnswer'));
    return;
  }

  for (const chunk of chunks) {
    await channelApi.sendText(event, chunk);
  }
}

async function sendFollowUpPrompt(event, channelApi, intentId) {
  const locale = getLocale(event);
  await channelApi.sendText(event, formatSuggestionLine(locale, getFollowUpSuggestions(locale, intentId)));
}

async function sendStarterQuestionButtons(event, channelApi) {
  const locale = getLocale(event);
  const starterQuestions = getStarterSuggestions(locale);

  await channelApi.sendChoices(event, t(locale, 'prompts.chooseQuestion'), [
    {
      id: `${ACTIONS.STARTER_QUESTION_PREFIX}0`,
      title: starterQuestions[0]
    },
    {
      id: `${ACTIONS.STARTER_QUESTION_PREFIX}1`,
      title: starterQuestions[1]
    },
    {
      id: ACTIONS.SHOW_MORE_QUESTIONS,
      title: t(locale, 'buttons.showMoreQuestions')
    }
  ]);
}

async function sendAllSuggestedQuestions(event, channelApi) {
  const locale = getLocale(event);
  const questions = getFirstQuestionPrompts(locale);
  const chunks = chunkQuestions(questions, 3);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    await channelApi.sendChoices(
      event,
      t(locale, 'prompts.moreQuestions'),
      chunk.map((question, index) => ({
        id: `${ACTIONS.FULL_QUESTION_PREFIX}${chunkIndex * 3 + index}`,
        title: question.slice(0, 60)
      }))
    );
  }
}

function buildProfileMessage(chatState) {
  const profile = chatState.natalProfile;
  const locale = getLocale(chatState);

  if (!profile) {
    return t(locale, 'profile.none');
  }

  const birthDate = profile.birthDatetime ? String(profile.birthDatetime).slice(0, 10) : 'Unknown';
  const city = profile.city || 'Unknown';
  const timeLine = profile.timeKnown
    ? t(locale, 'profile.birthTimeSaved', { value: String(profile.birthDatetime).slice(11, 16) || 'Saved' })
    : t(locale, 'profile.birthTimeMissing');

  return [
    t(locale, 'profile.title'),
    '',
    t(locale, 'profile.birthDate', { value: birthDate }),
    t(locale, 'profile.city', { value: city }),
    timeLine,
    t(locale, 'profile.language', { value: getLanguageName(chatState.locale, locale) }),
    '',
    t(locale, 'profile.footer')
  ].join('\n');
}

async function sendCompactChart(event, channelApi) {
  const chatState = getChatState(event);
  const chartPayload = chatState.chartRequestPayload;

  if (!chartPayload || !chatState.rawNatalPayload) {
    await channelApi.sendText(event, t(event, 'profile.chartUnavailable'));
    return true;
  }

  try {
    const chart = await getNatalChart(chartPayload);
    await channelApi.sendImage(event, chart.buffer, {
      caption: t(event, 'prompts.chartCaption'),
      filename: 'natal-chart.png'
    });
    await channelApi.sendText(event, formatNatalMessage(chatState.rawNatalPayload, chatState.natalProfile.city, getLocale(event)));
  } catch (error) {
    await channelApi.sendText(event, translateUserError(getLocale(event), error));
  }

  return true;
}

async function finishNatalFlow(event, channelApi, session) {
  const lockedSession = lockSession(event, session.flowId);
  const locale = getLocale(event);

  if (!lockedSession) {
    await channelApi.sendText(event, t(locale, 'prompts.stillReading'));
    return true;
  }

  const loadingRef = await channelApi.sendText(event, t(locale, 'prompts.readingChart'));

  try {
    const natalPayload = createNatalPayload(lockedSession, lockedSession.cityMatch);
    const chartPayload = createNatalChartPayload(lockedSession, lockedSession.cityMatch);
    const result = await getNatal(natalPayload);

    if (!isSessionCurrent(event, createSessionCheckpoint(lockedSession))) {
      return true;
    }

    clearSession(event);
    setNatalProfile(
      event,
      result,
      `${lockedSession.cityMatch.name}, ${lockedSession.cityMatch.country}`,
      {
        birthCountry: lockedSession.cityMatch.country,
        natalRequestPayload: natalPayload,
        chartRequestPayload: chartPayload
      }
    );
    refreshLocaleFromProfile(event);
    setChoiceMap(event, {});

    const pendingQuestion = consumePendingQuestion(event);

    if (!pendingQuestion) {
      await channelApi.editText(event, loadingRef, t(event, 'prompts.firstReady'));
      await sendAllSuggestedQuestions(event, channelApi);
      return true;
    }

    try {
      const answer = await answerConversation(event, pendingQuestion);
      const chunks = splitConversationReply(answer.text);

      if (chunks.length === 0) {
        await channelApi.editText(event, loadingRef, t(event, 'errors.noGroundedAnswer'));
        return true;
      }

      await channelApi.editText(event, loadingRef, chunks[0]);

      for (const chunk of chunks.slice(1)) {
        await channelApi.sendText(event, chunk);
      }

      await sendFollowUpPrompt(event, channelApi, answer.intent);
    } catch (error) {
      await channelApi.editText(event, loadingRef, `${t(event, 'errors.conversationUnavailable')}\n${getGeminiErrorMessage(error, getLocale(event))}`);
    }

    return true;
  } catch (error) {
    if (isSessionCurrent(event, createSessionCheckpoint(lockedSession))) {
      unlockSession(event, lockedSession.flowId);
    }

    const message = error instanceof FreeAstroError
      ? translateUserError(getLocale(event), error)
      : translateUserError(getLocale(event), new Error(t(event, 'errors.genericUnexpected')));
    await channelApi.editText(event, loadingRef, message);
    return true;
  }
}

async function handleStart(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const chatState = getChatState(event);

  if (chatState.natalProfile) {
    await channelApi.sendText(event, getWelcomeBackMessage(getLocale(event)));
    await sendStarterQuestionButtons(event, channelApi);
    return true;
  }

  setPendingQuestion(event, null);
  startNatalFlow(event, 'start');
  await promptForBirthDate(event, channelApi, 'start');
  return true;
}

async function handleProfile(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const chatState = getChatState(event);
  await channelApi.sendText(event, buildProfileMessage(chatState));

  if (chatState.natalProfile) {
    await channelApi.sendChoices(event, t(event, 'prompts.profileActions'), [
      { id: ACTIONS.PROFILE_UPDATE, title: t(event, 'buttons.update') },
      { id: ACTIONS.PROFILE_RESET, title: t(event, 'buttons.reset') },
      { id: ACTIONS.PROFILE_SHOW_CHART, title: t(event, 'buttons.showChart') }
    ]);
  }

  return true;
}

async function handleCancel(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  clearSession(event);
  setPendingQuestion(event, null);
  setChoiceMap(event, {});
  await channelApi.sendText(event, t(event, 'errors.cancelled'));
  return true;
}

async function promptForLanguage(event, channelApi) {
  const choices = getLanguageOptions().map((option) => ({
    id: `${ACTIONS.LANGUAGE_PREFIX}${option.locale}`,
    title: option.title
  }));

  for (const batch of chunkQuestions(choices, 3)) {
    await channelApi.sendChoices(event, t(event, 'prompts.languagePrompt'), batch);
  }
}

async function repromptCurrentStep(event, channelApi) {
  const session = getSession(event);

  if (!session) {
    return;
  }

  if (session.step === 'date') {
    await promptForBirthDate(event, channelApi, session.source);
    return;
  }

  if (session.step === 'city') {
    await promptForCity(event, channelApi);
    return;
  }

  if (session.step === 'city_confirm') {
    await promptForCityConfirmation(event, channelApi, session.cityCandidates || []);
    return;
  }

  if (session.step === 'time_known') {
    await promptForBirthTimeKnown(event, channelApi);
    return;
  }

  if (session.step === 'time') {
    await promptForBirthTime(event, channelApi);
  }
}

async function handleIncomingAction(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const actionId = String(event.actionId || '');

  if (!actionId) {
    return false;
  }

  if (actionId === ACTIONS.SHOW_MORE_QUESTIONS) {
    await channelApi.ackAction(event);
    await sendAllSuggestedQuestions(event, channelApi);
    return true;
  }

  if (actionId.startsWith(ACTIONS.LANGUAGE_PREFIX)) {
    const locale = actionId.slice(ACTIONS.LANGUAGE_PREFIX.length);

    if (!locale) {
      await channelApi.ackAction(event, t(event, 'errors.questionExpired'));
      return true;
    }

    await channelApi.ackAction(event);
    const selectedLocale = setManualLocale(event, locale);
    await channelApi.sendText(event, t(selectedLocale, 'prompts.languageUpdated', {
      language: getLanguageName(selectedLocale, selectedLocale)
    }));
    await repromptCurrentStep(event, channelApi);
    return true;
  }

  if (actionId.startsWith(ACTIONS.STARTER_QUESTION_PREFIX)) {
    const questionIndex = Number(actionId.slice(ACTIONS.STARTER_QUESTION_PREFIX.length));
    const question = getStarterSuggestions(getLocale(event))[questionIndex];

    if (!question) {
      await channelApi.ackAction(event, t(event, 'errors.questionExpired'));
      return true;
    }

    await channelApi.ackAction(event);
    return handleIncomingText(
      {
        ...event,
        type: 'text',
        text: question,
        actionId: null
      },
      channelApi
    );
  }

  if (actionId.startsWith(ACTIONS.FULL_QUESTION_PREFIX)) {
    const questionIndex = Number(actionId.slice(ACTIONS.FULL_QUESTION_PREFIX.length));
    const question = getFirstQuestionPrompts(getLocale(event))[questionIndex];

    if (!question) {
      await channelApi.ackAction(event, t(event, 'errors.questionExpired'));
      return true;
    }

    await channelApi.ackAction(event);
    return handleIncomingText(
      {
        ...event,
        type: 'text',
        text: question,
        actionId: null
      },
      channelApi
    );
  }

  if (actionId === ACTIONS.PROFILE_UPDATE) {
    await channelApi.ackAction(event);
    setPendingQuestion(event, null);
    startNatalFlow(event, 'profile');
    await promptForBirthDate(event, channelApi, 'start');
    return true;
  }

  if (actionId === ACTIONS.PROFILE_RESET) {
    await channelApi.ackAction(event);
    clearSession(event);
    clearNatalProfile(event);
    setPendingQuestion(event, null);
    setChoiceMap(event, {});
    await channelApi.sendText(event, t(event, 'profile.cleared'));
    return true;
  }

  if (actionId === ACTIONS.PROFILE_SHOW_CHART) {
    await channelApi.ackAction(event);
    return sendCompactChart(event, channelApi);
  }

  if (actionId === ACTIONS.TIME_YES || actionId === ACTIONS.TIME_NO) {
    const session = getSession(event);

    if (!session) {
      await channelApi.ackAction(event, t(event, 'errors.startAgain'));
      return true;
    }

     if (session.locked) {
      await channelApi.ackAction(event, t(event, 'prompts.stillReading'));
      return true;
    }

    session.timeKnown = actionId === ACTIONS.TIME_YES;
    session.step = session.timeKnown ? 'time' : 'complete';
    setSession(event, session);
    await channelApi.ackAction(event);

    if (session.timeKnown) {
      await promptForBirthTime(event, channelApi);
      return true;
    }

    return finishNatalFlow(event, channelApi, session);
  }

  if (actionId.startsWith(ACTIONS.CITY_PREFIX)) {
    const session = getSession(event);

    if (!session || session.step !== 'city_confirm') {
      await channelApi.ackAction(event, t(event, 'errors.cityChoicesExpired'));
      return true;
    }

    const cityIndex = Number(actionId.slice(ACTIONS.CITY_PREFIX.length));
    const cityMatch = Array.isArray(session.cityCandidates) ? session.cityCandidates[cityIndex] : null;

    if (!cityMatch) {
      await channelApi.ackAction(event, t(event, 'errors.cityOptionUnavailable'));
      return true;
    }

    if (session.locked) {
      await channelApi.ackAction(event, t(event, 'prompts.stillReading'));
      return true;
    }

    session.cityMatch = cityMatch;
    session.step = 'time_known';
    setSession(event, session);

    await channelApi.ackAction(event, t(event, 'errors.usingCity', { city: formatCityOption(cityMatch) }));
    await promptForBirthTimeKnown(event, channelApi);
    return true;
  }

  return false;
}

async function handleActiveFlowText(event, channelApi, text) {
  const session = getSession(event);

  if (!session) {
    return false;
  }

  if (session.locked) {
    await channelApi.sendText(event, t(event, 'prompts.stillReading'));
    return true;
  }

  if (session.step === 'date') {
    const birthDate = parseDateInput(text);

    if (!birthDate) {
      await channelApi.sendText(event, t(event, 'errors.invalidDate'));
      return true;
    }

    session.birthDate = birthDate;
    session.step = 'city';
    setSession(event, session);
    await promptForCity(event, channelApi);
    return true;
  }

  if (session.step === 'city') {
    const checkpoint = createSessionCheckpoint(session);

    try {
      const cityCandidates = await searchCities(text, 3);

      if (!isSessionCurrent(event, checkpoint, 'city')) {
        return true;
      }

      const currentSession = getSession(event);
      currentSession.city = text;
      currentSession.cityCandidates = cityCandidates;
      currentSession.step = 'city_confirm';
      setSession(event, currentSession);
      await promptForCityConfirmation(event, channelApi, cityCandidates);
    } catch (error) {
      if (!isSessionCurrent(event, checkpoint, 'city')) {
        return true;
      }

      const message = error instanceof FreeAstroError
        ? error.message
        : t(event, 'errors.cityLookupFailed');
      await channelApi.sendText(event, message);
    }
    return true;
  }

  if (session.step === 'city_confirm') {
    const choiceMap = getChoiceMap(event);
    const mappedAction = choiceMap[String(text).trim()];

    if (mappedAction) {
      return handleIncomingAction({ ...event, actionId: mappedAction, type: 'action' }, channelApi);
    }

    await channelApi.sendText(event, t(event, 'errors.chooseCityOption'));
    return true;
  }

  if (session.step === 'time_known') {
    const normalized = String(text || '').trim().toLowerCase();

    if (['yes', 'y', 'oui', 'ja', 'si', 'sí'].includes(normalized)) {
      return handleIncomingAction({ ...event, actionId: ACTIONS.TIME_YES, type: 'action' }, channelApi);
    }

    if (['no', 'n', 'non', 'nein'].includes(normalized)) {
      return handleIncomingAction({ ...event, actionId: ACTIONS.TIME_NO, type: 'action' }, channelApi);
    }

    await channelApi.sendText(event, t(event, 'errors.replyYesNo'));
    return true;
  }

  if (session.step === 'time') {
    const birthTime = parseTimeInput(text);

    if (!birthTime) {
      await channelApi.sendText(event, t(event, 'errors.invalidTime'));
      return true;
    }

    session.birthTime = birthTime;
    session.step = 'complete';
    setSession(event, session);
    return finishNatalFlow(event, channelApi, session);
  }

  return false;
}

async function handleIncomingText(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const text = String(event.text || '').trim();

  if (!text) {
    return false;
  }

  if (text === '/language') {
    await promptForLanguage(event, channelApi);
    return true;
  }

  const handledFlow = await handleActiveFlowText(event, channelApi, text);
  if (handledFlow) {
    return true;
  }

  const chatState = getChatState(event);

  if (!chatState.natalProfile) {
    setPendingQuestion(event, text);
    startNatalFlow(event, 'chat');
    await promptForBirthDate(event, channelApi, 'chat');
    return true;
  }

  const loadingRef = await channelApi.sendText(event, t(event, 'prompts.readingChart'));

  try {
    const result = await answerConversation(event, text);
    const chunks = splitConversationReply(result.text);

    if (chunks.length === 0) {
      await channelApi.editText(event, loadingRef, t(event, 'errors.noGroundedAnswer'));
      return true;
    }

    await channelApi.editText(event, loadingRef, chunks[0]);

    for (const chunk of chunks.slice(1)) {
      await channelApi.sendText(event, chunk);
    }

    await sendFollowUpPrompt(event, channelApi, result.intent);
  } catch (error) {
    await channelApi.editText(
      event,
      loadingRef,
      `${t(event, 'errors.conversationUnavailable')}\n${getGeminiErrorMessage(error, getLocale(event))}`
    );
  }

  return true;
}

module.exports = {
  ACTIONS,
  handleCancel,
  handleIncomingAction,
  handleIncomingText,
  promptForLanguage,
  handleProfile,
  handleStart
};
