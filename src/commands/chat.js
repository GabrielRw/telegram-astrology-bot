const { getChatState } = require('../state/chatState');
const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { handleIncomingText } = require('../core/controller');

module.exports = function registerChatCommand(bot) {
  bot.on('text', async (ctx) => {
    const text = String(ctx.message?.text || '').trim();

    if (!text || text.startsWith('/')) {
      return;
    }

    const event = createTelegramEvent(ctx, { type: 'text', text });
    const chatState = getChatState(event);

    if (chatState.activeFlow) {
      return;
    }

    await handleIncomingText(event, createTelegramChannelApi(ctx));
  });
};
