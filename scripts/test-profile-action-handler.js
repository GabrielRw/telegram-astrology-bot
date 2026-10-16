const assert = require('node:assert/strict');

const { ACTIONS } = require('../src/application/actionIds');
const {
  canHandleProfileAction,
  createProfileActionHandler
} = require('../src/application/useCases/profileActionHandler');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    refreshLocaleFromProfile(event) {
      event.localeRefreshed = true;
    },
    getLanguageName() {
      return 'English';
    },
    t(_eventOrLocale, path, args = {}) {
      const values = {
        'buttons.addProfile': 'Add profile',
        'buttons.cancel': 'Cancel',
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.reset': 'Reset',
        'buttons.settings': 'Settings',
        'buttons.switchProfile': 'Switch profile',
        'buttons.update': 'Update',
        'errors.profileUnavailable': 'Profile unavailable',
        'profile.activeSuffix': '(active)',
        'profile.alreadyActive': `Already active ${args.value}`,
        'profile.cleared': 'Cleared',
        'profile.deleted': `Deleted ${args.value}`,
        'profile.noOtherProfiles': 'No profiles',
        'profile.switched': `Switched ${args.value}`,
        'prompts.onboardingStart': 'Send birth date',
        'prompts.profileActions': 'Profile actions',
        'prompts.profileNamePrompt': 'Profile name',
        'prompts.profileSwitch': 'Choose profile'
      };
      return values[path] || path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async ackAction(event, text) {
      calls.push({ method: 'ackAction', event, text });
    },
    async sendText(event, text) {
      calls.push({ method: 'sendText', event, text });
    },
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  const chatState = overrides.chatState || {
    activeProfileId: 'profile-1',
    profileDirectory: [
      { profileId: 'profile-1', profileName: 'Ari' },
      { profileId: 'profile-2', profileName: 'Sam' }
    ],
    natalProfile: null,
    history: [],
    lastToolResults: [],
    choiceMap: {}
  };
  const deps = {
    calls,
    billing: {
      async getAccessSummary() {
        return { unlimited: false, usedToday: 0, profile: {} };
      },
      getBillingStatusLabel() {
        return 'Free 0/3';
      }
    },
    chatState: {
      getChatState(event) {
        calls.push({ method: 'getChatState', event });
        return chatState;
      },
      notifyPersistence(event) {
        calls.push({ method: 'notifyPersistence', event });
      },
      setChoiceMap(event, value) {
        calls.push({ method: 'setChoiceMap', event, value });
        chatState.choiceMap = value;
      },
      setPendingQuestion(event, value) {
        calls.push({ method: 'setPendingQuestion', event, value });
      },
      setResponseMode(event, value) {
        calls.push({ method: 'setResponseMode', event, value });
      }
    },
    locale: createLocale(),
    natalFlow: {
      clearSession(event) {
        calls.push({ method: 'clearSession', event });
      },
      startNatalFlow(event, source, options) {
        calls.push({ method: 'startNatalFlow', event, source, options });
      }
    },
    persistence: {
      async ensureHydrated(event) {
        calls.push({ method: 'ensureHydrated', event });
      }
    },
    profiles: {
      async getActiveProfile() {
        calls.push({ method: 'getActiveProfile' });
        return overrides.activeProfile || { profileId: 'profile-1', profileName: 'Ari' };
      },
      async setActiveProfile(_event, profileId) {
        calls.push({ method: 'setActiveProfile', profileId });
        return overrides.nextProfile === undefined ? { profileId, profileName: 'Sam' } : overrides.nextProfile;
      },
      async deleteProfile(_event, profileId) {
        calls.push({ method: 'deleteProfile', profileId });
      }
    },
    toolCache: {
      prewarmDailyHoroscope(event, profile, options) {
        calls.push({ method: 'prewarmDailyHoroscope', event, profile, options });
      }
    }
  };
  deps.getChatState = deps.chatState.getChatState;
  return deps;
}

async function testCanHandleProfileAction() {
  assert.equal(canHandleProfileAction(ACTIONS.PROFILE_ADD), true);
  assert.equal(canHandleProfileAction(`${ACTIONS.PROFILE_SWITCH_PREFIX}abc`), true);
  assert.equal(canHandleProfileAction(ACTIONS.PROFILE_SHOW_CHART), false);
  assert.equal(canHandleProfileAction('LANGUAGE_en'), false);
}

async function testProfileAddStartsSecondaryFlow() {
  const deps = createDeps();
  const handlers = createProfileActionHandler(deps);
  const channel = createChannel();
  const event = { actionId: ACTIONS.PROFILE_ADD };

  const result = await handlers.handleProfileAction(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'showPersistentActions']);
  assert.equal(channel.calls[1].text, 'Profile name');
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'getChatState',
    'setPendingQuestion',
    'startNatalFlow'
  ]);
  assert.deepEqual(deps.calls[3].options, { mode: 'add_secondary' });
}

async function testProfileSwitchChoicesSetNumericMap() {
  const deps = createDeps();
  const handlers = createProfileActionHandler(deps);
  const channel = createChannel();
  const event = { actionId: ACTIONS.PROFILE_SWITCH };

  const result = await handlers.handleProfileAction(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendChoices']);
  assert.deepEqual(channel.calls[1].choices, [
    { id: 'PROFILE_SWITCH_profile-1', title: 'Ari (active)' },
    { id: 'PROFILE_SWITCH_profile-2', title: 'Sam' }
  ]);
  assert.deepEqual(deps.calls.find((call) => call.method === 'setChoiceMap').value, {
    1: 'PROFILE_SWITCH_profile-1',
    2: 'PROFILE_SWITCH_profile-2'
  });
}

async function testProfileSwitchChangesActiveProfile() {
  const chatState = {
    activeProfileId: 'profile-1',
    profileDirectory: [],
    natalProfile: { name: 'Ari' },
    rawNatalPayload: { subject: { location: { timezone: 'Europe/Paris' } } },
    natalRequestPayload: { tz_str: 'Europe/Paris' },
    history: [{ role: 'user', text: 'x' }],
    lastToolResults: [{ name: 'tool' }],
    choiceMap: { 1: 'x' }
  };
  const deps = createDeps({ chatState });
  const handlers = createProfileActionHandler(deps);
  const channel = createChannel();
  const event = { actionId: 'PROFILE_SWITCH_profile-2' };

  const result = await handlers.handleProfileAction(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeRefreshed, true);
  assert.deepEqual(chatState.history, []);
  assert.deepEqual(chatState.lastToolResults, []);
  assert.deepEqual(chatState.choiceMap, {});
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText']);
  assert.equal(channel.calls[1].text, 'Switched Sam');
}

async function testProfileResetDeletesActiveProfile() {
  const deps = createDeps();
  const handlers = createProfileActionHandler(deps);
  const channel = createChannel();
  const event = { actionId: ACTIONS.PROFILE_RESET };

  const result = await handlers.handleProfileAction(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeRefreshed, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText']);
  assert.equal(channel.calls[1].text, 'Deleted Ari');
  assert.equal(deps.calls.some((call) => call.method === 'deleteProfile' && call.profileId === 'profile-1'), true);
}

async function main() {
  await testCanHandleProfileAction();
  await testProfileAddStartsSecondaryFlow();
  await testProfileSwitchChoicesSetNumericMap();
  await testProfileSwitchChangesActiveProfile();
  await testProfileResetDeletesActiveProfile();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
