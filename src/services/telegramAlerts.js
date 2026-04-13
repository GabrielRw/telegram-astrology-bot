let telegram = null;
const sentAlertKeys = new Set();

function setTelegramNotifier(nextTelegram) {
  telegram = nextTelegram || null;
}

function getAlertChatId() {
  return String(process.env.TELEGRAM_ALERT_CHAT_ID || '').trim();
}

async function notifyDailyCreditsExhausted({ endpoint, remaining, resetAt, status }) {
  const chatId = getAlertChatId();
  if (!telegram || !chatId) {
    return;
  }

  const resetKey = resetAt || 'unknown-reset';
  const alertKey = `daily-credits-exhausted:${resetKey}`;
  if (sentAlertKeys.has(alertKey)) {
    return;
  }

  sentAlertKeys.add(alertKey);

  const resetLine = resetAt
    ? `Reset: ${new Date(Number(resetAt) * 1000).toISOString()}`
    : 'Reset: unavailable';
  const remainingLine = remaining !== null && remaining !== undefined
    ? `Remaining: ${remaining}`
    : 'Remaining: unavailable';
  const statusLine = status ? `Status: ${status}` : 'Status: unavailable';

  const message = [
    'FreeAstro daily credits are exhausted.',
    statusLine,
    remainingLine,
    resetLine,
    `Endpoint: ${endpoint || 'unknown'}`
  ].join('\n');

  try {
    await telegram.sendMessage(chatId, message);
  } catch (error) {
    console.error('Failed to send Telegram daily credit alert:', error.message);
    sentAlertKeys.delete(alertKey);
  }
}

module.exports = {
  notifyDailyCreditsExhausted,
  setTelegramNotifier
};
