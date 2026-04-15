const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS, handleIncomingAction, handleStart } = require('../core/controller');

module.exports = function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    await handleStart(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^SHOW_MORE_QUESTIONS_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^STARTER_QUESTION_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^FULL_QUESTION_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });
};
