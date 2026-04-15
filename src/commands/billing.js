const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { handleBilling, handleSubscribe } = require('../core/controller');

module.exports = function registerBillingCommand(bot) {
  bot.command('billing', async (ctx) => {
    await handleBilling(
      createTelegramEvent(ctx, { type: 'command' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.command('subscribe', async (ctx) => {
    await handleSubscribe(
      createTelegramEvent(ctx, { type: 'command' }),
      createTelegramChannelApi(ctx)
    );
  });
};
