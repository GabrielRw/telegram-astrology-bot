const { answerConversation } = require('../services/conversation');
const { renderAstrocartographyMap } = require('../services/astroMap');
const { registerInteractiveAstroMap } = require('../services/interactiveAstroMap');
const billing = require('../services/billing');
const { FreeAstroError, getNatal, getNatalChart, searchCities } = require('../services/freeastro');
const { getGeminiErrorMessage } = require('../services/gemini');
const profiles = require('../services/profiles');
const {
  getLanguageName,
  getLanguageOptions,
  getLocale,
  refreshLocaleFromProfile,
  setManualLocale,
  syncLocaleFromEvent,
  t,
  translateUserError
} = require('../services/locale');
const persistence = require('../services/persistence');
const toolCache = require('../services/toolCache');
const {
  clearSession,
  createNatalChartPayload,
  createSessionCheckpoint,
  createNatalPayload,
  getSession,
  isSessionCurrent,
  lockSession,
  parseDateInput,
  parseProfileNameInput,
  parseTimeInput,
  setSession,
  startNatalFlow,
  unlockSession
} = require('../services/natalFlow');
const {
  consumePendingQuestion,
  getChoiceMap,
  getChatState,
  getResponseMode,
  notifyPersistence,
  setChoiceMap,
  setPendingSynastryQuestion,
  setPendingQuestion,
  setResponseMode
} = require('../state/chatState');
const {
  formatNatalMessage,
  splitConversationReply
} = require('../utils/format');

const ACTIONS = {
  TIME_YES: 'NATAL_TIME_YES',
  TIME_NO: 'NATAL_TIME_NO',
  CITY_PREFIX: 'NATAL_CITY_',
  LANGUAGE_PREFIX: 'LANGUAGE_',
  PROFILE_ADD: 'PROFILE_ADD',
  PROFILE_SWITCH_PREFIX: 'PROFILE_SWITCH_',
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  PROFILE_RESET: 'PROFILE_RESET',
  PROFILE_SHOW_CHART: 'PROFILE_SHOW_CHART',
  PROFILE_TOGGLE_RESPONSE_MODE: 'PROFILE_TOGGLE_RESPONSE_MODE',
  SYNASTRY_PARTNER_PREFIX: 'SYNASTRY_PARTNER_'
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

async function sendChoiceBatches(event, channelApi, prompt, choices, size = 3) {
  for (const batch of chunkQuestions(choices, size)) {
    await channelApi.sendChoices(event, prompt, batch);
  }
}

function resetConversationContext(identity) {
  const state = getChatState(identity);
  state.history = [];
  state.lastToolResults = [];
  state.pendingQuestion = null;
  state.pendingSynastryQuestion = null;
  state.choiceMap = {};
  notifyPersistence(identity);
}

function getWelcomeBackMessage(locale) {
  return t(locale, 'prompts.welcomeBack');
}

function getOnboardingIntro(locale, source = 'start') {
  return source === 'chat'
    ? t(locale, 'prompts.onboardingChat')
    : t(locale, 'prompts.onboardingStart');
}

function formatBillingLinkMessage(event, checkoutUrl) {
  return [
    t(event, 'billing.limitReached', { limit: billing.FREE_QUESTIONS_PER_DAY }),
    billing.getUpgradePitch((path, args) => t(event, path, args))
  ].join('\n\n');
}

async function sendExternalLink(event, channelApi, prompt, labelKey, url) {
  if (typeof channelApi.sendLink === 'function') {
    await channelApi.sendLink(event, prompt, t(event, labelKey), url);
    return true;
  }

  await channelApi.sendText(event, `${prompt}\n\n${t(event, labelKey)}: ${url}`);
  return true;
}

async function maybeBuildCheckoutLink(identity) {
  if (!billing.isStripeConfigured()) {
    return null;
  }

  try {
    return await billing.createCheckoutSessionUrl(identity);
  } catch (error) {
    return null;
  }
}

async function sendBillingStatus(event, channelApi) {
  const access = await billing.getAccessSummary(event);
  const lines = [billing.getBillingStatusLabel(access, (path, args) => t(event, path, args))];

  if (access.unlimited) {
    try {
      const portalUrl = await billing.createCustomerPortalUrl(event);
      const prompt = [...lines, t(event, 'billing.portalReady')].join('\n\n');
      await sendExternalLink(event, channelApi, prompt, 'billing.manageButton', portalUrl);
      return true;
    } catch (error) {
      lines.push(t(event, 'billing.portalUnavailable'));
    }
  } else {
    lines.push(billing.getUpgradePitch((path, args) => t(event, path, args)));
    lines.push(
      billing.isStripeConfigured()
        ? t(event, 'billing.subscribePrompt')
        : t(event, 'billing.checkoutUnavailable')
    );
  }

  await channelApi.sendText(event, lines.join('\n\n'));
  return true;
}

async function handleQuestionLimit(event, channelApi, loadingRef = null) {
  const checkoutUrl = await maybeBuildCheckoutLink(event);
  const message = checkoutUrl
    ? formatBillingLinkMessage(event, checkoutUrl)
    : [t(event, 'billing.limitReached', { limit: billing.FREE_QUESTIONS_PER_DAY }), t(event, 'billing.checkoutUnavailable')].join('\n\n');

  if (loadingRef && !checkoutUrl) {
    await channelApi.editText(event, loadingRef, message);
    return true;
  }

  if (checkoutUrl) {
    if (loadingRef) {
      await channelApi.editText(event, loadingRef, message);
    }

    return sendExternalLink(event, channelApi, message, 'billing.subscribeButton', checkoutUrl);
  }

  await channelApi.sendText(event, message);
  return true;
}

async function answerPaidConversation(event, channelApi, userText, options = {}) {
  const access = await billing.getAccessSummary(event);

  if (access.limitReached) {
    return handleQuestionLimit(event, channelApi, options.loadingRef || null);
  }

  const loadingRef = options.loadingRef || await channelApi.sendText(event, t(event, 'prompts.readingChart'));

  try {
    const result = await answerConversation(event, userText);

    if (result?.requiresSynastryProfileSelection) {
      setPendingSynastryQuestion(event, userText);
      await channelApi.editText(
        event,
        loadingRef,
        result.candidates?.length > 0 ? t(event, 'errors.choosePartnerProfile') : t(event, 'profile.noOtherProfiles')
      );

      if (result.candidates?.length > 0) {
        await sendSynastryPartnerChoices(event, channelApi, result.candidates);
      }

      return true;
    }

    if (result?.renderMode === 'telegram_pre' && event.channel === 'telegram') {
      await channelApi.editText(event, loadingRef, result.text, { html: true });
      await billing.recordAnsweredQuestion(event);
      await maybeSendAstroMap(event, channelApi, userText, result);
      return true;
    }

    if (Array.isArray(result?.textParts) && result.textParts.length > 0) {
      await channelApi.editText(event, loadingRef, result.textParts[0]);

      for (const part of result.textParts.slice(1)) {
        await channelApi.sendText(event, part);
      }

      await billing.recordAnsweredQuestion(event);
      await maybeSendAstroMap(event, channelApi, userText, result);
      return true;
    }

    const chunks = splitConversationReply(result.text);

    if (chunks.length === 0) {
      await channelApi.editText(event, loadingRef, t(event, 'errors.noGroundedAnswer'));
      return true;
    }

    await channelApi.editText(event, loadingRef, chunks[0]);

    for (const chunk of chunks.slice(1)) {
      await channelApi.sendText(event, chunk);
    }

    await billing.recordAnsweredQuestion(event);
    await maybeSendAstroMap(event, channelApi, userText, result);
  } catch (error) {
    const errorMessage = error?.name === 'FreeAstroError'
      ? translateUserError(getLocale(event), error)
      : getGeminiErrorMessage(error, getLocale(event));
    await channelApi.editText(
      event,
      loadingRef,
      `${t(event, 'errors.conversationUnavailable')}\n${errorMessage}`
    );
  }

  return true;
}

async function promptForBirthDate(event, channelApi, source = 'start') {
  const locale = getLocale(event);
  await channelApi.sendText(event, getOnboardingIntro(locale, source));
}

async function promptForProfileName(event, channelApi) {
  await channelApi.sendText(event, t(event, 'prompts.profileNamePrompt'));
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

async function maybeSendAstroMap(event, channelApi, userText, conversationResult) {
  if (conversationResult?.intent !== 'relocation') {
    return;
  }

  if (!Array.isArray(conversationResult?.usedTools) || conversationResult.usedTools.length === 0) {
    return;
  }

  try {
    const rendered = await renderAstrocartographyMap({
      locale: getLocale(event),
      toolResults: conversationResult.usedTools,
      userText,
      renderMode: 'atlas',
      projectionName: 'equirectangular'
    });

    if (!rendered) {
      return;
    }

    await channelApi.sendImage(event, rendered.buffer, {
      filename: rendered.filename
    });

    const interactiveUrl = registerInteractiveAstroMap({
      locale: getLocale(event),
      toolResults: conversationResult.usedTools,
      userText
    });

    if (interactiveUrl) {
      await sendExternalLink(
        event,
        channelApi,
        t(event, 'prompts.interactiveMapPrompt'),
        'buttons.openInteractiveMap',
        interactiveUrl
      );
    }
  } catch (error) {
    return;
  }
}

function buildProfileMessage(chatState, access) {
  const profile = chatState.natalProfile;
  const locale = getLocale(chatState);
  const directory = Array.isArray(chatState.profileDirectory) ? chatState.profileDirectory : [];

  if (!profile) {
    return [
      t(locale, 'profile.none'),
      '',
      billing.getBillingStatusLabel(access, (path, args) => t(locale, path, args))
    ].join('\n');
  }

  const birthDate = profile.birthDatetime ? String(profile.birthDatetime).slice(0, 10) : 'Unknown';
  const city = profile.city || 'Unknown';
  const activeProfileName = directory.find((entry) => entry.profileId === chatState.activeProfileId)?.profileName || profile.name || 'Chart User';
  const savedProfiles = directory.length > 0
    ? directory
        .map((entry) => entry.profileId === chatState.activeProfileId ? `${entry.profileName} (active)` : entry.profileName)
        .join(', ')
    : activeProfileName;
  const timeLine = profile.timeKnown
    ? t(locale, 'profile.birthTimeSaved', { value: String(profile.birthDatetime).slice(11, 16) || 'Saved' })
    : t(locale, 'profile.birthTimeMissing');
  const responseMode = getResponseMode(chatState);
  const responseModeLabel = t(locale, `responseModes.${responseMode}`);

  return [
    t(locale, 'profile.title'),
    '',
    t(locale, 'profile.activeProfile', { value: activeProfileName }),
    t(locale, 'profile.savedProfiles', { value: savedProfiles }),
    t(locale, 'profile.birthDate', { value: birthDate }),
    t(locale, 'profile.city', { value: city }),
    timeLine,
    t(locale, 'profile.language', { value: getLanguageName(chatState.locale, locale) }),
    t(locale, 'profile.responseMode', { value: responseModeLabel }),
    t(locale, 'profile.billing', {
      value: billing.getBillingStatusLabel(access, (path, args) => t(locale, path, args))
    }),
    '',
    t(locale, 'profile.footer'),
    t(locale, 'profile.billingFooter')
  ].join('\n');
}

async function sendProfileActions(event, channelApi, chatState) {
  const responseMode = getResponseMode(chatState);
  const choices = [
    { id: ACTIONS.PROFILE_ADD, title: t(event, 'buttons.addProfile') },
    { id: ACTIONS.PROFILE_UPDATE, title: t(event, 'buttons.update') },
    { id: ACTIONS.PROFILE_RESET, title: t(event, 'buttons.reset') },
    { id: ACTIONS.PROFILE_SHOW_CHART, title: t(event, 'buttons.showChart') },
    {
      id: ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE,
      title: t(event, responseMode === 'raw' ? 'buttons.enableInterpretedMode' : 'buttons.enableRawMode')
    }
  ];

  const otherProfiles = (chatState.profileDirectory || []).filter((entry) => entry.profileId !== chatState.activeProfileId);
  if (otherProfiles.length > 0) {
    choices.splice(1, 0, {
      id: `${ACTIONS.PROFILE_SWITCH_PREFIX}${otherProfiles[0].profileId}`,
      title: `${t(event, 'buttons.switchProfile')}: ${otherProfiles[0].profileName}`.slice(0, 60)
    });
  }

  await sendChoiceBatches(event, channelApi, t(event, 'prompts.profileActions'), choices);

  if (otherProfiles.length > 1) {
    const switchChoices = otherProfiles.slice(1).map((entry) => ({
      id: `${ACTIONS.PROFILE_SWITCH_PREFIX}${entry.profileId}`,
      title: entry.profileName.slice(0, 60)
    }));

    await sendChoiceBatches(event, channelApi, t(event, 'prompts.profileSwitch'), switchChoices);
  }
}

async function sendSynastryPartnerChoices(event, channelApi, candidates) {
  const choices = candidates.map((candidate) => ({
    id: `${ACTIONS.SYNASTRY_PARTNER_PREFIX}${candidate.profileId}`,
    title: `${candidate.profileName}${candidate.cityLabel ? ` • ${candidate.cityLabel}` : ''}`.slice(0, 60)
  }));

  if (choices.length === 0) {
    await channelApi.sendText(event, t(event, 'profile.noOtherProfiles'));
    return;
  }

  setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(event, channelApi, t(event, 'prompts.synastryPartner'), choices);
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
    const savedProfile = await profiles.saveProfile(event, {
      profileId: lockedSession.targetProfileId || null,
      profileName: lockedSession.profileName || result?.subject?.name || 'Chart User',
      rawNatalPayload: result,
      natalRequestPayload: natalPayload,
      chartRequestPayload: chartPayload,
      birthCountry: lockedSession.cityMatch.country,
      cityLabel: `${lockedSession.cityMatch.name}, ${lockedSession.cityMatch.country}`,
      isActive: lockedSession.mode !== 'add_secondary'
    });

    toolCache.prewarmMonthlyTransitTimeline(event, savedProfile);
    refreshLocaleFromProfile(event);
    setChoiceMap(event, {});

    const pendingQuestion = consumePendingQuestion(event);

    if (lockedSession.mode === 'add_secondary' && !pendingQuestion) {
      await channelApi.editText(
        event,
        loadingRef,
        t(event, 'profile.added', { value: savedProfile.profileName })
      );
      return true;
    }

    if (!pendingQuestion) {
      await channelApi.editText(event, loadingRef, t(event, 'prompts.firstReady'));
      return true;
    }

    return answerPaidConversation(event, channelApi, pendingQuestion, { loadingRef });
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
    return true;
  }

  setPendingQuestion(event, null);
  startNatalFlow(event, 'start', { mode: 'create_primary' });
  await promptForBirthDate(event, channelApi, 'start');
  return true;
}

async function handleProfile(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const chatState = getChatState(event);
  const access = await billing.getAccessSummary(event);
  await channelApi.sendText(event, buildProfileMessage(chatState, access));

  if (chatState.natalProfile) {
    await sendProfileActions(event, channelApi, chatState);
  }

  return true;
}

async function handleBilling(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  return sendBillingStatus(event, channelApi);
}

async function handleSubscribe(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);

  const access = await billing.getAccessSummary(event);

  if (access.unlimited) {
    return sendBillingStatus(event, channelApi);
  }

  const checkoutUrl = await maybeBuildCheckoutLink(event);

  if (!checkoutUrl) {
    await channelApi.sendText(event, t(event, 'billing.checkoutUnavailable'));
    return true;
  }

  return sendExternalLink(
    event,
    channelApi,
    [
      billing.getUpgradePitch((path, args) => t(event, path, args)),
      t(event, 'billing.subscribePrompt')
    ].join('\n\n'),
    'billing.subscribeButton',
    checkoutUrl
  );
}

async function handleCancel(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  clearSession(event);
  resetConversationContext(event);
  setPendingQuestion(event, null);
  setPendingSynastryQuestion(event, null);
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

  if (session.step === 'name') {
    await promptForProfileName(event, channelApi);
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

  if (actionId === ACTIONS.PROFILE_ADD) {
    await channelApi.ackAction(event);
    setPendingQuestion(event, null);
    startNatalFlow(event, 'profile', { mode: 'add_secondary' });
    await promptForProfileName(event, channelApi);
    return true;
  }

  if (actionId.startsWith(ACTIONS.PROFILE_SWITCH_PREFIX)) {
    const profileId = actionId.slice(ACTIONS.PROFILE_SWITCH_PREFIX.length);

    if (!profileId) {
      await channelApi.ackAction(event, t(event, 'errors.profileUnavailable'));
      return true;
    }

    const nextProfile = await profiles.setActiveProfile(event, profileId);

    if (!nextProfile) {
      await channelApi.ackAction(event, t(event, 'errors.profileUnavailable'));
      return true;
    }

    clearSession(event);
    resetConversationContext(event);
    refreshLocaleFromProfile(event);
    await channelApi.ackAction(event);
    await channelApi.sendText(event, t(event, 'profile.switched', { value: nextProfile.profileName }));
    return true;
  }

  if (actionId === ACTIONS.PROFILE_UPDATE) {
    await channelApi.ackAction(event);
    setPendingQuestion(event, null);
    const activeProfile = await profiles.getActiveProfile(event);

    startNatalFlow(event, 'profile', {
      mode: 'update_active',
      targetProfileId: activeProfile?.profileId || null,
      profileName: activeProfile?.profileName || null
    });
    await promptForBirthDate(event, channelApi, 'start');
    return true;
  }

  if (actionId === ACTIONS.PROFILE_RESET) {
    await channelApi.ackAction(event);
    const activeProfile = await profiles.getActiveProfile(event);

    if (!activeProfile) {
      await channelApi.sendText(event, t(event, 'profile.cleared'));
      return true;
    }

    await profiles.deleteProfile(event, activeProfile.profileId);
    clearSession(event);
    resetConversationContext(event);
    setChoiceMap(event, {});
    refreshLocaleFromProfile(event);
    await channelApi.sendText(event, t(event, 'profile.deleted', { value: activeProfile.profileName }));
    return true;
  }

  if (actionId === ACTIONS.PROFILE_SHOW_CHART) {
    await channelApi.ackAction(event);
    return sendCompactChart(event, channelApi);
  }

  if (actionId === ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE) {
    const nextMode = getResponseMode(event) === 'raw' ? 'interpreted' : 'raw';
    setResponseMode(event, nextMode);
    await channelApi.ackAction(event);
    const refreshedState = getChatState(event);
    const access = await billing.getAccessSummary(event);
    await channelApi.sendText(event, buildProfileMessage(refreshedState, access));
    if (refreshedState.natalProfile) {
      await sendProfileActions(event, channelApi, refreshedState);
    }
    return true;
  }

  if (actionId.startsWith(ACTIONS.SYNASTRY_PARTNER_PREFIX)) {
    const profileId = actionId.slice(ACTIONS.SYNASTRY_PARTNER_PREFIX.length);
    const selectedProfile = await profiles.getProfileById(event, profileId);

    if (!selectedProfile) {
      await channelApi.ackAction(event, t(event, 'errors.profileUnavailable'));
      return true;
    }

    await channelApi.ackAction(event);
    return answerPaidConversation(
      event,
      channelApi,
      `Compare me with ${selectedProfile.profileName}`
    );
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

  if (session.step === 'name') {
    const profileName = parseProfileNameInput(text);

    if (!profileName) {
      await channelApi.sendText(event, t(event, 'errors.invalidProfileName'));
      return true;
    }

    session.profileName = profileName;
    session.step = 'date';
    setSession(event, session);
    await promptForBirthDate(event, channelApi, 'start');
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

  if (text === '/billing') {
    return handleBilling(event, channelApi);
  }

  if (text === '/subscribe') {
    return handleSubscribe(event, channelApi);
  }

  const mappedAction = getChoiceMap(event)[text];
  if (mappedAction && (
    mappedAction.startsWith(ACTIONS.SYNASTRY_PARTNER_PREFIX) ||
    mappedAction.startsWith(ACTIONS.PROFILE_SWITCH_PREFIX) ||
    mappedAction.startsWith(ACTIONS.CITY_PREFIX)
  )) {
    return handleIncomingAction({ ...event, actionId: mappedAction, type: 'action' }, channelApi);
  }

  if (getChatState(event).pendingSynastryQuestion) {
    setPendingSynastryQuestion(event, null);
  }

  const handledFlow = await handleActiveFlowText(event, channelApi, text);
  if (handledFlow) {
    return true;
  }

  const chatState = getChatState(event);

  if (!chatState.natalProfile) {
    setPendingQuestion(event, text);
    startNatalFlow(event, 'chat', { mode: 'create_primary' });
    await promptForBirthDate(event, channelApi, 'chat');
    return true;
  }

  return answerPaidConversation(event, channelApi, text);
}

module.exports = {
  ACTIONS,
  handleBilling,
  handleCancel,
  handleIncomingAction,
  handleIncomingText,
  promptForLanguage,
  handleProfile,
  handleSubscribe,
  handleStart
};
