const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS, handleIncomingAction, handleStart } = require('../core/controller');

module.exports = function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    await handleStart(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.HELP_DAILY, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.HELP_DAILY }),
      createTelegramChannelApi(ctx)
    );
  });
};
