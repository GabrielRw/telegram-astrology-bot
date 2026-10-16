const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');

module.exports = function registerBillingCommand(bot, routeIncomingEvent) {
  bot.command('billing', async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'text', text: '/billing' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.command('subscribe', async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'text', text: '/subscribe' }),
      createTelegramChannelApi(ctx)
    );
  });
};
