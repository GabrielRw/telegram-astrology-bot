require('dotenv').config();

const http = require('node:http');
const { Telegraf } = require('telegraf');
const registerStartCommand = require('./commands/start');
const registerDailyCommand = require('./commands/daily');
const registerNatalCommand = require('./commands/natal');

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

  bot.catch((error, ctx) => {
    console.error(`Telegram bot error for update ${ctx.update.update_id}:`, error.message);
  });

  const webhookBaseUrl = getWebhookBaseUrl();
  const webhookPath = getWebhookPath();

  if (webhookBaseUrl) {
    const server = createAppServer(bot, webhookPath);
    const port = getPort();
    const webhookUrl = `${webhookBaseUrl}${webhookPath}`;

    await bot.telegram.setWebhook(webhookUrl);

    await new Promise((resolve) => {
      server.listen(port, '0.0.0.0', resolve);
    });

    console.log(`FreeAstro Telegram bot is running in webhook mode on port ${port}.`);
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
  console.error(error.message);
  process.exit(1);
});
