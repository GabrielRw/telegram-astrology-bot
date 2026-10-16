const defaultBilling = require('../../services/billing');
const defaultPersistence = require('../../services/persistence');
const defaultLocale = require('../../services/locale');
const defaultToolCache = require('../../services/toolCache');
const { getChatState: defaultGetChatState } = require('../../state/chatState');
const { sendExternalLink, sendGlobalPrompt } = require('../channelPrompts');
const { scheduleDailyHoroscopePrewarm } = require('../dailyHoroscopePrewarm');

async function maybeBuildCheckoutLink(identity, deps) {
  if (!deps.billing.isStripeConfigured()) {
    return null;
  }

  try {
    return await deps.billing.createCheckoutSessionUrl(identity);
  } catch (error) {
    return null;
  }
}

async function sendBillingStatus(event, channelApi, deps) {
  const access = await deps.billing.getAccessSummary(event);
  const translate = (path, args) => deps.locale.t(event, path, args);
  const lines = [deps.billing.getBillingStatusLabel(access, translate)];

  if (access.unlimited) {
    try {
      const portalUrl = await deps.billing.createCustomerPortalUrl(event);
      const prompt = [...lines, deps.locale.t(event, 'billing.portalReady')].join('\n\n');
      await sendExternalLink(event, channelApi, prompt, 'billing.manageButton', portalUrl, deps);
      return true;
    } catch (error) {
      lines.push(deps.locale.t(event, 'billing.portalUnavailable'));
    }
  } else {
    lines.push(deps.billing.getUpgradePitch(translate));
    lines.push(
      deps.billing.isStripeConfigured()
        ? deps.locale.t(event, 'billing.subscribePrompt')
        : deps.locale.t(event, 'billing.checkoutUnavailable')
    );
  }

  await sendGlobalPrompt(event, channelApi, lines.join('\n\n'), deps);
  return true;
}

function createBillingHandlers(overrides = {}) {
  const deps = {
    billing: defaultBilling,
    persistence: defaultPersistence,
    locale: defaultLocale,
    toolCache: defaultToolCache,
    getChatState: defaultGetChatState,
    ...overrides
  };

  return {
    async handleBilling(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      scheduleDailyHoroscopePrewarm(event, deps);
      return sendBillingStatus(event, channelApi, deps);
    },

    async handleSubscribe(event, channelApi) {
      await deps.persistence.ensureHydrated(event);
      deps.locale.syncLocaleFromEvent(event);
      scheduleDailyHoroscopePrewarm(event, deps);

      const access = await deps.billing.getAccessSummary(event);

      if (access.unlimited) {
        return sendBillingStatus(event, channelApi, deps);
      }

      const checkoutUrl = await maybeBuildCheckoutLink(event, deps);

      if (!checkoutUrl) {
        await channelApi.sendText(event, deps.locale.t(event, 'billing.checkoutUnavailable'));
        return true;
      }

      const translate = (path, args) => deps.locale.t(event, path, args);
      return sendExternalLink(
        event,
        channelApi,
        [
          deps.billing.getUpgradePitch(translate),
          deps.locale.t(event, 'billing.subscribePrompt')
        ].join('\n\n'),
        'billing.subscribeButton',
        checkoutUrl,
        deps
      );
    }
  };
}

module.exports = {
  createBillingHandlers
};
