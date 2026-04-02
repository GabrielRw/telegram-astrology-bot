const { getDaily, FreeAstroError } = require('../services/freeastro');
const {
  formatDailyMessage,
  formatUsage,
  formatUserError,
  normalizeSign
} = require('../utils/format');

module.exports = function registerDailyCommand(bot) {
  bot.command('daily', async (ctx) => {
    const text = ctx.message?.text || '';
    const [, rawSign] = text.trim().split(/\s+/);
    const sign = normalizeSign(rawSign);

    if (!sign) {
      await ctx.reply(formatUsage('/daily <sign>', '/daily leo'));
      return;
    }

    const loadingMessage = await ctx.reply('Fetching stars...');

    try {
      const result = await getDaily(sign);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        undefined,
        formatDailyMessage(result)
      );
    } catch (error) {
      const message = error instanceof FreeAstroError ? formatUserError(error) : formatUserError(new Error('Unexpected error.'));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        undefined,
        message
      );
    }
  });
};
