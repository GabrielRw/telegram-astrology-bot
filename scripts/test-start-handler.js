const assert = require('node:assert/strict');

const { createStartHandler } = require('../src/application/useCases/startHandler');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    t(_eventOrLocale, path, args = {}) {
      if (path === 'buttons.cancel') {
        return 'Cancel';
      }
      if (path === 'buttons.settings') {
        return 'Settings';
      }
      if (path === 'buttons.dailyHoroscope') {
        return 'Daily Horoscope';
      }
      if (path === 'prompts.onboardingStart') {
        return 'Send birth date';
      }
      if (path === 'prompts.welcomeBackWithProfile') {
        return `Welcome back ${args.profileName}`;
      }
      if (path === 'prompts.welcomeBack') {
        return 'Welcome back';
      }
      return path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async showPersistentActions(event, actions, text, options) {
      calls.push({ event, actions, text, options });
    }
  };
}

function createDeps(chatState) {
  const calls = [];
  const deps = {
    calls,
    persistence: {
      async ensureHydrated(event) {
        calls.push({ method: 'ensureHydrated', event });
      }
    },
    locale: createLocale(),
    toolCache: {
      prewarmDailyHoroscope(event, profile, options) {
        calls.push({ method: 'prewarmDailyHoroscope', event, profile, options });
      }
    },
    natalFlow: {
      clearSession(event) {
        calls.push({ method: 'clearSession', event });
      },
      startNatalFlow(event, source, options) {
        calls.push({ method: 'startNatalFlow', event, source, options });
      }
    },
    chatState: {
      getChatState(event) {
        calls.push({ method: 'getChatState', event });
        return chatState;
      },
      setPendingQuestion(event, value) {
        calls.push({ method: 'setPendingQuestion', event, value });
      },
      setPendingSynastryQuestion(event, value) {
        calls.push({ method: 'setPendingSynastryQuestion', event, value });
      },
      setPendingWeddingSelection(event, value) {
        calls.push({ method: 'setPendingWeddingSelection', event, value });
      },
      setChoiceMap(event, value) {
        calls.push({ method: 'setChoiceMap', event, value });
      }
    }
  };
  deps.getChatState = deps.chatState.getChatState;
  return deps;
}

async function testStartsOnboardingWhenNoProfileExists() {
  const chatState = { activeFlow: null, natalProfile: null };
  const deps = createDeps(chatState);
  const handlers = createStartHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleStart(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeSynced, true);
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'getChatState',
    'setPendingQuestion',
    'startNatalFlow'
  ]);
  assert.equal(deps.calls[2].value, null);
  assert.deepEqual(deps.calls[3].options, { mode: 'create_primary' });
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].text, 'Send birth date');
  assert.deepEqual(channel.calls[0].actions, [
    [{ id: 'cancel', title: 'Cancel' }],
    [
      { id: 'settings', title: 'Settings' },
      { id: 'daily_horoscope', title: 'Daily Horoscope' }
    ]
  ]);
}

async function testWelcomesExistingProfileAndClearsActiveFlow() {
  const chatState = {
    activeFlow: { step: 'date' },
    activeProfileId: 'profile-1',
    profileDirectory: [{ profileId: 'profile-1', profileName: 'Ari' }],
    natalProfile: { name: 'Fallback', city: 'Paris', timeKnown: true },
    rawNatalPayload: { subject: { location: { timezone: 'Europe/Paris' } } },
    natalRequestPayload: { tz_str: 'Europe/Paris' },
    chartRequestPayload: { chart: true }
  };
  const deps = createDeps(chatState);
  const handlers = createStartHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleStart(event, channel);

  assert.equal(result, true);
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'getChatState',
    'prewarmDailyHoroscope',
    'clearSession',
    'setPendingQuestion',
    'setPendingSynastryQuestion',
    'setPendingWeddingSelection',
    'setChoiceMap'
  ]);
  assert.equal(deps.calls[2].profile.profileId, 'profile-1');
  assert.equal(deps.calls[2].options.locale, 'en');
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].text, 'Welcome back Ari');
  assert.deepEqual(channel.calls[0].actions, [[
    { id: 'settings', title: 'Settings' },
    { id: 'daily_horoscope', title: 'Daily Horoscope' }
  ]]);
}

async function main() {
  await testStartsOnboardingWhenNoProfileExists();
  await testWelcomesExistingProfileAndClearsActiveFlow();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
