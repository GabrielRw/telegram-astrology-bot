let telegram = null;
const sentAlertKeys = new Set();
const operationalAlertCache = new Map();

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

async function notifyOperationalError({ scope, error, meta }) {
  const chatId = getAlertChatId();
  if (!telegram || !chatId) {
    return;
  }

  const fingerprint = [
    scope || 'unknown-scope',
    error?.name || 'Error',
    error?.message || String(error || 'unknown-error')
  ].join(':');
  const now = Date.now();
  const lastSentAt = operationalAlertCache.get(fingerprint) || 0;

  if (now - lastSentAt < 5 * 60 * 1000) {
    return;
  }

  operationalAlertCache.set(fingerprint, now);

  const metaLines = meta && typeof meta === 'object'
    ? Object.entries(meta)
        .slice(0, 5)
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    : [];

  const message = [
    'Bot operational error.',
    `Scope: ${scope || 'unknown'}`,
    `Error: ${error?.message || String(error || 'unknown error')}`,
    ...metaLines
  ].join('\n');

  try {
    await telegram.sendMessage(chatId, message);
  } catch (sendError) {
    console.error('Failed to send Telegram operational alert:', sendError.message);
  }
}

module.exports = {
  notifyDailyCreditsExhausted,
  notifyOperationalError,
  setTelegramNotifier
};
