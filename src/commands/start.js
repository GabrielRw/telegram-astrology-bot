const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');

module.exports = function registerStartCommand(bot, routeIncomingEvent) {
  bot.start(async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'text', text: '/start' }),
      createTelegramChannelApi(ctx)
    );
  });
};
