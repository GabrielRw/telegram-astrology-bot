const WHATSAPP_GRAPH_URL = 'https://graph.facebook.com/v23.0';

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getPhoneNumberId() {
  return getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID');
}

function getAccessToken() {
  return getRequiredEnv('WHATSAPP_ACCESS_TOKEN');
}

async function sendGraphRequest(path, options = {}) {
  const response = await fetch(`${WHATSAPP_GRAPH_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.error?.message || 'WhatsApp Graph API request failed.';
    throw new Error(message);
  }

  return data;
}

async function uploadMedia(buffer, filename = 'chart.png') {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: 'image/png' }), filename);

  const data = await sendGraphRequest(`/${getPhoneNumberId()}/media`, {
    method: 'POST',
    body: form
  });

  return data?.id;
}

async function sendMessage(body) {
  return sendGraphRequest(`/${getPhoneNumberId()}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...body
    })
  });
}

function createWhatsAppMessageRef(data) {
  return {
    chatId: String(data?.contacts?.[0]?.wa_id || ''),
    messageId: data?.messages?.[0]?.id || null
  };
}

function createWhatsAppChannelApi() {
  return {
    capabilities: {
      canEdit: false,
      helpActions: false,
      interactiveChoices: true,
      richNatalActions: false
    },
    async sendText(event, text) {
      const data = await sendMessage({
        to: event.userId,
        type: 'text',
        text: { body: text }
      });

      return createWhatsAppMessageRef(data);
    },
    async editText(event, messageRef, text) {
      return this.sendText(event, text);
    },
    async sendImage(event, buffer, options = {}) {
      const mediaId = await uploadMedia(buffer, options.filename);
      const data = await sendMessage({
        to: event.userId,
        type: 'image',
        image: {
          id: mediaId,
          caption: options.caption
        }
      });

      return createWhatsAppMessageRef(data);
    },
    async sendChoices(event, prompt, choices) {
      const replyButtons = choices.slice(0, 3).map((choice) => ({
        type: 'reply',
        reply: {
          id: choice.id,
          title: choice.title.slice(0, 20)
        }
      }));

      const data = await sendMessage({
        to: event.userId,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: prompt },
          action: { buttons: replyButtons }
        }
      });

      return createWhatsAppMessageRef(data);
    },
    async sendLink(event, prompt, label, url) {
      return this.sendText(event, `${prompt}\n\n${label}: ${url}`);
    },
    async ackAction() {}
  };
}

function getWhatsappPaths() {
  return {
    webhookPath: process.env.WHATSAPP_WEBHOOK_PATH || '/whatsapp/webhook'
  };
}

function normalizeWhatsAppEvents(payload) {
  const changes = Array.isArray(payload?.entry)
    ? payload.entry.flatMap((entry) => entry?.changes || [])
    : [];

  return changes.flatMap((change) => {
    const value = change?.value || {};
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const contacts = Array.isArray(value.contacts) ? value.contacts : [];

    return messages.map((message) => {
      const contact = contacts.find((item) => String(item?.wa_id || '') === String(message.from || ''));
      const baseEvent = {
        channel: 'whatsapp',
        userId: String(message.from || ''),
        chatId: String(message.from || ''),
        localeHint: contact?.profile?.language || contact?.language || null,
        messageRef: { chatId: String(message.from || ''), messageId: message.id || null }
      };

      if (message.type === 'text') {
        return {
          ...baseEvent,
          type: 'text',
          text: String(message.text?.body || ''),
          actionId: null
        };
      }

      const replyId = message.interactive?.button_reply?.id || message.button?.payload || null;

      if (replyId) {
        return {
          ...baseEvent,
          type: 'action',
          text: '',
          actionId: String(replyId)
        };
      }

      return {
        ...baseEvent,
        type: 'text',
        text: '',
        actionId: null
      };
    });
  });
}

module.exports = {
  createWhatsAppChannelApi,
  getWhatsappPaths,
  getRequiredEnv,
  normalizeWhatsAppEvents
};
