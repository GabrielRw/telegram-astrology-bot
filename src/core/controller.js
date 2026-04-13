const { answerConversation } = require('../services/conversation');
const { FreeAstroError, getNatal, getNatalChart, searchCities } = require('../services/freeastro');
const { getGeminiErrorMessage } = require('../services/gemini');
const {
  clearSession,
  createNatalChartPayload,
  createNatalPayload,
  getSession,
  parseDateInput,
  parseTimeInput,
  setSession,
  startNatalFlow
} = require('../services/natalFlow');
const {
  consumePendingQuestion,
  getChatState,
  getChoiceMap,
  getUiCache,
  setChoiceMap,
  setNatalProfile,
  setPendingQuestion,
  setUiCache
} = require('../state/chatState');
const {
  formatAspectInterpretationMessage,
  formatNatalMessage,
  formatUsage,
  formatUserError,
  getMajorAspectButtonsData,
  getPlanetPlacementButtonsData,
  splitConversationReply,
  splitMessage
} = require('../utils/format');

const ACTIONS = {
  HELP_DAILY: 'HELP_DAILY',
  TIME_YES: 'NATAL_TIME_YES',
  TIME_NO: 'NATAL_TIME_NO',
  CITY_PREFIX: 'NATAL_CITY_',
  ASPECT_PREFIX: 'NATAL_ASPECT_',
  PLANET_PREFIX: 'NATAL_PLANET_'
};

function getNatalIntroMessage(source = 'command') {
  if (source === 'chat') {
    return [
      'I can answer that, but first I need your natal chart so the reading is grounded.',
      '',
      'Reply with your name, or send skip to use Telegram User.',
      'You can cancel anytime with /cancel.'
    ].join('\n');
  }

  return [
    'Natal chart setup',
    '',
    'Reply with your name, or send skip to use Telegram User.',
    'You can cancel anytime with /cancel.'
  ].join('\n');
}

function formatCityOption(city) {
  const bits = [city?.name, city?.admin1 || city?.region, city?.country].filter(Boolean);
  return bits.join(', ').slice(0, 60) || 'City option';
}

async function promptForName(event, channelApi, source = 'command') {
  await channelApi.sendText(event, getNatalIntroMessage(source));
}

async function promptForBirthDate(event, channelApi) {
  await channelApi.sendText(event, 'Send your birth date in YYYY-MM-DD format.\nExample: 1990-05-15');
}

async function promptForBirthTime(event, channelApi) {
  await channelApi.sendText(event, 'Send your birth time in 24-hour format.\nExample: 14:30');
}

async function promptForCity(event, channelApi, timeKnown) {
  const line = timeKnown
    ? 'Send your birth city.'
    : 'Birth time marked unknown. Houses and Rising will be omitted by the API.\nNow send your birth city.';

  await channelApi.sendText(event, `${line}\nExample: Paris or New York`);
}

async function promptForCityConfirmation(event, channelApi, candidates) {
  const choices = candidates.map((city, index) => ({
    id: `${ACTIONS.CITY_PREFIX}${index}`,
    title: formatCityOption(city)
  }));

  await channelApi.sendChoices(event, 'I found these city matches. Choose the correct one.', choices);
  setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
}

async function sendConversationAnswer(event, channelApi, question, answerText) {
  const chunks = splitConversationReply(answerText);

  if (question) {
    await channelApi.sendText(event, `Your question: ${question}`);
  }

  if (chunks.length === 0) {
    await channelApi.sendText(event, 'I could not produce a grounded astrology answer.');
    return;
  }

  for (const chunk of chunks) {
    await channelApi.sendText(event, chunk);
  }
}

async function sendExplicitNatalReading(event, channelApi, payload, cityLabel, chart) {
  if (chart?.buffer) {
    await channelApi.sendImage(event, chart.buffer, {
      caption: 'Natal chart',
      filename: 'natal-chart.png'
    });
  }

  await channelApi.sendText(event, formatNatalMessage(payload, cityLabel));

  if (!channelApi.capabilities?.richNatalActions) {
    return;
  }

  const planetButtons = getPlanetPlacementButtonsData(payload);
  const aspectButtons = getMajorAspectButtonsData(payload);

  setUiCache(event, {
    aspects: aspectButtons,
    planets: planetButtons
  });

  for (const [index, planet] of planetButtons.entries()) {
    await channelApi.sendChoices(event, planet.summary, [
      {
        id: `${ACTIONS.PLANET_PREFIX}${index}`,
        title: 'Get interpretation'
      }
    ]);
  }

  if (aspectButtons.length === 0) {
    await channelApi.sendText(event, 'No major aspects were returned for this natal chart.');
    return;
  }

  for (const [index, aspect] of aspectButtons.entries()) {
    await channelApi.sendChoices(event, aspect.summary, [
      {
        id: `${ACTIONS.ASPECT_PREFIX}${index}`,
        title: 'Get interpretation'
      }
    ]);
  }
}

async function finishNatalFlow(event, channelApi, session, cityMatch) {
  const loadingRef = await channelApi.sendText(event, 'Calculating natal chart...');

  try {
    const natalPayload = createNatalPayload(session, cityMatch);
    const chartPayload = createNatalChartPayload(session, cityMatch);
    const [result, chart] = await Promise.allSettled([
      getNatal(natalPayload),
      getNatalChart(chartPayload)
    ]);

    if (result.status !== 'fulfilled') {
      throw result.reason;
    }

    clearSession(event);

    const cityLabel = `${cityMatch.name}, ${cityMatch.country}`;
    setNatalProfile(event, result.value, cityLabel);
    setChoiceMap(event, {});

    const pendingQuestion = consumePendingQuestion(event);
    const shouldSendNatalReading = session.source === 'command' && !pendingQuestion;

    if (shouldSendNatalReading) {
      await channelApi.editText(event, loadingRef, 'Natal chart ready.');
      await sendExplicitNatalReading(
        event,
        channelApi,
        result.value,
        cityLabel,
        chart.status === 'fulfilled' ? chart.value : null
      );
      return true;
    }

    await channelApi.editText(event, loadingRef, 'Birth details saved.');

    if (!pendingQuestion) {
      await channelApi.sendText(event, 'Your chart is ready. Ask your question directly.');
      return true;
    }

    const thinkingRef = await channelApi.sendText(event, 'Now I can answer your question from the chart...');

    try {
      const answer = await answerConversation(event, pendingQuestion);
      await channelApi.editText(event, thinkingRef, 'Answer ready.');
      await sendConversationAnswer(event, channelApi, pendingQuestion, answer.text);
    } catch (error) {
      await channelApi.editText(
        event,
        thinkingRef,
        `Conversational mode is unavailable right now.\n${getGeminiErrorMessage(error)}`
      );
    }

    return true;
  } catch (error) {
    const message = error instanceof FreeAstroError
      ? formatUserError(error)
      : formatUserError(new Error('Unexpected error.'));
    await channelApi.editText(event, loadingRef, message);
    return true;
  }
}

async function handleStart(event, channelApi) {
  const chatState = getChatState(event);

  if (chatState.natalProfile) {
    await channelApi.sendText(
      event,
      ['Your birth details are already saved.', '', 'Ask a chart question directly, or use /daily leo for a sign forecast.'].join('\n')
    );

    if (channelApi.capabilities?.helpActions) {
      await channelApi.sendChoices(event, 'Quick action', [
        { id: ACTIONS.HELP_DAILY, title: 'Daily' }
      ]);
    }

    return true;
  }

  setPendingQuestion(event, null);
  startNatalFlow(event, 'start');

  await channelApi.sendText(event, [
    'FreeAstro Telegram Bot Starter Kit',
    '',
    'I will first save your birth details so later questions stay natural and chart-grounded.',
    '',
    'You can still use:',
    '/daily leo',
    '',
    'After setup, just ask questions normally.',
    '',
    'Note: /daily is a sign-based forecast, not a personal birth-chart reading.'
  ].join('\n'));

  if (channelApi.capabilities?.helpActions) {
    await channelApi.sendChoices(event, 'Quick action', [
      { id: ACTIONS.HELP_DAILY, title: 'Daily' }
    ]);
  }

  await promptForName(event, channelApi, 'start');
  return true;
}

async function handleExplicitNatal(event, channelApi) {
  startNatalFlow(event, 'command');
  await promptForName(event, channelApi, 'command');
  return true;
}

async function handleCancel(event, channelApi) {
  clearSession(event);
  setPendingQuestion(event, null);
  setChoiceMap(event, {});
  await channelApi.sendText(event, 'Cancelled.');
  return true;
}

async function handleIncomingAction(event, channelApi) {
  const actionId = String(event.actionId || '');

  if (!actionId) {
    return false;
  }

  if (actionId === ACTIONS.HELP_DAILY) {
    await channelApi.ackAction(event);
    await channelApi.sendText(event, 'Try: /daily leo');
    return true;
  }

  if (actionId === ACTIONS.TIME_YES || actionId === ACTIONS.TIME_NO) {
    const session = getSession(event);

    if (!session) {
      await channelApi.ackAction(event, 'Start again with /start');
      return true;
    }

    session.timeKnown = actionId === ACTIONS.TIME_YES;
    session.step = session.timeKnown ? 'time' : 'city';
    setSession(event, session);

    await channelApi.ackAction(event);

    if (session.timeKnown) {
      await promptForBirthTime(event, channelApi);
    } else {
      await promptForCity(event, channelApi, false);
    }

    return true;
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

    await channelApi.ackAction(event, `Using ${formatCityOption(cityMatch)}`);
    await finishNatalFlow(event, channelApi, session, cityMatch);
    return true;
  }

  if (actionId.startsWith(ACTIONS.ASPECT_PREFIX)) {
    const aspectIndex = Number(actionId.slice(ACTIONS.ASPECT_PREFIX.length));
    const aspect = getUiCache(event)?.aspects?.[aspectIndex];

    if (!aspect) {
      await channelApi.ackAction(event, 'Aspect details expired.');
      return true;
    }

    await channelApi.ackAction(event);
    for (const chunk of splitMessage(formatAspectInterpretationMessage(aspect))) {
      await channelApi.sendText(event, chunk);
    }
    return true;
  }

  if (actionId.startsWith(ACTIONS.PLANET_PREFIX)) {
    const planetIndex = Number(actionId.slice(ACTIONS.PLANET_PREFIX.length));
    const planet = getUiCache(event)?.planets?.[planetIndex];

    if (!planet) {
      await channelApi.ackAction(event, 'Placement details expired.');
      return true;
    }

    await channelApi.ackAction(event);
    for (const chunk of splitMessage(formatAspectInterpretationMessage(planet))) {
      await channelApi.sendText(event, chunk);
    }
    return true;
  }

  return false;
}

async function handleActiveFlowText(event, channelApi, text) {
  const session = getSession(event);

  if (!session) {
    return false;
  }

  if (session.step === 'name') {
    session.name = /^skip$/i.test(text) ? 'Telegram User' : text;
    session.step = 'date';
    setSession(event, session);
    await promptForBirthDate(event, channelApi);
    return true;
  }

  if (session.step === 'date') {
    const birthDate = parseDateInput(text);

    if (!birthDate) {
      await channelApi.sendText(event, 'Date format should look like 1990-05-15.');
      return true;
    }

    session.birthDate = birthDate;
    session.step = 'time_known';
    setSession(event, session);

    await channelApi.sendChoices(event, 'Do you know the birth time?', [
      { id: ACTIONS.TIME_YES, title: 'Yes' },
      { id: ACTIONS.TIME_NO, title: 'No' }
    ]);
    return true;
  }

  if (session.step === 'time') {
    const birthTime = parseTimeInput(text);

    if (!birthTime) {
      await channelApi.sendText(event, 'Time format should look like 14:30.');
      return true;
    }

    session.birthTime = birthTime;
    session.step = 'city';
    setSession(event, session);
    await promptForCity(event, channelApi, true);
    return true;
  }

  if (session.step === 'city') {
    try {
      const cityCandidates = await searchCities(text, 3);
      session.city = text;
      session.cityCandidates = cityCandidates;
      session.step = 'city_confirm';
      setSession(event, session);
      await promptForCityConfirmation(event, channelApi, cityCandidates);
    } catch (error) {
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

    await channelApi.sendText(event, 'Choose one of the city options above. If buttons are unavailable, reply with 1, 2, or 3.');
    return true;
  }

  await channelApi.sendText(event, formatUsage('/natal', '/natal'));
  return true;
}

async function handleIncomingText(event, channelApi) {
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
    await promptForName(event, channelApi, 'chat');
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
  handleExplicitNatal,
  handleIncomingAction,
  handleIncomingText,
  handleStart
};
