const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCommonQuestionRouteById } = require('../config/commonQuestionRoutes');
const { getWesternCanonicalRouteById } = require('../config/westernCanonicalRoutes');
const { getGeminiClient } = require('./gemini');
const { info } = require('./logger');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_EXAMPLES_PATH = path.join(REPO_ROOT, 'data', 'routing', 'route-examples.jsonl');
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, 'data', 'routing', 'embedding-index.json');
const DEFAULT_MODEL = 'gemini-embedding-2';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_MIN_SCORE = 0.78;
const DEFAULT_MIN_MARGIN = 0.05;
const DEFAULT_TOP_K = 8;

let cachedIndex = null;
let cachedIndexPath = null;
let cachedIndexMtimeMs = null;

function getEmbeddingModelName() {
  return process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_MODEL;
}

function getEmbeddingDimensions() {
  const dimensions = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS);
  return Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : DEFAULT_DIMENSIONS;
}

function getRouteEmbeddingThresholds() {
  const minScore = Number(process.env.ROUTE_EMBEDDING_MIN_SCORE || DEFAULT_MIN_SCORE);
  const minMargin = Number(process.env.ROUTE_EMBEDDING_MIN_MARGIN || DEFAULT_MIN_MARGIN);
  return {
    minScore: Number.isFinite(minScore) ? minScore : DEFAULT_MIN_SCORE,
    minMargin: Number.isFinite(minMargin) ? minMargin : DEFAULT_MIN_MARGIN
  };
}

function isRouteEmbeddingMatchEnabled() {
  const value = String(process.env.ROUTE_EMBEDDING_MATCH_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function getRouteDefinition(routeId) {
  const id = String(routeId || '').trim();
  if (!id) {
    return null;
  }

  const canonicalRoute = getWesternCanonicalRouteById(id);
  if (canonicalRoute) {
    return {
      id,
      kind: 'canonical',
      route: canonicalRoute,
      routeKind: canonicalRoute.routeKind,
      answerStyle: canonicalRoute.answerStyle,
      family: canonicalRoute.family,
      expectedFamily: inferExpectedExecutionFamily(canonicalRoute)
    };
  }

  const commonRoute = getCommonQuestionRouteById(id);
  if (commonRoute) {
    return {
      id,
      kind: 'common',
      route: commonRoute,
      routeKind: commonRoute.routeKind,
      answerStyle: commonRoute.answerStyle,
      family: commonRoute.routeKind,
      expectedFamily: inferCommonRouteExpectedFamily(commonRoute)
    };
  }

  return null;
}

function inferCommonRouteExpectedFamily(route) {
  const sourceKinds = Array.isArray(route?.sourceKinds) ? route.sourceKinds : [];
  if (sourceKinds.some((kind) => String(kind).includes('monthly_transit'))) {
    return 'indexed_monthly_transits';
  }
  return 'indexed_natal';
}

function inferExpectedExecutionFamily(route) {
  if (!route) {
    return null;
  }

  if (route.family === 'synastry') {
    return 'mcp_synastry';
  }
  if (route.family === 'relocation') {
    return 'mcp_relocation';
  }
  if (route.family === 'progressions' || route.family === 'profections' || route.family === 'returns') {
    return 'mcp_progressions';
  }
  if (route.family === 'ephemeris') {
    return 'mcp_ephemeris';
  }
  if (route.family === 'horoscope') {
    return 'mcp_horoscope';
  }
  if (route.family === 'electional') {
    return 'mcp_electional';
  }
  if (route.family === 'transits') {
    return route.cacheStrategy === 'tool_only' ? 'mcp_transits' : 'indexed_monthly_transits';
  }
  return 'indexed_natal';
}

function parseRouteExampleLine(line, lineNumber) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const nextError = new Error(`Invalid JSON on route example line ${lineNumber}: ${error.message}`);
    nextError.code = 'INVALID_ROUTE_EXAMPLE_JSON';
    throw nextError;
  }

  const id = String(parsed.id || '').trim();
  const text = String(parsed.text || '').trim();
  const routeId = String(parsed.routeId || '').trim();
  const locale = String(parsed.locale || 'en').trim() || 'en';
  const expectedFamily = parsed.expectedFamily ? String(parsed.expectedFamily).trim() : null;

  if (!id || !text || !routeId) {
    const error = new Error(`Route example line ${lineNumber} must include id, text, and routeId.`);
    error.code = 'INVALID_ROUTE_EXAMPLE';
    throw error;
  }

  const definition = getRouteDefinition(routeId);
  if (!definition) {
    const error = new Error(`Route example line ${lineNumber} uses unknown routeId "${routeId}".`);
    error.code = 'UNKNOWN_ROUTE_ID';
    throw error;
  }

  if (expectedFamily && expectedFamily !== definition.expectedFamily) {
    const error = new Error(`Route example line ${lineNumber} expectedFamily "${expectedFamily}" does not match "${definition.expectedFamily}" for ${routeId}.`);
    error.code = 'INVALID_EXPECTED_FAMILY';
    throw error;
  }

  return {
    id,
    text,
    routeId,
    locale,
    expectedFamily: expectedFamily || definition.expectedFamily,
    routeKind: definition.routeKind
  };
}

function loadRouteExamples(filePath = DEFAULT_EXAMPLES_PATH) {
  const text = readTextIfExists(filePath);
  if (text === null) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line && !entry.line.startsWith('#'))
    .map((entry) => parseRouteExampleLine(entry.line, entry.lineNumber));
}

function validateRouteExamples(filePath = DEFAULT_EXAMPLES_PATH) {
  const examples = loadRouteExamples(filePath);
  const seenIds = new Set();
  for (const example of examples) {
    if (seenIds.has(example.id)) {
      const error = new Error(`Duplicate route example id "${example.id}".`);
      error.code = 'DUPLICATE_ROUTE_EXAMPLE_ID';
      throw error;
    }
    seenIds.add(example.id);
  }
  return examples;
}

async function embedTexts(texts, options = {}) {
  const values = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || '').trim())
    .filter(Boolean);
  if (values.length === 0) {
    return [];
  }

  const ai = getGeminiClient();
  const model = options.model || getEmbeddingModelName();
  const dimensions = options.dimensions || getEmbeddingDimensions();
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 100), 100));
  const vectors = [];

  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    const response = await embedContentBatchWithRetry(ai, {
      model,
      contents: batch,
      config: {
        taskType: options.taskType || 'SEMANTIC_SIMILARITY',
        outputDimensionality: dimensions
      }
    }, {
      attempts: options.attempts || 3
    });

    const embeddings = Array.isArray(response?.embeddings) ? response.embeddings : [];
    vectors.push(...embeddings.map((entry) => normalizeVector(entry?.values || [])));
  }

  return vectors;
}

function normalizeVector(vector) {
  if (!Array.isArray(vector)) {
    return [];
  }
  return vector.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(error, fallbackMs = 30000) {
  const message = String(error?.message || '');
  const retryInfo = message.match(/"retryDelay":"(\d+)s"/);
  if (retryInfo) {
    return (Number(retryInfo[1]) + 2) * 1000;
  }

  const retryText = message.match(/retry in ([\d.]+)s/i);
  if (retryText) {
    return Math.ceil((Number(retryText[1]) + 2) * 1000);
  }

  return fallbackMs;
}

async function embedContentBatchWithRetry(ai, request, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await ai.models.embedContent(request);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const isQuota = message.includes('RESOURCE_EXHAUSTED') || message.includes('quota') || message.includes('429');
      if (!isQuota || attempt === attempts - 1) {
        throw error;
      }
      await sleep(getRetryDelayMs(error, 30000 * (attempt + 1)));
    }
  }

  throw lastError || new Error('Gemini embedding request failed.');
}

function cosineSimilarity(leftVector, rightVector) {
  const left = normalizeVector(leftVector);
  const right = normalizeVector(rightVector);
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildEmbeddingIndexFromVectors(examples, vectors, options = {}) {
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new Error('Cannot build route embedding index without route examples.');
  }
  if (!Array.isArray(vectors) || vectors.length !== examples.length) {
    throw new Error('Embedding vector count must match route example count.');
  }

  const sourceText = examples.map((example) => JSON.stringify({
    id: example.id,
    text: example.text,
    routeId: example.routeId,
    locale: example.locale,
    expectedFamily: example.expectedFamily
  })).join('\n');

  return {
    version: 1,
    model: options.model || getEmbeddingModelName(),
    dimensions: options.dimensions || getEmbeddingDimensions(),
    sourceHash: options.sourceHash || sha256(sourceText),
    generatedAt: options.generatedAt || new Date().toISOString(),
    examples: examples.map((example, index) => ({
      id: example.id,
      text: example.text,
      routeId: example.routeId,
      locale: example.locale,
      expectedFamily: example.expectedFamily,
      routeKind: example.routeKind,
      embedding: normalizeVector(vectors[index])
    }))
  };
}

async function buildEmbeddingIndex(options = {}) {
  const examplesPath = options.examplesPath || DEFAULT_EXAMPLES_PATH;
  const examples = validateRouteExamples(examplesPath);
  const examplesSource = readTextIfExists(examplesPath) || '';
  const vectors = await embedTexts(examples.map((example) => example.text), {
    model: options.model || getEmbeddingModelName(),
    dimensions: options.dimensions || getEmbeddingDimensions()
  });
  return buildEmbeddingIndexFromVectors(examples, vectors, {
    model: options.model || getEmbeddingModelName(),
    dimensions: options.dimensions || getEmbeddingDimensions(),
    sourceHash: sha256(examplesSource)
  });
}

function validateEmbeddingIndex(index) {
  if (!index || typeof index !== 'object' || !Array.isArray(index.examples)) {
    throw new Error('Route embedding index is invalid or missing examples.');
  }

  for (const example of index.examples) {
    parseRouteExampleLine(JSON.stringify({
      id: example.id,
      text: example.text,
      routeId: example.routeId,
      locale: example.locale,
      expectedFamily: example.expectedFamily
    }), `index:${example.id || 'unknown'}`);

    if (!Array.isArray(example.embedding) || example.embedding.length === 0) {
      throw new Error(`Route embedding index example "${example.id}" has no embedding vector.`);
    }
  }

  return index;
}

function loadEmbeddingIndex(indexPath = DEFAULT_INDEX_PATH) {
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  const stat = fs.statSync(indexPath);
  if (cachedIndex && cachedIndexPath === indexPath && cachedIndexMtimeMs === stat.mtimeMs) {
    return cachedIndex;
  }

  const index = validateEmbeddingIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
  cachedIndex = index;
  cachedIndexPath = indexPath;
  cachedIndexMtimeMs = stat.mtimeMs;
  return index;
}

function scoreEmbeddingIndex(queryEmbedding, index, options = {}) {
  const topK = Number(options.topK || DEFAULT_TOP_K);
  const queryVector = normalizeVector(queryEmbedding);
  if (!index?.examples || queryVector.length === 0) {
    return [];
  }

  return index.examples
    .map((example) => ({
      id: example.id,
      text: example.text,
      routeId: example.routeId,
      expectedFamily: example.expectedFamily,
      routeKind: example.routeKind,
      score: cosineSimilarity(queryVector, example.embedding)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, topK));
}

function decideRouteMatch(matches, options = {}) {
  const thresholds = {
    ...getRouteEmbeddingThresholds(),
    ...options
  };
  const candidates = Array.isArray(matches) ? matches.filter(Boolean) : [];
  if (candidates.length === 0) {
    return {
      accepted: false,
      reason: 'no_matches',
      topMatch: null,
      topRouteId: null,
      candidateRouteIds: []
    };
  }

  const topMatch = candidates[0];
  const secondDifferent = candidates.find((match) => match.routeId !== topMatch.routeId) || null;
  const margin = secondDifferent ? topMatch.score - secondDifferent.score : topMatch.score;
  const topFive = candidates.slice(0, 5);
  const topRouteVotes = topFive.filter((match) => match.routeId === topMatch.routeId).length;
  const hasMajority = topRouteVotes >= Math.ceil(topFive.length / 2);
  const accepted = topMatch.score >= thresholds.minScore && (margin >= thresholds.minMargin || hasMajority);
  const routeIds = [...new Set(candidates.map((match) => match.routeId))];

  return {
    accepted,
    reason: accepted ? 'accepted' : (topMatch.score < thresholds.minScore ? 'below_score' : 'ambiguous'),
    topMatch,
    topRouteId: topMatch.routeId,
    score: topMatch.score,
    margin,
    topRouteVotes,
    candidateRouteIds: routeIds.slice(0, 5),
    matches: candidates
  };
}

async function matchRouteByEmbedding(text, options = {}) {
  const value = String(text || '').trim();
  if (!value || !isRouteEmbeddingMatchEnabled()) {
    return null;
  }

  try {
    const index = options.index || loadEmbeddingIndex(options.indexPath || DEFAULT_INDEX_PATH);
    if (!index) {
      return null;
    }
    const [queryEmbedding] = options.queryEmbedding
      ? [options.queryEmbedding]
      : await embedTexts([value], {
          model: index.model || getEmbeddingModelName(),
          dimensions: index.dimensions || getEmbeddingDimensions()
        });
    const matches = scoreEmbeddingIndex(queryEmbedding, index, { topK: options.topK || DEFAULT_TOP_K });
    const decision = decideRouteMatch(matches, options);
    const definition = getRouteDefinition(decision.topRouteId);

    if (!definition) {
      return null;
    }

    return {
      ...decision,
      definition,
      route: definition.route,
      routeId: definition.id,
      routeKind: definition.routeKind,
      expectedFamily: definition.expectedFamily,
      source: 'gemini_embedding'
    };
  } catch (error) {
    info('route embedding match failed', {
      error: error?.message || String(error)
    });
    return null;
  }
}

module.exports = {
  DEFAULT_EXAMPLES_PATH,
  DEFAULT_INDEX_PATH,
  buildEmbeddingIndex,
  buildEmbeddingIndexFromVectors,
  cosineSimilarity,
  decideRouteMatch,
  embedTexts,
  getEmbeddingDimensions,
  getEmbeddingModelName,
  getRouteDefinition,
  inferExpectedExecutionFamily,
  isRouteEmbeddingMatchEnabled,
  loadEmbeddingIndex,
  loadRouteExamples,
  matchRouteByEmbedding,
  scoreEmbeddingIndex,
  sha256,
  validateEmbeddingIndex,
  validateRouteExamples
};
