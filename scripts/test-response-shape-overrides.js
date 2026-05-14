#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getResponseShapeDefinitions,
  getResponseShapeIds,
  getResponseShapeInstructions,
  normalizeResponseShapeOverrides,
  writeResponseShapeOverrides
} = require('../src/config/responseShapeOverrides');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-shape-overrides-'));
const overridesPath = path.join(tempDir, 'response-shape-overrides.json');

assert.throws(
  () => normalizeResponseShapeOverrides({ shapes: { 'Bad Shape': {} } }),
  /must use lowercase/
);

assert.throws(
  () => normalizeResponseShapeOverrides({ shapes: { concise_cards: { instructions: 'Use cards.' } } }),
  /instructions must be an array/
);

const written = writeResponseShapeOverrides({
  shapes: {
    concise_cards: {
      description: 'Short card layout.',
      instructions: ['Use three short cards.']
    }
  }
}, { filePath: overridesPath });
assert.equal(written.concise_cards.description, 'Short card layout.');
assert.ok(fs.existsSync(overridesPath));

const definitions = getResponseShapeDefinitions({ filePath: overridesPath });
assert.equal(definitions.concise_cards.instructions[0], 'Use three short cards.');
assert.equal(definitions.synthesis.id, 'synthesis');
assert.equal(definitions.synastry_report.id, 'synastry_report');
assert.ok(definitions.monthly_transit_overview.instructions.length > 0);
assert.ok(getResponseShapeIds({ filePath: overridesPath }).includes('concise_cards'));
assert.ok(getResponseShapeIds({ filePath: overridesPath }).includes('relocation_report'));

process.env.RESPONSE_SHAPE_OVERRIDES_PATH = overridesPath;
assert.deepEqual(getResponseShapeInstructions('concise_cards'), ['Use three short cards.']);
const { normalizeRouteOverrides } = require('../src/config/routeOverrides');
const normalizedRoutes = normalizeRouteOverrides({
  routes: {
    moon_emotions: {
      responseShape: 'concise_cards'
    }
  }
}, new Set(['moon_emotions']));
assert.equal(normalizedRoutes.moon_emotions.responseShape, 'concise_cards');

process.stdout.write('ok response shape override tests\n');
