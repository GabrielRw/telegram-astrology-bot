const { Markup } = require('telegraf');

function toReplyMarkup(choices) {
  return Markup.inlineKeyboard(
    choices.map((choice) => [
      choice.url
        ? Markup.button.url(choice.title, choice.url)
        : Markup.button.callback(choice.title, choice.id)
    ])
  );
}

function toPersistentKeyboard(actions) {
  const rows = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.title || '').trim())
    .filter(Boolean)
    .map((title) => [title]);

  return Markup.keyboard(rows).resize();
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
    async sendText(event, text, options = {}) {
      const replyOptions = {};
      if (options.html) {
        replyOptions.parse_mode = 'HTML';
      }
      if (options.removeKeyboard) {
        replyOptions.reply_markup = Markup.removeKeyboard().reply_markup;
      } else if (Array.isArray(options.persistentActions) && options.persistentActions.length > 0) {
        replyOptions.reply_markup = toPersistentKeyboard(options.persistentActions).reply_markup;
      }

      const message = await ctx.reply(text, Object.keys(replyOptions).length > 0 ? replyOptions : undefined);
      return createTelegramMessageRef(ctx, message);
    },
    async editText(event, messageRef, text, options = {}) {
      if (!messageRef?.messageId) {
        return this.sendText(event, text, options);
      }

      await ctx.telegram.editMessageText(
        Number(messageRef.chatId || ctx.chat.id),
        messageRef.messageId,
        undefined,
        text,
        options.html ? { parse_mode: 'HTML' } : undefined
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
    async sendLink(event, prompt, label, url) {
      const message = await ctx.reply(
        prompt,
        Markup.inlineKeyboard([[Markup.button.url(label, url)]])
      );
      return createTelegramMessageRef(ctx, message);
    },
    async showPersistentActions(event, actions, text, options = {}) {
      return this.sendText(event, text, {
        ...options,
        persistentActions: actions
      });
    },
    async clearPersistentActions(event, text, options = {}) {
      return this.sendText(event, text, {
        ...options,
        removeKeyboard: true
      });
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
