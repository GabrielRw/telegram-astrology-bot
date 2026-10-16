const assert = require('node:assert/strict');

const { createConversationAnswerHandler } = require('../src/application/useCases/conversationAnswerHandler');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    translateUserError(_locale, error) {
      return `translated ${error.message}`;
    },
    t(_eventOrLocale, path, args = {}) {
      const values = {
        'billing.checkoutUnavailable': 'Checkout unavailable',
        'billing.limitReached': `Limit ${args.limit}`,
        'billing.subscribeButton': 'Subscribe',
        'billing.upgradePitch': 'Upgrade',
        'buttons.cancel': 'Cancel',
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.settings': 'Settings',
        'errors.choosePartnerProfile': 'Choose partner',
        'errors.conversationUnavailable': 'Unavailable',
        'errors.noGroundedAnswer': 'No answer',
        'profile.noOtherProfiles': 'No profiles',
        'prompts.cityConfirm': 'Confirm city',
        'prompts.onboardingChat': 'Send birth date',
        'prompts.profileNamePrompt': 'Profile name',
        'prompts.readingChart': 'Reading chart',
        'prompts.synastryPartner': 'Partner choices',
        'prompts.weddingFirstSpouse': 'Spouse choices'
      };
      return values[path] || path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async editText(event, messageRef, text, options) {
      calls.push({ method: 'editText', event, messageRef, text, options });
    },
    async deleteMessage(event, messageRef) {
      calls.push({ method: 'deleteMessage', event, messageRef });
      return true;
    },
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    },
    async sendText(event, text, options) {
      const ref = { messageId: calls.length + 1 };
      calls.push({ method: 'sendText', event, text, options, ref });
      return ref;
    },
    async sendImage(event, buffer, options) {
      const ref = { messageId: calls.length + 1 };
      calls.push({ method: 'sendImage', event, buffer, options, ref });
      return ref;
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  const deps = {
    calls,
    astroMap: {
      async renderAstrocartographyMap() {
        calls.push({ method: 'renderAstrocartographyMap' });
        return null;
      }
    },
    billing: {
      FREE_QUESTIONS_PER_DAY: 3,
      async getAccessSummary(event) {
        calls.push({ method: 'getAccessSummary', event });
        return overrides.access || { limitReached: false };
      },
      getUpgradePitch(t) {
        return t('billing.upgradePitch');
      },
      isStripeConfigured() {
        return false;
      },
      async recordAnsweredQuestion(event) {
        calls.push({ method: 'recordAnsweredQuestion', event });
      }
    },
    chatState: {
      getChatState(event) {
        calls.push({ method: 'getChatState', event });
        return overrides.chatState || {};
      },
      getUiCache(event) {
        calls.push({ method: 'getUiCache', event });
        return overrides.uiCache || {};
      },
      setChoiceMap(event, value) {
        calls.push({ method: 'setChoiceMap', event, value });
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
      setUiCache(event, value) {
        calls.push({ method: 'setUiCache', event, value });
      }
    },
    conversation: {
      async answerConversation(event, text, options) {
        calls.push({ method: 'answerConversation', event, text, options });
        return overrides.answerResult || { text: 'Answer text' };
      }
    },
    ephemerisTable: {
      buildEphemerisWebAppUrl() {
        return 'https://ephemeris.example';
      }
    },
    freeAstro: {},
    gemini: {
      getGeminiErrorMessage(error) {
        return `gemini ${error.message}`;
      }
    },
    interactiveAstroMap: {
      registerInteractiveAstroMap() {
        return null;
      }
    },
    locale: createLocale(),
    logger: {
      info(message, meta) {
        calls.push({ method: 'logger.info', message, meta });
      }
    },
    moonPhaseVisual: {
      async renderMoonPhaseVisualPng(payload) {
        calls.push({ method: 'renderMoonPhaseVisualPng', payload });
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          caption: 'Current Moon: Waxing Gibbous',
          filename: 'current-moon-phase.png'
        };
      }
    },
    monthlyTransitTable: {
      async renderMonthlyTransitsPng(payload) {
        calls.push({ method: 'renderMonthlyTransitsPng', payload });
        return [{
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          caption: 'All monthly transits',
          filename: 'monthly-transits.png'
        }];
      }
    },
    natalAspectTable: {},
    natalFlow: {
      startNatalFlow(event, source, options) {
        calls.push({ method: 'startNatalFlow', event, source, options });
      }
    },
    toolCache: {},
    ...overrides
  };
  return deps;
}

async function testLimitReachedEditsExistingLoadingMessage() {
  const deps = createDeps({
    access: { limitReached: true }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };
  const loadingRef = { messageId: 99 };

  const result = await handler.handleConversationAnswer(event, channel, 'Question', { loadingRef });

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['editText']);
  assert.equal(channel.calls[0].messageRef, loadingRef);
  assert.equal(channel.calls[0].text, 'Limit 3\n\nCheckout unavailable');
}

async function testTextPartsAreDeliveredAndRecorded() {
  const deps = createDeps({
    answerResult: { textParts: ['Part one', 'Part two'] }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  const result = await handler.handleConversationAnswer(event, channel, 'Question');

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText', 'sendText']);
  assert.equal(channel.calls[1].text, 'Part one');
  assert.equal(channel.calls[2].text, 'Part two');
  assert.equal(deps.calls.some((call) => call.method === 'recordAnsweredQuestion'), true);
}

async function testNeedsProfileCreationStartsSecondaryFlow() {
  const deps = createDeps({
    answerResult: {
      needsProfileCreation: true,
      requestedProfileName: null,
      text: 'Need birth data'
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  const result = await handler.handleConversationAnswer(event, channel, 'Read Sam');

  assert.equal(result, true);
  assert.equal(deps.calls.find((call) => call.method === 'setPendingQuestion').value, 'Read Sam');
  assert.deepEqual(deps.calls.find((call) => call.method === 'startNatalFlow').options, {
    mode: 'add_secondary',
    profileName: null
  });
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText', 'showPersistentActions']);
  assert.equal(channel.calls[2].text, 'Profile name');
}

async function testCitySelectionStoresUiCacheAndSendsChoices() {
  const deps = createDeps({
    answerResult: {
      requiresCitySelection: true,
      replayQuestion: 'Move where?',
      candidates: [{ name: 'Lisbon', country: 'Portugal' }]
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  const result = await handler.handleConversationAnswer(event, channel, 'Where should I move?');

  assert.equal(result, true);
  assert.equal(deps.calls.some((call) => call.method === 'setUiCache' && call.value.citySelection.question === 'Move where?'), true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText', 'sendChoices']);
  assert.equal(channel.calls[1].text, 'I found several possible cities for this relocation question.');
  assert.equal(channel.calls[2].choices[0].id, 'RELOCATION_CITY_0');
}

async function testMoonPhaseAttachmentSendsImage() {
  const deps = createDeps({
    answerResult: {
      text: 'Moon answer',
      mediaAttachments: ['moon_phase_svg'],
      usedTools: [{
        name: 'rest_moon_phase',
        result: {
          available: true,
          moon_phase: { phaseName: 'Waxing Gibbous' },
          moon_visual: {
            type: 'svg',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'
          }
        }
      }]
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  const result = await handler.handleConversationAnswer(event, channel, 'What is the Moon doing?');

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'editText', 'sendImage']);
  assert.equal(channel.calls[2].options.filename, 'current-moon-phase.png');
  assert.equal(channel.calls[2].options.caption, 'Current Moon: Waxing Gibbous');
  assert.equal(deps.calls.some((call) => call.method === 'renderMoonPhaseVisualPng'), true);
}

async function testMonthlyTransitAttachmentSendsImageWithoutTextDump() {
  const deps = createDeps({
    answerResult: {
      text: '',
      suppressTextResponse: true,
      mediaPayload: {
        monthlyTransits: {
          title: 'All monthly transits',
          rows: [{ title: 'Saturn square Moon', window: '2026-06-01 to 2026-06-10' }]
        }
      }
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  const result = await handler.handleConversationAnswer(event, channel, 'List all monthly transits');

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['sendText', 'deleteMessage', 'sendImage']);
  assert.equal(channel.calls[2].options.filename, 'monthly-transits.png');
  assert.equal(channel.calls[2].options.caption, 'All monthly transits');
  assert.equal(deps.calls.some((call) => call.method === 'renderMonthlyTransitsPng'), true);
}

function getQualityLog(deps) {
  return deps.calls.find((call) => call.method === 'logger.info' && call.message === 'answer quality')?.meta || null;
}

async function testTextAnswerIsRepairedAndQualityLogged() {
  const deps = createDeps({
    answerResult: {
      text: '### Summary\nYour Sun is in Taurus. The tool does not list any aspects.',
      intent: 'astrology_natal'
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: 'chat-1' };

  await handler.handleConversationAnswer(event, channel, 'What does my Sun mean?');

  assert.equal(channel.calls[1].method, 'editText');
  assert.equal(channel.calls[1].text, 'Summary — Your Sun is in Taurus.');
  const quality = getQualityLog(deps);
  assert.equal(quality.renderMode, 'text');
  assert.equal(quality.intent, 'astrology_natal');
  assert.deepEqual(quality.repairs, ['folded_headings', 'dropped_meta_sentence']);
  assert.deepEqual(quality.issues, []);
}

async function testProgressiveSectionsAreRepaired() {
  const deps = createDeps({
    conversation: {
      async answerConversation(_event, _text, options) {
        await options.onProgressSection('Based on the provided data, your Moon is in Capricorn.');
        await options.onProgressSection('It is conjunct Saturn.');
        return { alreadyDelivered: true };
      }
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram' };

  await handler.handleConversationAnswer(event, channel, 'Where is my Moon?');

  assert.deepEqual(channel.calls.slice(1).map((call) => [call.method, call.text]), [
    ['editText', 'Your Moon is in Capricorn.'],
    ['sendText', 'It is conjunct Saturn.']
  ]);
  const quality = getQualityLog(deps);
  assert.equal(quality.renderMode, 'progressive');
  assert.deepEqual(quality.repairs, ['stripped_meta_prefix']);
  assert.equal(quality.paragraphCount, 2);
}

async function testFormatViolationIsLogged() {
  const deps = createDeps({
    answerResult: { text: 'One.\n\nTwo.\n\nThree.\n\nFour.' }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();

  await handler.handleConversationAnswer({ channel: 'telegram' }, channel, 'Summarize my chart in 3 paragraphs');

  assert.deepEqual(getQualityLog(deps).issues.map((issue) => issue.code), ['format_paragraph_count']);
}

async function testFailedAnswerIsNotQualityLogged() {
  const deps = createDeps({
    conversation: {
      async answerConversation() {
        throw new Error('boom');
      }
    }
  });
  const handler = createConversationAnswerHandler(deps);
  const channel = createChannel();

  await handler.handleConversationAnswer({ channel: 'telegram' }, channel, 'Question');

  assert.equal(getQualityLog(deps), null);
}

async function main() {
  await testLimitReachedEditsExistingLoadingMessage();
  await testTextPartsAreDeliveredAndRecorded();
  await testNeedsProfileCreationStartsSecondaryFlow();
  await testCitySelectionStoresUiCacheAndSendsChoices();
  await testMoonPhaseAttachmentSendsImage();
  await testMonthlyTransitAttachmentSendsImageWithoutTextDump();
  await testTextAnswerIsRepairedAndQualityLogged();
  await testProgressiveSectionsAreRepaired();
  await testFormatViolationIsLogged();
  await testFailedAnswerIsNotQualityLogged();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
