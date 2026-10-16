const defaultPersistence = require('../../services/persistence');
const defaultLocale = require('../../services/locale');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultChatState = require('../../state/chatState');
const { sendGlobalPrompt } = require('../channelPrompts');

function resetFlowState(identity, deps) {
  deps.natalFlow.clearSession(identity);
  deps.chatState.setPendingQuestion(identity, null);
  deps.chatState.setPendingSynastryQuestion(identity, null);
  deps.chatState.setPendingWeddingSelection(identity, null);
  deps.chatState.setChoiceMap(identity, {});
}

function resetConversationContext(identity, deps) {
  const state = deps.chatState.getChatState(identity);
  state.history = [];
  state.lastToolResults = [];
  state.pendingQuestion = null;
  state.pendingSynastryQuestion = null;
  state.pendingWeddingSelection = null;
  state.choiceMap = {};
  deps.chatState.notifyPersistence(identity);
}

function createCancelHandler(overrides = {}) {
  const deps = {
    persistence: defaultPersistence,
    locale: defaultLocale,
    natalFlow: defaultNatalFlow,
    chatState: defaultChatState,
    ...overrides
  };

  return {
    async handleCancel(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      resetFlowState(event, deps);
      resetConversationContext(event, deps);
      await sendGlobalPrompt(event, channelApi, deps.locale.t(event, 'errors.cancelled'), deps);
      return true;
    }
  };
}

module.exports = {
  createCancelHandler,
  resetConversationContext,
  resetFlowState
};
