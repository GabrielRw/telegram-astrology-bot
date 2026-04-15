require('dotenv').config();

const http = require('node:http');
const { createHash } = require('node:crypto');
const { Telegraf } = require('telegraf');
const registerBillingCommand = require('./commands/billing');
const registerStartCommand = require('./commands/start');
const registerNatalCommand = require('./commands/natal');
const registerLanguageCommand = require('./commands/language');
const registerProfileCommand = require('./commands/profile');
const registerChatCommand = require('./commands/chat');
const { getWhatsappPaths } = require('./channels/whatsapp/api');
const { handleWhatsAppVerification, handleWhatsAppWebhook, processWhatsAppEvent } = require('./channels/whatsapp/webhook');
const billing = require('./services/billing');
const eventQueue = require('./services/eventQueue');
const { info, reportError, warn } = require('./services/logger');
const persistence = require('./services/persistence');
const { setTelegramNotifier } = require('./services/telegramAlerts');

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getWebhookBaseUrl() {
  return process.env.WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
}

function getWebhookPath() {
  return process.env.WEBHOOK_PATH || '/telegram/webhook';
}

function getPort() {
  return Number(process.env.PORT || 10000);
}

function renderBillingPage(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7f2ea; color: #1f1f1f; margin: 0; }
      main { max-width: 640px; margin: 10vh auto; padding: 32px 24px; background: #fffdf8; border: 1px solid #e8dcc8; border-radius: 18px; }
      h1 { margin-top: 0; font-size: 32px; }
      p { line-height: 1.55; }
      code { background: #f3eadb; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function hasWhatsAppConfig() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_VERIFY_TOKEN
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry(label, fn, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 1500;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      warn('retrying startup operation', {
        label,
        attempt,
        attempts,
        error: error.message
      });
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

function createAppServer(bot, webhookPath) {
  const { webhookPath: whatsappWebhookPath } = getWhatsappPaths();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (pathname === webhookPath) {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
        return;
      }

      await handleTelegramWebhook(req, res, bot);
      return;
    }

    if (pathname === billing.getStripeWebhookPath()) {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
        return;
      }

      await handleStripeWebhook(req, res);
      return;
    }

    if (pathname === '/billing/success') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderBillingPage(
        'Subscription started',
        '<p>Your checkout completed. Stripe will confirm the subscription by webhook.</p><p>Return to the bot and send <code>/billing</code> to verify your unlimited access.</p>'
      ));
      return;
    }

    if (pathname === '/billing/cancel') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderBillingPage(
        'Checkout canceled',
        '<p>No subscription was created. You can return to the bot and start checkout again whenever you want.</p>'
      ));
      return;
    }

    if (pathname === '/billing/return') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderBillingPage(
        'Billing updated',
        '<p>Your Stripe billing session is complete.</p><p>Return to the bot and send <code>/billing</code> to see your current plan status.</p>'
      ));
      return;
    }

    if (hasWhatsAppConfig()) {
      if (pathname === whatsappWebhookPath && req.method === 'GET') {
        await handleWhatsAppVerification(req, res);
        return;
      }

      if (pathname === whatsappWebhookPath && req.method === 'POST') {
        await handleWhatsAppWebhook(req, res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

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

function readRawRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

function getTelegramEventKey(update) {
  if (update?.update_id !== undefined && update?.update_id !== null) {
    return `telegram:${update.update_id}`;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(update))
    .digest('hex')
    .slice(0, 16);

  return `telegram:fallback:${digest}`;
}

async function handleTelegramWebhook(req, res, bot) {
  try {
    const update = await readRequestBody(req);

    if (eventQueue.isEnabled()) {
      await eventQueue.enqueue({
        eventKey: getTelegramEventKey(update),
        channel: 'telegram',
        eventType: 'telegram_update',
        payload: update
      });
    } else {
      await bot.handleUpdate(update);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    await reportError('telegram.webhook', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

async function handleStripeWebhook(req, res) {
  if (!billing.isStripeWebhookConfigured()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stripe_webhook_not_configured' }));
    return;
  }

  try {
    const rawBody = await readRawRequestBody(req);
    await billing.handleStripeWebhook(rawBody, req.headers['stripe-signature']);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    await reportError('stripe.webhook', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_webhook' }));
  }
}

async function main() {
  const botToken = requireEnv('BOT_TOKEN');
  requireEnv('FREEASTRO_API_KEY');

  const bot = new Telegraf(botToken);
  setTelegramNotifier(bot.telegram);
  persistence.initialize();
  billing.initialize();

  registerBillingCommand(bot);
  registerStartCommand(bot);
  registerNatalCommand(bot);
  registerLanguageCommand(bot);
  registerProfileCommand(bot);
  registerChatCommand(bot);

  bot.catch(async (error, ctx) => {
    await reportError('telegram.bot', error, { updateId: ctx.update?.update_id });
  });

  const webhookBaseUrl = getWebhookBaseUrl();
  const webhookPath = getWebhookPath();
  const startHttpServer = Boolean(webhookBaseUrl || hasWhatsAppConfig());
  let server = null;

  if (startHttpServer) {
    server = createAppServer(bot, webhookPath);
    const port = getPort();

    await new Promise((resolve) => {
      server.listen(port, '0.0.0.0', resolve);
    });

    info('channel server started', { port });
  }

  if (webhookBaseUrl) {
    const webhookUrl = `${webhookBaseUrl}${webhookPath}`;

    const me = await withRetry('Telegram getMe', () => bot.telegram.getMe());
    await withRetry('Telegram setWebhook', () => bot.telegram.setWebhook(webhookUrl));

    info('telegram webhook mode enabled', {
      username: me.username,
      webhookUrl
    });

    process.once('SIGINT', () => {
      server?.close();
      eventQueue.stop();
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      server?.close();
      eventQueue.stop();
      bot.stop('SIGTERM');
    });
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch();
    info('telegram polling mode enabled');

    process.once('SIGINT', () => {
      server?.close();
      eventQueue.stop();
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      server?.close();
      eventQueue.stop();
      bot.stop('SIGTERM');
    });
  }

  if (hasWhatsAppConfig()) {
    info('whatsapp webhook configured', { path: getWhatsappPaths().webhookPath });
  }

  if (eventQueue.isEnabled()) {
    eventQueue.registerHandler('telegram_update', async (update) => {
      await bot.handleUpdate(update);
    });
    eventQueue.registerHandler('whatsapp_event', async (event) => {
      await processWhatsAppEvent(event);
    });
    eventQueue.start();
  } else {
    warn('durable webhook queue disabled', { reason: 'missing Supabase configuration' });
  }
}

main().catch(async (error) => {
  await reportError('bot.main', error);
  process.exit(1);
});
