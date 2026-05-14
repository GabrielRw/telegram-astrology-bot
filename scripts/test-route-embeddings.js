#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildEmbeddingIndexFromVectors,
  cosineSimilarity,
  decideRouteMatch,
  scoreEmbeddingIndex,
  validateEmbeddingIndex,
  validateRouteExamples
} = require('../src/services/routeEmbeddings');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'route-embeddings-'));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function testExampleValidation() {
  const tempDir = makeTempDir();
  const validFile = path.join(tempDir, 'valid.jsonl');
  writeJsonl(validFile, [
    {
      id: 'moon_1',
      text: 'Why am I emotionally guarded?',
      routeId: 'moon_emotions',
      locale: 'en',
      expectedFamily: 'indexed_natal'
    }
  ]);
  assert.equal(validateRouteExamples(validFile).length, 1);

  const invalidFile = path.join(tempDir, 'invalid.jsonl');
  writeJsonl(invalidFile, [
    {
      id: 'bad_1',
      text: 'Unknown route',
      routeId: 'not_a_route',
      locale: 'en',
      expectedFamily: 'indexed_natal'
    }
  ]);
  assert.throws(() => validateRouteExamples(invalidFile), /unknown routeId/i);
}

function testCosineAndTopK() {
  const index = buildEmbeddingIndexFromVectors([
    {
      id: 'moon_1',
      text: 'What does my Moon mean emotionally?',
      routeId: 'moon_emotions',
      locale: 'en',
      expectedFamily: 'indexed_natal',
      routeKind: 'astrology_natal'
    },
    {
      id: 'transit_1',
      text: 'What is happening emotionally right now?',
      routeId: 'current_emotional_transits',
      locale: 'en',
      expectedFamily: 'indexed_monthly_transits',
      routeKind: 'astrology_transits'
    },
    {
      id: 'rising_1',
      text: 'What is my rising sign?',
      routeId: 'rising_sign',
      locale: 'en',
      expectedFamily: 'indexed_natal',
      routeKind: 'astrology_natal'
    }
  ], [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ], {
    model: 'test-embedding',
    dimensions: 3,
    generatedAt: '2026-01-01T00:00:00.000Z'
  });

  validateEmbeddingIndex(index);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);

  const matches = scoreEmbeddingIndex([0.98, 0.02, 0], index, { topK: 2 });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].routeId, 'moon_emotions');
  assert.ok(matches[0].score > matches[1].score);
}

function testConfidenceLogic() {
  const clearDecision = decideRouteMatch([
    { routeId: 'moon_emotions', score: 0.91 },
    { routeId: 'moon_emotions', score: 0.89 },
    { routeId: 'rising_sign', score: 0.82 }
  ], {
    minScore: 0.78,
    minMargin: 0.05
  });
  assert.equal(clearDecision.accepted, true);
  assert.equal(clearDecision.topRouteId, 'moon_emotions');

  const ambiguousDecision = decideRouteMatch([
    { routeId: 'moon_emotions', score: 0.82 },
    { routeId: 'current_emotional_transits', score: 0.81 },
    { routeId: 'rising_sign', score: 0.79 },
    { routeId: 'venus_love', score: 0.78 }
  ], {
    minScore: 0.78,
    minMargin: 0.05
  });
  assert.equal(ambiguousDecision.accepted, false);
  assert.equal(ambiguousDecision.reason, 'ambiguous');

  const weakDecision = decideRouteMatch([
    { routeId: 'moon_emotions', score: 0.7 },
    { routeId: 'rising_sign', score: 0.64 }
  ], {
    minScore: 0.78,
    minMargin: 0.05
  });
  assert.equal(weakDecision.accepted, false);
  assert.equal(weakDecision.reason, 'below_score');
}

testExampleValidation();
testCosineAndTopK();
testConfidenceLogic();

process.stdout.write('ok route embedding matcher tests\n');
