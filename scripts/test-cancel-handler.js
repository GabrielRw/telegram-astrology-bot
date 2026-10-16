const assert = require('node:assert/strict');

const { createCancelHandler } = require('../src/application/useCases/cancelHandler');

function createDeps() {
  const calls = [];
  const state = {
    history: [{ role: 'user', text: 'hello' }],
    lastToolResults: [{ name: 'tool' }],
    pendingQuestion: 'question',
    pendingSynastryQuestion: 'synastry',
    pendingWeddingSelection: { question: 'wedding' },
    choiceMap: { 1: 'ACTION' }
  };

  return {
    calls,
    state,
    persistence: {
      async ensureHydrated(event) {
        calls.push({ method: 'ensureHydrated', event });
      }
    },
    locale: {
      getLocale() {
        return 'en';
      },
      syncLocaleFromEvent(event) {
        calls.push({ method: 'syncLocaleFromEvent', event });
      },
      t(_eventOrLocale, path) {
        if (path === 'errors.cancelled') {
          return 'Cancelled';
        }
        if (path === 'buttons.settings') {
          return 'Settings';
        }
        if (path === 'buttons.dailyHoroscope') {
          return 'Daily Horoscope';
        }
        return path;
      }
    },
    natalFlow: {
      clearSession(event) {
        calls.push({ method: 'clearSession', event });
      }
    },
    chatState: {
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
      },
      getChatState(event) {
        calls.push({ method: 'getChatState', event });
        return state;
      },
      notifyPersistence(event) {
        calls.push({ method: 'notifyPersistence', event });
      }
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
    }
  };
}

async function testCancelClearsFlowAndConversationState() {
  const deps = createDeps();
  const handlers = createCancelHandler(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleCancel(event, channel);

  assert.equal(result, true);
  assert.deepEqual(deps.calls.map((call) => call.method), [
    'ensureHydrated',
    'syncLocaleFromEvent',
    'clearSession',
    'setPendingQuestion',
    'setPendingSynastryQuestion',
    'setPendingWeddingSelection',
    'setChoiceMap',
    'getChatState',
    'notifyPersistence'
  ]);
  assert.deepEqual(deps.state.history, []);
  assert.deepEqual(deps.state.lastToolResults, []);
  assert.equal(deps.state.pendingQuestion, null);
  assert.equal(deps.state.pendingSynastryQuestion, null);
  assert.equal(deps.state.pendingWeddingSelection, null);
  assert.deepEqual(deps.state.choiceMap, {});
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].text, 'Cancelled');
  assert.deepEqual(channel.calls[0].actions, [[
    { id: 'settings', title: 'Settings' },
    { id: 'daily_horoscope', title: 'Daily Horoscope' }
  ]]);
}

async function main() {
  await testCancelClearsFlowAndConversationState();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
