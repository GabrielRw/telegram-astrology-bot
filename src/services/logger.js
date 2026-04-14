const { notifyOperationalError } = require('./telegramAlerts');

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || null
  };
}

function write(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function info(message, meta) {
  write('info', message, meta);
}

function warn(message, meta) {
  write('warn', message, meta);
}

function error(message, meta) {
  write('error', message, meta);
}

async function reportError(scope, err, meta = {}) {
  const errorMeta = {
    scope,
    error: serializeError(err),
    ...meta
  };

  error(`${scope} failed`, errorMeta);

  try {
    await notifyOperationalError({
      scope,
      error: err,
      meta
    });
  } catch (notifyError) {
    error('operational alert failed', {
      scope,
      error: serializeError(notifyError)
    });
  }
}

module.exports = {
  error,
  info,
  reportError,
  serializeError,
  warn
};
