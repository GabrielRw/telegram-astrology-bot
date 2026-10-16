const assert = require('node:assert/strict');

const {
  FREE_QUESTIONS_PER_DAY,
  MONTHLY_PRICE_USD,
  buildAccessSummary,
  buildRecordedQuestionSummary,
  hasUnlimitedAccess
} = require('../src/domain/billingPolicy');

function testConstants() {
  assert.equal(FREE_QUESTIONS_PER_DAY, 3);
  assert.equal(MONTHLY_PRICE_USD, '$4');
}

function testUnlimitedStatuses() {
  assert.equal(hasUnlimitedAccess({ subscription_status: 'active' }), true);
  assert.equal(hasUnlimitedAccess({ subscription_status: 'trialing' }), true);
  assert.equal(hasUnlimitedAccess({ subscription_status: 'ACTIVE' }), true);
  assert.equal(hasUnlimitedAccess({ subscription_status: 'past_due' }), false);
  assert.equal(hasUnlimitedAccess(null), false);
}

function testBuildAccessSummaryForFreeUser() {
  assert.deepEqual(buildAccessSummary({ subscription_status: 'free' }, 2), {
    profile: { subscription_status: 'free' },
    usedToday: 2,
    remainingFreeQuestions: 1,
    unlimited: false,
    limitReached: false
  });

  assert.deepEqual(buildAccessSummary({ subscription_status: 'free' }, 3), {
    profile: { subscription_status: 'free' },
    usedToday: 3,
    remainingFreeQuestions: 0,
    unlimited: false,
    limitReached: true
  });
}

function testBuildAccessSummaryForUnlimitedUser() {
  assert.deepEqual(buildAccessSummary({ subscription_status: 'active' }, 99), {
    profile: { subscription_status: 'active' },
    usedToday: 99,
    remainingFreeQuestions: null,
    unlimited: true,
    limitReached: false
  });
}

function testRecordedQuestionSummary() {
  const access = buildAccessSummary({ subscription_status: 'free' }, 2);
  assert.deepEqual(buildRecordedQuestionSummary(access, 3), {
    ...access,
    usedToday: 3,
    remainingFreeQuestions: 0,
    limitReached: true
  });

  const unlimited = buildAccessSummary({ subscription_status: 'active' }, 0);
  assert.deepEqual(buildRecordedQuestionSummary(unlimited, 10), {
    ...unlimited,
    usedToday: 0,
    remainingFreeQuestions: null
  });
}

testConstants();
testUnlimitedStatuses();
testBuildAccessSummaryForFreeUser();
testBuildAccessSummaryForUnlimitedUser();
testRecordedQuestionSummary();

console.log('ok');
