const { Markup } = require('telegraf');

function toReplyMarkup(choices) {
  return Markup.inlineKeyboard(
    choices.map((choice) => [Markup.button.callback(choice.title, choice.id)])
  );
}

function createTelegramMessageRef(ctx, message) {
  return {
    chatId: String(ctx.chat.id),
    messageId: message?.message_id || null
  };
}

function createTelegramChannelApi(ctx) {
  return {
    capabilities: {
      canEdit: true,
      helpActions: true,
      interactiveChoices: true,
      richNatalActions: true
    },
    async sendText(event, text) {
      const message = await ctx.reply(text);
      return createTelegramMessageRef(ctx, message);
    },
    async editText(event, messageRef, text) {
      if (!messageRef?.messageId) {
        return this.sendText(event, text);
      }

      await ctx.telegram.editMessageText(
        Number(messageRef.chatId || ctx.chat.id),
        messageRef.messageId,
        undefined,
        text
      );

      return messageRef;
    },
    async sendImage(event, buffer, options = {}) {
      const message = await ctx.replyWithPhoto(
        {
          source: buffer,
          filename: options.filename || 'chart.png'
        },
        {
          caption: options.caption
        }
      );

      return createTelegramMessageRef(ctx, message);
    },
    async sendChoices(event, prompt, choices) {
      const message = await ctx.reply(prompt, toReplyMarkup(choices));
      return createTelegramMessageRef(ctx, message);
    },
    async ackAction(event, text) {
      if (ctx.answerCbQuery) {
        await ctx.answerCbQuery(text);
      }
    }
  };
}

function createTelegramEvent(ctx, overrides = {}) {
  return {
    channel: 'telegram',
    userId: String(ctx.from?.id || ctx.chat?.id || ''),
    chatId: String(ctx.chat?.id || ''),
    localeHint: overrides.localeHint !== undefined ? overrides.localeHint : (ctx.from?.language_code || null),
    type: overrides.type || 'text',
    text: overrides.text !== undefined ? overrides.text : String(ctx.message?.text || ''),
    actionId: overrides.actionId || null,
    messageRef: overrides.messageRef || (ctx.message ? { chatId: String(ctx.chat.id), messageId: ctx.message.message_id } : null)
  };
}

module.exports = {
  createTelegramChannelApi,
  createTelegramEvent
};
