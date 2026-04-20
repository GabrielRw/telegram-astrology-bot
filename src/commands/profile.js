const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS, handleIncomingAction, handleProfile } = require('../core/controller');

module.exports = function registerProfileCommand(bot) {
  bot.command('profile', async (ctx) => {
    await handleProfile(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_UPDATE, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_UPDATE }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_ADD, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_ADD }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_RESET, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_RESET }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_SHOW_CHART, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_SHOW_CHART }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^PROFILE_SWITCH_.+$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^SYNASTRY_PARTNER_.+$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^RELOCATION_CITY_.+$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });
};
