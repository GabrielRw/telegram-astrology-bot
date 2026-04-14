const { createHash } = require('node:crypto');
const {
  createWhatsAppChannelApi,
  getRequiredEnv,
  normalizeWhatsAppEvents
} = require('./api');
const {
  handleStart,
  handleProfile,
  handleIncomingAction,
  handleIncomingText,
  promptForLanguage
} = require('../../core/controller');
const eventQueue = require('../../services/eventQueue');
const { reportError } = require('../../services/logger');

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

async function handleWhatsAppVerification(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === getRequiredEnv('WHATSAPP_VERIFY_TOKEN')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(challenge || '');
    return;
  }

  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('forbidden');
}

async function processWhatsAppEvent(event) {
  const channelApi = createWhatsAppChannelApi();
  const text = String(event.text || '').trim().toLowerCase();

  if (event.type === 'action') {
    await handleIncomingAction(event, channelApi);
  } else if (event.type === 'text' && (text === 'start' || text === '/start')) {
    await handleStart(event, channelApi);
  } else if (event.type === 'text' && text === '/profile') {
    await handleProfile(event, channelApi);
  } else if (event.type === 'text' && text === '/language') {
    await promptForLanguage(event, channelApi);
  } else if (event.type === 'text') {
    await handleIncomingText(event, channelApi);
  }
}

function getWhatsAppEventKey(event) {
  const rawId = event?.messageRef?.messageId;

  if (rawId) {
    return `whatsapp:${rawId}`;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(event))
    .digest('hex')
    .slice(0, 16);

  return `whatsapp:fallback:${digest}`;
}

async function handleWhatsAppWebhook(req, res) {
  try {
    const payload = await readRequestBody(req);
    const events = normalizeWhatsAppEvents(payload);
    for (const event of events) {
      if (eventQueue.isEnabled()) {
        await eventQueue.enqueue({
          eventKey: getWhatsAppEventKey(event),
          channel: 'whatsapp',
          eventType: 'whatsapp_event',
          payload: event
        });
      } else {
        await processWhatsAppEvent(event);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    await reportError('whatsapp.webhook', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

module.exports = {
  handleWhatsAppVerification,
  handleWhatsAppWebhook,
  processWhatsAppEvent
};
