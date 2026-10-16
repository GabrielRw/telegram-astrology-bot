const assert = require('node:assert/strict');

const { createDailyHoroscopeHandler } = require('../src/application/useCases/dailyHoroscopeHandler');

class FakeFreeAstroError extends Error {}

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    translateUserError(_locale, error) {
      return `translated ${error.message}`;
    },
    t(_eventOrLocale, path) {
      const values = {
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.settings': 'Settings',
        'errors.dailyHoroscopeNeedsProfile': 'Need profile',
        'errors.noGroundedAnswer': 'No grounded answer',
        'prompts.readingChart': 'Reading chart'
      };
      return values[path] || path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async sendText(event, text, options) {
      const ref = { messageId: calls.length + 1 };
      calls.push({ method: 'sendText', event, text, options, ref });
      return ref;
    },
    async editText(event, messageRef, text) {
      calls.push({ method: 'editText', event, messageRef, text });
      return messageRef;
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
      return { messageId: calls.length };
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  const profile = overrides.profile === undefined
    ? { profileId: 'profile-1', profileName: 'Ari' }
    : overrides.profile;

  return {
    calls,
    FreeAstroError: FakeFreeAstroError,
    getChatState(event) {
      calls.push({ method: 'getChatState', event });
      return overrides.chatState || null;
    },
    getGeminiErrorMessage(error, locale) {
      calls.push({ method: 'getGeminiErrorMessage', error, locale });
      return `gemini ${error.message}`;
    },
    locale: createLocale(),
    persistence: {
      async ensureHydrated(event) {
        calls.push({ method: 'ensureHydrated', event });
      }
    },
    profiles: {
      async getActiveProfile(event) {
        calls.push({ method: 'getActiveProfile', event });
        return profile;
      }
    },
    toolCache: {
      prewarmDailyHoroscope(event, prewarmProfile, options) {
        calls.push({ method: 'prewarmDailyHoroscope', event, profile: prewarmProfile, options });
      },
      async getCachedDailyHoroscope(event, cachedProfile, options) {
        calls.push({ method: 'getCachedDailyHoroscope', event, profile: cachedProfile, options });
        return overrides.cached || null;
      },
      async ensureDailyHoroscope(event, ensuredProfile, options) {
        calls.push({ method: 'ensureDailyHoroscope', event, profile: ensuredProfile, options });
        if (overrides.ensureError) {
          throw overrides.ensureError;
        }
        return overrides.ensured || { result: { text: 'Fresh reading' } };
      }
    },
    ...overrides
  };
}

async function testNeedsProfile() {
  const deps = createDeps({ profile: null });
  const handlers = createDailyHoroscopeHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleDailyHoroscope(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeSynced, true);
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'getChatState',
    'getActiveProfile'
  ]);
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'Need profile');
}

async function testCachedReadingUsesGlobalPrompt() {
  const deps = createDeps({
    cached: { result: { text: '  Cached reading  ' } }
  });
  const handlers = createDailyHoroscopeHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleDailyHoroscope(event, channel);

  assert.equal(result, true);
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'Cached reading');
}

async function testFreshReadingEditsLoadingMessage() {
  const deps = createDeps();
  const handlers = createDailyHoroscopeHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleDailyHoroscope(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText']);
  assert.equal(channel.calls[0].text, 'Reading chart');
  assert.equal(channel.calls[1].text, 'Fresh reading');
}

async function testFreeAstroErrorIsTranslated() {
  const deps = createDeps({
    ensureError: new FakeFreeAstroError('api down')
  });
  const handlers = createDailyHoroscopeHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleDailyHoroscope(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText']);
  assert.equal(channel.calls[1].text, 'translated api down');
}

async function main() {
  await testNeedsProfile();
  await testCachedReadingUsesGlobalPrompt();
  await testFreshReadingEditsLoadingMessage();
  await testFreeAstroErrorIsTranslated();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
