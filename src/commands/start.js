const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { handleStart } = require('../core/controller');

module.exports = function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    await handleStart(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });
};
