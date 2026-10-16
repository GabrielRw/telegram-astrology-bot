const defaultPersistence = require('../../services/persistence');
const defaultLocale = require('../../services/locale');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultToolCache = require('../../services/toolCache');
const defaultChatState = require('../../state/chatState');
const { sendGlobalPrompt } = require('../channelPrompts');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');
const { resetFlowState } = require('./cancelHandler');
const { promptForBirthDate } = require('./natalFlowPrompts');

function getWelcomeBackMessage(locale, activeProfileName = null, localeService) {
  const profileName = String(activeProfileName || '').trim();
  return profileName
    ? localeService.t(locale, 'prompts.welcomeBackWithProfile', { profileName })
    : localeService.t(locale, 'prompts.welcomeBack');
}

function createStartHandler(overrides = {}) {
  const deps = {
    persistence: defaultPersistence,
    locale: defaultLocale,
    natalFlow: defaultNatalFlow,
    toolCache: defaultToolCache,
    chatState: defaultChatState,
    getChatState: defaultChatState.getChatState,
    ...overrides
  };

  return {
    async handleStart(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      const chatState = deps.getChatState(event);
      scheduleDailyHoroscopePrewarm(event, deps, chatState);
      const hadActiveFlow = Boolean(chatState.activeFlow);

      if (hadActiveFlow) {
        resetFlowState(event, deps);
      }

      if (chatState.natalProfile) {
        const activeProfileName = Array.isArray(chatState.profileDirectory)
          ? chatState.profileDirectory.find((entry) => entry.profileId === chatState.activeProfileId)?.profileName
          : null;
        await sendGlobalPrompt(
          event,
          channelApi,
          getWelcomeBackMessage(
            deps.locale.getLocale(event),
            activeProfileName || chatState.natalProfile?.name,
            deps.locale
          ),
          deps
        );
        return true;
      }

      deps.chatState.setPendingQuestion(event, null);
      deps.natalFlow.startNatalFlow(event, 'start', { mode: 'create_primary' });
      await promptForBirthDate(event, channelApi, 'start', deps);
      return true;
    }
  };
}

module.exports = {
  createStartHandler
};
