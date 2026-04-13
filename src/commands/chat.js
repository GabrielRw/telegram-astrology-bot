const { answerConversation } = require('../services/conversation');
const { getGeminiErrorMessage } = require('../services/gemini');
const { getChatState, setPendingQuestion } = require('../state/chatState');
const { startNatalFlow } = require('../services/natalFlow');
const { splitMessage } = require('../utils/format');

module.exports = function registerChatCommand(bot) {
  bot.on('text', async (ctx) => {
    const text = String(ctx.message?.text || '').trim();

    if (!text || text.startsWith('/')) {
      return;
    }

    const chatState = getChatState(ctx.chat.id);

    if (chatState.activeFlow) {
      return;
    }

    if (!chatState.natalProfile) {
      setPendingQuestion(ctx.chat.id, text);
      startNatalFlow(ctx.chat.id, 'chat');
      await ctx.reply(
        [
          'I can answer that, but first I need your natal chart so the reading is specific to you.',
          '',
          'Reply with your name, or send `skip` to use Telegram User.',
          'You can cancel anytime with /cancel.'
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const loadingMessage = await ctx.reply('Reading your chart...');

    try {
      const result = await answerConversation(ctx.chat.id, text);
      const chunks = splitMessage(result.text);

      if (chunks.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          undefined,
          'I could not produce a grounded astrology answer.'
        );
        return;
      }

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        undefined,
        chunks[0]
      );

      for (const chunk of chunks.slice(1)) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        undefined,
        `Conversational mode is unavailable right now.\n${getGeminiErrorMessage(error)}`
      );
    }
  });
};
