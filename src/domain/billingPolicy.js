const FREE_QUESTIONS_PER_DAY = 3;
const MONTHLY_PRICE_USD = '$4';
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function hasUnlimitedAccess(profile) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(String(profile?.subscription_status || '').toLowerCase());
}

function buildAccessSummary(profile, usedToday, options = {}) {
  const freeLimit = Number.isFinite(options.freeLimit) ? options.freeLimit : FREE_QUESTIONS_PER_DAY;
  const normalizedUsedToday = Number(usedToday || 0);
  const unlimited = hasUnlimitedAccess(profile);
  const remainingFreeQuestions = unlimited
    ? null
    : Math.max(0, freeLimit - normalizedUsedToday);

  return {
    profile,
    usedToday: normalizedUsedToday,
    remainingFreeQuestions,
    unlimited,
    limitReached: !unlimited && normalizedUsedToday >= freeLimit
  };
}

function buildRecordedQuestionSummary(access, usedToday, options = {}) {
  const freeLimit = Number.isFinite(options.freeLimit) ? options.freeLimit : FREE_QUESTIONS_PER_DAY;
  const normalizedUsedToday = Number(usedToday || 0);

  if (access.unlimited) {
    return {
      ...access,
      usedToday: access.usedToday,
      remainingFreeQuestions: null
    };
  }

  return {
    ...access,
    usedToday: normalizedUsedToday,
    remainingFreeQuestions: Math.max(0, freeLimit - normalizedUsedToday),
    limitReached: normalizedUsedToday >= freeLimit
  };
}

module.exports = {
  FREE_QUESTIONS_PER_DAY,
  MONTHLY_PRICE_USD,
  buildAccessSummary,
  buildRecordedQuestionSummary,
  hasUnlimitedAccess
};
