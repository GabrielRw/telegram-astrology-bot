require('dotenv').config();

const http = require('node:http');
const { Telegraf } = require('telegraf');
const registerStartCommand = require('./commands/start');
const registerDailyCommand = require('./commands/daily');
const registerNatalCommand = require('./commands/natal');
const registerChatCommand = require('./commands/chat');

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

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.url === webhookPath) {
      webhookHandler(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

async function main() {
  const botToken = requireEnv('BOT_TOKEN');
  requireEnv('FREEASTRO_API_KEY');

  const bot = new Telegraf(botToken);

  registerStartCommand(bot);
  registerDailyCommand(bot);
  registerNatalCommand(bot);
  registerChatCommand(bot);

  bot.catch((error, ctx) => {
    console.error(`Telegram bot error for update ${ctx.update.update_id}:`, error.message);
  });

  const webhookBaseUrl = getWebhookBaseUrl();
  const webhookPath = getWebhookPath();

  if (webhookBaseUrl) {
    const server = createAppServer(bot, webhookPath);
    const port = getPort();
    const webhookUrl = `${webhookBaseUrl}${webhookPath}`;

    await new Promise((resolve) => {
      server.listen(port, '0.0.0.0', resolve);
    });

    const me = await withRetry('Telegram getMe', () => bot.telegram.getMe());
    await withRetry('Telegram setWebhook', () => bot.telegram.setWebhook(webhookUrl));

    console.log(`FreeAstro Telegram bot is running in webhook mode on port ${port}.`);
    console.log(`Telegram bot: @${me.username}`);
    console.log(`Webhook URL: ${webhookUrl}`);

    process.once('SIGINT', () => {
      server.close();
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      server.close();
      bot.stop('SIGTERM');
    });
    return;
  }

  await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  await bot.launch();
  console.log('FreeAstro Telegram bot is running in polling mode.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
