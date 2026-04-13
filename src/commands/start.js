const { Markup } = require('telegraf');
const { formatStartMessage } = require('../utils/format');

module.exports = function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    await ctx.reply(
      formatStartMessage(),
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Daily', 'HELP_DAILY'),
          Markup.button.callback('Natal', 'HELP_NATAL')
        ]
      ])
    );
  });

  bot.action('HELP_DAILY', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Try: /daily leo');
  });

  bot.action('HELP_NATAL', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Send /natal and I will ask for birth date, time, and city step by step. After that, you can ask chart questions naturally.');
  });
};
