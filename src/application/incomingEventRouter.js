const { ACTIONS } = require('./actionIds');

const PROFILE_COMMANDS = new Set([
  '/profile',
  '/reglage',
  '/settings',
  '/einstellungen',
  '/ajustes'
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function requireHandler(handlers, name) {
  if (typeof handlers?.[name] !== 'function') {
    throw new Error(`Missing incoming event handler: ${name}`);
  }

  return handlers[name];
}

function getTextIntent(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return null;
  }

  if (normalized === 'start' || normalized === '/start') {
    return 'start';
  }

  if (PROFILE_COMMANDS.has(normalized)) {
    return 'profile';
  }

  if (normalized === '/language') {
    return 'language';
  }

  if (normalized === '/billing') {
    return 'billing';
  }

  if (normalized === '/subscribe') {
    return 'subscribe';
  }

  if (
    normalized === ACTIONS.DAILY_HOROSCOPE ||
    normalized === '/daily' ||
    normalized === '/daily_horoscope' ||
    normalized === 'my daily horoscope'
  ) {
    return 'daily_horoscope';
  }

  return 'text';
}

async function routeIncomingEvent(event, channelApi, handlers) {
  if (event?.type === 'action') {
    if (event.actionId === ACTIONS.CANCEL) {
      return requireHandler(handlers, 'handleCancel')(event, channelApi);
    }

    if (event.actionId === ACTIONS.SETTINGS) {
      return requireHandler(handlers, 'handleProfile')(event, channelApi);
    }

    if (event.actionId === ACTIONS.DAILY_HOROSCOPE) {
      return requireHandler(handlers, 'handleDailyHoroscope')(event, channelApi);
    }

    return requireHandler(handlers, 'handleIncomingAction')(event, channelApi);
  }

  if (event?.type !== 'text') {
    return false;
  }

  const intent = getTextIntent(event.text);

  if (intent === 'start') {
    return requireHandler(handlers, 'handleStart')(event, channelApi);
  }

  if (intent === 'profile') {
    return requireHandler(handlers, 'handleProfile')(event, channelApi);
  }

  if (intent === 'language') {
    return requireHandler(handlers, 'promptForLanguage')(event, channelApi);
  }

  if (intent === 'billing') {
    return requireHandler(handlers, 'handleBilling')(event, channelApi);
  }

  if (intent === 'subscribe') {
    return requireHandler(handlers, 'handleSubscribe')(event, channelApi);
  }

  if (intent === 'daily_horoscope') {
    return requireHandler(handlers, 'handleDailyHoroscope')(event, channelApi);
  }

  if (intent === 'text') {
    return requireHandler(handlers, 'handleIncomingText')(event, channelApi);
  }

  return false;
}

function createIncomingEventRouter(handlers) {
  return (event, channelApi) => routeIncomingEvent(event, channelApi, handlers);
}

module.exports = {
  createIncomingEventRouter,
  getTextIntent,
  routeIncomingEvent
};
