const assert = require('node:assert/strict');

const { ACTIONS } = require('../src/application/actionIds');
const { createConversationSelectionActionHandler } = require('../src/application/useCases/conversationSelectionActionHandler');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    t(_eventOrLocale, path, args = {}) {
      const values = {
        'buttons.addNewUser': 'Add new user',
        'buttons.cancel': 'Cancel',
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.settings': 'Settings',
        'errors.profileUnavailable': 'Profile unavailable',
        'errors.weddingSelectionExpired': 'Wedding expired',
        'profile.noOtherProfiles': 'No profiles',
        'prompts.cityConfirm': 'Confirm city',
        'prompts.profileNamePrompt': 'Profile name',
        'prompts.synastryPartner': 'Choose partner',
        'prompts.weddingAddPartner': 'Add partner',
        'prompts.weddingFirstSpouse': 'Choose spouse A',
        'prompts.weddingSecondSpouse': `Choose spouse B for ${args.value}`
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
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    },
    async sendText(event, text) {
      calls.push({ method: 'sendText', event, text });
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  const uiCache = overrides.uiCache || {
    citySelection: {
      question: 'Where should I move?',
      candidates: [
        { name: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 }
      ]
    }
  };
  return {
    calls,
    chatState: {
      getPendingWeddingSelection(event) {
        calls.push({ method: 'getPendingWeddingSelection', event });
        return overrides.pendingWeddingSelection || {
          question: 'When should we marry?',
          spouseAProfileId: 'profile-a'
        };
      },
      getUiCache(event) {
        calls.push({ method: 'getUiCache', event });
        return uiCache;
      },
      setChoiceMap(event, value) {
        calls.push({ method: 'setChoiceMap', event, value });
      },
      setPendingQuestion(event, value) {
        calls.push({ method: 'setPendingQuestion', event, value });
      },
      setPendingWeddingSelection(event, value) {
        calls.push({ method: 'setPendingWeddingSelection', event, value });
      },
      setUiCache(event, value) {
        calls.push({ method: 'setUiCache', event, value });
      }
    },
    locale: createLocale(),
    natalFlow: {
      startNatalFlow(event, source, options) {
        calls.push({ method: 'startNatalFlow', event, source, options });
      }
    },
    profiles: {
      async getProfileById(event, profileId) {
        calls.push({ method: 'getProfileById', event, profileId });
        const profiles = {
          'profile-a': { profileId: 'profile-a', profileName: 'Ari' },
          'profile-b': { profileId: 'profile-b', profileName: 'Sam' }
        };
        return overrides.missingProfile ? null : profiles[profileId] || { profileId, profileName: 'Sam' };
      },
      async listProfiles(event) {
        calls.push({ method: 'listProfiles', event });
        return [
          { profileId: 'profile-a', profileName: 'Ari' },
          { profileId: 'profile-b', profileName: 'Sam', cityLabel: 'Berlin' }
        ];
      }
    }
  };
}

async function testSynastryPartnerContinuesConversation() {
  const deps = createDeps();
  const handler = createConversationSelectionActionHandler(deps);
  const channel = createChannel();
  const continued = [];
  const event = { type: 'action', actionId: `${ACTIONS.SYNASTRY_PARTNER_PREFIX}profile-b` };

  const result = await handler.handleConversationSelectionAction(event, channel, async (...args) => {
    continued.push(args);
    return 'continued';
  });

  assert.equal(result, 'continued');
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction']);
  assert.equal(continued[0][2], 'Compare me with Sam');
}

async function testWeddingSpouseAStoresSelectionAndSendsChoices() {
  const deps = createDeps({
    pendingWeddingSelection: {
      question: 'When should we marry?',
      spouseAProfileId: null
    }
  });
  const handler = createConversationSelectionActionHandler(deps);
  const channel = createChannel();
  const event = { type: 'action', actionId: `${ACTIONS.WEDDING_SPOUSE_A_PREFIX}profile-a` };

  const result = await handler.handleConversationSelectionAction(event, channel, async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText', 'sendChoices']);
  assert.deepEqual(deps.calls.find((call) => call.method === 'setPendingWeddingSelection').value, {
    question: 'When should we marry?',
    spouseAProfileId: 'profile-a'
  });
  assert.equal(channel.calls[2].choices[0].id, `${ACTIONS.WEDDING_SPOUSE_B_PREFIX}profile-b`);
}

async function testWeddingSpouseBContinuesWithReplayQuestion() {
  const deps = createDeps();
  const handler = createConversationSelectionActionHandler(deps);
  const channel = createChannel();
  const continued = [];
  const event = { type: 'action', actionId: `${ACTIONS.WEDDING_SPOUSE_B_PREFIX}profile-b` };

  const result = await handler.handleConversationSelectionAction(event, channel, async (...args) => {
    continued.push(args);
    return 'continued';
  });

  assert.equal(result, 'continued');
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction']);
  assert.equal(continued[0][2], 'When should we marry?\n\nPartner A: Ari\nPartner B: Sam');
  assert.equal(deps.calls.some((call) => call.method === 'setPendingWeddingSelection' && call.value === null), true);
}

async function testRelocationCityContinuesWithSelectedCity() {
  const deps = createDeps();
  const handler = createConversationSelectionActionHandler(deps);
  const channel = createChannel();
  const continued = [];
  const event = { type: 'action', actionId: `${ACTIONS.RELOCATION_CITY_PREFIX}0` };

  const result = await handler.handleConversationSelectionAction(event, channel, async (...args) => {
    continued.push(args);
    return 'continued';
  });

  assert.equal(result, 'continued');
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction']);
  assert.equal(channel.calls[0].text, 'Using Lisbon, Portugal.');
  assert.match(continued[0][2], /Selected city: Lisbon, Portugal \[38.72, -9.14\]/);
  assert.equal(deps.calls.some((call) => call.method === 'setUiCache' && call.value.citySelection === null), true);
}

async function main() {
  await testSynastryPartnerContinuesConversation();
  await testWeddingSpouseAStoresSelectionAndSendsChoices();
  await testWeddingSpouseBContinuesWithReplayQuestion();
  await testRelocationCityContinuesWithSelectedCity();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
