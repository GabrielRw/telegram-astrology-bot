const defaultPersistence = require('../../services/persistence');
const defaultLocale = require('../../services/locale');
const defaultProfiles = require('../../services/profiles');
const defaultToolCache = require('../../services/toolCache');
const { FreeAstroError } = require('../../services/freeastro');
const { getGeminiErrorMessage } = require('../../services/gemini');
const defaultChatState = require('../../state/chatState');
const { sendGlobalPrompt } = require('../channelPrompts');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');

async function sendEditablePrompt(event, channelApi, text, options = {}) {
  return channelApi.sendText(event, text, options);
}

function createDailyHoroscopeHandler(overrides = {}) {
  const deps = {
    persistence: defaultPersistence,
    locale: defaultLocale,
    profiles: defaultProfiles,
    toolCache: defaultToolCache,
    getChatState: defaultChatState.getChatState,
    FreeAstroError,
    getGeminiErrorMessage,
    ...overrides
  };

  return {
    async handleDailyHoroscope(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      scheduleDailyHoroscopePrewarm(event, deps);

      const profile = await deps.profiles.getActiveProfile(event);

      if (!profile) {
        await sendGlobalPrompt(
          event,
          channelApi,
          deps.locale.t(event, 'errors.dailyHoroscopeNeedsProfile'),
          deps
        );
        return true;
      }

      const locale = deps.locale.getLocale(event);
      const questionText = deps.locale.t(event, 'buttons.dailyHoroscope');
      const cached = await deps.toolCache.getCachedDailyHoroscope(event, profile, {
        locale,
        questionText
      });

      if (String(cached?.result?.text || '').trim()) {
        await sendGlobalPrompt(event, channelApi, cached.result.text.trim(), deps);
        return true;
      }

      const loadingRef = await sendEditablePrompt(
        event,
        channelApi,
        deps.locale.t(event, 'prompts.readingChart')
      );

      try {
        const resolved = await deps.toolCache.ensureDailyHoroscope(event, profile, {
          locale,
          questionText
        });
        const text = String(resolved?.result?.text || '').trim() ||
          deps.locale.t(event, 'errors.noGroundedAnswer');
        await channelApi.editText(event, loadingRef, text);
      } catch (error) {
        const message = error instanceof deps.FreeAstroError
          ? deps.locale.translateUserError(locale, error)
          : deps.getGeminiErrorMessage(error, locale);
        await channelApi.editText(event, loadingRef, message);
      }

      return true;
    }
  };
}

module.exports = {
  createDailyHoroscopeHandler
};
