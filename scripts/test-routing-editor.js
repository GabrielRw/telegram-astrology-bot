#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-editor-'));
const examplesPath = path.join(tempDir, 'route-examples.jsonl');
const overridesPath = path.join(tempDir, 'route-overrides.json');
const answerStyleOverridesPath = path.join(tempDir, 'answer-style-overrides.json');
const responseShapeOverridesPath = path.join(tempDir, 'response-shape-overrides.json');
const port = 4545 + Math.floor(Math.random() * 1000);

fs.writeFileSync(examplesPath, [
  JSON.stringify({
    id: 'moon_test_001',
    text: 'What does my Moon mean emotionally?',
    routeId: 'moon_emotions',
    locale: 'en',
    expectedFamily: 'indexed_natal'
  })
].join('\n') + '\n');
fs.writeFileSync(overridesPath, JSON.stringify({ version: 1, routes: {} }, null, 2));
fs.writeFileSync(answerStyleOverridesPath, JSON.stringify({ version: 1, styles: {} }, null, 2));
fs.writeFileSync(responseShapeOverridesPath, JSON.stringify({ version: 1, shapes: {} }, null, 2));

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Routing editor did not start in time.')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Routing editor:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    child.on('exit', (code) => {
      reject(new Error(`Routing editor exited early with code ${code}.`));
    });
  });
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || response.statusText);
    error.body = body;
    throw error;
  }
  return body;
}

async function main() {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/route-examples-editor.js'), String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROUTE_EXAMPLES_PATH: examplesPath,
      ROUTE_OVERRIDES_PATH: overridesPath,
      ANSWER_STYLE_OVERRIDES_PATH: answerStyleOverridesPath,
      RESPONSE_SHAPE_OVERRIDES_PATH: responseShapeOverridesPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);

    const metadata = await requestJson('/api/metadata');
    assert.ok(metadata.routes.some((route) => route.id === 'moon_emotions'));
    const synastryRoute = metadata.routes.find((route) => route.id === 'synastry_summary');
    assert.equal(synastryRoute.responseShape, 'synastry_report');
    assert.equal(synastryRoute.responseRenderer.id, 'synastry_report');
    assert.ok(metadata.responseShapes.includes('synastry_report'));
    assert.ok(metadata.responseRendererDefinitions.synastry_summary);

    const simulatorState = await requestJson('/api/simulator/state');
    assert.equal(simulatorState.state.chatId, 'browser-sim-local');

    const simulatorStart = await requestJson('/api/simulator/message', {
      method: 'POST',
      body: JSON.stringify({ text: '/start' })
    });
    assert.ok(Array.isArray(simulatorStart.messages));
    assert.ok(simulatorStart.messages.some((message) => message.side === 'bot'));
    assert.ok(simulatorStart.log.durationMs >= 0);

    const simulatorBilling = await requestJson('/api/simulator/message', {
      method: 'POST',
      body: JSON.stringify({ text: '/billing' })
    });
    assert.ok(simulatorBilling.messages.some((message) => /Unlimited plan: active/i.test(message.text || '')));

    const simulatorText = await requestJson('/api/simulator/message', {
      method: 'POST',
      body: JSON.stringify({ text: 'What does my Moon mean emotionally?' })
    });
    assert.ok(simulatorText.messages.some((message) => message.side === 'user'));
    assert.equal(simulatorText.log.input, 'What does my Moon mean emotionally?');

    const simulatorReset = await requestJson('/api/simulator/reset', {
      method: 'POST',
      body: JSON.stringify({ chatId: 'browser-sim-local' })
    });
    assert.equal(simulatorReset.state.chatId, 'browser-sim-local');
    assert.equal(simulatorReset.state.activeFlow, null);

    const examples = await requestJson('/api/examples');
    assert.equal(examples.examples.length, 1);

    const savedExamples = await requestJson('/api/examples', {
      method: 'POST',
      body: JSON.stringify({
        examples: [{
          ...examples.examples[0],
          toolTargets: ['should_not_persist'],
          requiredUserData: ['should_not_persist']
        }]
      })
    });
    assert.equal(savedExamples.examples[0].toolTargets, undefined);
    assert.equal(savedExamples.examples[0].requiredUserData, undefined);

    await assert.rejects(
      () => requestJson('/api/route-overrides', {
        method: 'POST',
        body: JSON.stringify({ routes: { missing_route: {} } })
      }),
      /unknown routeId/
    );

    await assert.rejects(
      () => requestJson('/api/route-overrides', {
        method: 'POST',
        body: JSON.stringify({ routes: { transit_search_exact: { mcpLoadingMode: 'never' } } })
      }),
      /cannot use MCP loading "never"/
    );

    const savedOverrides = await requestJson('/api/route-overrides', {
      method: 'POST',
      body: JSON.stringify({
        routes: {
          moon_emotions: {
            toolTargets: ['search_cached_profile_facts'],
            requiredArgs: ['profile'],
            sourceKinds: ['natal'],
            factSourceTools: ['rest_western_natal_insights'],
            categories: ['emotions'],
            tags: ['planet:moon'],
            answerStyle: 'planet_focus',
            displayName: 'Moon emotions route',
            cacheStrategy: 'indexed_natal_then_tool',
            responseShape: 'factual_cards',
            cardLimit: 3,
            factLimit: 11,
            mcpLoadingMode: 'after_fast_path',
            deliveryMode: 'progressive_generate_sections',
            mediaAttachments: ['natal_chart_png'],
            productionStatus: 'ready',
            productionNotes: 'Manual approval after simulator smoke.',
            responseInstructions: 'Return three short cards.',
            followUpPolicy: 'standalone',
            blockedPhrases: ['currently', 'right now'],
            matchHint: 'Test override.'
          }
        }
      })
    });
    assert.equal(savedOverrides.routes.moon_emotions.toolTarget, 'search_cached_profile_facts');
    assert.equal(savedOverrides.routes.moon_emotions.displayName, 'Moon emotions route');
    assert.deepEqual(savedOverrides.routes.moon_emotions.sourceKinds, ['natal']);
    assert.deepEqual(savedOverrides.routes.moon_emotions.factSourceTools, ['rest_western_natal_insights']);
    assert.deepEqual(savedOverrides.routes.moon_emotions.categories, ['emotions']);
    assert.deepEqual(savedOverrides.routes.moon_emotions.tags, ['planet:moon']);
    assert.equal(savedOverrides.routes.moon_emotions.cardLimit, 3);
    assert.equal(savedOverrides.routes.moon_emotions.factLimit, 11);
    assert.equal(savedOverrides.routes.moon_emotions.mcpLoadingMode, 'after_fast_path');
    assert.equal(savedOverrides.routes.moon_emotions.deliveryMode, 'progressive_generate_sections');
    assert.deepEqual(savedOverrides.routes.moon_emotions.mediaAttachments, ['natal_chart_png']);
    assert.equal(savedOverrides.routes.moon_emotions.productionStatus, 'ready');
    assert.equal(savedOverrides.routes.moon_emotions.productionNotes, 'Manual approval after simulator smoke.');
    assert.equal(savedOverrides.routes.moon_emotions.responseInstructions, 'Return three short cards.');
    assert.equal(savedOverrides.routes.moon_emotions.followUpPolicy, 'standalone');
    assert.deepEqual(savedOverrides.routes.moon_emotions.blockedPhrases, ['currently', 'right now']);
    assert.equal(JSON.parse(fs.readFileSync(overridesPath, 'utf8')).routes.moon_emotions.matchHint, 'Test override.');

    const routesAfterOverride = await requestJson('/api/routes');
    const moonRouteAfterOverride = routesAfterOverride.routes.find((route) => route.id === 'moon_emotions');
    assert.equal(moonRouteAfterOverride.displayName, 'Moon emotions route');
    assert.equal(moonRouteAfterOverride.label, 'Moon emotions route');
    assert.equal(moonRouteAfterOverride.cardLimit, 3);
    assert.equal(moonRouteAfterOverride.factLimit, 11);
    assert.deepEqual(moonRouteAfterOverride.factSourceTools, ['rest_western_natal_insights']);
    assert.equal(moonRouteAfterOverride.mcpLoadingMode, 'after_fast_path');
    assert.equal(moonRouteAfterOverride.deliveryMode, 'progressive_generate_sections');
    assert.deepEqual(moonRouteAfterOverride.mediaAttachments, ['natal_chart_png']);
    assert.equal(moonRouteAfterOverride.productionStatus, 'ready');
    assert.equal(moonRouteAfterOverride.productionNotes, 'Manual approval after simulator smoke.');
    assert.equal(moonRouteAfterOverride.responseInstructions, 'Return three short cards.');

    const styleOverrides = await requestJson('/api/answer-style-overrides');
    assert.deepEqual(styleOverrides.styles, {});

    await assert.rejects(
      () => requestJson('/api/answer-style-overrides', {
        method: 'POST',
        body: JSON.stringify({ styles: { 'Bad Style': {} } })
      }),
      /must use lowercase/
    );

    const savedStyleOverrides = await requestJson('/api/answer-style-overrides', {
      method: 'POST',
      body: JSON.stringify({
        styles: {
          concise_emotional: {
            description: 'Short emotional answer.',
            instructions: ['Keep it warm and direct.']
          },
          planet_focus: {
            description: 'Test style description.',
            instructions: ['Start with exact placement.']
          }
        }
      })
    });
    assert.equal(savedStyleOverrides.styles.concise_emotional.description, 'Short emotional answer.');
    assert.equal(savedStyleOverrides.styles.planet_focus.description, 'Test style description.');
    assert.equal(
      JSON.parse(fs.readFileSync(answerStyleOverridesPath, 'utf8')).styles.planet_focus.instructions[0],
      'Start with exact placement.'
    );

    const shapeOverrides = await requestJson('/api/response-shape-overrides');
    assert.deepEqual(shapeOverrides.shapes, {});

    await assert.rejects(
      () => requestJson('/api/response-shape-overrides', {
        method: 'POST',
        body: JSON.stringify({ shapes: { 'Bad Shape': {} } })
      }),
      /must use lowercase/
    );

    const savedShapeOverrides = await requestJson('/api/response-shape-overrides', {
      method: 'POST',
      body: JSON.stringify({
        shapes: {
          concise_cards: {
            description: 'Short card layout.',
            instructions: ['Use three short cards.']
          }
        }
      })
    });
    assert.equal(savedShapeOverrides.shapes.concise_cards.description, 'Short card layout.');
    assert.equal(
      JSON.parse(fs.readFileSync(responseShapeOverridesPath, 'utf8')).shapes.concise_cards.instructions[0],
      'Use three short cards.'
    );

    const customShapeRoute = await requestJson('/api/route-overrides', {
      method: 'POST',
      body: JSON.stringify({
        routes: {
          moon_emotions: {
            responseShape: 'concise_cards'
          }
        }
      })
    });
    assert.equal(customShapeRoute.routes.moon_emotions.responseShape, 'concise_cards');
  } finally {
    child.kill();
  }

  process.stdout.write('ok routing editor smoke tests\n');
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
