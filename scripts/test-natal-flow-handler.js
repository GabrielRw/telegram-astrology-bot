const assert = require('node:assert/strict');

const { ACTIONS } = require('../src/application/actionIds');
const { createNatalFlowHandler } = require('../src/application/useCases/natalFlowHandler');

class FakeFreeAstroError extends Error {}

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    refreshLocaleFromProfile(event) {
      event.localeRefreshed = true;
    },
    translateUserError(_locale, error) {
      return `translated ${error.message}`;
    },
    localizeUserErrorDetail(_locale, error) {
      return `localized ${error.message}`;
    },
    t(_eventOrLocale, path, args = {}) {
      const values = {
        'buttons.cancel': 'Cancel',
        'buttons.dailyHoroscope': 'Daily Horoscope',
        'buttons.no': 'No',
        'buttons.settings': 'Settings',
        'buttons.yes': 'Yes',
        'errors.chooseCityOption': 'Choose a city',
        'errors.cityChoicesExpired': 'City expired',
        'errors.cityLookupFailed': 'City lookup failed',
        'errors.cityLooksLikeDate': 'Looks like a date',
        'errors.cityOptionUnavailable': 'City unavailable',
        'errors.genericUnexpected': 'Unexpected',
        'errors.invalidDate': 'Invalid date',
        'errors.invalidProfileName': 'Invalid name',
        'errors.invalidTime': 'Invalid time',
        'errors.replyYesNo': 'Reply yes/no',
        'errors.startAgain': 'Start again',
        'errors.usingCity': `Using ${args.city}`,
        'profile.added': `Added ${args.value}`,
        'prompts.birthDateAccepted': 'Send city',
        'prompts.birthDateUpdated': `Date updated to ${args.date}`,
        'prompts.birthTimePrompt': 'Send time',
        'prompts.cityAccepted': 'Know time?',
        'prompts.cityConfirm': 'Confirm city',
        'prompts.firstReady': 'First ready',
        'prompts.onboardingStart': 'Send birth date',
        'prompts.readingChart': 'Reading chart',
        'prompts.stillReading': 'Still reading'
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
    async editText(event, messageRef, text) {
      calls.push({ method: 'editText', event, messageRef, text });
    },
    async sendChoices(event, prompt, choices) {
      calls.push({ method: 'sendChoices', event, prompt, choices });
    },
    async sendText(event, text, options) {
      const ref = { messageId: calls.length + 1 };
      calls.push({ method: 'sendText', event, text, options, ref });
      return ref;
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
      return { messageId: calls.length };
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  const session = overrides.session || {
    flowId: 'flow-1',
    step: 'date',
    mode: 'create_primary'
  };
  const chatState = overrides.chatState || {
    activeProfileId: 'profile-1',
    rawNatalPayload: null,
    natalRequestPayload: null,
    natalProfile: null
  };
  const deps = {
    calls,
    chatState: {
      consumePendingQuestion(event) {
        calls.push({ method: 'consumePendingQuestion', event });
        return overrides.pendingQuestion || null;
      },
      getChatState(event) {
        calls.push({ method: 'getChatState', event });
        return chatState;
      },
      getChoiceMap(event) {
        calls.push({ method: 'getChoiceMap', event });
        return overrides.choiceMap || {};
      },
      getPendingWeddingSelection(event) {
        calls.push({ method: 'getPendingWeddingSelection', event });
        return overrides.pendingWeddingSelection || null;
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
      }
    },
    freeAstro: {
      FreeAstroError: FakeFreeAstroError,
      async getNatal(payload) {
        calls.push({ method: 'getNatal', payload });
        return overrides.natalResult || { subject: { name: 'Ari' } };
      },
      async searchCities(text, limit) {
        calls.push({ method: 'searchCities', text, limit });
        if (overrides.cityError) {
          throw overrides.cityError;
        }
        return overrides.cityCandidates || [
          { name: 'Paris', country: 'France', lat: 48.85, lng: 2.35 }
        ];
      }
    },
    locale: createLocale(),
    natalFlow: {
      clearSession(event) {
        calls.push({ method: 'clearSession', event });
      },
      createNatalChartPayload(lockedSession, cityMatch) {
        calls.push({ method: 'createNatalChartPayload', lockedSession, cityMatch });
        return { chart: true };
      },
      createNatalPayload(lockedSession, cityMatch) {
        calls.push({ method: 'createNatalPayload', lockedSession, cityMatch });
        return { natal: true, city: cityMatch.name };
      },
      createSessionCheckpoint(currentSession) {
        calls.push({ method: 'createSessionCheckpoint', session: currentSession });
        return { flowId: currentSession.flowId, step: currentSession.step };
      },
      getSession(event) {
        calls.push({ method: 'getSession', event });
        return session;
      },
      isSessionCurrent(event, checkpoint, step) {
        calls.push({ method: 'isSessionCurrent', event, checkpoint, step });
        return overrides.isSessionCurrent !== false;
      },
      lockSession(event, flowId) {
        calls.push({ method: 'lockSession', event, flowId });
        return overrides.lockedSession === undefined
          ? { ...session, locked: true, cityMatch: session.cityMatch || { name: 'Paris', country: 'France' } }
          : overrides.lockedSession;
      },
      looksLikeDateInput(text) {
        calls.push({ method: 'looksLikeDateInput', text });
        return /^\d{1,4}[\s./-]\d{1,2}[\s./-]\d{1,4}$/.test(String(text).trim());
      },
      parseDateInput(text) {
        calls.push({ method: 'parseDateInput', text });
        return overrides.parsedDate === undefined ? '1990-01-01' : overrides.parsedDate;
      },
      parseProfileNameInput(text) {
        calls.push({ method: 'parseProfileNameInput', text });
        return overrides.parsedName === undefined ? text.trim() : overrides.parsedName;
      },
      parseTimeInput(text) {
        calls.push({ method: 'parseTimeInput', text });
        return overrides.parsedTime === undefined ? '12:30' : overrides.parsedTime;
      },
      setSession(event, value) {
        calls.push({ method: 'setSession', event, value: { ...value } });
      },
      unlockSession(event, flowId) {
        calls.push({ method: 'unlockSession', event, flowId });
      }
    },
    profiles: {
      async getProfileById(event, profileId) {
        calls.push({ method: 'getProfileById', event, profileId });
        return { profileId, profileName: 'Sam' };
      },
      async saveProfile(event, profile) {
        calls.push({ method: 'saveProfile', event, profile });
        return { profileId: 'profile-1', profileName: profile.profileName };
      }
    },
    toolCache: {
      prewarmDailyHoroscope(event, profile, options) {
        calls.push({ method: 'prewarmDailyHoroscope', event, profile, options });
      },
      prewarmMonthlyTransitTimeline(event, profile) {
        calls.push({ method: 'prewarmMonthlyTransitTimeline', event, profile });
      }
    }
  };
  return deps;
}

async function testDateStepPromptsForCity() {
  const deps = createDeps();
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: '1990-01-01' };

  const result = await handler.handleActiveFlowText(event, channel, '1990-01-01', async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.equal(deps.calls.find((call) => call.method === 'setSession').value.step, 'city');
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'Send city');
}

async function testCityStepSetsChoiceMap() {
  const deps = createDeps({
    session: {
      flowId: 'flow-1',
      step: 'city',
      mode: 'create_primary'
    }
  });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: 'Paris' };

  const result = await handler.handleActiveFlowText(event, channel, 'Paris', async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.equal(deps.calls.find((call) => call.method === 'searchCities').text, 'Paris');
  assert.deepEqual(deps.calls.find((call) => call.method === 'setChoiceMap').value, {
    1: `${ACTIONS.CITY_PREFIX}0`
  });
  assert.equal(channel.calls[0].method, 'sendChoices');
  assert.equal(channel.calls[0].prompt, 'Confirm city');
}

async function testTimeKnownActionPromptsForTime() {
  const deps = createDeps({
    session: {
      flowId: 'flow-1',
      step: 'time_known',
      mode: 'create_primary'
    }
  });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'action', actionId: ACTIONS.TIME_YES };

  const result = await handler.handleNatalAction(event, channel, async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.equal(deps.calls.find((call) => call.method === 'setSession').value.step, 'time');
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'showPersistentActions']);
  assert.equal(channel.calls[1].text, 'Send time');
}

async function testUnknownTimeFinishesPrimaryFlow() {
  const deps = createDeps({
    session: {
      flowId: 'flow-1',
      step: 'time_known',
      mode: 'create_primary',
      cityMatch: { name: 'Paris', country: 'France' }
    }
  });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'action', actionId: ACTIONS.TIME_NO };

  const result = await handler.handleNatalAction(event, channel, async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText', 'editText']);
  assert.equal(channel.calls[1].text, 'Reading chart');
  assert.equal(channel.calls[2].text, 'First ready');
  assert.equal(deps.calls.some((call) => call.method === 'saveProfile'), true);
}

function createCityStepDeps(overrides = {}) {
  return createDeps({
    session: {
      flowId: 'flow-1',
      step: 'city',
      mode: 'create_primary',
      birthDate: { year: 1985, month: 2, day: 28, raw: '1985-02-28' }
    },
    ...overrides
  });
}

async function testDateAtCityStepCorrectsBirthDate() {
  const corrected = { year: 1985, month: 3, day: 15, raw: '1985-03-15' };
  const deps = createCityStepDeps({ parsedDate: corrected });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: '1985-03-15' };

  const result = await handler.handleActiveFlowText(event, channel, '1985-03-15', async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.equal(deps.calls.some((call) => call.method === 'searchCities'), false);
  const saved = deps.calls.find((call) => call.method === 'setSession').value;
  assert.equal(saved.step, 'city');
  assert.deepEqual(saved.birthDate, corrected);
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'Date updated to 1985-03-15');
}

async function testInvalidDateAtCityStepIsNotSearchedAsCity() {
  const deps = createCityStepDeps({ parsedDate: null });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: '1985-02-30' };

  const result = await handler.handleActiveFlowText(event, channel, '1985-02-30', async () => {
    throw new Error('should not continue');
  });

  assert.equal(result, true);
  assert.equal(deps.calls.some((call) => call.method === 'searchCities'), false);
  assert.equal(deps.calls.some((call) => call.method === 'setSession'), false);
  assert.deepEqual(channel.calls.map((call) => [call.method, call.text]), [['sendText', 'Looks like a date']]);
}

async function testCityLookupErrorIsLocalized() {
  const deps = createCityStepDeps({
    cityError: new FakeFreeAstroError('Could not find a city match for "Lyonnn".')
  });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: 'Lyonnn' };

  await handler.handleActiveFlowText(event, channel, 'Lyonnn', async () => {
    throw new Error('should not continue');
  });

  assert.deepEqual(channel.calls.map((call) => [call.method, call.text]), [
    ['sendText', 'localized Could not find a city match for "Lyonnn".']
  ]);
}

async function testUnexpectedCityLookupErrorUsesGenericMessage() {
  const deps = createCityStepDeps({ cityError: new Error('socket hang up') });
  const handler = createNatalFlowHandler(deps);
  const channel = createChannel();
  const event = { type: 'text', text: 'Lyon' };

  await handler.handleActiveFlowText(event, channel, 'Lyon', async () => {
    throw new Error('should not continue');
  });

  assert.deepEqual(channel.calls.map((call) => [call.method, call.text]), [['sendText', 'City lookup failed']]);
}

async function main() {
  await testDateStepPromptsForCity();
  await testCityStepSetsChoiceMap();
  await testDateAtCityStepCorrectsBirthDate();
  await testInvalidDateAtCityStepIsNotSearchedAsCity();
  await testCityLookupErrorIsLocalized();
  await testUnexpectedCityLookupErrorUsesGenericMessage();
  await testTimeKnownActionPromptsForTime();
  await testUnknownTimeFinishesPrimaryFlow();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
