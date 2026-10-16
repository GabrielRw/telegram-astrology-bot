const { createBillingHandlers } = require('../application/useCases/billingHandlers');
const { createCancelHandler } = require('../application/useCases/cancelHandler');
const { createDailyHoroscopeHandler } = require('../application/useCases/dailyHoroscopeHandler');
const { createLanguageHandlers } = require('../application/useCases/languageHandlers');
const {
  canHandleProfileAction,
  createProfileActionHandler
} = require('../application/useCases/profileActionHandler');
const { createProfileChartHandler } = require('../application/useCases/profileChartHandler');
const { createProfileHandler } = require('../application/useCases/profileHandler');
const { createStartHandler } = require('../application/useCases/startHandler');
const { ACTIONS } = require('../application/actionIds');
const { getChoiceMap } = require('../state/chatState');

const REQUIRED_HANDLER_NAMES = [
  'handleBilling',
  'handleCancel',
  'handleDailyHoroscope',
  'handleIncomingAction',
  'handleIncomingText',
  'promptForLanguage',
  'handleProfile',
  'handleSubscribe',
  'handleStart'
];

function getLegacyController() {
  return require('../core/controller');
}

function createLegacyControllerHandlers(sourceHandlers = getLegacyController(), overrides = {}) {
  const billingHandlers = createBillingHandlers();
  const cancelHandler = createCancelHandler();
  const dailyHoroscopeHandler = createDailyHoroscopeHandler();
  const languageHandlers = createLanguageHandlers();
  const profileActionHandler = createProfileActionHandler();
  const profileChartHandler = createProfileChartHandler();
  const profileHandler = createProfileHandler();
  const startHandler = createStartHandler();
  const handlers = {
    ...sourceHandlers,
    ...billingHandlers,
    ...cancelHandler,
    ...dailyHoroscopeHandler,
    ...languageHandlers,
    ...profileHandler,
    ...startHandler,
    ...overrides
  };

  if (
    typeof languageHandlers.handleLanguageAction === 'function' &&
    typeof sourceHandlers.handleIncomingAction === 'function' &&
    typeof overrides.handleIncomingAction !== 'function'
  ) {
    handlers.handleIncomingAction = (event, channelApi) => {
      const actionId = String(event?.actionId || '');
      if (actionId.startsWith('LANGUAGE_')) {
        return languageHandlers.handleLanguageAction(event, channelApi);
      }

      if (actionId === ACTIONS.DAILY_HOROSCOPE) {
        return dailyHoroscopeHandler.handleDailyHoroscope(event, channelApi);
      }

      if (actionId === ACTIONS.SETTINGS) {
        return profileHandler.handleProfile(event, channelApi);
      }

      if (canHandleProfileAction(actionId)) {
        return profileActionHandler.handleProfileAction(event, channelApi);
      }

      if (actionId === ACTIONS.PROFILE_SHOW_CHART) {
        return profileChartHandler.handleProfileChart(event, channelApi);
      }

      return sourceHandlers.handleIncomingAction(event, channelApi);
    };
  }

  if (
    typeof sourceHandlers.handleIncomingText === 'function' &&
    typeof overrides.handleIncomingText !== 'function'
  ) {
    handlers.handleIncomingText = (event, channelApi) => {
      const text = String(event?.text || '').trim();
      const mappedAction = getChoiceMap(event)[text];

      if (canHandleProfileAction(mappedAction)) {
        return profileActionHandler.handleProfileAction({
          ...event,
          actionId: mappedAction,
          type: 'action'
        }, channelApi);
      }

      return sourceHandlers.handleIncomingText(event, channelApi);
    };
  }

  const missing = REQUIRED_HANDLER_NAMES
    .filter((name) => typeof handlers[name] !== 'function');

  if (missing.length > 0) {
    throw new Error(`Missing controller handlers: ${missing.join(', ')}`);
  }

  return Object.freeze(Object.fromEntries(
    REQUIRED_HANDLER_NAMES.map((name) => [name, handlers[name]])
  ));
}

module.exports = {
  createLegacyControllerHandlers,
  REQUIRED_HANDLER_NAMES
};
