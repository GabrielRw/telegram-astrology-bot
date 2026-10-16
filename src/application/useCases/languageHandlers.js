const { ACTIONS } = require('../actionIds');
const defaultLocale = require('../../services/locale');
const defaultPersistence = require('../../services/persistence');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultToolCache = require('../../services/toolCache');
const defaultChatState = require('../../state/chatState');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');
const { repromptCurrentStep } = require('./natalFlowPrompts');

function chunkItems(items, size = 3) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function createLanguageHandlers(overrides = {}) {
  const deps = {
    locale: defaultLocale,
    persistence: defaultPersistence,
    natalFlow: defaultNatalFlow,
    toolCache: defaultToolCache,
    chatState: defaultChatState,
    getChatState: defaultChatState.getChatState,
    ...overrides
  };

  return {
    async promptForLanguage(event, channelApi) {
      const choices = deps.locale.getLanguageOptions().map((option) => ({
        id: `${ACTIONS.LANGUAGE_PREFIX}${option.locale}`,
        title: option.title
      }));

      for (const batch of chunkItems(choices, 3)) {
        await channelApi.sendChoices(event, deps.locale.t(event, 'prompts.languagePrompt'), batch);
      }
    },

    async handleLanguageAction(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      scheduleDailyHoroscopePrewarm(event, deps);

      const actionId = String(event.actionId || '');
      const locale = actionId.startsWith(ACTIONS.LANGUAGE_PREFIX)
        ? actionId.slice(ACTIONS.LANGUAGE_PREFIX.length)
        : '';

      if (!locale) {
        await channelApi.ackAction(event, deps.locale.t(event, 'errors.questionExpired'));
        return true;
      }

      await channelApi.ackAction(event);
      const selectedLocale = deps.locale.setManualLocale(event, locale);
      scheduleDailyHoroscopePrewarm(event, deps);
      await channelApi.sendText(event, deps.locale.t(selectedLocale, 'prompts.languageUpdated', {
        language: deps.locale.getLanguageName(selectedLocale, selectedLocale)
      }));
      await repromptCurrentStep(event, channelApi, deps);
      return true;
    }
  };
}

module.exports = {
  createLanguageHandlers
};
