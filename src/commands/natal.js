const { getChatState } = require('../state/chatState');
const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS } = require('../application/actionIds');

module.exports = function registerNatalCommand(bot, routeIncomingEvent) {
  bot.command('cancel', async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.CANCEL }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.TIME_YES, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.TIME_YES }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.TIME_NO, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.TIME_NO }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^NATAL_CITY_(\d+)$/, async (ctx) => {
    await routeIncomingEvent(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.on('text', async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();

    if (!text || text.startsWith('/')) {
      return next();
    }

    const event = createTelegramEvent(ctx, { type: 'text', text });
    const chatState = getChatState(event);

    if (!chatState.activeFlow) {
      return next();
    }

    await routeIncomingEvent(event, createTelegramChannelApi(ctx));
  });
};
