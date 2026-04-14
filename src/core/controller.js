const { answerConversation } = require('../services/conversation');
const { FreeAstroError, getNatal, getNatalChart, searchCities } = require('../services/freeastro');
const { getGeminiErrorMessage } = require('../services/gemini');
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
  formatUserError,
  splitConversationReply
} = require('../utils/format');

const ACTIONS = {
  HELP_DAILY: 'HELP_DAILY',
  TIME_YES: 'NATAL_TIME_YES',
  TIME_NO: 'NATAL_TIME_NO',
  CITY_PREFIX: 'NATAL_CITY_',
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  PROFILE_RESET: 'PROFILE_RESET',
  PROFILE_SHOW_CHART: 'PROFILE_SHOW_CHART'
};

function formatCityOption(city) {
  const bits = [city?.name, city?.admin1 || city?.region, city?.country].filter(Boolean);
  return bits.join(', ').slice(0, 60) || 'City option';
}

function getStarterSuggestions() {
  return [
    'Ask about your Rising sign',
    'Ask about love patterns',
    'Ask for your strongest aspect'
  ];
}

function getFirstQuestionPrompts() {
  return [
    'What does my birth chart say about my personality?',
    'What are my Sun, Moon, and Rising signs, and what do they mean?',
    'Who am I most compatible with in love?',
    'What does my chart say about my career path?',
    'What is my biggest hidden strength according to astrology?',
    'What karmic lessons am I here to learn?',
    'What does my Saturn placement say about my life challenges?',
    'What does my Venus sign reveal about how I love?',
    'What major transits are affecting me right now?',
    'Why has this year felt so difficult for me astrologically?',
    'What does the current moon mean for me personally?',
    'What area of life is about to change for me?',
    'What is my soul purpose based on my North Node?',
    'Which zodiac signs understand me best emotionally?',
    'What patterns in my chart explain my friendships and conflicts?',
    'What does western astrology predict for my next 12 months?',
    'Where should I relocate in the world for my career?',
    'How is the city where I live influencing me?',
    'Show me my natal chart visually.'
  ];
}

function formatFirstQuestionPrompts() {
  return getFirstQuestionPrompts()
    .map((question) => `- ${question}`)
    .join('\n');
}

function getFollowUpSuggestions(intentId) {
  switch (intentId) {
    case 'relocation':
      return ['another city in France', 'career relocation', 'romantic relocation'];
    case 'rising_sign':
      return ['Moon sign meaning', 'love patterns', 'strongest aspect'];
    case 'planet_placement':
      return ['strongest aspect', 'career themes', 'Rising sign'];
    case 'major_aspects':
      return ['how that aspect plays out in love', 'chart summary', 'Rising sign'];
    case 'house_question':
      return ['another house focus', 'Rising sign', 'career themes'];
    case 'chart_summary':
      return ['love patterns', 'career themes', 'strongest aspect'];
    default:
      return ['Rising sign', 'strongest aspect', 'love patterns'];
  }
}

function formatSuggestionLine(suggestions) {
  return `Next you can ask: ${suggestions.join(', ')}.`;
}

function getWelcomeBackMessage() {
  return [
    'Welcome back. What do you want to explore today?',
    '',
    formatSuggestionLine(getStarterSuggestions())
  ].join('\n');
}

function getOnboardingIntro(source = 'start') {
  if (source === 'chat') {
    return [
      'I can answer that properly from your chart.',
      'First I need your birth date and birth city.',
      '',
      'Send your birth date in YYYY-MM-DD format.'
    ].join('\n');
  }

  return [
    'I read charts from your birth details so later questions stay personal and precise.',
    '',
    'Send your birth date in YYYY-MM-DD format.'
  ].join('\n');
}

async function promptForBirthDate(event, channelApi, source = 'start') {
  await channelApi.sendText(event, getOnboardingIntro(source));
}

async function promptForCity(event, channelApi) {
  await channelApi.sendText(
    event,
    'Good. Your birth date anchors the core chart.\nNow send your birth city.\nExample: Paris or New York'
  );
}

async function promptForCityConfirmation(event, channelApi, candidates) {
  const choices = candidates.map((city, index) => ({
    id: `${ACTIONS.CITY_PREFIX}${index}`,
    title: formatCityOption(city)
  }));

  const prompt = [
    'I found these city matches. Choose the right one.',
    'Reply 1, 2, or 3 if buttons don’t appear.'
  ].join('\n');

  await channelApi.sendChoices(event, prompt, choices);
  setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
}

async function promptForBirthTimeKnown(event, channelApi) {
  await channelApi.sendChoices(
    event,
    'Good. Your birth city locks the location and timezone.\nDo you know your birth time? It helps with Rising sign and house accuracy.',
    [
      { id: ACTIONS.TIME_YES, title: 'Yes' },
      { id: ACTIONS.TIME_NO, title: 'No' }
    ]
  );
}

async function promptForBirthTime(event, channelApi) {
  await channelApi.sendText(event, 'Send your birth time in 24-hour format.\nExample: 14:30');
}

async function sendConversationAnswer(event, channelApi, answerText) {
  const chunks = splitConversationReply(answerText);

  if (chunks.length === 0) {
    await channelApi.sendText(event, 'I could not produce a grounded astrology answer.');
    return;
  }

  for (const chunk of chunks) {
    await channelApi.sendText(event, chunk);
  }
}

async function sendFollowUpPrompt(event, channelApi, intentId) {
  await channelApi.sendText(event, formatSuggestionLine(getFollowUpSuggestions(intentId)));
}

function buildProfileMessage(chatState) {
  const profile = chatState.natalProfile;

  if (!profile) {
    return [
      'No birth details are saved yet.',
      '',
      'Use /start to set up your chart.'
    ].join('\n');
  }

  const birthDate = profile.birthDatetime ? String(profile.birthDatetime).slice(0, 10) : 'Unknown';
  const city = profile.city || 'Unknown';
  const timeLine = profile.timeKnown
    ? `Birth time: ${String(profile.birthDatetime).slice(11, 16) || 'Saved'}`
    : 'Birth time: not saved';

  return [
    'Saved birth details',
    '',
    `Birth date: ${birthDate}`,
    `City: ${city}`,
    timeLine,
    '',
    'Use the buttons below to update, reset, or view your chart.'
  ].join('\n');
}

async function sendCompactChart(event, channelApi) {
  const chatState = getChatState(event);
  const chartPayload = chatState.chartRequestPayload;

  if (!chartPayload || !chatState.rawNatalPayload) {
    await channelApi.sendText(event, 'Your chart image is not available right now.');
    return true;
  }

  try {
    const chart = await getNatalChart(chartPayload);
    await channelApi.sendImage(event, chart.buffer, {
      caption: 'Your natal chart',
      filename: 'natal-chart.png'
    });
    await channelApi.sendText(event, formatNatalMessage(chatState.rawNatalPayload, chatState.natalProfile.city));
  } catch (error) {
    await channelApi.sendText(event, formatUserError(error));
  }

  return true;
}

async function finishNatalFlow(event, channelApi, session) {
  const lockedSession = lockSession(event, session.flowId);

  if (!lockedSession) {
    await channelApi.sendText(event, 'Still reading your chart...');
    return true;
  }

  const loadingRef = await channelApi.sendText(event, 'Reading your chart...');

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
        natalRequestPayload: natalPayload,
        chartRequestPayload: chartPayload
      }
    );
    setChoiceMap(event, {});

    const pendingQuestion = consumePendingQuestion(event);

    if (!pendingQuestion) {
      await channelApi.editText(event, loadingRef, 'We are ready now, What do you want to explore first?');
      await channelApi.sendText(event, formatFirstQuestionPrompts());
      return true;
    }

    try {
      const answer = await answerConversation(event, pendingQuestion);
      const chunks = splitConversationReply(answer.text);

      if (chunks.length === 0) {
        await channelApi.editText(event, loadingRef, 'I could not produce a grounded astrology answer.');
        return true;
      }

      await channelApi.editText(event, loadingRef, chunks[0]);

      for (const chunk of chunks.slice(1)) {
        await channelApi.sendText(event, chunk);
      }

      await sendFollowUpPrompt(event, channelApi, answer.intent);
    } catch (error) {
      await channelApi.editText(event, loadingRef, `Conversational mode is unavailable right now.\n${getGeminiErrorMessage(error)}`);
    }

    return true;
  } catch (error) {
    if (isSessionCurrent(event, createSessionCheckpoint(lockedSession))) {
      unlockSession(event, lockedSession.flowId);
    }

    const message = error instanceof FreeAstroError
      ? formatUserError(error)
      : formatUserError(new Error('Unexpected error.'));
    await channelApi.editText(event, loadingRef, message);
    return true;
  }
}

async function handleStart(event, channelApi) {
  await persistence.ensureHydrated(event);
  const chatState = getChatState(event);

  if (chatState.natalProfile) {
    await channelApi.sendText(event, getWelcomeBackMessage());

    if (channelApi.capabilities?.helpActions) {
      await channelApi.sendChoices(event, 'Quick actions', [
        { id: ACTIONS.HELP_DAILY, title: 'Daily' },
        { id: ACTIONS.PROFILE_SHOW_CHART, title: 'Chart' },
        { id: ACTIONS.PROFILE_UPDATE, title: 'Update profile' }
      ]);
    }

    return true;
  }

  setPendingQuestion(event, null);
  startNatalFlow(event, 'start');
  await promptForBirthDate(event, channelApi, 'start');
  return true;
}

async function handleProfile(event, channelApi) {
  await persistence.ensureHydrated(event);
  const chatState = getChatState(event);
  await channelApi.sendText(event, buildProfileMessage(chatState));

  if (chatState.natalProfile) {
    await channelApi.sendChoices(event, 'Profile actions', [
      { id: ACTIONS.PROFILE_UPDATE, title: 'Update' },
      { id: ACTIONS.PROFILE_RESET, title: 'Reset' },
      { id: ACTIONS.PROFILE_SHOW_CHART, title: 'Show chart' }
    ]);
  }

  return true;
}

async function handleCancel(event, channelApi) {
  await persistence.ensureHydrated(event);
  clearSession(event);
  setPendingQuestion(event, null);
  setChoiceMap(event, {});
  await channelApi.sendText(event, 'Cancelled.');
  return true;
}

async function handleIncomingAction(event, channelApi) {
  await persistence.ensureHydrated(event);
  const actionId = String(event.actionId || '');

  if (!actionId) {
    return false;
  }

  if (actionId === ACTIONS.HELP_DAILY) {
    await channelApi.ackAction(event);
    await channelApi.sendText(event, 'Try: /daily leo');
    return true;
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
    await channelApi.sendText(event, 'Your saved birth details were cleared. Send /start when you want to set them again.');
    return true;
  }

  if (actionId === ACTIONS.PROFILE_SHOW_CHART) {
    await channelApi.ackAction(event);
    return sendCompactChart(event, channelApi);
  }

  if (actionId === ACTIONS.TIME_YES || actionId === ACTIONS.TIME_NO) {
    const session = getSession(event);

    if (!session) {
      await channelApi.ackAction(event, 'Start again with /start');
      return true;
    }

     if (session.locked) {
      await channelApi.ackAction(event, 'Still reading your chart...');
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
      await channelApi.ackAction(event, 'City choices expired. Start again with /start.');
      return true;
    }

    const cityIndex = Number(actionId.slice(ACTIONS.CITY_PREFIX.length));
    const cityMatch = Array.isArray(session.cityCandidates) ? session.cityCandidates[cityIndex] : null;

    if (!cityMatch) {
      await channelApi.ackAction(event, 'That city option is no longer available.');
      return true;
    }

    if (session.locked) {
      await channelApi.ackAction(event, 'Still reading your chart...');
      return true;
    }

    session.cityMatch = cityMatch;
    session.step = 'time_known';
    setSession(event, session);

    await channelApi.ackAction(event, `Using ${formatCityOption(cityMatch)}`);
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
    await channelApi.sendText(event, 'Still reading your chart...');
    return true;
  }

  if (session.step === 'date') {
    const birthDate = parseDateInput(text);

    if (!birthDate) {
      await channelApi.sendText(event, 'Date format should look like 1990-05-15.');
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
        : 'I could not look up that city right now.';
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

    await channelApi.sendText(event, 'Choose one of the city options above. Reply 1, 2, or 3 if buttons don’t appear.');
    return true;
  }

  if (session.step === 'time_known') {
    const normalized = String(text || '').trim().toLowerCase();

    if (['yes', 'y', 'oui'].includes(normalized)) {
      return handleIncomingAction({ ...event, actionId: ACTIONS.TIME_YES, type: 'action' }, channelApi);
    }

    if (['no', 'n', 'non'].includes(normalized)) {
      return handleIncomingAction({ ...event, actionId: ACTIONS.TIME_NO, type: 'action' }, channelApi);
    }

    await channelApi.sendText(event, 'Reply yes or no. Birth time helps with Rising sign and house accuracy.');
    return true;
  }

  if (session.step === 'time') {
    const birthTime = parseTimeInput(text);

    if (!birthTime) {
      await channelApi.sendText(event, 'Time format should look like 14:30.');
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
  const text = String(event.text || '').trim();

  if (!text) {
    return false;
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

  const loadingRef = await channelApi.sendText(event, 'Reading your chart...');

  try {
    const result = await answerConversation(event, text);
    const chunks = splitConversationReply(result.text);

    if (chunks.length === 0) {
      await channelApi.editText(event, loadingRef, 'I could not produce a grounded astrology answer.');
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
      `Conversational mode is unavailable right now.\n${getGeminiErrorMessage(error)}`
    );
  }

  return true;
}

module.exports = {
  ACTIONS,
  handleCancel,
  handleIncomingAction,
  handleIncomingText,
  handleProfile,
  handleStart
};
