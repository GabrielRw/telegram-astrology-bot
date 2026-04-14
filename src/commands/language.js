const { createTelegramChannelApi, createTelegramEvent } = require('../channels/telegram/api');
const { ACTIONS, handleIncomingAction, promptForLanguage } = require('../core/controller');
const { SUPPORTED_LOCALES } = require('../services/locale');

module.exports = function registerLanguageCommand(bot) {
  bot.command('language', async (ctx) => {
    await promptForLanguage(
      createTelegramEvent(ctx, { type: 'start' }),
      createTelegramChannelApi(ctx)
    );
  });

  for (const locale of SUPPORTED_LOCALES) {
    const actionId = `${ACTIONS.LANGUAGE_PREFIX}${locale}`;

    bot.action(actionId, async (ctx) => {
      await handleIncomingAction(
        createTelegramEvent(ctx, { type: 'action', actionId }),
        createTelegramChannelApi(ctx)
      );
    });
  }
};
