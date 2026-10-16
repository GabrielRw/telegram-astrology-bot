const assert = require('node:assert/strict');

const { createProfileHandler } = require('../src/application/useCases/profileHandler');

function createLocale() {
  return {
    getLocale(input) {
      return input.locale || 'en';
    },
    getLanguageName(locale) {
      return locale === 'fr' ? 'French' : 'English';
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    t(_eventOrLocale, path, args = {}) {
      const values = {
        'buttons.settings': 'Settings',
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.addProfile': 'Add profile',
        'buttons.switchProfile': 'Switch profile',
        'buttons.update': 'Update',
        'buttons.reset': 'Reset',
        'prompts.profileActions': 'Profile actions',
        'profile.none': 'No profile',
        'profile.title': 'Profile',
        'profile.birthTimeMissing': 'Birth time missing',
        'profile.footer': 'Footer',
        'profile.billingFooter': 'Billing footer'
      };
      if (path === 'profile.activeProfile') {
        return `Active: ${args.value}`;
      }
      if (path === 'profile.savedProfiles') {
        return `Saved: ${args.value}`;
      }
      if (path === 'profile.birthDate') {
        return `Birth date: ${args.value}`;
      }
      if (path === 'profile.city') {
        return `City: ${args.value}`;
      }
      if (path === 'profile.birthTimeSaved') {
        return `Birth time: ${args.value}`;
      }
      if (path === 'profile.language') {
        return `Language: ${args.value}`;
      }
      if (path === 'profile.billing') {
        return `Billing: ${args.value}`;
      }
      return values[path] || path;
    }
  };
}

function createBilling(access) {
  return {
    async getAccessSummary() {
      return access;
    },
    getBillingStatusLabel(summary) {
      return summary.unlimited ? 'Unlimited' : `Free ${summary.usedToday}/3`;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
    },
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    }
  };
}

function createDeps(chatState, access) {
  const calls = [];
  return {
    calls,
    billing: createBilling(access),
    locale: createLocale(),
    persistence: {
      async ensureHydrated(event) {
        calls.push({ method: 'ensureHydrated', event });
      }
    },
    toolCache: {
      prewarmDailyHoroscope(event, profile, options) {
        calls.push({ method: 'prewarmDailyHoroscope', event, profile, options });
      }
    },
    getChatState(event) {
      calls.push({ method: 'getChatState', event });
      return chatState;
    }
  };
}

async function testProfileWithoutNatalDataSendsStatusOnly() {
  const chatState = {
    locale: 'en',
    natalProfile: null,
    profileDirectory: []
  };
  const deps = createDeps(chatState, { unlimited: false, usedToday: 2, profile: {} });
  const handlers = createProfileHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleProfile(event, channel);

  assert.equal(result, true);
  assert.deepEqual(deps.calls.map((call) => call.method), ['ensureHydrated', 'getChatState']);
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'No profile\n\nFree 2/3');
}

async function testProfileWithNatalDataSendsActions() {
  const chatState = {
    locale: 'fr',
    activeProfileId: 'profile-1',
    profileDirectory: [
      { profileId: 'profile-1', profileName: 'Ari' },
      { profileId: 'profile-2', profileName: 'Sam' }
    ],
    natalProfile: {
      name: 'Fallback',
      birthDatetime: '1990-05-10T09:15:00',
      city: 'Paris',
      timeKnown: true
    },
    rawNatalPayload: { subject: { location: { timezone: 'Europe/Paris' } } },
    natalRequestPayload: { tz_str: 'Europe/Paris' }
  };
  const deps = createDeps(chatState, { unlimited: true, usedToday: 0, profile: {} });
  const handlers = createProfileHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleProfile(event, channel);

  assert.equal(result, true);
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'getChatState',
    'prewarmDailyHoroscope'
  ]);
  assert.match(channel.calls[0].text, /Active: Ari/);
  assert.match(channel.calls[0].text, /Saved: Ari \(active\), Sam/);
  assert.match(channel.calls[0].text, /Birth time: 09:15/);
  assert.equal(channel.calls[1].method, 'sendChoices');
  assert.deepEqual(channel.calls[1].choices, [
    { id: 'PROFILE_ADD', title: 'Add profile' },
    { id: 'PROFILE_SWITCH', title: 'Switch profile' },
    { id: 'PROFILE_UPDATE', title: 'Update' },
    { id: 'PROFILE_RESET', title: 'Reset' }
  ]);
}

async function main() {
  await testProfileWithoutNatalDataSendsStatusOnly();
  await testProfileWithNatalDataSendsActions();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
