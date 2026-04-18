const fs = require('node:fs/promises');
const path = require('node:path');
const { warn } = require('./logger');

function getUnmatchedCanonicalLogPath() {
  return process.env.UNMATCHED_CANONICAL_QUESTION_LOG_PATH
    || path.join(process.cwd(), 'var', 'unmatched-canonical-questions.jsonl');
}

async function appendUnmatchedCanonicalQuestion(entry = {}) {
  const targetPath = getUnmatchedCanonicalLogPath();
  const payload = {
    ts: new Date().toISOString(),
    type: 'unmatched_canonical_question',
    stateKey: entry.stateKey || null,
    channel: entry.channel || null,
    userId: entry.userId || null,
    chatId: entry.chatId || null,
    locale: entry.locale || null,
    responseMode: entry.responseMode || null,
    detectedRouteKind: entry.detectedRouteKind || null,
    rewrittenQuestion: entry.rewrittenQuestion || null,
    userText: entry.userText || null
  };

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.appendFile(targetPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    warn('unmatched canonical question log append failed', {
      path: targetPath,
      error: error?.message || String(error)
    });
  }
}

module.exports = {
  appendUnmatchedCanonicalQuestion,
  getUnmatchedCanonicalLogPath
};
