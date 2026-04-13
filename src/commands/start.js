const { Markup } = require('telegraf');
const { startNatalFlow } = require('../services/natalFlow');
const { getChatState, setPendingQuestion } = require('../state/chatState');
const { formatStartMessage } = require('../utils/format');

module.exports = function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    const chatState = getChatState(ctx.chat.id);

    if (chatState.natalProfile) {
      await ctx.reply(
        [
          'Your birth details are already saved.',
          '',
          'Ask a chart question directly, or use /daily leo for a sign forecast.'
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('Daily', 'HELP_DAILY')]
        ])
      );
      return;
    }

    setPendingQuestion(ctx.chat.id, null);
    startNatalFlow(ctx.chat.id, 'start');

    await ctx.reply(
      formatStartMessage(),
      Markup.inlineKeyboard([
        [Markup.button.callback('Daily', 'HELP_DAILY')]
      ])
    );

    await ctx.reply(
      [
        'First step: reply with your name, or send `skip` to use Telegram User.',
        'You can cancel anytime with /cancel.'
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('HELP_DAILY', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Try: /daily leo');
  });
};
