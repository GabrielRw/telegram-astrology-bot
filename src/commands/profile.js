const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS } = require('../application/actionIds');

module.exports = function registerProfileCommand(bot, routeIncomingEvent) {
  for (const command of ['profile', 'reglage', 'settings', 'einstellungen', 'ajustes']) {
    bot.command(command, async (ctx) => {
      await routeIncomingEvent(
        createTelegramEvent(ctx, { type: 'text', text: `/${command}` }),
        createTelegramChannelApi(ctx)
      );
    });
  }

  bot.action(ACTIONS.PROFILE_UPDATE, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_UPDATE }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_ADD, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_ADD }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_SWITCH, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_SWITCH }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_RESET, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_RESET }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_SHOW_CHART, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_SHOW_CHART }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.PROFILE_TOGGLE_RESPONSE_MODE }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^PROFILE_SWITCH_.+$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^SYNASTRY_PARTNER_.+$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^WEDDING_SPOUSE_A_.+$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.WEDDING_SPOUSE_B_NEW, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.WEDDING_SPOUSE_B_NEW }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^WEDDING_SPOUSE_B_.+$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^RELOCATION_CITY_.+$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });
};
