const assert = require('node:assert/strict');

const { createLanguageHandlers } = require('../src/application/useCases/languageHandlers');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    getLanguageOptions() {
      return [
        { locale: 'en', title: 'English' },
        { locale: 'fr', title: 'Français' },
        { locale: 'de', title: 'Deutsch' },
        { locale: 'es', title: 'Español' }
      ];
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    setManualLocale(event, locale) {
      event.selectedLocale = locale;
      return locale;
    },
    getLanguageName(locale) {
      return locale === 'fr' ? 'Français' : locale;
    },
    t(_eventOrLocale, path, args = {}) {
      if (path === 'prompts.languagePrompt') {
        return 'Choose language';
      }
      if (path === 'prompts.languageUpdated') {
        return `Language updated: ${args.language}`;
      }
      if (path === 'errors.questionExpired') {
        return 'Expired';
      }
      if (path === 'prompts.cityConfirm') {
        return 'Confirm city';
      }
      return path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    },
    async ackAction(event, text) {
      calls.push({ method: 'ackAction', event, text });
    },
    async sendText(event, text) {
      calls.push({ method: 'sendText', event, text });
    }
  };
}

function createActionDeps(session = null) {
  const calls = [];
  return {
    calls,
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
    natalFlow: {
      getSession(event) {
        calls.push({ method: 'getSession', event });
        return session;
      }
    },
    chatState: {
      setChoiceMap(event, value) {
        calls.push({ method: 'setChoiceMap', event, value });
      }
    },
    getChatState() {
      return null;
    }
  };
}

async function testLanguagePromptBatchesChoices() {
  const handlers = createLanguageHandlers({
    locale: createLocale()
  });
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  await handlers.promptForLanguage(event, channel);

  assert.equal(channel.calls.length, 2);
  assert.equal(channel.calls[0].event, event);
  assert.equal(channel.calls[0].prompt, 'Choose language');
  assert.deepEqual(channel.calls[0].choices, [
    { id: 'LANGUAGE_en', title: 'English' },
    { id: 'LANGUAGE_fr', title: 'Français' },
    { id: 'LANGUAGE_de', title: 'Deutsch' }
  ]);
  assert.deepEqual(channel.calls[1].choices, [
    { id: 'LANGUAGE_es', title: 'Español' }
  ]);
}

async function testLanguageActionUpdatesLocale() {
  const deps = createActionDeps();
  const handlers = createLanguageHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1', actionId: 'LANGUAGE_fr' };

  const result = await handlers.handleLanguageAction(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeSynced, true);
  assert.equal(event.selectedLocale, 'fr');
  assert.deepEqual(deps.calls.map((call) => call.method), ['ensureHydrated', 'getSession']);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText']);
  assert.equal(channel.calls[1].text, 'Language updated: Français');
}

async function testLanguageActionRepromptsCurrentStep() {
  const deps = createActionDeps({
    step: 'city_confirm',
    cityCandidates: [
      { name: 'Paris', country: 'France' },
      { name: 'Lyon', country: 'France' }
    ]
  });
  const handlers = createLanguageHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1', actionId: 'LANGUAGE_fr' };

  const result = await handlers.handleLanguageAction(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText', 'sendChoices']);
  assert.equal(channel.calls[2].prompt, 'Confirm city');
  assert.deepEqual(channel.calls[2].choices, [
    { id: 'NATAL_CITY_0', title: 'Paris, France' },
    { id: 'NATAL_CITY_1', title: 'Lyon, France' }
  ]);
  assert.deepEqual(deps.calls.find((call) => call.method === 'setChoiceMap').value, {
    1: 'NATAL_CITY_0',
    2: 'NATAL_CITY_1'
  });
}

async function testLanguageActionHandlesExpiredChoice() {
  const deps = createActionDeps();
  const handlers = createLanguageHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1', actionId: 'LANGUAGE_' };

  const result = await handlers.handleLanguageAction(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls, [
    { method: 'ackAction', event, text: 'Expired' }
  ]);
}

async function main() {
  await testLanguagePromptBatchesChoices();
  await testLanguageActionUpdatesLocale();
  await testLanguageActionRepromptsCurrentStep();
  await testLanguageActionHandlesExpiredChoice();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
