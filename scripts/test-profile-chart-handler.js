const assert = require('node:assert/strict');

const { createProfileChartHandler } = require('../src/application/useCases/profileChartHandler');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    translateUserError(_locale, error) {
      return `translated ${error.message}`;
    },
    t(_eventOrLocale, path) {
      const values = {
        'profile.chartUnavailable': 'Chart unavailable',
        'prompts.chartCaption': 'Chart caption'
      };
      return values[path] || path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async ackAction(event) {
      calls.push({ method: 'ackAction', event });
    },
    async sendImage(event, buffer, options) {
      calls.push({ method: 'sendImage', event, buffer, options });
    },
    async sendText(event, text) {
      calls.push({ method: 'sendText', event, text });
    }
  };
}

function createDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    locale: createLocale(),
    getChatState(event) {
      calls.push({ method: 'getChatState', event });
      return overrides.chatState || {
        chartRequestPayload: { date: '1990-01-01' },
        rawNatalPayload: { subject: { name: 'Ari' } },
        natalProfile: { city: 'Paris' }
      };
    },
    async getNatalChart(payload) {
      calls.push({ method: 'getNatalChart', payload });
      if (overrides.chartError) {
        throw overrides.chartError;
      }
      return { buffer: Buffer.from('chart') };
    },
    formatNatalMessage(rawNatalPayload, city, locale) {
      calls.push({ method: 'formatNatalMessage', rawNatalPayload, city, locale });
      return `formatted ${city} ${locale}`;
    }
  };
}

async function testSendsChartAndSummary() {
  const deps = createDeps();
  const handlers = createProfileChartHandler(deps);
  const channel = createChannel();
  const event = { actionId: 'PROFILE_SHOW_CHART' };

  const result = await handlers.handleProfileChart(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendImage', 'sendText']);
  assert.equal(channel.calls[1].buffer.toString(), 'chart');
  assert.deepEqual(channel.calls[1].options, {
    caption: 'Chart caption',
    filename: 'natal-chart.png'
  });
  assert.equal(channel.calls[2].text, 'formatted Paris en');
}

async function testMissingPayloadSendsUnavailable() {
  const deps = createDeps({
    chatState: {
      chartRequestPayload: null,
      rawNatalPayload: null,
      natalProfile: null
    }
  });
  const handlers = createProfileChartHandler(deps);
  const channel = createChannel();
  const event = { actionId: 'PROFILE_SHOW_CHART' };

  const result = await handlers.handleProfileChart(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText']);
  assert.equal(channel.calls[1].text, 'Chart unavailable');
}

async function testChartErrorIsTranslated() {
  const deps = createDeps({
    chartError: new Error('render failed')
  });
  const handlers = createProfileChartHandler(deps);
  const channel = createChannel();
  const event = { actionId: 'PROFILE_SHOW_CHART' };

  const result = await handlers.handleProfileChart(event, channel);

  assert.equal(result, true);
  assert.deepEqual(channel.calls.map((call) => call.method), ['ackAction', 'sendText']);
  assert.equal(channel.calls[1].text, 'translated render failed');
}

async function main() {
  await testSendsChartAndSummary();
  await testMissingPayloadSendsUnavailable();
  await testChartErrorIsTranslated();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
