#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  applyRouteOverrides,
  normalizeRouteOverrides,
  writeRouteOverrides
} = require('../src/config/routeOverrides');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-overrides-'));
const overridesPath = path.join(tempDir, 'route-overrides.json');

const knownRouteIds = new Set(['synastry_summary', 'moon_emotions']);

assert.deepEqual(
  normalizeRouteOverrides({
    routes: {
      synastry_summary: {
        toolTargets: ['v1_western_synastry_summary', 'v1_western_synastry'],
        requiredArgs: ['profile', 'secondaryProfile'],
        optionalArgs: [],
        sourceKinds: ['natal'],
        categories: ['relationships'],
        tags: ['love'],
        answerStyle: 'synastry',
        displayName: 'Synastry overview',
        cacheStrategy: 'tool_only',
        responseShape: 'factual_cards',
        cardLimit: 3,
        factLimit: 10,
        responseInstructions: 'Return three named cards.',
        productionStatus: 'ready',
        productionNotes: 'Validated in simulator.',
        followUpPolicy: 'standalone',
        blockedPhrases: ['currently', 'right now'],
        matchHint: 'Use summary first.'
      }
    }
  }, knownRouteIds).synastry_summary.toolTarget,
  'v1_western_synastry_summary'
);

const normalizedSynastry = normalizeRouteOverrides({
  routes: {
    synastry_summary: {
      responseShape: 'factual_cards',
      cardLimit: 3,
      factLimit: 10,
      responseInstructions: 'Return three named cards.'
    }
  }
}, knownRouteIds).synastry_summary;
assert.equal(normalizedSynastry.cardLimit, 3);
assert.equal(normalizedSynastry.factLimit, 10);
assert.equal(normalizedSynastry.responseInstructions, 'Return three named cards.');
assert.equal(
  normalizeRouteOverrides({ routes: { synastry_summary: { displayName: 'Relationship overview' } } }, knownRouteIds).synastry_summary.displayName,
  'Relationship overview'
);
assert.equal(
  normalizeRouteOverrides({ routes: { synastry_summary: { followUpPolicy: 'standalone' } } }, knownRouteIds).synastry_summary.followUpPolicy,
  'standalone'
);
assert.deepEqual(
  normalizeRouteOverrides({ routes: { synastry_summary: { blockedPhrases: ['currently', 'right now'] } } }, knownRouteIds).synastry_summary.blockedPhrases,
  ['currently', 'right now']
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { unknown_route: {} } }, knownRouteIds),
  /unknown routeId/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { requiredArgs: 'profile' } } }, knownRouteIds),
  /must be an array/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { answerStyle: 'not_real' } } }, knownRouteIds),
  /invalid answerStyle/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { sourceKinds: ['bad_source'] } } }, knownRouteIds),
  /invalid sourceKind/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { cardLimit: 20 } } }, knownRouteIds),
  /cardLimit/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { factLimit: 100 } } }, knownRouteIds),
  /factLimit/
);

assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { followUpPolicy: 'bad' } } }, knownRouteIds),
  /invalid followUpPolicy/
);
assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { mcpLoadingMode: 'bad' } } }, knownRouteIds),
  /invalid mcpLoadingMode/
);
assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { deliveryMode: 'bad' } } }, knownRouteIds),
  /invalid deliveryMode/
);
assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { productionStatus: 'automatic_ready' } } }, knownRouteIds),
  /invalid productionStatus/
);
assert.throws(
  () => normalizeRouteOverrides({ routes: { moon_emotions: { toolTargets: ['v1_western_transits_timeline'], mcpLoadingMode: 'never' } } }, knownRouteIds),
  /cannot set mcpLoadingMode "never" while using MCP tool/
);
assert.equal(
  normalizeRouteOverrides({ routes: { moon_emotions: { toolTargets: ['rest_horoscope_daily_personal_text'], mcpLoadingMode: 'never' } } }, knownRouteIds).moon_emotions.toolTarget,
  'rest_horoscope_daily_personal_text'
);
assert.equal(
  normalizeRouteOverrides({ routes: { moon_emotions: { toolTargets: ['rest_ephemeris'], mcpLoadingMode: 'never' } } }, knownRouteIds).moon_emotions.toolTarget,
  'rest_ephemeris'
);

assert.equal(
  normalizeRouteOverrides({ routes: { moon_emotions: { cacheStrategy: 'cached_plus_tool' } } }, knownRouteIds).moon_emotions.cacheStrategy,
  'cached_plus_tool'
);

const written = writeRouteOverrides({
  routes: {
    moon_emotions: {
      toolTargets: ['search_cached_profile_facts'],
      requiredArgs: ['profile'],
      sourceKinds: ['natal'],
      factSourceTools: ['rest_western_natal_insights'],
      categories: ['emotions'],
      tags: ['planet:moon'],
      cacheStrategy: 'indexed_natal_then_tool',
      responseShape: 'factual_cards',
      cardLimit: 4,
      factLimit: 12,
      mcpLoadingMode: 'after_fast_path',
      deliveryMode: 'progressive_generate_sections',
      mediaAttachments: ['natal_chart_png'],
      productionStatus: 'check',
      productionNotes: 'Needs one more simulator run.',
      responseInstructions: 'Use one card per grounded fact.',
      followUpPolicy: 'standalone',
      blockedPhrases: ['current atmosphere']
    }
  }
}, {
  filePath: overridesPath,
  knownRouteIds
});
assert.equal(written.moon_emotions.toolTarget, 'search_cached_profile_facts');
assert.ok(fs.existsSync(overridesPath));

const merged = applyRouteOverrides([
  {
    id: 'moon_emotions',
    answerStyle: 'planet_focus',
    requiredArgs: [],
    toolTarget: null
  }
], {
  overrides: written
});
assert.equal(merged[0].toolTarget, 'search_cached_profile_facts');
assert.deepEqual(merged[0].requiredArgs, ['profile']);
assert.deepEqual(merged[0].sourceKinds, ['natal']);
assert.deepEqual(merged[0].factSourceTools, ['rest_western_natal_insights']);
assert.deepEqual(merged[0].categories, ['emotions']);
assert.deepEqual(merged[0].tags, ['planet:moon']);
assert.equal(merged[0].cardLimit, 4);
assert.equal(merged[0].factLimit, 12);
assert.equal(merged[0].mcpLoadingMode, 'after_fast_path');
assert.equal(merged[0].deliveryMode, 'progressive_generate_sections');
assert.deepEqual(merged[0].mediaAttachments, ['natal_chart_png']);
assert.equal(merged[0].productionStatus, 'check');
assert.equal(merged[0].productionNotes, 'Needs one more simulator run.');
assert.equal(merged[0].responseInstructions, 'Use one card per grounded fact.');
assert.equal(merged[0].followUpPolicy, 'standalone');
assert.deepEqual(merged[0].blockedPhrases, ['current atmosphere']);

process.stdout.write('ok route override tests\n');
