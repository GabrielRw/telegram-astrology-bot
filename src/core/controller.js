const { ACTIONS } = require('../application/actionIds');
const { scheduleDailyHoroscopePrewarm } = require('../application/dailyHoroscopePrewarm');
const { createConversationSelectionActionHandler } = require('../application/useCases/conversationSelectionActionHandler');
const { createConversationAnswerHandler } = require('../application/useCases/conversationAnswerHandler');
const { createBillingHandlers } = require('../application/useCases/billingHandlers');
const { createCancelHandler } = require('../application/useCases/cancelHandler');
const { createDailyHoroscopeHandler } = require('../application/useCases/dailyHoroscopeHandler');
const { createNatalFlowHandler } = require('../application/useCases/natalFlowHandler');
const {
  promptForBirthDate,
  promptForProfileName
} = require('../application/useCases/natalFlowPrompts');
const { createProfileHandler } = require('../application/useCases/profileHandler');
const { createStartHandler } = require('../application/useCases/startHandler');
const {
  getLocale,
  syncLocaleFromEvent,
  t
} = require('../services/locale');
const persistence = require('../services/persistence');
const toolCache = require('../services/toolCache');
const {
  clearSession,
  startNatalFlow
} = require('../services/natalFlow');
const {
  getChoiceMap,
  getChatState,
  setChoiceMap,
  setPendingSynastryQuestion,
  setPendingWeddingSelection,
  setPendingQuestion
} = require('../state/chatState');

const billingHandlers = createBillingHandlers();
const cancelHandlers = createCancelHandler();
const conversationAnswerHandlers = createConversationAnswerHandler();
const dailyHoroscopeHandlers = createDailyHoroscopeHandler();
const conversationSelectionActionHandlers = createConversationSelectionActionHandler();
const natalFlowHandlers = createNatalFlowHandler();
const profileHandlers = createProfileHandler();
const startHandlers = createStartHandler();
const prewarmDeps = {
  getChatState,
  locale: { getLocale },
  toolCache
};
const promptDeps = {
  locale: { getLocale, t }
};

function isCancelFlowText(event, text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  const localizedCancel = String(t(event, 'buttons.cancel') || '').trim().toLowerCase();
  return value === '/cancel' || value === localizedCancel || ['cancel', 'annuler', 'abbrechen', 'cancelar'].includes(value);
}

function isSettingsIntent(event, text) {
  const value = String(text || '').trim().toLowerCase();
  const localized = String(t(event, 'buttons.settings') || '').trim().toLowerCase();

  if (!value) {
    return false;
  }

  return value === localized || [
    '/profile',
    '/reglage',
    '/settings',
    '/einstellungen',
    '/ajustes',
    'settings',
    'reglages',
    'réglages',
    'einstellungen',
    'ajustes'
  ].includes(value);
}

function isDailyHoroscopeIntent(event, text) {
  const value = String(text || '').trim().toLowerCase();
  const localized = String(t(event, 'buttons.dailyHoroscope') || '').trim().toLowerCase();

  if (!value) {
    return false;
  }

  return value === localized || [
    'my daily horoscope',
    'mon horoscope du jour',
    'mein tageshoroskop',
    'mi horóscopo del día',
    'mi horoscopo del dia'
  ].includes(value);
}

function isAddProfileIntent(event, text) {
  const value = String(text || '').trim().toLowerCase();

  if (!value) {
    return false;
  }

  return [
    'ajoute un nouveau profil',
    'ajoute un profil',
    'ajouter un profil',
    'crée un nouveau profil',
    'cree un nouveau profil',
    'crée un profil',
    'cree un profil',
    'nouveau profil',
    'add a new profile',
    'add profile',
    'new profile',
    'neues profil',
    'profil hinzufügen',
    'profil hinzufugen',
    'añadir perfil',
    'anadir perfil',
    'nuevo perfil'
  ].includes(value);
}

function resetFlowState(identity) {
  clearSession(identity);
  setPendingQuestion(identity, null);
  setPendingSynastryQuestion(identity, null);
  setPendingWeddingSelection(identity, null);
  setChoiceMap(identity, {});
}

async function handleDailyHoroscope(event, channelApi) {
  return dailyHoroscopeHandlers.handleDailyHoroscope(event, channelApi);
}

async function answerPaidConversation(event, channelApi, userText, options = {}) {
  return conversationAnswerHandlers.handleConversationAnswer(event, channelApi, userText, options);
}

async function finishNatalFlow(event, channelApi, session) {
  return natalFlowHandlers.finishNatalFlow(event, channelApi, session, answerPaidConversation);
}

async function handleStart(event, channelApi) {
  return startHandlers.handleStart(event, channelApi);
}

async function handleProfile(event, channelApi) {
  return profileHandlers.handleProfile(event, channelApi);
}

async function handleBilling(event, channelApi) {
  return billingHandlers.handleBilling(event, channelApi);
}

async function handleSubscribe(event, channelApi) {
  return billingHandlers.handleSubscribe(event, channelApi);
}

async function handleCancel(event, channelApi) {
  return cancelHandlers.handleCancel(event, channelApi);
}

async function handleIncomingAction(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  scheduleDailyHoroscopePrewarm(event, prewarmDeps);
  const actionId = String(event.actionId || '');

  if (!actionId) {
    return false;
  }

  const handledConversationSelection = await conversationSelectionActionHandlers
    .handleConversationSelectionAction(event, channelApi, answerPaidConversation);
  if (handledConversationSelection) {
    return true;
  }

  const handledNatalAction = await natalFlowHandlers.handleNatalAction(
    event,
    channelApi,
    answerPaidConversation
  );
  if (handledNatalAction) {
    return true;
  }

  return false;
}

async function handleActiveFlowText(event, channelApi, text) {
  return natalFlowHandlers.handleActiveFlowText(event, channelApi, text, answerPaidConversation);
}

async function handleIncomingText(event, channelApi) {
  await persistence.ensureHydrated(event);
  syncLocaleFromEvent(event);
  const text = String(event.text || '').trim();
  const chatState = getChatState(event);
  scheduleDailyHoroscopePrewarm(event, prewarmDeps, chatState);

  if (!text) {
    return false;
  }

  if (isSettingsIntent(event, text)) {
    if (chatState.activeFlow) {
      resetFlowState(event);
    }
    return handleProfile(event, channelApi);
  }

  if (isDailyHoroscopeIntent(event, text)) {
    if (chatState.activeFlow) {
      resetFlowState(event);
    }
    return handleDailyHoroscope(event, channelApi);
  }

  if (chatState.activeFlow && isCancelFlowText(event, text)) {
    return handleCancel(event, channelApi);
  }

  const mappedAction = getChoiceMap(event)[text];
  if (mappedAction && (
    mappedAction.startsWith(ACTIONS.SYNASTRY_PARTNER_PREFIX) ||
    mappedAction.startsWith(ACTIONS.WEDDING_SPOUSE_A_PREFIX) ||
    mappedAction.startsWith(ACTIONS.WEDDING_SPOUSE_B_PREFIX) ||
    mappedAction === ACTIONS.WEDDING_SPOUSE_B_NEW ||
    mappedAction.startsWith(ACTIONS.PROFILE_SWITCH_PREFIX) ||
    (!chatState.activeFlow && (
      mappedAction === ACTIONS.TIME_YES ||
      mappedAction === ACTIONS.TIME_NO ||
      mappedAction.startsWith(ACTIONS.CITY_PREFIX)
    ))
  )) {
    return handleIncomingAction({ ...event, actionId: mappedAction, type: 'action' }, channelApi);
  }

  if (chatState.pendingSynastryQuestion) {
    setPendingSynastryQuestion(event, null);
  }

  if (chatState.pendingWeddingSelection && !chatState.activeFlow) {
    setPendingWeddingSelection(event, null);
  }

  const handledFlow = await handleActiveFlowText(event, channelApi, text);
  if (handledFlow) {
    return true;
  }

  if (chatState.natalProfile && isAddProfileIntent(event, text)) {
    setPendingQuestion(event, null);
    startNatalFlow(event, 'profile', { mode: 'add_secondary' });
    await promptForProfileName(event, channelApi, promptDeps);
    return true;
  }

  if (!chatState.natalProfile) {
    setPendingQuestion(event, text);
    startNatalFlow(event, 'chat', { mode: 'create_primary' });
    await promptForBirthDate(event, channelApi, 'chat', promptDeps);
    return true;
  }

  return answerPaidConversation(event, channelApi, text);
}

module.exports = {
  handleIncomingAction,
  handleIncomingText
};
