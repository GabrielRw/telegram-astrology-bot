const assert = require('node:assert/strict');

const { ACTIONS } = require('../src/application/actionIds');
const {
  createIncomingEventRouter,
  getTextIntent,
  routeIncomingEvent
} = require('../src/application/incomingEventRouter');
const {
  createLegacyControllerHandlers,
  REQUIRED_HANDLER_NAMES
} = require('../src/adapters/legacyControllerHandlers');
const { processWhatsAppEvent } = require('../src/channels/whatsapp/webhook');

function createHandlers(calls) {
  return {
    async handleIncomingAction(event, channelApi) {
      calls.push({ handler: 'action', event, channelApi });
      return 'action-result';
    },
    async handleCancel(event, channelApi) {
      calls.push({ handler: 'cancel', event, channelApi });
      return 'cancel-result';
    },
    async handleStart(event, channelApi) {
      calls.push({ handler: 'start', event, channelApi });
      return 'start-result';
    },
    async handleProfile(event, channelApi) {
      calls.push({ handler: 'profile', event, channelApi });
      return 'profile-result';
    },
    async promptForLanguage(event, channelApi) {
      calls.push({ handler: 'language', event, channelApi });
      return 'language-result';
    },
    async handleBilling(event, channelApi) {
      calls.push({ handler: 'billing', event, channelApi });
      return 'billing-result';
    },
    async handleSubscribe(event, channelApi) {
      calls.push({ handler: 'subscribe', event, channelApi });
      return 'subscribe-result';
    },
    async handleDailyHoroscope(event, channelApi) {
      calls.push({ handler: 'daily_horoscope', event, channelApi });
      return 'daily-result';
    },
    async handleIncomingText(event, channelApi) {
      calls.push({ handler: 'text', event, channelApi });
      return 'text-result';
    }
  };
}

async function testTextIntentNormalization() {
  assert.equal(getTextIntent('start'), 'start');
  assert.equal(getTextIntent(' /START '), 'start');
  assert.equal(getTextIntent('/settings'), 'profile');
  assert.equal(getTextIntent('/reglage'), 'profile');
  assert.equal(getTextIntent('/language'), 'language');
  assert.equal(getTextIntent('/billing'), 'billing');
  assert.equal(getTextIntent('/subscribe'), 'subscribe');
  assert.equal(getTextIntent('/daily'), 'daily_horoscope');
  assert.equal(getTextIntent('daily_horoscope'), 'daily_horoscope');
  assert.equal(getTextIntent('What is my rising sign?'), 'text');
  assert.equal(getTextIntent('   '), null);
}

async function testRoutesActionEvents() {
  const calls = [];
  const channelApi = { id: 'channel' };
  const event = { type: 'action', actionId: 'NATAL_TIME_YES' };
  const result = await routeIncomingEvent(event, channelApi, createHandlers(calls));

  assert.equal(result, 'action-result');
  assert.deepEqual(calls.map((call) => call.handler), ['action']);
  assert.equal(calls[0].event, event);
  assert.equal(calls[0].channelApi, channelApi);
}

async function testRoutesCancelAction() {
  const calls = [];
  const channelApi = { id: 'channel' };
  const event = { type: 'action', actionId: ACTIONS.CANCEL };
  const result = await routeIncomingEvent(event, channelApi, createHandlers(calls));

  assert.equal(result, 'cancel-result');
  assert.deepEqual(calls.map((call) => call.handler), ['cancel']);
  assert.equal(calls[0].event, event);
  assert.equal(calls[0].channelApi, channelApi);
}

async function testRoutesPersistentActionEvents() {
  const cases = [
    { actionId: ACTIONS.SETTINGS, expectedHandler: 'profile', expectedResult: 'profile-result' },
    { actionId: ACTIONS.DAILY_HOROSCOPE, expectedHandler: 'daily_horoscope', expectedResult: 'daily-result' }
  ];

  for (const testCase of cases) {
    const calls = [];
    const channelApi = { id: 'channel' };
    const event = { type: 'action', actionId: testCase.actionId };
    const result = await routeIncomingEvent(event, channelApi, createHandlers(calls));

    assert.equal(result, testCase.expectedResult);
    assert.deepEqual(calls.map((call) => call.handler), [testCase.expectedHandler]);
    assert.equal(calls[0].event, event);
    assert.equal(calls[0].channelApi, channelApi);
  }
}

async function testRoutesTextCommands() {
  const cases = [
    { text: 'start', expectedHandler: 'start', expectedResult: 'start-result' },
    { text: '/start', expectedHandler: 'start', expectedResult: 'start-result' },
    { text: '/profile', expectedHandler: 'profile', expectedResult: 'profile-result' },
    { text: '/settings', expectedHandler: 'profile', expectedResult: 'profile-result' },
    { text: '/language', expectedHandler: 'language', expectedResult: 'language-result' },
    { text: '/billing', expectedHandler: 'billing', expectedResult: 'billing-result' },
    { text: '/subscribe', expectedHandler: 'subscribe', expectedResult: 'subscribe-result' },
    { text: '/daily', expectedHandler: 'daily_horoscope', expectedResult: 'daily-result' },
    { text: 'What is my Moon sign?', expectedHandler: 'text', expectedResult: 'text-result' }
  ];

  for (const testCase of cases) {
    const calls = [];
    const event = { type: 'text', text: testCase.text };
    const channelApi = { id: testCase.text };
    const result = await routeIncomingEvent(event, channelApi, createHandlers(calls));

    assert.equal(result, testCase.expectedResult);
    assert.deepEqual(calls.map((call) => call.handler), [testCase.expectedHandler]);
    assert.equal(calls[0].event, event);
    assert.equal(calls[0].channelApi, channelApi);
  }
}

async function testCreatesInjectedRouter() {
  const calls = [];
  const router = createIncomingEventRouter(createHandlers(calls));
  const event = { type: 'text', text: '/billing' };
  const channelApi = { id: 'injected' };
  const result = await router(event, channelApi);

  assert.equal(result, 'billing-result');
  assert.deepEqual(calls.map((call) => call.handler), ['billing']);
  assert.equal(calls[0].event, event);
  assert.equal(calls[0].channelApi, channelApi);
}

async function testFailsWhenRequiredHandlerMissing() {
  await assert.rejects(
    () => routeIncomingEvent({ type: 'text', text: '/billing' }, {}, {}),
    /Missing incoming event handler: handleBilling/
  );
}

async function testIgnoresUnsupportedEvents() {
  const calls = [];
  const result = await routeIncomingEvent(
    { type: 'image', text: 'ignored' },
    {},
    createHandlers(calls)
  );

  assert.equal(result, false);
  assert.deepEqual(calls, []);
}

async function testWhatsAppProcessorUsesInjectedRouter() {
  const event = { channel: 'whatsapp', type: 'text', text: 'start', userId: 'user-1' };
  const calls = [];
  const result = await processWhatsAppEvent(event, async (routedEvent, channelApi) => {
    calls.push({ routedEvent, channelApi });
    return 'whatsapp-result';
  });

  assert.equal(result, 'whatsapp-result');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].routedEvent, event);
  assert.equal(typeof calls[0].channelApi.sendText, 'function');
}

async function testWhatsAppProcessorRequiresRouter() {
  await assert.rejects(
    () => processWhatsAppEvent({ channel: 'whatsapp', type: 'text' }),
    /Missing routeIncomingEvent dependency/
  );
}

async function testControllerHandlerFactorySelectsRequiredHandlers() {
  const sourceHandlers = Object.fromEntries(
    REQUIRED_HANDLER_NAMES.map((name) => [name, async () => `${name}-result`])
  );
  sourceHandlers.extraHandler = async () => 'extra';

  const handlers = createLegacyControllerHandlers(sourceHandlers);

  assert.deepEqual(Object.keys(handlers), REQUIRED_HANDLER_NAMES);
  assert.equal(handlers.extraHandler, undefined);
  assert.equal(Object.isFrozen(handlers), true);
}

async function testControllerHandlerFactoryAllowsOverrides() {
  const sourceHandlers = Object.fromEntries(
    REQUIRED_HANDLER_NAMES.map((name) => [name, async () => `${name}-result`])
  );
  const override = async () => 'override-result';
  const handlers = createLegacyControllerHandlers(sourceHandlers, {
    handleBilling: override
  });

  assert.equal(handlers.handleBilling, override);
}

async function testControllerHandlerFactoryFailsForMissingHandlers() {
  assert.throws(
    () => createLegacyControllerHandlers({}),
    /Missing controller handlers:/
  );
}

async function main() {
  await testTextIntentNormalization();
  await testRoutesActionEvents();
  await testRoutesCancelAction();
  await testRoutesPersistentActionEvents();
  await testRoutesTextCommands();
  await testCreatesInjectedRouter();
  await testFailsWhenRequiredHandlerMissing();
  await testIgnoresUnsupportedEvents();
  await testWhatsAppProcessorUsesInjectedRouter();
  await testWhatsAppProcessorRequiresRouter();
  await testControllerHandlerFactorySelectsRequiredHandlers();
  await testControllerHandlerFactoryAllowsOverrides();
  await testControllerHandlerFactoryFailsForMissingHandlers();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
