const assert = require('node:assert/strict');

const { createBillingHandlers } = require('../src/application/useCases/billingHandlers');

function createLocale() {
  return {
    getLocale() {
      return 'en';
    },
    syncLocaleFromEvent(event) {
      event.localeSynced = true;
    },
    t(_eventOrLocale, path, args = {}) {
      if (path === 'buttons.settings') {
        return 'Settings';
      }
      if (path === 'buttons.dailyHoroscope') {
        return 'Daily Horoscope';
      }
      if (path === 'billing.statusFree') {
        return `Free ${args.used}/${args.limit}`;
      }
      if (path === 'billing.statusActive') {
        return 'Active';
      }
      if (path === 'billing.upgradePitch') {
        return `Upgrade ${args.price}`;
      }
      if (path === 'billing.subscribePrompt') {
        return 'Subscribe prompt';
      }
      if (path === 'billing.checkoutUnavailable') {
        return 'Checkout unavailable';
      }
      if (path === 'billing.portalReady') {
        return 'Portal ready';
      }
      if (path === 'billing.portalUnavailable') {
        return 'Portal unavailable';
      }
      if (path === 'billing.manageButton') {
        return 'Manage';
      }
      if (path === 'billing.subscribeButton') {
        return 'Subscribe';
      }
      return path;
    }
  };
}

function createChannel() {
  const calls = [];
  return {
    calls,
    async sendText(event, text, options) {
      calls.push({ method: 'sendText', event, text, options });
      return { messageId: calls.length };
    },
    async sendLink(event, prompt, label, url) {
      calls.push({ method: 'sendLink', event, prompt, label, url });
      return { messageId: calls.length };
    },
    async showPersistentActions(event, actions, text, options) {
      calls.push({ method: 'showPersistentActions', event, actions, text, options });
      return { messageId: calls.length };
    }
  };
}

function createBaseDeps(overrides = {}) {
  const calls = [];
  return {
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
    getChatState() {
      return null;
    },
    billing: {
      FREE_QUESTIONS_PER_DAY: 3,
      async getAccessSummary() {
        return {
          unlimited: false,
          usedToday: 1,
          profile: {},
          remainingFreeQuestions: 2,
          limitReached: false
        };
      },
      getBillingStatusLabel(access, t) {
        return t('billing.statusFree', { used: access.usedToday, limit: 3 });
      },
      getUpgradePitch(t) {
        return t('billing.upgradePitch', { price: '$4' });
      },
      isStripeConfigured() {
        return false;
      },
      async createCheckoutSessionUrl() {
        return 'https://checkout.example';
      },
      async createCustomerPortalUrl() {
        return 'https://portal.example';
      }
    },
    ...overrides
  };
}

async function testFreeBillingStatusUsesPersistentActions() {
  const deps = createBaseDeps();
  const handlers = createBillingHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleBilling(event, channel);

  assert.equal(result, true);
  assert.equal(event.localeSynced, true);
  assert.deepEqual(deps.calls.map((call) => call.method), ['ensureHydrated']);
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].method, 'showPersistentActions');
  assert.equal(channel.calls[0].text, 'Free 1/3\n\nUpgrade $4\n\nCheckout unavailable');
  assert.deepEqual(channel.calls[0].actions, [[
    { id: 'settings', title: 'Settings' },
    { id: 'daily_horoscope', title: 'Daily Horoscope' }
  ]]);
}

async function testSubscribeSendsCheckoutLink() {
  const deps = createBaseDeps({
    billing: {
      ...createBaseDeps().billing,
      isStripeConfigured() {
        return true;
      }
    }
  });
  const handlers = createBillingHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleSubscribe(event, channel);

  assert.equal(result, true);
  assert.equal(channel.calls.length, 1);
  assert.deepEqual(channel.calls[0], {
    method: 'sendLink',
    event,
    prompt: 'Upgrade $4\n\nSubscribe prompt',
    label: 'Subscribe',
    url: 'https://checkout.example'
  });
}

async function testSubscribeFallsBackWhenCheckoutUnavailable() {
  const deps = createBaseDeps({
    billing: {
      ...createBaseDeps().billing,
      isStripeConfigured() {
        return true;
      },
      async createCheckoutSessionUrl() {
        throw new Error('stripe unavailable');
      }
    }
  });
  const handlers = createBillingHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleSubscribe(event, channel);

  assert.equal(result, true);
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].method, 'sendText');
  assert.equal(channel.calls[0].text, 'Checkout unavailable');
}

async function testUnlimitedBillingSendsPortalLink() {
  const deps = createBaseDeps({
    billing: {
      ...createBaseDeps().billing,
      async getAccessSummary() {
        return {
          unlimited: true,
          usedToday: 0,
          profile: {},
          remainingFreeQuestions: null,
          limitReached: false
        };
      },
      getBillingStatusLabel(_access, t) {
        return t('billing.statusActive');
      }
    }
  });
  const handlers = createBillingHandlers(deps);
  const channel = createChannel();
  const event = { channel: 'telegram', chatId: '1' };

  const result = await handlers.handleBilling(event, channel);

  assert.equal(result, true);
  assert.equal(channel.calls.length, 1);
  assert.deepEqual(channel.calls[0], {
    method: 'sendLink',
    event,
    prompt: 'Active\n\nPortal ready',
    label: 'Manage',
    url: 'https://portal.example'
  });
}

async function main() {
  await testFreeBillingStatusUsesPersistentActions();
  await testSubscribeSendsCheckoutLink();
  await testSubscribeFallsBackWhenCheckoutUnavailable();
  await testUnlimitedBillingSendsPortalLink();
  console.log('ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
