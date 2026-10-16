const defaultFreeAstro = require('../../services/freeastro');
const defaultLocale = require('../../services/locale');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultProfiles = require('../../services/profiles');
const defaultToolCache = require('../../services/toolCache');
const defaultChatState = require('../../state/chatState');
const { ACTIONS } = require('../actionIds');
const { resetFlowState } = require('./cancelHandler');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');
const {
  formatCityOption,
  promptForBirthDate,
  promptForBirthTime,
  promptForBirthTimeKnown,
  promptForCity,
  promptForCityAfterDateCorrection,
  promptForCityConfirmation
} = require('./natalFlowPrompts');

function isCancelFlowText(event, text, deps) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  const localizedCancel = String(deps.locale.t(event, 'buttons.cancel') || '').trim().toLowerCase();
  return value === '/cancel' || value === localizedCancel || ['cancel', 'annuler', 'abbrechen', 'cancelar'].includes(value);
}

function buildWeddingReplayQuestion(question, spouseAName, spouseBName) {
  return [
    String(question || '').trim(),
    '',
    `Partner A: ${spouseAName}`,
    `Partner B: ${spouseBName}`
  ].join('\n');
}

async function sendEditablePrompt(event, channelApi, text, options = {}) {
  return channelApi.sendText(event, text, options);
}

function createNatalFlowHandler(overrides = {}) {
  const deps = {
    chatState: defaultChatState,
    freeAstro: defaultFreeAstro,
    handleCancel: null,
    locale: defaultLocale,
    natalFlow: defaultNatalFlow,
    profiles: defaultProfiles,
    toolCache: defaultToolCache,
    ...overrides
  };

  async function finishNatalFlow(event, channelApi, session, answerPaidConversation) {
    const lockedSession = deps.natalFlow.lockSession(event, session.flowId);
    const locale = deps.locale.getLocale(event);

    if (!lockedSession) {
      await channelApi.sendText(event, deps.locale.t(locale, 'prompts.stillReading'));
      return true;
    }

    const loadingRef = await sendEditablePrompt(
      event,
      channelApi,
      deps.locale.t(locale, 'prompts.readingChart')
    );

    try {
      const natalPayload = deps.natalFlow.createNatalPayload(lockedSession, lockedSession.cityMatch);
      const chartPayload = deps.natalFlow.createNatalChartPayload(lockedSession, lockedSession.cityMatch);
      const result = await deps.freeAstro.getNatal(natalPayload);

      if (!deps.natalFlow.isSessionCurrent(event, deps.natalFlow.createSessionCheckpoint(lockedSession))) {
        return true;
      }

      deps.natalFlow.clearSession(event);
      const savedProfile = await deps.profiles.saveProfile(event, {
        profileId: lockedSession.targetProfileId || null,
        profileName: lockedSession.profileName || result?.subject?.name || 'Chart User',
        rawNatalPayload: result,
        natalRequestPayload: natalPayload,
        chartRequestPayload: chartPayload,
        birthCountry: lockedSession.cityMatch.country,
        cityLabel: `${lockedSession.cityMatch.name}, ${lockedSession.cityMatch.country}`,
        isActive: lockedSession.mode !== 'add_secondary'
      });

      deps.toolCache.prewarmMonthlyTransitTimeline(event, savedProfile);
      deps.locale.refreshLocaleFromProfile(event);
      scheduleDailyHoroscopePrewarm(event, {
        ...deps,
        getChatState: deps.chatState.getChatState
      });
      deps.chatState.setChoiceMap(event, {});

      const pendingQuestion = deps.chatState.consumePendingQuestion(event);
      const pendingWeddingSelection = deps.chatState.getPendingWeddingSelection(event);

      if (
        lockedSession.mode === 'add_secondary' &&
        pendingQuestion &&
        pendingWeddingSelection?.question &&
        pendingWeddingSelection?.spouseAProfileId
      ) {
        const spouseA = await deps.profiles.getProfileById(event, pendingWeddingSelection.spouseAProfileId);

        if (spouseA && spouseA.profileId !== savedProfile.profileId) {
          deps.chatState.setPendingWeddingSelection(event, null);
          return answerPaidConversation(
            event,
            channelApi,
            buildWeddingReplayQuestion(pendingQuestion, spouseA.profileName, savedProfile.profileName),
            { loadingRef }
          );
        }
      }

      if (lockedSession.mode === 'add_secondary' && !pendingQuestion) {
        await channelApi.editText(
          event,
          loadingRef,
          deps.locale.t(event, 'profile.added', { value: savedProfile.profileName })
        );
        return true;
      }

      if (!pendingQuestion) {
        await channelApi.editText(event, loadingRef, deps.locale.t(event, 'prompts.firstReady'));
        return true;
      }

      return answerPaidConversation(event, channelApi, pendingQuestion, { loadingRef });
    } catch (error) {
      if (deps.natalFlow.isSessionCurrent(event, deps.natalFlow.createSessionCheckpoint(lockedSession))) {
        deps.natalFlow.unlockSession(event, lockedSession.flowId);
      }

      const message = error instanceof deps.freeAstro.FreeAstroError
        ? deps.locale.translateUserError(deps.locale.getLocale(event), error)
        : deps.locale.translateUserError(
            deps.locale.getLocale(event),
            new Error(deps.locale.t(event, 'errors.genericUnexpected'))
          );
      await channelApi.editText(event, loadingRef, message);
      return true;
    }
  }

  async function handleNatalAction(event, channelApi, answerPaidConversation) {
    const actionId = String(event.actionId || '');

    if (actionId !== ACTIONS.TIME_YES && actionId !== ACTIONS.TIME_NO && !actionId.startsWith(ACTIONS.CITY_PREFIX)) {
      return false;
    }

    if (actionId === ACTIONS.TIME_YES || actionId === ACTIONS.TIME_NO) {
      const session = deps.natalFlow.getSession(event);

      if (!session) {
        await channelApi.ackAction(event, deps.locale.t(event, 'errors.startAgain'));
        return true;
      }

      if (session.locked) {
        await channelApi.ackAction(event, deps.locale.t(event, 'prompts.stillReading'));
        return true;
      }

      session.timeKnown = actionId === ACTIONS.TIME_YES;
      session.step = session.timeKnown ? 'time' : 'complete';
      deps.natalFlow.setSession(event, session);
      await channelApi.ackAction(event);

      if (session.timeKnown) {
        await promptForBirthTime(event, channelApi, deps);
        return true;
      }

      return finishNatalFlow(event, channelApi, session, answerPaidConversation);
    }

    if (actionId.startsWith(ACTIONS.CITY_PREFIX)) {
      const session = deps.natalFlow.getSession(event);

      if (!session || session.step !== 'city_confirm') {
        await channelApi.ackAction(event, deps.locale.t(event, 'errors.cityChoicesExpired'));
        return true;
      }

      const cityIndex = Number(actionId.slice(ACTIONS.CITY_PREFIX.length));
      const cityMatch = Array.isArray(session.cityCandidates) ? session.cityCandidates[cityIndex] : null;

      if (!cityMatch) {
        await channelApi.ackAction(event, deps.locale.t(event, 'errors.cityOptionUnavailable'));
        return true;
      }

      if (session.locked) {
        await channelApi.ackAction(event, deps.locale.t(event, 'prompts.stillReading'));
        return true;
      }

      session.cityMatch = cityMatch;
      session.step = 'time_known';
      deps.natalFlow.setSession(event, session);

      await channelApi.ackAction(event, deps.locale.t(event, 'errors.usingCity', { city: formatCityOption(cityMatch) }));
      await promptForBirthTimeKnown(event, channelApi, deps);
      return true;
    }

    return false;
  }

  async function handleActiveFlowText(event, channelApi, text, answerPaidConversation) {
    const session = deps.natalFlow.getSession(event);

    if (!session) {
      return false;
    }

    if (isCancelFlowText(event, text, deps)) {
      if (typeof deps.handleCancel === 'function') {
        return deps.handleCancel(event, channelApi);
      }

      resetFlowState(event, {
        natalFlow: deps.natalFlow,
        chatState: deps.chatState
      });
      await channelApi.sendText(event, deps.locale.t(event, 'errors.cancelled'));
      return true;
    }

    if (session.locked) {
      await channelApi.sendText(event, deps.locale.t(event, 'prompts.stillReading'));
      return true;
    }

    if (session.step === 'name') {
      const profileName = deps.natalFlow.parseProfileNameInput(text);

      if (!profileName) {
        await channelApi.sendText(event, deps.locale.t(event, 'errors.invalidProfileName'));
        return true;
      }

      session.profileName = profileName;
      session.step = 'date';
      deps.natalFlow.setSession(event, session);
      await promptForBirthDate(event, channelApi, 'start', deps);
      return true;
    }

    if (session.step === 'date') {
      const birthDate = deps.natalFlow.parseDateInput(text);

      if (!birthDate) {
        await channelApi.sendText(event, deps.locale.t(event, 'errors.invalidDate'));
        return true;
      }

      session.birthDate = birthDate;
      session.step = 'city';
      deps.natalFlow.setSession(event, session);
      await promptForCity(event, channelApi, deps);
      return true;
    }

    if (session.step === 'city') {
      if (deps.natalFlow.looksLikeDateInput(text)) {
        const correctedDate = deps.natalFlow.parseDateInput(text);

        if (!correctedDate) {
          await channelApi.sendText(event, deps.locale.t(event, 'errors.cityLooksLikeDate'));
          return true;
        }

        session.birthDate = correctedDate;
        deps.natalFlow.setSession(event, session);
        await promptForCityAfterDateCorrection(event, channelApi, correctedDate, deps);
        return true;
      }

      const checkpoint = deps.natalFlow.createSessionCheckpoint(session);

      try {
        const cityCandidates = await deps.freeAstro.searchCities(text, 3);

        if (!deps.natalFlow.isSessionCurrent(event, checkpoint, 'city')) {
          return true;
        }

        const currentSession = deps.natalFlow.getSession(event);
        currentSession.city = text;
        currentSession.cityCandidates = cityCandidates;
        currentSession.step = 'city_confirm';
        deps.natalFlow.setSession(event, currentSession);
        await promptForCityConfirmation(event, channelApi, cityCandidates, deps);
      } catch (error) {
        if (!deps.natalFlow.isSessionCurrent(event, checkpoint, 'city')) {
          return true;
        }

        const message = (
          error instanceof deps.freeAstro.FreeAstroError &&
          deps.locale.localizeUserErrorDetail(deps.locale.getLocale(event), error)
        ) || deps.locale.t(event, 'errors.cityLookupFailed');
        await channelApi.sendText(event, message);
      }
      return true;
    }

    if (session.step === 'city_confirm') {
      const choiceMap = deps.chatState.getChoiceMap(event);
      const mappedAction = choiceMap[String(text).trim()];

      if (mappedAction) {
        return handleNatalAction({ ...event, actionId: mappedAction, type: 'action' }, channelApi, answerPaidConversation);
      }

      await channelApi.sendText(event, deps.locale.t(event, 'errors.chooseCityOption'));
      return true;
    }

    if (session.step === 'time_known') {
      const normalized = String(text || '').trim().toLowerCase();
      const mappedAction = deps.chatState.getChoiceMap(event)[normalized];

      if (mappedAction === ACTIONS.TIME_YES || mappedAction === ACTIONS.TIME_NO) {
        return handleNatalAction({ ...event, actionId: mappedAction, type: 'action' }, channelApi, answerPaidConversation);
      }

      if (normalized === '1') {
        return handleNatalAction({ ...event, actionId: ACTIONS.TIME_YES, type: 'action' }, channelApi, answerPaidConversation);
      }

      if (normalized === '2') {
        return handleNatalAction({ ...event, actionId: ACTIONS.TIME_NO, type: 'action' }, channelApi, answerPaidConversation);
      }

      if (['yes', 'y', 'oui', 'ja', 'si', 'sí'].includes(normalized)) {
        return handleNatalAction({ ...event, actionId: ACTIONS.TIME_YES, type: 'action' }, channelApi, answerPaidConversation);
      }

      if (['no', 'n', 'non', 'nein'].includes(normalized)) {
        return handleNatalAction({ ...event, actionId: ACTIONS.TIME_NO, type: 'action' }, channelApi, answerPaidConversation);
      }

      await channelApi.sendText(event, deps.locale.t(event, 'errors.replyYesNo'));
      return true;
    }

    if (session.step === 'time') {
      const birthTime = deps.natalFlow.parseTimeInput(text);

      if (!birthTime) {
        await channelApi.sendText(event, deps.locale.t(event, 'errors.invalidTime'));
        return true;
      }

      session.birthTime = birthTime;
      session.step = 'complete';
      deps.natalFlow.setSession(event, session);
      return finishNatalFlow(event, channelApi, session, answerPaidConversation);
    }

    return false;
  }

  return {
    finishNatalFlow,
    handleActiveFlowText,
    handleNatalAction
  };
}

module.exports = {
  buildWeddingReplayQuestion,
  createNatalFlowHandler,
  isCancelFlowText
};
