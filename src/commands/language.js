const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS } = require('../application/actionIds');
const { SUPPORTED_LOCALES } = require('../services/locale');

module.exports = function registerLanguageCommand(bot, routeIncomingEvent) {
  bot.command('language', async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'text', text: '/language' }),
      createTelegramChannelApi(ctx)
    );
  });

  for (const locale of SUPPORTED_LOCALES) {
    const actionId = `${ACTIONS.LANGUAGE_PREFIX}${locale}`;

    bot.action(actionId, async (ctx) => {
      await routeIncomingEvent(
        createTelegramEvent(ctx, { type: 'action', actionId }),
        createTelegramChannelApi(ctx)
      );
    });
  }
};
