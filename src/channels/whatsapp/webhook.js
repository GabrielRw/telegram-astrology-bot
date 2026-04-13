const {
  createWhatsAppChannelApi,
  getRequiredEnv,
  normalizeWhatsAppEvents
} = require('./api');
const {
  handleStart,
  handleIncomingAction,
  handleIncomingText
} = require('../../core/controller');

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

async function handleWhatsAppWebhook(req, res) {
  try {
    const payload = await readRequestBody(req);
    const events = normalizeWhatsAppEvents(payload);
    const channelApi = createWhatsAppChannelApi();

    for (const event of events) {
      if (event.type === 'action') {
        await handleIncomingAction(event, channelApi);
      } else if (event.type === 'text' && String(event.text || '').trim().toLowerCase() === 'start') {
        await handleStart(event, channelApi);
      } else if (event.type === 'text') {
        await handleIncomingText(event, channelApi);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    console.error('WhatsApp webhook error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

module.exports = {
  handleWhatsAppVerification,
  handleWhatsAppWebhook
};
