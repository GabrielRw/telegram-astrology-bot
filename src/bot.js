require('dotenv').config();

const http = require('node:http');
const { Telegraf } = require('telegraf');
const registerStartCommand = require('./commands/start');
const registerDailyCommand = require('./commands/daily');
const registerNatalCommand = require('./commands/natal');
const registerProfileCommand = require('./commands/profile');
const registerChatCommand = require('./commands/chat');
const { getWhatsappPaths } = require('./channels/whatsapp/api');
const { handleWhatsAppVerification, handleWhatsAppWebhook } = require('./channels/whatsapp/webhook');
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

      console.error(`${label} failed on attempt ${attempt}/${attempts}: ${error.message}`);
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

function createAppServer(bot, webhookPath) {
  const webhookHandler = bot.webhookCallback(webhookPath);
  const { webhookPath: whatsappWebhookPath } = getWhatsappPaths();

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.url === webhookPath) {
      webhookHandler(req, res);
      return;
    }

    if (hasWhatsAppConfig()) {
      const pathname = new URL(req.url, 'http://localhost').pathname;

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

async function main() {
  const botToken = requireEnv('BOT_TOKEN');
  requireEnv('FREEASTRO_API_KEY');

  const bot = new Telegraf(botToken);
  setTelegramNotifier(bot.telegram);

  registerStartCommand(bot);
  registerDailyCommand(bot);
  registerNatalCommand(bot);
  registerProfileCommand(bot);
  registerChatCommand(bot);

  bot.catch((error, ctx) => {
    console.error(`Telegram bot error for update ${ctx.update.update_id}:`, error.message);
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

    console.log(`Channel server is running on port ${port}.`);
  }

  if (webhookBaseUrl) {
    const webhookUrl = `${webhookBaseUrl}${webhookPath}`;

    const me = await withRetry('Telegram getMe', () => bot.telegram.getMe());
    await withRetry('Telegram setWebhook', () => bot.telegram.setWebhook(webhookUrl));

    console.log('FreeAstro Telegram bot is running in webhook mode.');
    console.log(`Telegram bot: @${me.username}`);
    console.log(`Webhook URL: ${webhookUrl}`);

    process.once('SIGINT', () => {
      server?.close();
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      server?.close();
      bot.stop('SIGTERM');
    });
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch();
    console.log('FreeAstro Telegram bot is running in polling mode.');

    process.once('SIGINT', () => {
      server?.close();
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      server?.close();
      bot.stop('SIGTERM');
    });
  }

  if (hasWhatsAppConfig()) {
    console.log(`WhatsApp webhook path: ${getWhatsappPaths().webhookPath}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
