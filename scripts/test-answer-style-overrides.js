#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getAnswerStyleDefinitions,
  getAnswerStyleInstructions,
  normalizeAnswerStyleOverrides,
  writeAnswerStyleOverrides
} = require('../src/config/answerStyleOverrides');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-style-overrides-'));
const overridesPath = path.join(tempDir, 'answer-style-overrides.json');

assert.throws(
  () => normalizeAnswerStyleOverrides({ styles: { 'Bad Style': {} } }),
  /must use lowercase/
);

assert.throws(
  () => normalizeAnswerStyleOverrides({ styles: { planet_focus: { instructions: 'Start exact.' } } }),
  /instructions must be an array/
);

const normalized = normalizeAnswerStyleOverrides({
  styles: {
    concise_emotional: {
      description: 'Short emotional answer.',
      instructions: ['Keep it warm and direct.']
    },
    planet_focus: {
      description: 'Placement answer.',
      instructions: ['Start with exact placement.', 'Then explain meaning.']
    }
  }
});
assert.deepEqual(normalized.concise_emotional.instructions, ['Keep it warm and direct.']);
assert.deepEqual(normalized.planet_focus.instructions, ['Start with exact placement.', 'Then explain meaning.']);

const written = writeAnswerStyleOverrides({
  styles: {
    concise_emotional: {
      description: 'Short emotional answer.',
      instructions: ['Keep it warm and direct.']
    },
    personal_transits: {
      description: 'Transit answer.',
      instructions: ['Start with timing.']
    }
  }
}, { filePath: overridesPath });
assert.equal(written.personal_transits.description, 'Transit answer.');
assert.ok(fs.existsSync(overridesPath));

const definitions = getAnswerStyleDefinitions({ filePath: overridesPath });
assert.equal(definitions.concise_emotional.description, 'Short emotional answer.');
assert.equal(definitions.personal_transits.description, 'Transit answer.');
assert.deepEqual(definitions.personal_transits.instructions, ['Start with timing.']);
assert.ok(Array.isArray(definitions.planet_focus.instructions));

process.env.ANSWER_STYLE_OVERRIDES_PATH = overridesPath;
assert.deepEqual(getAnswerStyleInstructions('personal_transits'), ['Start with timing.']);

process.stdout.write('ok answer style override tests\n');
