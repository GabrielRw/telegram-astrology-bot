require('dotenv').config();

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

  await bot.launch();
  console.log('FreeAstro Telegram bot is running.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
