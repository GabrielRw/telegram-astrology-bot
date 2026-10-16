const { ACTIONS } = require('../actionIds');
const { sendGlobalPrompt } = require('../channelPrompts');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');
const defaultBilling = require('../../services/billing');
const defaultPersistence = require('../../services/persistence');
const defaultLocale = require('../../services/locale');
const defaultToolCache = require('../../services/toolCache');
const defaultChatState = require('../../state/chatState');

function buildProfileMessage(chatState, access, deps) {
  const profile = chatState.natalProfile;
  const locale = deps.locale.getLocale(chatState);
  const directory = Array.isArray(chatState.profileDirectory) ? chatState.profileDirectory : [];

  if (!profile) {
    return [
      deps.locale.t(locale, 'profile.none'),
      '',
      deps.billing.getBillingStatusLabel(access, (path, args) => deps.locale.t(locale, path, args))
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
    ? deps.locale.t(locale, 'profile.birthTimeSaved', { value: String(profile.birthDatetime).slice(11, 16) || 'Saved' })
    : deps.locale.t(locale, 'profile.birthTimeMissing');

  return [
    deps.locale.t(locale, 'profile.title'),
    '',
    deps.locale.t(locale, 'profile.activeProfile', { value: activeProfileName }),
    deps.locale.t(locale, 'profile.savedProfiles', { value: savedProfiles }),
    deps.locale.t(locale, 'profile.birthDate', { value: birthDate }),
    deps.locale.t(locale, 'profile.city', { value: city }),
    timeLine,
    deps.locale.t(locale, 'profile.language', { value: deps.locale.getLanguageName(chatState.locale, locale) }),
    deps.locale.t(locale, 'profile.billing', {
      value: deps.billing.getBillingStatusLabel(access, (path, args) => deps.locale.t(locale, path, args))
    }),
    '',
    deps.locale.t(locale, 'profile.footer'),
    deps.locale.t(locale, 'profile.billingFooter')
  ].join('\n');
}

async function sendProfileActions(event, channelApi, deps) {
  const choices = [
    { id: ACTIONS.PROFILE_ADD, title: deps.locale.t(event, 'buttons.addProfile') },
    { id: ACTIONS.PROFILE_SWITCH, title: deps.locale.t(event, 'buttons.switchProfile') },
    { id: ACTIONS.PROFILE_UPDATE, title: deps.locale.t(event, 'buttons.update') },
    { id: ACTIONS.PROFILE_RESET, title: deps.locale.t(event, 'buttons.reset') }
  ];

  await channelApi.sendChoices(event, deps.locale.t(event, 'prompts.profileActions'), choices);
}

function createProfileHandler(overrides = {}) {
  const deps = {
    billing: defaultBilling,
    persistence: defaultPersistence,
    locale: defaultLocale,
    toolCache: defaultToolCache,
    getChatState: defaultChatState.getChatState,
    ...overrides
  };

  return {
    async handleProfile(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      const chatState = deps.getChatState(event);
      scheduleDailyHoroscopePrewarm(event, deps, chatState);
      const access = await deps.billing.getAccessSummary(event);
      await sendGlobalPrompt(event, channelApi, buildProfileMessage(chatState, access, deps), deps);

      if (chatState.natalProfile) {
        await sendProfileActions(event, channelApi, deps);
      }

      return true;
    }
  };
}

module.exports = {
  buildProfileMessage,
  createProfileHandler,
  sendProfileActions
};
