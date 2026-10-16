const { ACTIONS } = require('./actionIds');

function getGlobalPersistentActions(locale, localeService) {
  return [[
    {
      id: ACTIONS.SETTINGS,
      title: localeService.t(locale, 'buttons.settings')
    },
    {
      id: ACTIONS.DAILY_HOROSCOPE,
      title: localeService.t(locale, 'buttons.dailyHoroscope')
    }
  ]];
}

function getFlowPersistentActions(locale, localeService) {
  return [
    [
      {
        id: ACTIONS.CANCEL,
        title: localeService.t(locale, 'buttons.cancel')
      }
    ],
    [
      {
        id: ACTIONS.SETTINGS,
        title: localeService.t(locale, 'buttons.settings')
      },
      {
        id: ACTIONS.DAILY_HOROSCOPE,
        title: localeService.t(locale, 'buttons.dailyHoroscope')
      }
    ]
  ];
}

async function sendFlowPrompt(event, channelApi, text, deps, options = {}) {
  const locale = deps.locale.getLocale(event);
  if (typeof channelApi.showPersistentActions === 'function') {
    return channelApi.showPersistentActions(
      event,
      getFlowPersistentActions(locale, deps.locale),
      text,
      options
    );
  }

  return channelApi.sendText(event, text, options);
}

async function sendGlobalPrompt(event, channelApi, text, deps, options = {}) {
  const locale = deps.locale.getLocale(event);
  if (typeof channelApi.showPersistentActions === 'function') {
    return channelApi.showPersistentActions(
      event,
      getGlobalPersistentActions(locale, deps.locale),
      text,
      options
    );
  }

  return channelApi.sendText(event, text, options);
}

async function sendExternalLink(event, channelApi, prompt, labelKey, url, deps) {
  if (typeof channelApi.sendLink === 'function') {
    await channelApi.sendLink(event, prompt, deps.locale.t(event, labelKey), url);
    return true;
  }

  await channelApi.sendText(event, `${prompt}\n\n${deps.locale.t(event, labelKey)}: ${url}`);
  return true;
}

module.exports = {
  getFlowPersistentActions,
  getGlobalPersistentActions,
  sendExternalLink,
  sendFlowPrompt,
  sendGlobalPrompt
};
