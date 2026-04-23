const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

function buildContext({ routeKind, routeId, family, baseQuestion, summary }) {
  return {
    lastResponseRoute: routeKind,
    lastResolvedQuestion: baseQuestion,
    lastQueryState: {
      canonicalRouteId: routeId,
      routeKind,
      baseQuestion,
      parameters: {}
    },
    lastAnswerArtifact: __test.buildConversationAnswerArtifact(
      { kind: routeKind, commonRouteId: routeId },
      { family },
      { canonicalRouteId: routeId },
      summary,
      [{ name: 'demo_tool' }]
    )
  };
}

function testElectionalArtifactFollowUp() {
  const context = buildContext({
    routeKind: 'astrology_natal',
    routeId: 'invest_money_election_search',
    family: 'mcp_electional',
    baseQuestion: 'What is the best time to invest this year?',
    summary: 'The best date this year is June 16, 2026 at 12:00 (local time).'
  });

  const followUp = __test.detectArtifactFollowUpLocally('what are these factors?', context, []);
  assert.equal(followUp?.followUpType, 'artifact_follow_up');
  assert.equal(followUp?.canonicalRouteId, 'invest_money_election_search');
  assert.match(followUp?.rewrittenQuestion || '', /What is the best time to invest this year\?/);
  assert.match(followUp?.rewrittenQuestion || '', /what are these factors\?/i);
}

function testTransitArtifactFollowUp() {
  const context = buildContext({
    routeKind: 'astrology_transits',
    routeId: 'transit_search_exact',
    family: 'mcp_transits',
    baseQuestion: 'When does Jupiter trine my Venus this year?',
    summary: 'Jupiter trines your Venus on April 18, 2026 at 12:30.'
  });

  const followUp = __test.detectArtifactFollowUpLocally('verify', context, []);
  assert.equal(followUp?.followUpType, 'artifact_follow_up');
  assert.equal(followUp?.canonicalRouteId, 'transit_search_exact');
  assert.match(followUp?.rewrittenQuestion || '', /When does Jupiter trine my Venus this year\?/);
  assert.match(followUp?.rewrittenQuestion || '', /verify/i);
}

function testRelocationArtifactFollowUp() {
  const context = buildContext({
    routeKind: 'astrology_relocation',
    routeId: 'relocation_recommendations',
    family: 'mcp_relocation',
    baseQuestion: 'Best cities for health for me this year',
    summary: 'Lisbon and Valencia are the strongest cities for health.'
  });

  const followUp = __test.detectArtifactFollowUpLocally('and in Europe only?', context, []);
  assert.equal(followUp?.followUpType, 'artifact_follow_up');
  assert.equal(followUp?.canonicalRouteId, 'relocation_recommendations');
  assert.match(followUp?.rewrittenQuestion || '', /Best cities for health for me this year/);
  assert.match(followUp?.rewrittenQuestion || '', /and in Europe only\?/i);
}

function testStandaloneQuestionDoesNotInherit() {
  const context = buildContext({
    routeKind: 'astrology_natal',
    routeId: 'invest_money_election_search',
    family: 'mcp_electional',
    baseQuestion: 'What is the best time to invest this year?',
    summary: 'The best date this year is June 16, 2026 at 12:00 (local time).'
  });

  const followUp = __test.detectArtifactFollowUpLocally('What is my Venus sign?', context, []);
  assert.equal(followUp, null);
}

testElectionalArtifactFollowUp();
testTransitArtifactFollowUp();
testRelocationArtifactFollowUp();
testStandaloneQuestionDoesNotInherit();

console.log('ok');
