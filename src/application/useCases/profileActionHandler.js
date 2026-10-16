const { ACTIONS } = require('../actionIds');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');
const { resetConversationContext } = require('./cancelHandler');
const { buildProfileMessage, sendProfileActions } = require('./profileHandler');
const {
  promptForBirthDate,
  promptForProfileName
} = require('./natalFlowPrompts');
const defaultBilling = require('../../services/billing');
const defaultLocale = require('../../services/locale');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultPersistence = require('../../services/persistence');
const defaultProfiles = require('../../services/profiles');
const defaultToolCache = require('../../services/toolCache');
const defaultChatState = require('../../state/chatState');

const DIRECT_PROFILE_ACTIONS = new Set([
  ACTIONS.PROFILE_ADD,
  ACTIONS.PROFILE_SWITCH,
  ACTIONS.PROFILE_UPDATE,
  ACTIONS.PROFILE_RESET,
  ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE
]);

function canHandleProfileAction(actionId) {
  const value = String(actionId || '');
  return DIRECT_PROFILE_ACTIONS.has(value) || value.startsWith(ACTIONS.PROFILE_SWITCH_PREFIX);
}

function chunkItems(items, size = 3) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function sendChoiceBatches(event, channelApi, prompt, choices, size = 3) {
  for (const batch of chunkItems(choices, size)) {
    await channelApi.sendChoices(event, prompt, batch);
  }
}

async function sendProfileSwitchChoices(event, channelApi, chatState, deps) {
  const availableProfiles = chatState.profileDirectory || [];

  if (availableProfiles.length === 0) {
    await channelApi.sendText(event, deps.locale.t(event, 'profile.noOtherProfiles'));
    return;
  }

  const switchChoices = availableProfiles.map((entry) => ({
    id: `${ACTIONS.PROFILE_SWITCH_PREFIX}${entry.profileId}`,
    title: (
      entry.profileId === chatState.activeProfileId
        ? `${entry.profileName} ${deps.locale.t(event, 'profile.activeSuffix')}`
        : entry.profileName
    ).slice(0, 60)
  }));

  deps.chatState.setChoiceMap(event, Object.fromEntries(switchChoices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(event, channelApi, deps.locale.t(event, 'prompts.profileSwitch'), switchChoices);
}

function createProfileActionHandler(overrides = {}) {
  const deps = {
    billing: defaultBilling,
    chatState: defaultChatState,
    getChatState: defaultChatState.getChatState,
    locale: defaultLocale,
    natalFlow: defaultNatalFlow,
    persistence: defaultPersistence,
    profiles: defaultProfiles,
    toolCache: defaultToolCache,
    ...overrides
  };

  async function prepare(event) {
    await deps.persistence.ensureHydrated(event);
    deps.locale.syncLocaleFromEvent(event);
    scheduleDailyHoroscopePrewarm(event, deps);
  }

  return {
    async handleProfileAction(event, channelApi) {
      await prepare(event);
      const actionId = String(event.actionId || '');

      if (actionId === ACTIONS.PROFILE_ADD) {
        await channelApi.ackAction(event);
        deps.chatState.setPendingQuestion(event, null);
        deps.natalFlow.startNatalFlow(event, 'profile', { mode: 'add_secondary' });
        await promptForProfileName(event, channelApi, deps);
        return true;
      }

      if (actionId === ACTIONS.PROFILE_SWITCH) {
        await channelApi.ackAction(event);
        await sendProfileSwitchChoices(event, channelApi, deps.getChatState(event), deps);
        return true;
      }

      if (actionId.startsWith(ACTIONS.PROFILE_SWITCH_PREFIX)) {
        const profileId = actionId.slice(ACTIONS.PROFILE_SWITCH_PREFIX.length);

        if (!profileId) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.profileUnavailable'));
          return true;
        }

        const currentState = deps.getChatState(event);

        if (profileId === currentState.activeProfileId) {
          await channelApi.ackAction(event);
          const activeProfile = await deps.profiles.getActiveProfile(event);
          await channelApi.sendText(event, deps.locale.t(event, 'profile.alreadyActive', { value: activeProfile?.profileName || 'Profile' }));
          return true;
        }

        const nextProfile = await deps.profiles.setActiveProfile(event, profileId);

        if (!nextProfile) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.profileUnavailable'));
          return true;
        }

        deps.natalFlow.clearSession(event);
        resetConversationContext(event, deps);
        deps.locale.refreshLocaleFromProfile(event);
        scheduleDailyHoroscopePrewarm(event, deps);
        await channelApi.ackAction(event);
        await channelApi.sendText(event, deps.locale.t(event, 'profile.switched', { value: nextProfile.profileName }));
        return true;
      }

      if (actionId === ACTIONS.PROFILE_UPDATE) {
        await channelApi.ackAction(event);
        deps.chatState.setPendingQuestion(event, null);
        const activeProfile = await deps.profiles.getActiveProfile(event);

        deps.natalFlow.startNatalFlow(event, 'profile', {
          mode: 'update_active',
          targetProfileId: activeProfile?.profileId || null,
          profileName: activeProfile?.profileName || null
        });
        await promptForBirthDate(event, channelApi, 'start', deps);
        return true;
      }

      if (actionId === ACTIONS.PROFILE_RESET) {
        await channelApi.ackAction(event);
        const activeProfile = await deps.profiles.getActiveProfile(event);

        if (!activeProfile) {
          await channelApi.sendText(event, deps.locale.t(event, 'profile.cleared'));
          return true;
        }

        await deps.profiles.deleteProfile(event, activeProfile.profileId);
        deps.natalFlow.clearSession(event);
        resetConversationContext(event, deps);
        deps.chatState.setChoiceMap(event, {});
        deps.locale.refreshLocaleFromProfile(event);
        await channelApi.sendText(event, deps.locale.t(event, 'profile.deleted', { value: activeProfile.profileName }));
        return true;
      }

      if (actionId === ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE) {
        deps.chatState.setResponseMode(event, 'interpreted');
        await channelApi.ackAction(event);
        const refreshedState = deps.getChatState(event);
        const access = await deps.billing.getAccessSummary(event);
        await channelApi.sendText(event, buildProfileMessage(refreshedState, access, deps));
        if (refreshedState.natalProfile) {
          await sendProfileActions(event, channelApi, deps);
        }
        return true;
      }

      return false;
    }
  };
}

module.exports = {
  canHandleProfileAction,
  createProfileActionHandler
};
