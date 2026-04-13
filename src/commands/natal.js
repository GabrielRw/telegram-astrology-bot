const { getChatState } = require('../state/chatState');
const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const {
  ACTIONS,
  handleCancel,
  handleExplicitNatal,
  handleIncomingAction,
  handleIncomingText
} = require('../core/controller');

module.exports = function registerNatalCommand(bot) {
  bot.command('natal', async (ctx) => {
    await handleExplicitNatal(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.command('cancel', async (ctx) => {
    await handleCancel(
      createTelegramEvent(ctx, { type: 'action', actionId: 'cancel' }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.TIME_YES, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.TIME_YES }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(ACTIONS.TIME_NO, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ACTIONS.TIME_NO }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^NATAL_CITY_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^NATAL_ASPECT_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
      createTelegramEvent(ctx, { type: 'action', actionId: ctx.match[0] }),
      createTelegramChannelApi(ctx)
    );
  });

  bot.action(/^NATAL_PLANET_(\d+)$/, async (ctx) => {
    await handleIncomingAction(
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

    await handleIncomingText(event, createTelegramChannelApi(ctx));
  });
};
