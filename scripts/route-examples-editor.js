#!/usr/bin/env node
require('dotenv').config();

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { URL } = require('node:url');
const persistence = require('../src/services/persistence');
const natalFlow = require('../src/services/natalFlow');
const {
  handleBilling,
  handleCancel,
  handleIncomingAction,
  handleIncomingText,
  handleProfile,
  handleStart
} = require('../src/core/controller');
const {
  getChatState,
  getChatStateSnapshot,
  getChoiceMap,
  replaceChatState,
  resolveStateKey
} = require('../src/state/chatState');
const {
  COMMON_QUESTION_ROUTES,
  getCommonQuestionRouteById,
  reloadCommonQuestionRouteOverrides
} = require('../src/config/commonQuestionRoutes');
const {
  WESTERN_CANONICAL_ROUTES,
  reloadWesternCanonicalRouteOverrides
} = require('../src/config/westernCanonicalRoutes');
const {
  DEFAULT_ANSWER_STYLE_DEFINITIONS,
  getAnswerStyleDefinitions,
  getAnswerStyleIds,
  getAnswerStyleOverridesPath,
  readAnswerStyleOverrides,
  writeAnswerStyleOverrides
} = require('../src/config/answerStyleOverrides');
const {
  getResponseShapeDefinitions,
  getResponseShapeOverridesPath,
  readResponseShapeOverrides,
  writeResponseShapeOverrides
} = require('../src/config/responseShapeOverrides');
const {
  getResponseRendererDefinitions,
  getRouteResponseRenderer
} = require('../src/config/responseRenderers');
const {
  CACHE_STRATEGIES,
  DELIVERY_MODES,
  FOLLOW_UP_POLICIES,
  MEDIA_ATTACHMENTS,
  MCP_LOADING_MODES,
  PRODUCTION_STATUSES,
  getRouteOverridesPath,
  isMcpToolTarget,
  readRouteOverrides,
  writeRouteOverrides
} = require('../src/config/routeOverrides');
const {
  DEFAULT_EXAMPLES_PATH,
  getRouteDefinition,
  validateRouteExamples
} = require('../src/services/routeEmbeddings');

const REPO_ROOT = path.resolve(__dirname, '..');
const EXAMPLES_PATH = path.resolve(process.env.ROUTE_EXAMPLES_PATH || DEFAULT_EXAMPLES_PATH);
const OVERRIDES_PATH = getRouteOverridesPath();
const ANSWER_STYLE_OVERRIDES_PATH = getAnswerStyleOverridesPath();
const RESPONSE_SHAPE_OVERRIDES_PATH = getResponseShapeOverridesPath();
const PORT = Number(process.env.ROUTING_EDITOR_PORT || process.argv[2] || 4321);
const DEFAULT_SIMULATOR_CHAT_ID = 'browser-sim-local';

persistence.initialize();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store'
  });
  response.end(body);
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON request: ${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

function readRawExamples() {
  if (!fs.existsSync(EXAMPLES_PATH)) {
    return [];
  }

  return fs.readFileSync(EXAMPLES_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line && !entry.line.startsWith('#'))
    .map((entry) => {
      const parsed = JSON.parse(entry.line);
      return {
        ...parsed,
        lineNumber: entry.lineNumber
      };
    });
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function defaultFactLimitForRoute(route = {}) {
  const cardLimit = Math.max(1, Math.min(Number(route.cardLimit || 5), 12));
  return Math.max(cardLimit, Math.min(Math.max(cardLimit * 3, 12), 30));
}

function normalizeExample(example, index) {
  const routeId = String(example.routeId || '').trim();
  const definition = getRouteDefinition(routeId);
  if (!definition) {
    throw new Error(`Row ${index + 1} has unknown routeId "${routeId}".`);
  }

  const id = String(example.id || '').trim();
  const text = String(example.text || '').trim();
  if (!id || !text) {
    throw new Error(`Row ${index + 1} must include id and text.`);
  }

  const normalized = {
    ...example,
    id,
    text,
    routeId,
    locale: String(example.locale || 'en').trim() || 'en',
    expectedFamily: definition.expectedFamily
  };

  delete normalized.lineNumber;

  delete normalized.toolTargets;
  delete normalized.requiredUserData;

  const notes = String(example.notes || '').trim();
  if (notes) {
    normalized.notes = notes;
  } else {
    delete normalized.notes;
  }

  return normalized;
}

function writeExamples(examples) {
  const normalized = examples.map((example, index) => normalizeExample(example, index));
  const seenIds = new Set();
  for (const example of normalized) {
    if (seenIds.has(example.id)) {
      throw new Error(`Duplicate id "${example.id}".`);
    }
    seenIds.add(example.id);
  }

  fs.mkdirSync(path.dirname(EXAMPLES_PATH), { recursive: true });
  const output = normalized.map((example) => JSON.stringify(example)).join('\n');
  fs.writeFileSync(EXAMPLES_PATH, `${output}\n`);
  validateRouteExamples(EXAMPLES_PATH);
  return normalized;
}

function inferCommonExpectedFamily(route) {
  return (Array.isArray(route.sourceKinds) && route.sourceKinds.some((kind) => String(kind).includes('monthly_transit')))
    ? 'indexed_monthly_transits'
    : 'indexed_natal';
}

function routeToOption(route, kind) {
  const definition = getRouteDefinition(route.id);
  const responseRenderer = getRouteResponseRenderer(route.id);
  const expectedFamily = definition?.expectedFamily || (kind === 'common' ? inferCommonExpectedFamily(route) : null);
  const toolTargets = normalizeStringArray(route.toolTargets || (route.toolTarget ? [route.toolTarget] : []));
  const linkedCommonRoute = kind === 'canonical' && route.commonRouteId
    ? getCommonQuestionRouteById(route.commonRouteId)
    : null;
  const sourceKinds = Array.isArray(route.sourceKinds) && route.sourceKinds.length > 0
    ? route.sourceKinds
    : (Array.isArray(linkedCommonRoute?.sourceKinds) ? linkedCommonRoute.sourceKinds : []);
  const categories = Array.isArray(route.categories) && route.categories.length > 0
    ? route.categories
    : (Array.isArray(linkedCommonRoute?.categories) ? linkedCommonRoute.categories : []);
  const tags = Array.isArray(route.tags) && route.tags.length > 0
    ? route.tags
    : (Array.isArray(linkedCommonRoute?.tags) ? linkedCommonRoute.tags : []);
  const factSourceTools = Array.isArray(route.factSourceTools) && route.factSourceTools.length > 0
    ? route.factSourceTools
    : (Array.isArray(linkedCommonRoute?.factSourceTools) ? linkedCommonRoute.factSourceTools : []);
  return {
    id: route.id,
    kind,
    label: route.displayName || route.id,
    displayName: route.displayName || null,
    family: route.family || null,
    answerStyle: route.answerStyle || null,
    expectedFamily,
    toolTarget: toolTargets[0] || route.toolTarget || null,
    toolTargets,
    requiredArgs: Array.isArray(route.requiredArgs) ? route.requiredArgs : [],
    optionalArgs: Array.isArray(route.optionalArgs) ? route.optionalArgs : [],
    cacheStrategy: route.cacheStrategy || null,
    responseShape: route.responseShape || null,
    responseRenderer,
    cardLimit: route.cardLimit || (route.responseShape === 'factual_cards' ? 5 : null),
    factLimit: route.factLimit || (route.responseShape === 'factual_cards' ? defaultFactLimitForRoute(route) : null),
    responseInstructions: route.responseInstructions || null,
    mcpLoadingMode: route.mcpLoadingMode || 'auto',
    deliveryMode: route.deliveryMode || 'standard',
    mediaAttachments: Array.isArray(route.mediaAttachments) ? route.mediaAttachments : [],
    productionStatus: route.productionStatus || 'unreviewed',
    productionNotes: route.productionNotes || null,
    followUpPolicy: route.followUpPolicy || 'auto',
    blockedPhrases: Array.isArray(route.blockedPhrases) ? route.blockedPhrases : [],
    sourceKinds,
    factSourceTools,
    categories,
    tags,
    aliases: Array.isArray(route.aliases) ? route.aliases.slice(0, 12) : [],
    intentSample: route.intentSample || null,
    matchHint: route.matchHint || null
  };
}

function getRouteOptions() {
  const optionsById = new Map();
  for (const route of COMMON_QUESTION_ROUTES) {
    optionsById.set(route.id, routeToOption(route, 'common'));
  }
  for (const route of WESTERN_CANONICAL_ROUTES) {
    optionsById.set(route.id, routeToOption(route, 'canonical'));
  }
  return [...optionsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function getToolOptions(routes) {
  const toolTargets = new Set();
  for (const route of routes) {
    for (const tool of route.toolTargets || []) {
      toolTargets.add(tool);
    }
    if (route.toolTarget) {
      toolTargets.add(route.toolTarget);
    }
  }
  toolTargets.add('search_cached_profile_facts');
  toolTargets.add('get_cached_natal_summary');
  toolTargets.add('get_cached_planet_placement');
  toolTargets.add('get_cached_angle_info');
  toolTargets.add('get_cached_house_info');
  toolTargets.add('get_cached_monthly_transits');
  toolTargets.add('get_profile_completeness');
  toolTargets.add('rest_ephemeris');
  return [...toolTargets].sort();
}

function getToolDisplayMetadata() {
  return {
    v1_horoscope_daily_personal: {
      label: 'Legacy MCP daily personal horoscope',
      endpoint: '/api/v3/horoscope/daily/personal'
    },
    rest_ephemeris: {
      label: 'Monthly ephemeris',
      endpoint: '/api/v1/ephemeris/calculate'
    },
    rest_horoscope_daily_personal_text: {
      label: 'Daily personal horoscope',
      endpoint: '/api/v3/horoscope/daily/personal'
    },
    v1_horoscope_daily_sign: {
      label: 'Daily sign horoscope'
    },
    v1_western_synastry_horoscope: {
      label: 'Couples horoscope'
    }
  };
}

function getRequiredDataOptions(routes) {
  const values = new Set(['profile', 'secondaryProfile', 'birthDate', 'birthTime', 'birthPlace', 'city', 'focus', 'range', 'sign', 'searchWindow', 'location']);
  for (const route of routes) {
    for (const arg of route.requiredArgs || []) {
      values.add(arg);
    }
    for (const arg of route.optionalArgs || []) {
      values.add(arg);
    }
  }
  return [...values].sort();
}

function getFactFilterOptions(routes) {
  const sourceKinds = new Set(['natal', 'monthly_transit']);
  const factSourceTools = new Set([
    'v1_natal_calculate',
    'rest_western_natal_insights',
    'rest_western_transits_insights'
  ]);
  const categories = new Set([
    'identity',
    'emotions',
    'relationships',
    'structure',
    'transformation',
    'growth',
    'drive',
    'life_path',
    'chart_pattern',
    'mind',
    'transit_event',
    'transit_theme',
    'timing_window'
  ]);
  const tags = new Set(['current', 'today', 'sky', 'relationship', 'love', 'career', 'work', 'planet:moon', 'planet:sun', 'planet:venus', 'planet:mars', 'angle:asc', 'angle:mc', 'house:7']);
  for (const route of routes) {
    for (const item of route.sourceKinds || []) sourceKinds.add(item);
    for (const item of route.factSourceTools || []) factSourceTools.add(item);
    for (const item of route.categories || []) categories.add(item);
    for (const item of route.tags || []) tags.add(item);
  }
  return {
    sourceKinds: [...sourceKinds].sort(),
    factSourceTools: [...factSourceTools].sort(),
    categories: [...categories].sort(),
    tags: [...tags].sort()
  };
}

function buildMetadata() {
  const routes = getRouteOptions();
  const factFilterOptions = getFactFilterOptions(routes);
  return {
    repoRoot: REPO_ROOT,
    examplesPath: EXAMPLES_PATH,
    routeOverridesPath: OVERRIDES_PATH,
    answerStyleOverridesPath: ANSWER_STYLE_OVERRIDES_PATH,
    responseShapeOverridesPath: RESPONSE_SHAPE_OVERRIDES_PATH,
    routes,
    tools: getToolOptions(routes),
    toolDisplay: getToolDisplayMetadata(),
    requiredDataOptions: getRequiredDataOptions(routes),
    sourceKindOptions: factFilterOptions.sourceKinds,
    factSourceToolOptions: factFilterOptions.factSourceTools,
    categoryOptions: factFilterOptions.categories,
    tagOptions: factFilterOptions.tags,
    answerStyleDefinitions: getAnswerStyleDefinitions(),
    builtInAnswerStyles: Object.keys(DEFAULT_ANSWER_STYLE_DEFINITIONS).sort(),
    responseShapeDefinitions: getResponseShapeDefinitions(),
    responseRendererDefinitions: getResponseRendererDefinitions(),
    answerStyles: getAnswerStyleIds(),
    cacheStrategies: [...CACHE_STRATEGIES].sort(),
    mcpLoadingModes: [...MCP_LOADING_MODES],
    mcpToolTargets: routes.flatMap((route) => route.toolTargets || (route.toolTarget ? [route.toolTarget] : [])).filter(isMcpToolTarget).sort(),
    deliveryModes: [...DELIVERY_MODES],
    mediaAttachmentOptions: [...MEDIA_ATTACHMENTS],
    productionStatuses: [...PRODUCTION_STATUSES],
    followUpPolicies: [...FOLLOW_UP_POLICIES].sort(),
    responseShapes: Object.keys(getResponseShapeDefinitions()).sort(),
    locales: ['en', 'fr', 'de', 'es']
  };
}

function getKnownRouteIds() {
  return new Set(getRouteOptions().map((route) => route.id));
}

function readRouteOverridesForEditor() {
  return readRouteOverrides(OVERRIDES_PATH).routes || {};
}

function writeRouteOverridesForEditor(overrides) {
  validateEffectiveRouteOverridesForEditor(overrides || {});
  const routes = writeRouteOverrides({ routes: overrides || {} }, {
    filePath: OVERRIDES_PATH,
    knownRouteIds: getKnownRouteIds()
  });
  refreshRuntimeRouteConfig();
  return routes;
}

function validateEffectiveRouteOverridesForEditor(overrides) {
  const currentRoutes = new Map(getRouteOptions().map((route) => [route.id, route]));
  for (const [routeId, override] of Object.entries(overrides || {})) {
    const route = currentRoutes.get(routeId);
    if (!route) {
      continue;
    }
    const mcpLoadingMode = override?.mcpLoadingMode !== undefined
      ? String(override.mcpLoadingMode || '').trim()
      : (route.mcpLoadingMode || 'auto');
    const toolTargets = Array.isArray(override?.toolTargets)
      ? override.toolTargets
      : (Array.isArray(route.toolTargets) ? route.toolTargets : (route.toolTarget ? [route.toolTarget] : []));
    if (mcpLoadingMode === 'never') {
      const invalidTool = toolTargets.find((tool) => isMcpToolTarget(tool));
      if (invalidTool) {
        throw new Error(`Route "${routeId}" cannot use MCP loading "never" while fallback tool "${invalidTool}" is selected.`);
      }
    }
  }
}

function refreshRuntimeRouteConfig() {
  reloadCommonQuestionRouteOverrides();
  reloadWesternCanonicalRouteOverrides();
}

function readAnswerStyleOverridesForEditor() {
  return readAnswerStyleOverrides(ANSWER_STYLE_OVERRIDES_PATH).styles || {};
}

function writeAnswerStyleOverridesForEditor(overrides) {
  return writeAnswerStyleOverrides({ styles: overrides || {} }, {
    filePath: ANSWER_STYLE_OVERRIDES_PATH
  });
}

function readResponseShapeOverridesForEditor() {
  return readResponseShapeOverrides(RESPONSE_SHAPE_OVERRIDES_PATH).shapes || {};
}

function writeResponseShapeOverridesForEditor(overrides) {
  return writeResponseShapeOverrides({ shapes: overrides || {} }, {
    filePath: RESPONSE_SHAPE_OVERRIDES_PATH
  });
}

function createSimulatorEvent(chatId = DEFAULT_SIMULATOR_CHAT_ID, overrides = {}) {
  const normalizedChatId = String(chatId || DEFAULT_SIMULATOR_CHAT_ID).trim() || DEFAULT_SIMULATOR_CHAT_ID;
  return {
    channel: 'simulator',
    userId: normalizedChatId,
    chatId: normalizedChatId,
    localeHint: 'en',
    type: overrides.type || 'text',
    text: overrides.text !== undefined ? overrides.text : '',
    actionId: overrides.actionId || null,
    messageRef: overrides.messageRef || null
  };
}

function addSimulatorTiming(captured, label, startedAt, extra = {}) {
  if (!captured?.timeline || !captured?.startedAt) {
    return;
  }
  const startMs = Math.max(0, Math.round(startedAt - captured.startedAt));
  captured.timeline.push({
    label,
    startMs,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    ...extra
  });
}

function markSimulatorTiming(captured, label, extra = {}) {
  addSimulatorTiming(captured, label, performance.now(), extra);
}

function attachSimulatorTrace(event, captured) {
  if (!event || !captured) {
    return event;
  }
  Object.defineProperty(event, '__simulatorTrace', {
    configurable: true,
    enumerable: false,
    value(label, startedAt, extra = {}) {
      addSimulatorTiming(captured, label, Number(startedAt) || performance.now(), {
        scope: 'conversation',
        ...extra
      });
    }
  });
  return event;
}

function createBrowserSimulatorChannelApi(captured, options = {}) {
  let nextMessageId = 1;
  const makeRef = () => ({ chatId: captured.chatId, messageId: nextMessageId++ });
  const push = (entry) => {
    const startedAt = performance.now();
    const message = {
      id: `${entry.kind || 'message'}-${captured.messages.length + 1}`,
      ts: new Date().toISOString(),
      ...entry
    };
    captured.messages.push(message);
    addSimulatorTiming(captured, `bot ${message.kind || 'message'}`, startedAt, {
      messageId: message.messageRef?.messageId || null
    });
    if (typeof options.onMessage === 'function') {
      options.onMessage(message);
    }
    return message;
  };

  return {
    capabilities: {
      canEdit: true,
      helpActions: true,
      interactiveChoices: true,
      richNatalActions: false
    },
    async sendText(_event, text) {
      const ref = makeRef();
      push({ side: 'bot', kind: 'text', text: String(text || ''), messageRef: ref });
      return ref;
    },
    async editText(_event, messageRef, text) {
      const ref = messageRef || makeRef();
      push({ side: 'bot', kind: 'edit', text: String(text || ''), messageRef: ref });
      return ref;
    },
    async deleteMessage(_event, messageRef) {
      const messageId = messageRef?.messageId;
      if (!messageId) {
        return false;
      }
      const index = captured.messages.findIndex((message) => (
        message?.messageRef?.messageId === messageId &&
        message.side === 'bot'
      ));
      if (index >= 0) {
        captured.messages.splice(index, 1);
      }
      if (typeof options.onDeleteMessage === 'function') {
        options.onDeleteMessage(messageRef);
      }
      return true;
    },
    async sendImage(_event, _buffer, options = {}) {
      const ref = makeRef();
      const buffer = Buffer.isBuffer(_buffer) ? _buffer : Buffer.from(_buffer || []);
      push({
        side: 'bot',
        kind: 'image',
        text: options.caption !== undefined ? String(options.caption || '') : '[image]',
        filename: options.filename || null,
        imageDataUrl: buffer.length > 0 ? `data:image/png;base64,${buffer.toString('base64')}` : null,
        messageRef: ref
      });
      return ref;
    },
    async sendChoices(_event, prompt, choices) {
      const ref = makeRef();
      push({
        side: 'bot',
        kind: 'choices',
        text: String(prompt || ''),
        choices: Array.isArray(choices) ? choices.map((choice) => ({
          id: choice.id,
          title: choice.title
        })) : [],
        messageRef: ref
      });
      return ref;
    },
    async sendLink(_event, prompt, label, url) {
      const ref = makeRef();
      push({ side: 'bot', kind: 'link', text: String(prompt || ''), label: String(label || ''), url: String(url || ''), messageRef: ref });
      return ref;
    },
    async ackAction(_event, text) {
      if (text) {
        push({ side: 'bot', kind: 'ack', text: String(text || '') });
      }
    }
  };
}

function compactStateForSimulator(chatId = DEFAULT_SIMULATOR_CHAT_ID) {
  const event = createSimulatorEvent(chatId);
  const state = getChatState(event);
  return {
    chatId: event.chatId,
    stateKey: resolveStateKey(event),
    activeProfileId: state.activeProfileId || null,
    activeFlow: state.activeFlow || null,
    factAvailability: state.factAvailability || {},
    pendingQuestion: state.pendingQuestion || null,
    pendingSynastryQuestion: state.pendingSynastryQuestion || null,
    conversationContext: state.conversationContext || {},
    choiceMap: getChoiceMap(event) || {},
    historyCount: Array.isArray(state.history) ? state.history.length : 0,
    lastToolResults: Array.isArray(state.lastToolResults) ? state.lastToolResults : []
  };
}

function summarizeValue(value, maxLength = 900) {
  if (value === undefined) {
    return null;
  }
  const cloned = JSON.parse(JSON.stringify(value ?? null));
  const text = JSON.stringify(cloned);
  if (text.length <= maxLength) {
    return cloned;
  }
  return {
    truncated: true,
    preview: text.slice(0, maxLength)
  };
}

function summarizeToolResult(tool) {
  const result = tool?.result || {};
  const facts = Array.isArray(result.facts) ? result.facts : [];
  return {
    name: tool?.name || null,
    args: summarizeValue(tool?.args || {}, 600),
    available: result.available !== undefined ? Boolean(result.available) : undefined,
    factCount: facts.length || undefined,
    cacheMonth: result.cacheMonth || result.cache_month || facts.find((fact) => fact.cache_month || fact.cacheMonth)?.cache_month || null,
    sourceKinds: [...new Set(facts.map((fact) => fact.source_kind || fact.sourceKind).filter(Boolean))],
    resultPreview: summarizeValue(result, 900)
  };
}

function routeSummaryForSimulator(context = {}) {
  const routes = getRouteOptions();
  const routeId = context.lastCommonRouteId || context.lastQueryState?.canonicalRouteId || null;
  const route = routeId ? routes.find((item) => item.id === routeId) : null;
  return {
    routeId,
    answerStyle: context.lastAnswerStyle || route?.answerStyle || null,
    executionTarget: context.lastExecutionTarget || null,
    executionFamily: context.lastResultFamily || null,
    cacheStrategy: route?.cacheStrategy || null,
    sourceKinds: route?.sourceKinds || [],
    factSourceTools: route?.factSourceTools || [],
    categories: route?.categories || [],
    tags: route?.tags || [],
    fallbackTools: route?.toolTargets || (route?.toolTarget ? [route.toolTarget] : []),
    responseShape: route?.responseShape || null,
    responseRenderer: route?.responseRenderer || null,
    cardLimit: route?.cardLimit || (route?.responseShape === 'factual_cards' ? 5 : null),
    factLimit: route?.factLimit || (route?.responseShape === 'factual_cards' ? defaultFactLimitForRoute(route) : null),
    mcpLoadingMode: route?.mcpLoadingMode || 'auto',
    deliveryMode: route?.deliveryMode || 'standard',
    mediaAttachments: route?.mediaAttachments || [],
    responseInstructions: route?.responseInstructions || null,
    hasCustomResponseInstructions: Boolean(route?.responseInstructions),
    resolvedQuestion: context.lastResolvedQuestion || null,
    queryState: context.lastQueryState || null
  };
}

function summarizeSimulatorResponse(messages = [], route = {}) {
  const botMessages = Array.isArray(messages) ? messages.filter((message) => message.side === 'bot') : [];
  const kinds = [...new Set(botMessages.map((message) => message.kind || 'text').filter(Boolean))];
  const hasChoices = botMessages.some((message) => Array.isArray(message.choices) && message.choices.length > 0);
  return {
    type: route.responseShape || route.answerStyle || (hasChoices ? 'choices' : (kinds[0] || 'none')),
    shape: route.responseShape || null,
    answerStyle: route.answerStyle || null,
    messageKinds: kinds,
    botMessageCount: botMessages.length,
    hasChoices
  };
}

function compactRawStateForSimulator(state = {}) {
  return {
    channel: state.channel || null,
    userId: state.userId || null,
    chatId: state.chatId || null,
    locale: state.locale || null,
    activeProfileId: state.activeProfileId || null,
    responseMode: state.responseMode || null,
    profileDirectory: Array.isArray(state.profileDirectory)
      ? state.profileDirectory.map((profile) => ({
          profileId: profile.profileId || null,
          profileName: profile.profileName || null,
          isActive: Boolean(profile.isActive),
          birthDate: profile.birthDate || null,
          cityLabel: profile.cityLabel || null,
          timeKnown: profile.timeKnown !== undefined ? Boolean(profile.timeKnown) : null,
          summary: profile.summary?.summaryText || null
        }))
      : [],
    factAvailability: state.factAvailability || {},
    history: {
      count: Array.isArray(state.history) ? state.history.length : 0,
      roles: Array.isArray(state.history) ? state.history.map((item) => item.role || null) : []
    },
    activeFlow: state.activeFlow || null,
    pendingQuestion: state.pendingQuestion || null,
    pendingSynastryQuestion: state.pendingSynastryQuestion || null,
    pendingWeddingSelection: state.pendingWeddingSelection ? true : null,
    conversationContext: state.conversationContext || {},
    choiceMap: state.choiceMap || {},
    lastToolResults: Array.isArray(state.lastToolResults) ? state.lastToolResults.map(summarizeToolResult) : []
  };
}

function buildSimulatorTurnLog(input, startedAt, beforeState, afterState, messages, timeline = [], error = null) {
  const context = afterState.conversationContext || {};
  const tools = Array.isArray(afterState.lastToolResults) ? afterState.lastToolResults.map(summarizeToolResult) : [];
  const route = routeSummaryForSimulator(context);
  return {
    input,
    durationMs: Math.round(performance.now() - startedAt),
    timeline,
    route,
    response: summarizeSimulatorResponse(messages, route),
    tools,
    messageCount: messages.length,
    state: {
      before: {
        activeFlow: beforeState.activeFlow || null,
        activeProfileId: beforeState.activeProfileId || null,
        pendingQuestion: beforeState.pendingQuestion || null
      },
      after: {
        activeFlow: afterState.activeFlow || null,
        activeProfileId: afterState.activeProfileId || null,
        pendingQuestion: afterState.pendingQuestion || null,
        factAvailability: afterState.factAvailability || {},
        choiceMap: afterState.choiceMap || {}
      }
    },
    error: error ? { message: error.message || String(error), stack: error.stack || null } : null,
    raw: {
      beforeState: compactRawStateForSimulator(beforeState),
      afterState: compactRawStateForSimulator(afterState),
      messages
    }
  };
}

async function dispatchSimulatorMessage(chatId, input, options = {}) {
  const startedAt = performance.now();
  const captured = {
    chatId: String(chatId || DEFAULT_SIMULATOR_CHAT_ID).trim() || DEFAULT_SIMULATOR_CHAT_ID,
    messages: [],
    timeline: [],
    startedAt
  };
  const line = String(input || '').trim();
  if (!line) {
    throw new Error('Message cannot be empty.');
  }

  markSimulatorTiming(captured, 'received user input', { chars: line.length });

  const refreshStartedAt = performance.now();
  refreshRuntimeRouteConfig();
  addSimulatorTiming(captured, 'refresh route config', refreshStartedAt);

  const event = attachSimulatorTrace(createSimulatorEvent(chatId, { text: line }), captured);
  const hydrateStartedAt = performance.now();
  await persistence.ensureHydrated(event);
  addSimulatorTiming(captured, 'hydrate simulator state', hydrateStartedAt);
  const beforeSnapshotStartedAt = performance.now();
  const beforeState = getChatStateSnapshot(event);
  addSimulatorTiming(captured, 'snapshot state before', beforeSnapshotStartedAt);
  captured.chatId = event.chatId;
  const channelApi = createBrowserSimulatorChannelApi(captured, {
    onMessage: options.onMessage,
    onDeleteMessage: options.onDeleteMessage
  });

  const userBubbleStartedAt = performance.now();
  captured.messages.push({
    id: `user-${Date.now()}`,
    ts: new Date().toISOString(),
    side: 'user',
    kind: 'text',
    text: line
  });
  if (typeof options.onMessage === 'function') {
    options.onMessage(captured.messages[captured.messages.length - 1]);
  }
  addSimulatorTiming(captured, 'render user bubble', userBubbleStartedAt);

  let error = null;
  const handlerStartedAt = performance.now();
  let handlerName = 'text handler';
  try {
    if (line === '/start') {
      handlerName = 'start command';
      await handleStart(attachSimulatorTrace(createSimulatorEvent(chatId, { type: 'start' }), captured), channelApi);
    } else if (line === '/profile') {
      handlerName = 'profile command';
      await handleProfile(attachSimulatorTrace(createSimulatorEvent(chatId, { type: 'command' }), captured), channelApi);
    } else if (line === '/billing') {
      handlerName = 'billing command';
      await handleBilling(attachSimulatorTrace(createSimulatorEvent(chatId, { type: 'command' }), captured), channelApi);
    } else if (line === '/cancel') {
      handlerName = 'cancel command';
      await handleCancel(attachSimulatorTrace(createSimulatorEvent(chatId, { type: 'action', actionId: 'cancel' }), captured), channelApi);
    } else if (line.startsWith('/action ')) {
      handlerName = 'action handler';
      await handleIncomingAction(attachSimulatorTrace(createSimulatorEvent(chatId, {
        type: 'action',
        actionId: line.slice('/action '.length).trim()
      }), captured), channelApi);
    } else {
      await handleIncomingText(event, channelApi);
    }
  } catch (caught) {
    error = caught;
    addSimulatorTiming(captured, handlerName, handlerStartedAt, { error: true });
    captured.messages.push({
      id: `error-${Date.now()}`,
      ts: new Date().toISOString(),
      side: 'bot',
      kind: 'error',
      text: caught?.message || String(caught)
    });
    if (typeof options.onMessage === 'function') {
      options.onMessage(captured.messages[captured.messages.length - 1]);
    }
  } finally {
    if (!error) {
      addSimulatorTiming(captured, handlerName, handlerStartedAt);
    }
  }

  const afterSnapshotStartedAt = performance.now();
  const afterState = getChatStateSnapshot(event);
  addSimulatorTiming(captured, 'snapshot state after', afterSnapshotStartedAt);
  const logStartedAt = performance.now();
  const log = buildSimulatorTurnLog(line, startedAt, beforeState, afterState, captured.messages, captured.timeline, error);
  addSimulatorTiming(captured, 'build simulator log', logStartedAt);
  log.timeline = captured.timeline;
  if (typeof options.onLog === 'function') {
    options.onLog(log);
  }
  return {
    chatId: event.chatId,
    messages: captured.messages,
    log,
    state: compactStateForSimulator(event.chatId)
  };
}

function resetSimulator(chatId = DEFAULT_SIMULATOR_CHAT_ID) {
  const event = createSimulatorEvent(chatId);
  replaceChatState(event, null);
  natalFlow.replaceSession(event, null);
  return compactStateForSimulator(event.chatId);
}

function buildHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Routing Editor</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --panel-alt: #f0f3f2;
      --text: #18211f;
      --muted: #5f6c68;
      --line: #d9dedb;
      --accent: #176b5b;
      --accent-dark: #0e4f43;
      --danger: #a33a32;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      min-height: 34px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.primary:hover { background: var(--accent-dark); }
    button.danger { color: var(--danger); }
    input, select, textarea {
      width: 100%;
      min-height: 34px;
      height: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 7px 9px;
      background: #fff;
      color: var(--text);
      align-self: start;
    }
    textarea {
      min-height: 74px;
      resize: vertical;
      line-height: 1.35;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    h1 {
      font-size: 18px;
      margin: 0;
      font-weight: 680;
      letter-spacing: 0;
    }
    .path {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .tabs {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .tab {
      background: var(--panel-alt);
    }
    .tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(340px, 44%) 1fr;
      gap: 0;
      min-height: 0;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      background: var(--panel);
    }
    .filters {
      display: grid;
      grid-template-columns: 1fr 150px 170px;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--line);
    }
    .list {
      overflow: auto;
      min-height: 0;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
    }
    .row:hover, .row.active { background: var(--panel-alt); }
    .row-title {
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-text {
      color: var(--muted);
      margin-top: 3px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.25;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: #e7eeeb;
      color: #245b50;
      font-size: 12px;
      white-space: nowrap;
    }
    .badge-ready {
      background: #dff3eb;
      color: #17604f;
    }
    .badge-warning {
      background: #fff3d8;
      color: #7a5200;
    }
    .badge-error {
      background: #ffe3de;
      color: #9b2c1f;
    }
    .badge-unreviewed {
      background: #edf1ef;
      color: #5b6964;
    }
    .editor {
      min-width: 0;
      overflow: auto;
      padding: 18px;
    }
    .empty {
      color: var(--muted);
      padding: 24px;
    }
    .form {
      display: grid;
      gap: 14px;
      max-width: 1180px;
    }
    .grid2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-items: start;
    }
    .grid3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      align-items: start;
    }
    .step {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .step-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      color: #294942;
      font-weight: 780;
      font-size: 14px;
    }
    .step-note {
      color: var(--muted);
      font-weight: 600;
      font-size: 12px;
    }
    .step-subpanel {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid #d7c483;
      border-radius: 8px;
      background: #fff8e8;
    }
    .advanced {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .inline-advanced {
      border: 1px solid #dce4e1;
      border-radius: 8px;
      background: #fbfcfb;
    }
    .inline-advanced summary {
      cursor: pointer;
      padding: 10px 12px;
      color: #31534b;
      font-weight: 720;
      list-style-position: inside;
    }
    .inline-advanced-body {
      display: grid;
      gap: 12px;
      padding: 0 12px 12px;
    }
    .advanced summary {
      cursor: pointer;
      padding: 12px 14px;
      color: #294942;
      font-weight: 780;
      font-size: 14px;
      list-style-position: inside;
    }
    .advanced-body {
      display: grid;
      gap: 10px;
      padding: 0 14px 14px;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      align-content: start;
      min-width: 0;
    }
    label.editable input,
    label.editable select,
    label.editable textarea {
      background: #fff8e7;
      border-color: #d9c58f;
    }
    label.readonly input,
    label.readonly select,
    label.readonly textarea {
      background: #f3f5f4;
      color: #3f4d49;
    }
    label span {
      color: var(--muted);
    }
    .label-head {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .info-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 17px;
      height: 17px;
      min-height: 17px;
      padding: 0;
      border-radius: 50%;
      border: 1px solid #b9c5c1;
      color: #315f56;
      background: #eef4f1;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      cursor: help;
      flex: 0 0 auto;
    }
    .help-panel {
      display: grid;
      gap: 5px;
      padding: 12px;
      border: 1px solid #cfdad6;
      border-radius: 8px;
      background: #f2f7f5;
      color: #334d47;
      line-height: 1.35;
    }
    .help-title {
      font-weight: 750;
      color: #1c443b;
    }
    .help-line {
      font-size: 13px;
    }
    .notice {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.35;
    }
    .notice-warning {
      border: 1px solid #d7bd73;
      background: #fff8e2;
      color: #61480d;
    }
    .validation-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 8px;
      background: #fff;
    }
    .validation-panel.ready {
      border-color: #97cdbd;
      background: #f2faf7;
    }
    .validation-panel.warning {
      border-color: #d8b45d;
      background: #fffaf0;
    }
    .validation-panel.error {
      border-color: #dfa198;
      background: #fff7f5;
    }
    .validation-title {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      font-weight: 800;
      color: #203c36;
    }
    .validation-list {
      display: grid;
      gap: 6px;
    }
    .validation-item {
      border-radius: 6px;
      padding: 7px 8px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid var(--line);
      font-size: 13px;
    }
    .validation-item strong {
      display: block;
      margin-bottom: 2px;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(24, 33, 31, 0.36);
      z-index: 20;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal {
      width: min(520px, 100%);
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.18);
      padding: 18px;
      display: grid;
      gap: 10px;
    }
    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .modal-title {
      font-size: 17px;
      font-weight: 750;
    }
    .modal-body {
      color: var(--muted);
      line-height: 1.45;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .cache-source {
      color: #405a54;
    }
    .status {
      min-width: 180px;
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
    .dirty {
      color: var(--danger);
      font-weight: 700;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-start;
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 28px;
      padding: 4px 7px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      max-width: 100%;
      white-space: nowrap;
    }
    .chip {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chip button {
      border: 0;
      min-height: 18px;
      padding: 0 3px;
      color: var(--danger);
      background: transparent;
    }
    .layout.simulator-mode {
      grid-template-columns: 1fr;
    }
    .layout.simulator-mode .sidebar {
      display: none;
    }
    .simulator {
      display: grid;
      grid-template-columns: minmax(320px, 430px) minmax(360px, 1fr);
      gap: 16px;
      max-width: 1180px;
      height: calc(100vh - 132px);
      min-height: 620px;
      align-items: start;
    }
    .phone {
      border: 1px solid #cbd5d1;
      border-radius: 20px;
      background: #eef3f0;
      height: clamp(620px, calc(100vh - 154px), 780px);
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr auto;
      box-shadow: 0 10px 30px rgba(24, 33, 31, 0.08);
      align-self: start;
    }
    .phone-head {
      padding: 14px 16px;
      background: #174f45;
      color: #fff;
      display: grid;
      gap: 4px;
    }
    .phone-title { font-weight: 780; }
    .phone-subtitle { opacity: 0.82; font-size: 12px; }
    .chat-feed {
      padding: 14px;
      overflow: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 9px;
      background: linear-gradient(#edf5f1, #f7f7f4);
    }
    .bubble {
      max-width: 86%;
      padding: 9px 11px;
      border-radius: 12px;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border: 1px solid transparent;
    }
    .bubble.user {
      align-self: flex-end;
      background: #d9f1e8;
      border-color: #b7ddd0;
    }
    .bubble.bot {
      align-self: flex-start;
      background: #fff;
      border-color: #dce4e1;
    }
    .bubble.has-image {
      max-width: calc(100% - 10px);
      width: calc(100% - 10px);
    }
    .bubble-image-frame {
      max-width: 100%;
      max-height: 420px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-top: 8px;
      background: #fff;
    }
    .bubble-image {
      display: block;
      width: auto;
      min-width: 900px;
      max-width: none;
      height: auto;
      background: #fff;
    }
    .bubble-meta {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
      font-weight: 700;
    }
    .choice-list {
      display: grid;
      gap: 5px;
      margin-top: 8px;
    }
    .choice-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 8px;
      background: #f7faf8;
      font-size: 12px;
    }
    .sim-input {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--line);
      background: #fff;
    }
    .sim-input-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }
    .sim-shortcuts {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .sim-shortcuts button {
      min-height: 28px;
      padding: 4px 8px;
      font-size: 12px;
    }
    .logs-panel {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: clamp(620px, calc(100vh - 154px), 780px);
      min-height: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
      align-self: start;
    }
    .logs-head {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: #f4f7f5;
    }
    .logs-head-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }
    .log-feed {
      overflow: auto;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 10px;
    }
    .log-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 7px;
      background: #fff;
    }
    .loaded-route-card {
      border-radius: 0;
      border-left: 0;
      border-right: 0;
      border-top: 0;
      background: #fbf8ee;
    }
    .route-load-actions {
      justify-content: flex-start;
    }
    .log-title {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-weight: 750;
      color: #294942;
    }
    .log-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      font-size: 12px;
    }
    .log-item {
      background: #f4f7f5;
      border-radius: 6px;
      padding: 6px;
      min-width: 0;
    }
    .log-item-wide {
      grid-column: 1 / -1;
      white-space: pre-wrap;
    }
    .log-item strong {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 2px;
    }
    .log-tools {
      display: grid;
      gap: 5px;
      font-size: 12px;
    }
    .timeline {
      display: grid;
      gap: 4px;
      font-size: 12px;
    }
    .timeline-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 7px;
    }
    .timeline-summary-card {
      background: #eef5f1;
      border: 1px solid #cfddd7;
      border-radius: 7px;
      padding: 7px;
      min-width: 0;
    }
    .timeline-summary-card strong {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 2px;
    }
    .timeline-summary-card span {
      display: block;
      font-weight: 750;
      color: #203c36;
    }
    .timeline-row {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) 88px 80px;
      gap: 8px;
      align-items: center;
      padding: 5px 6px;
      border-radius: 6px;
      background: #f4f7f5;
    }
    .timeline-row.timeline-head {
      background: transparent;
      padding-top: 0;
      padding-bottom: 2px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      text-transform: uppercase;
    }
    .timeline-row.timeline-slow {
      background: #fff5df;
      border: 1px solid #e3be67;
    }
    .timeline-row.timeline-medium {
      background: #f8fbf9;
      border: 1px solid #dde8e3;
    }
    .timeline-row strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #294942;
    }
    .timeline-row small {
      display: block;
      color: var(--muted);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .timeline-row span {
      color: var(--muted);
      text-align: right;
      white-space: nowrap;
    }
    .raw-json {
      white-space: pre-wrap;
      overflow: auto;
      max-height: 260px;
      background: #17211f;
      color: #d9f1e8;
      border-radius: 6px;
      padding: 8px;
      font-size: 11px;
    }
    .raw-json-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin: 6px 0;
    }
    .raw-json-copy {
      font-size: 12px;
      padding: 6px 10px;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--line); max-height: 48vh; }
      .grid2, .grid3 { grid-template-columns: 1fr; }
      .simulator { grid-template-columns: 1fr; height: auto; }
      .phone, .logs-panel { height: min(720px, calc(100vh - 132px)); }
      .timeline-row { grid-template-columns: minmax(120px, 1fr) 58px 62px; }
      .timeline-summary { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; }
      .status { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>Routing Editor</h1>
        <div class="path" id="path"></div>
      </div>
      <div class="actions">
        <div class="tabs">
          <button id="tab-questions" class="tab active">Questions</button>
          <button id="tab-routes" class="tab">Routes</button>
          <button id="tab-styles" class="tab">Answer Styles</button>
          <button id="tab-shapes" class="tab">Response Shapes</button>
          <button id="tab-simulator" class="tab">Simulator</button>
        </div>
        <button id="add">Add question</button>
        <button id="duplicate">Duplicate</button>
        <button id="delete" class="danger">Delete</button>
        <button id="reload">Reload</button>
        <button id="save" class="primary">Save JSONL</button>
        <div class="status" id="status">Loading</div>
      </div>
    </header>
    <main class="layout" id="main-layout">
      <section class="sidebar">
        <div class="filters">
          <input id="search" placeholder="Search questions, ids, routes">
          <select id="familyFilter"><option value="">All families</option></select>
          <select id="toolFilter">
            <option value="">All tool states</option>
            <option value="has_any">Has route tool</option>
            <option value="missing_any">No route tool</option>
            <option value="has_override">Has override</option>
            <option value="missing_override">No override</option>
          </select>
        </div>
        <div class="list" id="list"></div>
      </section>
      <section class="editor" id="editor"></section>
    </main>
    <div class="modal-backdrop" id="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title" id="help-modal-title"></div>
          <button id="help-modal-close">Close</button>
        </div>
        <div class="modal-body" id="help-modal-body"></div>
      </div>
    </div>
  </div>
  <script>
    const state = {
      metadata: null,
      examples: [],
      routeOverrides: {},
      answerStyleOverrides: {},
      responseShapeOverrides: {},
      mode: 'questions',
      selected: 0,
      selectedRoute: 0,
      selectedStyle: 0,
      selectedShape: 0,
      simulator: {
        chatId: 'browser-sim-local',
        messages: [],
        logs: [],
        busy: false,
        selectedRouteId: '',
        backendState: null
      },
      routeOverridesDirty: false,
      dirty: false
    };

    const el = (id) => document.getElementById(id);

    function routeById(id) {
      return state.metadata.routes.find((route) => route.id === id) || null;
    }

    function setStatus(text, dirty = state.dirty) {
      el('status').textContent = text;
      el('status').className = dirty ? 'status dirty' : 'status';
    }

    function markDirty() {
      state.dirty = true;
      setStatus('Unsaved changes', true);
      renderList();
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || response.statusText);
      }
      return body;
    }

    async function load() {
      const [metadata, examplesBody, overridesBody, styleOverridesBody, shapeOverridesBody] = await Promise.all([
        fetchJson('/api/metadata'),
        fetchJson('/api/examples'),
        fetchJson('/api/route-overrides'),
        fetchJson('/api/answer-style-overrides'),
        fetchJson('/api/response-shape-overrides')
      ]);
      state.metadata = metadata;
      state.examples = examplesBody.examples;
      state.routeOverrides = overridesBody.routes || {};
      state.answerStyleOverrides = styleOverridesBody.styles || {};
      state.responseShapeOverrides = shapeOverridesBody.shapes || {};
      state.selected = Math.min(state.selected, Math.max(0, state.examples.length - 1));
      state.selectedRoute = Math.min(state.selectedRoute, Math.max(0, state.metadata.routes.length - 1));
      state.selectedStyle = Math.min(state.selectedStyle, Math.max(0, getAnswerStyleOptions().length - 1));
      state.selectedShape = Math.min(state.selectedShape, Math.max(0, getResponseShapeOptions().length - 1));
      state.routeOverridesDirty = false;
      state.dirty = false;
      setPathForMode();
      renderFamilyFilter();
      renderList();
      renderEditor();
      setStatus(state.examples.length + ' questions, ' + state.metadata.routes.length + ' routes loaded', false);
    }

    function renderFamilyFilter() {
      const select = el('familyFilter');
      const previous = select.value;
      const families = [...new Set(state.metadata.routes.map((route) => route.expectedFamily).filter(Boolean))].sort();
      select.innerHTML = '<option value="">All families</option>' + families.map((family) => '<option value="' + escapeHtml(family) + '">' + escapeHtml(family) + '</option>').join('');
      select.value = previous;
    }

    function filteredExamples() {
      const query = el('search').value.trim().toLowerCase();
      const family = el('familyFilter').value;
      const toolFilter = el('toolFilter').value;
      if (state.mode === 'routes') {
        return state.metadata.routes
          .map((route, index) => ({ route, index }))
          .filter(({ route }) => {
            const hasTool = Boolean(route.toolTarget) || (Array.isArray(route.toolTargets) && route.toolTargets.length > 0);
            const hasOverride = Boolean(state.routeOverrides[route.id]);
            const haystack = [route.id, route.expectedFamily, route.family, route.answerStyle, route.toolTarget, route.matchHint, route.intentSample, (route.sourceKinds || []).join(' '), (route.factSourceTools || []).join(' '), (route.categories || []).join(' '), (route.tags || []).join(' ')].join(' ').toLowerCase();
            const matchesToolFilter = (
              !toolFilter ||
              (toolFilter === 'has_any' && hasTool) ||
              (toolFilter === 'missing_any' && !hasTool) ||
              (toolFilter === 'has_override' && hasOverride) ||
              (toolFilter === 'missing_override' && !hasOverride)
            );
            return (
              (!query || haystack.includes(query)) &&
              (!family || route.expectedFamily === family) &&
              matchesToolFilter
            );
          });
      }
      if (state.mode === 'styles') {
        return getAnswerStyleOptions()
          .map((styleId, index) => ({ style: getEditableAnswerStyle(styleId), index }))
          .filter(({ style }) => {
            const routeCount = routesForAnswerStyle(style.id).length;
            const haystack = [style.id, style.description, (style.instructions || []).join(' ')].join(' ').toLowerCase();
            return (!query || haystack.includes(query)) && (!family || (family === 'indexed_natal' ? routeCount >= 0 : true));
          });
      }
      if (state.mode === 'shapes') {
        return getResponseShapeOptions()
          .map((shapeId, index) => ({ shape: getEditableResponseShape(shapeId), index }))
          .filter(({ shape }) => {
            const haystack = [shape.id, shape.description, (shape.instructions || []).join(' ')].join(' ').toLowerCase();
            return !query || haystack.includes(query);
          });
      }
      return state.examples
        .map((example, index) => ({ example, index }))
        .filter(({ example }) => {
          const route = routeById(example.routeId);
          const hasAnyTool = Boolean(route?.toolTarget) || (Array.isArray(route?.toolTargets) && route.toolTargets.length > 0);
          const hasOverride = Boolean(state.routeOverrides[example.routeId]);
          const haystack = [example.id, example.text, example.routeId, example.expectedFamily, example.locale, example.notes].join(' ').toLowerCase();
          const matchesToolFilter = (
            !toolFilter ||
            (toolFilter === 'has_any' && hasAnyTool) ||
            (toolFilter === 'missing_any' && !hasAnyTool) ||
            (toolFilter === 'has_override' && hasOverride) ||
            (toolFilter === 'missing_override' && !hasOverride)
          );
          return (
            (!query || haystack.includes(query)) &&
            (!family || route?.expectedFamily === family || example.expectedFamily === family) &&
            matchesToolFilter
          );
        });
    }

    function getRouteExampleCount(routeId) {
      return state.examples.filter((example) => example.routeId === routeId).length;
    }

    function countInstructionSections(text) {
      return String(text || '')
        .split(/\\r?\\n/)
        .map((line) => line.trim().replace(/\\s+:/g, ':'))
        .filter((line) => /^[A-Z][A-Za-z0-9 \\\\/&'()-]{1,80}:$/.test(line))
        .length;
    }

    function findExactSectionCount(text) {
      const match = String(text || '').match(/\\b(?:exactly|return)\\s+(\\d{1,2})\\s+(?:short\\s+)?sections?\\b/i);
      return match ? Number(match[1]) : null;
    }

    function validateRouteForProduction(route) {
      const override = getEditableRouteOverride(route);
      const issues = [];
      const warnings = [];
      const passes = [];
      const exampleCount = getRouteExampleCount(route.id);
      const toolTargets = Array.isArray(override.toolTargets) ? override.toolTargets : [];
      const mediaAttachments = Array.isArray(override.mediaAttachments) ? override.mediaAttachments : [];
      const usesIndexed = ['indexed_natal_then_tool', 'indexed_transits_then_tool', 'cached_plus_tool'].includes(override.cacheStrategy);
      const usesMcpTool = toolTargets.some(isMcpToolTargetForUi);

      if (exampleCount === 0) {
        issues.push('No question examples map to this route.');
      } else if (exampleCount < 3) {
        warnings.push('Only ' + exampleCount + ' question example' + (exampleCount === 1 ? '' : 's') + '. Add at least 3 realistic examples before production.');
      } else {
        passes.push(exampleCount + ' question examples are mapped to this route.');
      }

      if (!override.answerStyle) issues.push('Answer style is missing.');
      else passes.push('Answer style is set.');

      if (!override.responseShape) issues.push('Response shape is missing.');
      else passes.push('Response shape is set.');

      if (override.cacheStrategy === 'tool_only' && toolTargets.length === 0) {
        issues.push('Tool-only route has no tool selected.');
      }
      if (override.cacheStrategy === 'cached_plus_tool' && toolTargets.length === 0) {
        issues.push('Cache plus tool requires at least one fallback tool.');
      }
      if (usesMcpTool && override.mcpLoadingMode === 'never') {
        issues.push('MCP loading is set to never, but an MCP fallback tool is selected.');
      }
      if (usesIndexed) {
        const lockedSourceKinds = getLockedSourceKindsForStrategy(override.cacheStrategy);
        const sourceKinds = lockedSourceKinds.length > 0 ? lockedSourceKinds : override.sourceKinds;
        if (!Array.isArray(sourceKinds) || sourceKinds.length === 0) {
          issues.push('Cached-fact route has no source kind to search.');
        } else {
          passes.push('Cached fact source is defined.');
        }
      }

      if (override.responseShape === 'factual_cards') {
        const cardLimit = Number(override.cardLimit || 0);
        const factLimit = Number(override.factLimit || 0);
        if (!Number.isFinite(cardLimit) || cardLimit < 1 || cardLimit > 12) {
          issues.push('Number of cards must be between 1 and 12.');
        }
        if (usesIndexed && (!Number.isFinite(factLimit) || factLimit < cardLimit || factLimit > 30)) {
          issues.push('Facts to fetch must be at least the number of cards and at most 30.');
        }
      }

      if (override.deliveryMode === 'progressive_generate_sections') {
        if (override.responseShape !== 'factual_cards') {
          issues.push('Generate each section live only works with factual_cards.');
        }
        if (!String(override.responseInstructions || '').trim()) {
          warnings.push('Live section generation works best with explicit section instructions.');
        }
      }

      const exactSectionCount = findExactSectionCount(override.responseInstructions);
      const headingCount = countInstructionSections(override.responseInstructions);
      if (exactSectionCount && headingCount && exactSectionCount !== headingCount) {
        warnings.push('Custom instructions say exactly ' + exactSectionCount + ' sections but define ' + headingCount + ' headings.');
      }
      if (exactSectionCount && Number(override.cardLimit || 0) && exactSectionCount !== Number(override.cardLimit || 0)) {
        warnings.push('Custom instructions say exactly ' + exactSectionCount + ' sections but Number of cards is ' + override.cardLimit + '.');
      }

      if (mediaAttachments.includes('natal_chart_png') && !(override.requiredArgs || []).includes('profile')) {
        warnings.push('Natal chart PNG needs a completed profile. Add required arg "profile" for clarity.');
      }
      if (mediaAttachments.includes('ephemeris_month_png') && !['ephemeris', 'daily_ephemeris'].includes(route.id)) {
        warnings.push('Ephemeris PNG is intended for ephemeris routes.');
      }
      if (mediaAttachments.includes('natal_aspects_png') && route.id !== 'all_natal_aspects') {
        warnings.push('Natal aspects PNG is intended for the all_natal_aspects route.');
      }
      if (mediaAttachments.length > 0) {
        passes.push('Media attachments are configured.');
      }

      if (toolTargets.length > 0 || usesIndexed) {
        passes.push('Route has a data source.');
      } else {
        warnings.push('Route has no explicit data source. This may still work for simple system answers, but validate in Simulator.');
      }

      const status = issues.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'ready');
      return { status, issues, warnings, passes };
    }

    function formatRouteValidationBadge(validation) {
      if (validation.status === 'error') return { label: 'Needs work', className: 'badge-error' };
      if (validation.status === 'warning') return { label: 'Check', className: 'badge-warning' };
      return { label: 'Ready', className: 'badge-ready' };
    }

    function formatProductionStatus(status) {
      const value = String(status || 'unreviewed');
      if (value === 'ready') return 'Ready';
      if (value === 'check') return 'Check';
      if (value === 'needs_work') return 'Needs work';
      return 'Unreviewed';
    }

    function productionStatusBadgeClass(status) {
      const value = String(status || 'unreviewed');
      if (value === 'ready') return 'badge-ready';
      if (value === 'check') return 'badge-warning';
      if (value === 'needs_work') return 'badge-error';
      return 'badge-unreviewed';
    }

    function renderRouteValidationPanel(route) {
      const validation = validateRouteForProduction(route);
      const badge = formatRouteValidationBadge(validation);
      const rows = [
        ...validation.issues.map((text) => ['Fix before production', text]),
        ...validation.warnings.map((text) => ['Review', text]),
        ...(validation.issues.length || validation.warnings.length ? [] : validation.passes.slice(0, 4).map((text) => ['Looks good', text]))
      ];
      return '<div class="validation-panel ' + escapeAttr(validation.status) + '">' +
        '<div class="validation-title"><span>Production checklist</span><span class="badge ' + escapeAttr(badge.className) + '">' + escapeHtml(badge.label) + '</span></div>' +
        '<div class="hint">Advisory only. This checklist does not set the route status; you choose the production flag manually.</div>' +
        '<div class="validation-list">' + rows.map(([title, text]) => (
          '<div class="validation-item"><strong>' + escapeHtml(title) + '</strong>' + escapeHtml(text) + '</div>'
        )).join('') + '</div>' +
      '</div>';
    }

    function renderList() {
      if (state.mode === 'simulator') {
        el('list').innerHTML = '';
        return;
      }
      const rows = filteredExamples();
      el('list').innerHTML = rows.map((item) => {
        const example = item.example;
        const route = item.route;
        const index = item.index;
        const style = item.style;
        const shape = item.shape;
        const active = index === (state.mode === 'routes'
          ? state.selectedRoute
          : (state.mode === 'styles' ? state.selectedStyle : (state.mode === 'shapes' ? state.selectedShape : state.selected))) ? ' active' : '';
        const title = state.mode === 'routes'
          ? formatRouteName(route)
          : (state.mode === 'styles' ? style.id : (state.mode === 'shapes' ? shape.id : (example.id || '(missing id)')));
        const body = state.mode === 'routes'
          ? [route.id, formatExpectedFamily(route.expectedFamily), route.toolTarget || 'uses cached facts'].filter(Boolean).join(' · ')
          : (state.mode === 'styles' ? style.description : (state.mode === 'shapes' ? shape.description : (example.text || '')));
        const badge = state.mode === 'routes'
          ? formatProductionStatus(getEditableRouteOverride(route).productionStatus)
          : (state.mode === 'styles'
              ? routesForAnswerStyle(style.id).length + ' routes'
              : (state.mode === 'shapes' ? routesForResponseShape(shape.id).length + ' routes' : (example.routeId || 'no route')));
        const badgeClass = state.mode === 'routes' ? productionStatusBadgeClass(getEditableRouteOverride(route).productionStatus) : '';
        return '<div class="row' + active + '" data-index="' + index + '">' +
          '<div><div class="row-title">' + escapeHtml(title) + '</div>' +
          '<div class="row-text">' + escapeHtml(body) + '</div></div>' +
          '<div class="badge ' + escapeAttr(badgeClass) + '">' + escapeHtml(badge) + '</div>' +
          '</div>';
      }).join('') || '<div class="empty">No matching rows.</div>';
      for (const row of document.querySelectorAll('.row')) {
        row.addEventListener('click', () => {
          if (state.mode === 'routes') {
            state.selectedRoute = Number(row.dataset.index);
          } else if (state.mode === 'styles') {
            state.selectedStyle = Number(row.dataset.index);
          } else if (state.mode === 'shapes') {
            state.selectedShape = Number(row.dataset.index);
          } else {
            state.selected = Number(row.dataset.index);
          }
          renderList();
          renderEditor();
        });
      }
    }

    function routeOptions(selectedRouteId) {
      return state.metadata.routes.map((route) => {
        const selected = route.id === selectedRouteId ? ' selected' : '';
        return '<option value="' + escapeHtml(route.id) + '"' + selected + '>' + escapeHtml(route.label) + '</option>';
      }).join('');
    }

    function renderEditor() {
      if (state.mode === 'simulator') {
        renderSimulator();
        return;
      }
      if (state.mode === 'routes') {
        renderRouteEditor();
        return;
      }
      if (state.mode === 'styles') {
        renderAnswerStyleEditor();
        return;
      }
      if (state.mode === 'shapes') {
        renderResponseShapeEditor();
        return;
      }
      const example = state.examples[state.selected];
      if (!example) {
        el('editor').innerHTML = '<div class="empty">Add a question to begin.</div>';
        return;
      }
      const route = routeById(example.routeId) || state.metadata.routes[0];

      el('editor').innerHTML = '<div class="form">' +
        '<div class="grid3">' +
          '<label>' + fieldLabel('ID', 'Unique row name for this example. It does not affect routing, but it must be unique.') + '<input id="field-id" value="' + escapeAttr(example.id || '') + '"></label>' +
          '<label>' + fieldLabel('Locale', 'Language of this example wording. Add real examples per language; do not mechanically translate every row.') + '<select id="field-locale">' + state.metadata.locales.map((locale) => '<option value="' + locale + '"' + (locale === (example.locale || 'en') ? ' selected' : '') + '>' + locale + '</option>').join('') + '</select></label>' +
          '<label>' + fieldLabel('Route', 'The bot capability this user wording should map to. The route decides tools and required data.') + '<select id="field-route">' + routeOptions(example.routeId) + '</select></label>' +
        '</div>' +
        '<label>' + fieldLabel('Question text', 'A realistic message a Telegram user might type.') + '<textarea id="field-text">' + escapeHtml(example.text || '') + '</textarea></label>' +
        '<label>' + fieldLabel('Notes', 'Optional human note for why this example maps to the selected route. Not used by runtime.') + '<textarea id="field-notes">' + escapeHtml(example.notes || '') + '</textarea></label>' +
      '</div>';

      bindEditor(example);
    }

    function renderSimulatorMessage(message) {
      const side = message.side === 'user' ? 'user' : 'bot';
      const meta = message.kind === 'edit' ? 'edited bot' : (side === 'user' ? 'you' : 'bot');
      const choices = Array.isArray(message.choices) && message.choices.length > 0
        ? '<div class="choice-list">' + message.choices.map((choice, index) => (
            '<div class="choice-pill">' + escapeHtml(String(index + 1)) + '. ' + escapeHtml(choice.title || choice.id) + ' <span class="hint">[' + escapeHtml(choice.id || '') + ']</span></div>'
          )).join('') + '</div>'
        : '';
      const link = message.kind === 'link' && message.url
        ? '<div class="choice-list"><a href="' + escapeAttr(message.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(message.label || message.url) + '</a></div>'
        : '';
      const hasImage = message.kind === 'image' && message.imageDataUrl;
      const image = hasImage
        ? '<div class="bubble-image-frame"><img class="bubble-image" src="' + escapeAttr(message.imageDataUrl) + '" alt="' + escapeAttr(message.filename || 'Generated chart') + '"></div>'
        : '';
      return '<div class="bubble ' + side + (hasImage ? ' has-image' : '') + '">' +
        '<div class="bubble-meta">' + escapeHtml(meta) + '</div>' +
        escapeHtml(message.text || '') +
        image +
        choices +
        link +
      '</div>';
    }

    function formatLogValue(value) {
      if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
      if (value && typeof value === 'object') return JSON.stringify(value);
      return value === null || value === undefined || value === '' ? 'none' : String(value);
    }

    function formatDuration(ms) {
      const value = Math.max(0, Number(ms || 0));
      if (value < 1000) return Math.round(value) + 'ms';
      if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 's';
      const minutes = Math.floor(value / 60000);
      const seconds = Math.round((value % 60000) / 1000);
      return minutes + 'm ' + seconds + 's';
    }

    function describeTimelineStep(step) {
      const label = String(step.label || '');
      if (label === 'bot edit' || label === 'bot text') return 'Message reached the chat';
      if (label.startsWith('Gemini progressive section:')) return 'AI generated one section';
      if (label === 'embedding route match') return 'Matched wording to a route';
      if (label === 'search indexed facts') return 'Fetched cached chart facts';
      if (label === 'Gemini fact answer rewrite') return 'AI rewrote facts into answer';
      if (label === 'hydrate simulator state') return 'Loaded local chat state';
      if (label === 'profile hydration' || label === 'load active profile' || label === 'resolve target profile') return 'Loaded user profile';
      if (label === 'ensure natal cache') return 'Checked chart cache';
      if (label === 'load monthly transit cache') return 'Checked transit cache';
      if (label === 'save conversation state') return 'Saved answer context';
      if (label === 'text handler') return 'Total backend handling time';
      if (label === 'indexed fact fast path') return 'Cached-fact answer path';
      return '';
    }

    function classifyTimelineStep(step) {
      const duration = Number(step.durationMs || 0);
      if (duration >= 10000) return ' timeline-slow';
      if (duration >= 1000) return ' timeline-medium';
      return '';
    }

    function buildTimingSummary(timeline, log) {
      const botDeliverySteps = timeline.filter((step) => step.label === 'bot edit' || step.label === 'bot text');
      const firstAnswer = botDeliverySteps.find((step) => Number(step.startMs || 0) > 20);
      const finalAnswer = botDeliverySteps[botDeliverySteps.length - 1];
      const slowest = timeline
        .filter((step) => Number(step.durationMs || 0) > 0 && step.label !== 'text handler' && step.label !== 'indexed fact fast path')
        .sort((left, right) => Number(right.durationMs || 0) - Number(left.durationMs || 0))[0];
      const cards = [
        ['First answer shown', firstAnswer ? formatDuration(firstAnswer.startMs) + ' after send' : 'not measured'],
        ['Full turn finished', formatDuration(log.durationMs || finalAnswer?.startMs || 0)],
        ['Slowest step', slowest ? formatDuration(slowest.durationMs) + ' · ' + slowest.label : 'none']
      ];
      return '<div class="timeline-summary">' + cards.map(([label, value]) => (
        '<div class="timeline-summary-card"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>'
      )).join('') + '</div>';
    }

    function renderSimulatorLog(log, index) {
      const route = log.route || {};
      const response = log.response || {};
      const stateAfter = log.state?.after || {};
      const tools = Array.isArray(log.tools) ? log.tools : [];
      const renderer = route.responseRenderer || null;
      const customInstructionRow = route.responseInstructions
        ? '<div class="log-item log-item-wide"><strong>Custom response instructions</strong>' + escapeHtml(formatLogValue(route.responseInstructions)) + '</div>'
        : '';
      const rendererRow = renderer
        ? '<div class="log-item"><strong>Runtime renderer</strong>' + escapeHtml(formatLogValue(renderer.id)) + '</div>'
        : '';
      const toolRows = tools.length
        ? tools.map((tool) => (
            '<div class="log-item"><strong>' + escapeHtml(tool.name || 'tool') + '</strong>' +
            'available: ' + escapeHtml(tool.available === undefined ? 'unknown' : String(tool.available)) +
            (tool.factCount ? ' · facts: ' + escapeHtml(tool.factCount) : '') +
            (tool.cacheMonth ? ' · month: ' + escapeHtml(tool.cacheMonth) : '') +
            '</div>'
          )).join('')
        : '<div class="hint">No tools recorded for this turn.</div>';
      const timeline = Array.isArray(log.timeline)
        ? [...log.timeline].sort((left, right) => Number(left.startMs || 0) - Number(right.startMs || 0))
        : [];
      const timelineRows = timeline.length
        ? buildTimingSummary(timeline, log) + '<div class="timeline">' +
          '<div class="timeline-row timeline-head"><strong>Step</strong><span>Shown at</span><span>Took</span></div>' +
          timeline.map((step) => {
            const detail = describeTimelineStep(step);
            return '<div class="timeline-row' + classifyTimelineStep(step) + '">' +
              '<strong title="' + escapeAttr(step.label || 'step') + '">' + escapeHtml(step.label || 'step') + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</strong>' +
              '<span>' + escapeHtml(formatDuration(step.startMs || 0)) + '</span>' +
              '<span>' + escapeHtml(formatDuration(step.durationMs || 0)) + '</span>' +
            '</div>';
          }).join('') + '</div>'
        : '<div class="hint">No timing steps recorded for this turn.</div>';
      return '<div class="log-card">' +
        '<div class="log-title"><span>' + escapeHtml(log.input || 'turn') + '</span><span>' + escapeHtml(formatDuration(log.durationMs || 0)) + '</span></div>' +
        '<div class="log-grid">' +
          '<div class="log-item"><strong>Route</strong>' + escapeHtml(formatLogValue(route.routeId)) + '</div>' +
          '<div class="log-item"><strong>Response type</strong>' + escapeHtml(formatLogValue(response.type || route.responseShape || route.answerStyle)) + '</div>' +
          '<div class="log-item"><strong>Answer style</strong>' + escapeHtml(formatLogValue(route.answerStyle || response.answerStyle)) + '</div>' +
          '<div class="log-item"><strong>Response shape</strong>' + escapeHtml(formatLogValue(route.responseShape || response.shape)) + '</div>' +
          rendererRow +
          '<div class="log-item"><strong>Card limit</strong>' + escapeHtml(formatLogValue(route.cardLimit)) + '</div>' +
          '<div class="log-item"><strong>Fact fetch limit</strong>' + escapeHtml(formatLogValue(route.factLimit)) + '</div>' +
          '<div class="log-item"><strong>MCP loading</strong>' + escapeHtml(formatLogValue(route.mcpLoadingMode)) + '</div>' +
          '<div class="log-item"><strong>Delivery mode</strong>' + escapeHtml(formatLogValue(route.deliveryMode)) + '</div>' +
          '<div class="log-item"><strong>Media attachments</strong>' + escapeHtml(formatLogValue(route.mediaAttachments)) + '</div>' +
          '<div class="log-item"><strong>Execution</strong>' + escapeHtml(formatLogValue(route.executionTarget)) + ' / ' + escapeHtml(formatLogValue(route.executionFamily)) + '</div>' +
          '<div class="log-item"><strong>Cache strategy</strong>' + escapeHtml(formatLogValue(route.cacheStrategy)) + '</div>' +
          '<div class="log-item"><strong>Source kinds</strong>' + escapeHtml(formatLogValue(route.sourceKinds)) + '</div>' +
          '<div class="log-item"><strong>Fact sources</strong>' + escapeHtml(formatLogValue(route.factSourceTools)) + '</div>' +
          '<div class="log-item"><strong>Fallback tools</strong>' + escapeHtml(formatLogValue((route.fallbackTools || []).map(formatToolTarget))) + '</div>' +
          customInstructionRow +
          '<div class="log-item"><strong>Bot output</strong>' + escapeHtml(formatLogValue(response.messageKinds)) + ' · ' + escapeHtml(formatLogValue(response.botMessageCount)) + ' bot messages</div>' +
          '<div class="log-item"><strong>Active flow</strong>' + escapeHtml(formatLogValue(stateAfter.activeFlow)) + '</div>' +
          '<div class="log-item"><strong>Profile</strong>' + escapeHtml(formatLogValue(stateAfter.activeProfileId)) + '</div>' +
          '<div class="log-item"><strong>Pending question</strong>' + escapeHtml(formatLogValue(stateAfter.pendingQuestion)) + '</div>' +
        '</div>' +
        '<details open><summary>Timing by step</summary>' + timelineRows + '</details>' +
        '<div class="log-tools">' + toolRows + '</div>' +
        (log.error ? '<div class="notice notice-warning">' + escapeHtml(log.error.message || 'Error') + '</div>' : '') +
        '<details><summary>Raw turn JSON</summary><div class="raw-json-toolbar"><button class="raw-json-copy" data-copy-log-index="' + escapeAttr(index) + '">Copy JSON</button></div><pre class="raw-json">' + escapeHtml(JSON.stringify(log, null, 2)) + '</pre></details>' +
      '</div>';
    }

    function renderLoadedSimulatorRoute() {
      const routeId = state.simulator.selectedRouteId;
      if (!routeId) {
        return '<div class="help-panel">' +
          '<div class="help-title">Load a route directly</div>' +
          '<div class="help-line">Choose a route to inspect its settings here, insert one of its example questions, or jump to the route editor.</div>' +
        '</div>';
      }
      const route = routeById(routeId);
      if (!route) {
        return '<div class="notice notice-warning">Selected route no longer exists.</div>';
      }
      const override = getEditableRouteOverride(route);
      const examples = examplesForRoute(route.id);
      const sample = examples[0]?.text || '';
      return '<div class="log-card loaded-route-card">' +
        '<div class="log-title"><span>Loaded route</span><span>' + escapeHtml(formatProductionStatus(override.productionStatus)) + '</span></div>' +
        '<div class="log-grid">' +
          '<div class="log-item"><strong>Route</strong>' + escapeHtml(route.id) + '</div>' +
          '<div class="log-item"><strong>Family</strong>' + escapeHtml(formatLogValue(route.expectedFamily)) + '</div>' +
          '<div class="log-item"><strong>Answer style</strong>' + escapeHtml(formatLogValue(override.answerStyle)) + '</div>' +
          '<div class="log-item"><strong>Response shape</strong>' + escapeHtml(formatLogValue(override.responseShape)) + '</div>' +
          '<div class="log-item"><strong>Data strategy</strong>' + escapeHtml(formatLogValue(override.cacheStrategy)) + '</div>' +
          '<div class="log-item"><strong>Delivery mode</strong>' + escapeHtml(formatLogValue(override.deliveryMode)) + '</div>' +
          '<div class="log-item"><strong>Facts to fetch</strong>' + escapeHtml(formatLogValue(override.factLimit)) + '</div>' +
          '<div class="log-item"><strong>Cards</strong>' + escapeHtml(formatLogValue(override.cardLimit)) + '</div>' +
          '<div class="log-item"><strong>Fallback tools</strong>' + escapeHtml(formatLogValue((override.toolTargets || []).map(formatToolTarget))) + '</div>' +
          '<div class="log-item"><strong>Examples</strong>' + escapeHtml(String(examples.length)) + '</div>' +
          (sample ? '<div class="log-item log-item-wide"><strong>First example</strong>' + escapeHtml(sample) + '</div>' : '<div class="log-item log-item-wide"><strong>First example</strong>none</div>') +
        '</div>' +
        '<div class="actions route-load-actions">' +
          '<button id="sim-use-route-example" ' + (sample ? '' : 'disabled') + '>Use first example</button>' +
          '<button id="sim-send-route-example" class="primary" ' + (sample && !state.simulator.busy ? '' : 'disabled') + '>Send first example</button>' +
          '<button id="sim-open-route">Open route editor</button>' +
        '</div>' +
      '</div>';
    }

    function renderSimulator() {
      const routeOptions = state.metadata.routes.map((route) => '<option value="' + escapeAttr(route.id) + '"' + (route.id === state.simulator.selectedRouteId ? ' selected' : '') + '>' + escapeHtml(route.id) + '</option>').join('');
      el('editor').innerHTML = '<div class="simulator">' +
        '<section class="phone">' +
          '<div class="phone-head"><div class="phone-title">Telegram Simulator</div><div class="phone-subtitle">Local browser chat · ' + escapeHtml(state.simulator.chatId) + '</div></div>' +
          '<div class="chat-feed" id="sim-chat-feed">' +
            (state.simulator.messages.length ? state.simulator.messages.map(renderSimulatorMessage).join('') : '<div class="empty">Send /start or type a user question.</div>') +
          '</div>' +
          '<div class="sim-input">' +
            '<div class="sim-shortcuts">' +
              '<button data-sim-shortcut="/start">/start</button>' +
              '<button data-sim-shortcut="/profile">/profile</button>' +
              '<button data-sim-shortcut="/billing">/billing</button>' +
              '<button data-sim-shortcut="/cancel">/cancel</button>' +
            '</div>' +
            '<div class="sim-input-row"><input id="sim-input" placeholder="Type a Telegram message" ' + (state.simulator.busy ? 'disabled' : '') + '><button id="sim-send" class="primary" ' + (state.simulator.busy ? 'disabled' : '') + '>Send</button></div>' +
          '</div>' +
        '</section>' +
        '<section class="logs-panel">' +
          '<div class="logs-head">' +
            '<div class="logs-head-row">' +
              '<label>' + fieldLabel('Simulator chat ID', 'Use the default isolated chat, or enter another local simulator chat id for testing.') + '<input id="sim-chat-id" value="' + escapeAttr(state.simulator.chatId) + '"></label>' +
              '<button id="sim-reset" class="danger">Reset</button>' +
            '</div>' +
            '<div class="logs-head-row">' +
              '<label>' + fieldLabel('Load route', 'Loads a route into the simulator side panel so you can inspect the route config and send one of its mapped example questions.') + '<select id="sim-route-picker"><option value="">Choose a route</option>' + routeOptions + '</select></label>' +
            '</div>' +
            '<div class="hint">Decision summary: route, cache, fallback tools, used tools, flow state, and duration.</div>' +
          '</div>' +
          renderLoadedSimulatorRoute() +
          '<div class="log-feed" id="sim-log-feed">' +
            (state.simulator.logs.length ? state.simulator.logs.map(renderSimulatorLog).join('') : '<div class="empty">Logs appear after each turn.</div>') +
          '</div>' +
        '</section>' +
      '</div>';
      bindSimulator();
      const feed = el('sim-chat-feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
    }

    function bindSimulator() {
      const sendCurrent = () => {
        const input = el('sim-input');
        sendSimulatorMessage(input.value).catch((error) => setStatus(error.message, true));
      };
      el('sim-send').addEventListener('click', sendCurrent);
      el('sim-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendCurrent();
        }
      });
      el('sim-chat-id').addEventListener('change', (event) => {
        state.simulator.chatId = event.target.value.trim() || 'browser-sim-local';
        fetchSimulatorState().catch((error) => setStatus(error.message, true));
      });
      el('sim-reset').addEventListener('click', () => {
        resetSimulatorChat().catch((error) => setStatus(error.message, true));
      });
      el('sim-route-picker').addEventListener('change', (event) => {
        state.simulator.selectedRouteId = event.target.value;
        renderEditor();
      });
      const selectedRoute = state.simulator.selectedRouteId ? routeById(state.simulator.selectedRouteId) : null;
      const selectedExample = selectedRoute ? examplesForRoute(selectedRoute.id)[0] : null;
      if (el('sim-use-route-example')) {
        el('sim-use-route-example').addEventListener('click', () => {
          if (!selectedExample) return;
          el('sim-input').value = selectedExample.text || '';
          el('sim-input').focus();
        });
      }
      if (el('sim-send-route-example')) {
        el('sim-send-route-example').addEventListener('click', () => {
          if (!selectedExample) return;
          sendSimulatorMessage(selectedExample.text || '').catch((error) => setStatus(error.message, true));
        });
      }
      if (el('sim-open-route')) {
        el('sim-open-route').addEventListener('click', () => {
          if (!selectedRoute) return;
          const index = state.metadata.routes.findIndex((route) => route.id === selectedRoute.id);
          state.selectedRoute = Math.max(0, index);
          setMode('routes');
        });
      }
      for (const button of document.querySelectorAll('[data-sim-shortcut]')) {
        button.addEventListener('click', () => {
          sendSimulatorMessage(button.dataset.simShortcut).catch((error) => setStatus(error.message, true));
        });
      }
      for (const button of document.querySelectorAll('[data-copy-log-index]')) {
        button.addEventListener('click', () => {
          copySimulatorLog(button).catch((error) => setStatus(error.message, true));
        });
      }
    }

    async function copySimulatorLog(button) {
      const index = Number(button.dataset.copyLogIndex);
      const log = state.simulator.logs[index];
      if (!log) {
        throw new Error('No raw JSON found for this log.');
      }
      const text = JSON.stringify(log, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      button.textContent = 'Copied';
      setStatus('Raw turn JSON copied', false);
      window.setTimeout(() => {
        button.textContent = 'Copy JSON';
      }, 1400);
    }

    async function fetchSimulatorState() {
      const result = await fetchJson('/api/simulator/state?chatId=' + encodeURIComponent(state.simulator.chatId));
      state.simulator.backendState = result.state || null;
      renderEditor();
    }

    async function saveRouteOverridesForSimulator() {
      if (!state.routeOverridesDirty) {
        return;
      }
      setStatus('Saving route overrides before simulator turn...', true);
      const result = await fetchJson('/api/route-overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routes: state.routeOverrides })
      });
      state.routeOverrides = result.routes || {};
      state.routeOverridesDirty = false;
    }

    async function sendSimulatorMessage(text) {
      const message = String(text || '').trim();
      if (!message || state.simulator.busy) return;
      state.simulator.busy = true;
      renderEditor();
      try {
        await saveRouteOverridesForSimulator();
        const response = await fetch('/api/simulator/message-stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatId: state.simulator.chatId, text: message })
        });
        if (!response.ok || !response.body) {
          throw new Error('Simulator request failed.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            handleSimulatorStreamEvent(line);
          }
        }
        if (buffer.trim()) {
          handleSimulatorStreamEvent(buffer);
        }
        setStatus('Simulator turn complete', false);
      } finally {
        state.simulator.busy = false;
        renderEditor();
      }
    }

    function handleSimulatorStreamEvent(line) {
      if (!String(line || '').trim()) {
        return;
      }
      const event = JSON.parse(line);
      if (event.type === 'message' && event.message) {
        state.simulator.messages.push(event.message);
        renderEditor();
        return;
      }
      if (event.type === 'delete_message' && event.messageRef) {
        state.simulator.messages = state.simulator.messages.filter((message) => (
          message?.messageRef?.messageId !== event.messageRef.messageId
        ));
        renderEditor();
        return;
      }
      if (event.type === 'log' && event.log) {
        state.simulator.logs.unshift(event.log);
        renderEditor();
        return;
      }
      if (event.type === 'done') {
        state.simulator.chatId = event.chatId || state.simulator.chatId;
        state.simulator.backendState = event.state || null;
        return;
      }
      if (event.type === 'error') {
        throw new Error(event.error?.message || 'Simulator stream failed.');
      }
    }

    async function resetSimulatorChat() {
      const result = await fetchJson('/api/simulator/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: state.simulator.chatId })
      });
      state.simulator.messages = [];
      state.simulator.logs = [];
      state.simulator.backendState = result.state || null;
      setStatus('Simulator reset', false);
      renderEditor();
    }

    function renderRouteEditor() {
      const route = state.metadata.routes[state.selectedRoute];
      if (!route) {
        el('editor').innerHTML = '<div class="empty">No route selected.</div>';
        return;
      }
      const override = getEditableRouteOverride(route);
      const mode = describeRouteMode(route, override);
      const cacheSourceLine = mode.usesIndexedFacts
        ? '<div class="hint cache-source"><strong>Cache built from:</strong> ' + escapeHtml(formatCacheBuiltFrom(route, override)) + '</div>'
        : '';
      const expectsToolFallback = ['indexed_natal_then_tool', 'indexed_transits_then_tool', 'cached_plus_tool'].includes(override.cacheStrategy);
      const hasSelectedTool = Array.isArray(override.toolTargets) && override.toolTargets.length > 0;
      const missingFallbackToolNotice = expectsToolFallback && !hasSelectedTool
        ? '<div class="notice notice-warning">No fallback tool is selected. This route will answer from cached facts only. That is fastest and fine when the index has the needed facts; add a tool only if missing data should be calculated instead of falling back to a generic answer.</div>'
        : '';
      const lockedSourceKinds = getLockedSourceKindsForStrategy(override.cacheStrategy);
      const sourceKindControl = lockedSourceKinds.length > 0
        ? '<label class="readonly">' + fieldLabel('Source kind', 'Chosen automatically by Data strategy so editors do not need to set it twice.') + '<div class="chips">' + renderStaticChips(lockedSourceKinds) + '</div><div class="hint">Chosen by Data strategy.</div></label>'
        : '<label class="editable">' + fieldLabel('Source kinds', 'Which indexed fact stores this route searches: natal chart facts, current monthly transit facts, or both.') + '<select id="route-source-kind-picker"><option value="">Add source kind</option>' + state.metadata.sourceKindOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.sourceKinds, 'route-source-kind') + '</div></label>';
      const cachedFactControls = mode.usesIndexedFacts
        ? '<details class="inline-advanced">' +
            '<summary>Advanced cached fact filters</summary>' +
            '<div class="inline-advanced-body">' +
              '<div class="hint">These filters decide which indexed facts are searched before any fallback tool is used. Most routes can leave them as configured.</div>' +
              '<div class="grid3">' +
                sourceKindControl +
                '<label class="editable">' + fieldLabel('Fact sources', 'Optional source tool filter for indexed facts. Leave empty to allow any indexed source, or choose natal calculation facts, natal insight facts, or transit insight facts explicitly.') + '<select id="route-fact-source-tool-picker"><option value="">Add fact source</option>' + state.metadata.factSourceToolOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.factSourceTools, 'route-fact-source-tool') + '</div></label>' +
                '<label class="editable">' + fieldLabel('Categories', 'Broad fact-index categories used to narrow cached fact search. Leave empty for broad search.') + '<select id="route-category-picker"><option value="">Add category</option>' + state.metadata.categoryOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.categories, 'route-category') + '</div></label>' +
                '<label class="editable">' + fieldLabel('Tags', 'Exact-ish fact-index tags used to target planets, houses, angles, topics, or timing.') + '<select id="route-tag-picker"><option value="">Add tag</option>' + state.metadata.tagOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.tags, 'route-tag') + '</div></label>' +
              '</div>' +
            '</div>' +
          '</details>'
        : '<div class="help-panel">' +
            '<div class="help-title">Cached fact filters are not used here</div>' +
            '<div class="help-line">This route is tool-only, so Source kinds, Categories, and Tags do not apply. The selected tool and required args decide what data is fetched.</div>' +
          '</div>';
      const displayedResponseInstructions = override.responseInstructions || '';
      const customResponseInstructionsActive = Boolean(state.routeOverrides[route.id]?.responseInstructions || route.responseInstructions);
      const validationPanel = renderRouteValidationPanel(route);
      const renderer = route.responseRenderer || null;
      const rendererPanel = renderer
        ? '<div class="help-panel">' +
            '<div class="help-title">Runtime renderer: ' + escapeHtml(renderer.id) + '</div>' +
            '<div class="help-line">' + escapeHtml(renderer.description || 'This route has a special deterministic renderer before generic AI fallback.') + '</div>' +
            '<div class="help-line">Editing the route instructions below can override the final wording after the tool result is formatted.</div>' +
          '</div>'
        : '<div class="hint">This route uses the selected response shape without a special deterministic renderer.</div>';
      const customInstructionsNotice = customResponseInstructionsActive
        ? '<div class="notice">Custom response instructions are active for this route and will be shown in simulator logs.</div>'
        : '';
      const productionStatusPanel = '<div class="step">' +
          '<div class="step-head">Production flag <span class="step-note">manual</span></div>' +
          '<div class="hint">This is the only production status shown in the route list. The checklist below is advisory and will not change this flag automatically.</div>' +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Route status', 'Manual production flag. Use the checklist and simulator to decide this, then set it yourself.') + '<select id="route-production-status">' + optionList(state.metadata.productionStatuses || ['unreviewed', 'needs_work', 'check', 'ready'], override.productionStatus, formatProductionStatus) + '</select></label>' +
            '<label class="editable">' + fieldLabel('Production notes', 'Optional notes about what still needs testing or why this route is considered ready.') + '<textarea id="route-production-notes">' + escapeHtml(override.productionNotes || '') + '</textarea></label>' +
          '</div>' +
        '</div>';
      const cardLimitControl = override.responseShape === 'factual_cards'
        ? '<label class="editable">' + fieldLabel('Number of cards', 'How many grounded fact cards this route should try to use. Runtime caps this between 1 and 12.') + '<input id="route-card-limit" type="number" min="1" max="12" step="1" value="' + escapeAttr(override.cardLimit || 5) + '"></label>'
        : '<label class="readonly">' + fieldLabel('Number of cards', 'Only factual_cards routes use this setting.') + '<input value="Not used by this shape" disabled></label>';
      const factLimitControl = mode.usesIndexedFacts
        ? '<label class="editable">' + fieldLabel('Facts to fetch', 'How many cached facts this route can inspect before writing. This is internal context, not the number of visible cards. Runtime caps this between 1 and 30.') + '<input id="route-fact-limit" type="number" min="1" max="30" step="1" value="' + escapeAttr(override.factLimit || defaultFactLimitForRoute(override)) + '"></label>'
        : '<label class="readonly">' + fieldLabel('Facts to fetch', 'Only indexed-fact routes use this setting.') + '<input value="Not used by this route" disabled></label>';
      const responseShapeControls = '<div class="step-subpanel">' +
          '<div class="help-title">Route response instructions</div>' +
          '<div class="grid3">' +
            cardLimitControl +
            factLimitControl +
            '<label class="editable">' + fieldLabel('Custom response instructions', 'Optional route-specific instructions. Use only when this route needs wording, headings, order, or card/list structure different from the selected response shape.') + '<textarea id="route-response-instructions">' + escapeHtml(displayedResponseInstructions) + '</textarea></label>' +
          '</div>' +
          '<div class="hint">Leave empty to use the selected response shape defaults. Editing this field saves route-specific instructions.</div>' +
          customInstructionsNotice +
        '</div>';
      el('editor').innerHTML = '<div class="form">' +
        '<div class="step">' +
          '<div class="step-head">1. Identify the route <span class="step-note">stable ID, editable name</span></div>' +
          '<div class="grid2">' +
            '<label class="readonly">' + fieldLabel('Route ID', 'Stable capability name. Question examples should map to this ID.') + '<input value="' + escapeAttr(route.id) + '" disabled></label>' +
            '<label class="editable">' + fieldLabel('Route name', 'Human-friendly name shown in this editor. The stable route ID stays unchanged for routing and embeddings.') + '<input id="route-display-name" value="' + escapeAttr(override.displayName || '') + '" placeholder="' + escapeAttr(route.id) + '"></label>' +
            '<label class="readonly">' + fieldLabel('Answer source', 'Plain-language description of where this route gets its answer data.') + '<input value="' + escapeAttr(formatExpectedFamily(route.expectedFamily)) + '" disabled></label>' +
          '</div>' +
        '</div>' +
        validationPanel +
        productionStatusPanel +
        '<div class="step">' +
          '<div class="step-head">2. Choose how data is gathered <span class="step-note">' + escapeHtml(mode.title) + '</span></div>' +
          '<div class="help-line">' + escapeHtml(mode.description) + '</div>' +
          cacheSourceLine +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Data strategy', 'Choose whether the route uses cached facts, tool output, or both.') + '<select id="route-cache-strategy">' + optionList(state.metadata.cacheStrategies, override.cacheStrategy, formatCacheStrategy) + '</select></label>' +
            '<label class="editable">' + fieldLabel('MCP loading', 'Controls when the bot loads the external MCP tool list. For cached-fact routes, after fast path is usually fastest because MCP loads only if cached facts fail.') + '<select id="route-mcp-loading-mode">' + optionList(state.metadata.mcpLoadingModes || ['auto', 'before_fast_path', 'after_fast_path', 'never'], override.mcpLoadingMode, formatMcpLoadingMode) + '</select></label>' +
          '</div>' +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Fallback tools', 'External/local tools this route may call while answering. Labels show the product capability and endpoint when the route uses a wrapped REST endpoint; the saved value remains the internal runtime tool name.') + '<select id="route-tool-picker"><option value="">Add fallback tool only if needed</option>' + state.metadata.tools.map((tool) => '<option value="' + escapeAttr(tool) + '">' + escapeHtml(formatToolTarget(tool)) + '</option>').join('') + '</select><div class="chips" id="route-tool-chips">' + renderToolChips(override.toolTargets) + '</div><div class="hint">' + escapeHtml(mode.toolHint) + ' Cache-builder endpoints are not fallback tools.</div></label>' +
          '</div>' +
          missingFallbackToolNotice +
          cachedFactControls +
        '</div>' +
        '<div class="step">' +
          '<div class="step-head">3. Confirm needed user data <span class="step-note">editable</span></div>' +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Required args', 'Data the bot must have before this route can answer, such as profile, secondaryProfile, city, range, or sign.') + '<select id="route-required-picker"><option value="">Add required arg</option>' + state.metadata.requiredDataOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.requiredArgs, 'route-required') + '</div></label>' +
            '<label class="editable">' + fieldLabel('Optional args', 'Helpful extra data if available, but not required before answering.') + '<select id="route-optional-picker"><option value="">Add optional arg</option>' + state.metadata.requiredDataOptions.map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(item) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.optionalArgs, 'route-optional') + '</div></label>' +
          '</div>' +
        '</div>' +
        '<div class="step">' +
          '<div class="step-head">4. Shape the answer <span class="step-note">editable</span></div>' +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Answer style', 'Controls the focus/tone of the answer, like natal_theme, planet_focus, personal_transits, or synastry.') + '<select id="route-answer-style">' + optionList(getAnswerStyleOptions(), override.answerStyle) + '</select></label>' +
            '<label class="editable">' + fieldLabel('Response shape', 'Controls the structural format of the answer. Some shapes map to deterministic renderers; custom shapes add instructions to AI-rendered answers.') + '<select id="route-response-shape">' + optionList(getResponseShapeOptions(), override.responseShape) + '</select></label>' +
            '<label class="editable">' + fieldLabel('Delivery mode', 'Standard sends the final answer normally. Separate card sections splits the final answer after generation. Generate each section live creates and sends each factual-card section one after another.') + '<select id="route-delivery-mode">' + optionList(state.metadata.deliveryModes || ['standard', 'progressive_sections', 'progressive_generate_sections'], override.deliveryMode, formatDeliveryMode) + '</select></label>' +
            '<label class="editable">' + fieldLabel('Media attachments', 'Optional images sent with the answer. Natal chart PNG uses /api/v1/natal/chart/. Ephemeris month PNG turns returned ephemeris rows into a Telegram-friendly table image. Natal aspects PNG turns the aspect listing into an image.') + '<select id="route-media-picker"><option value="">Add media attachment</option>' + (state.metadata.mediaAttachmentOptions || []).map((item) => '<option value="' + escapeAttr(item) + '">' + escapeHtml(formatMediaAttachment(item)) + '</option>').join('') + '</select><div class="chips">' + renderChips(override.mediaAttachments, 'route-media') + '</div></label>' +
          '</div>' +
          rendererPanel +
          responseShapeControls +
        '</div>' +
        '<div class="step">' +
          '<div class="step-head">5. Conversation behavior <span class="step-note">editable</span></div>' +
          '<div class="grid2">' +
            '<label class="editable">' + fieldLabel('Follow-up behavior', 'Controls whether this route should answer as a fresh standalone question or can inherit the previous topic.') + '<select id="route-follow-up-policy">' + optionList(state.metadata.followUpPolicies || ['auto', 'contextual', 'standalone'], override.followUpPolicy, formatFollowUpPolicy) + '</select><div class="hint">Standalone means examples for this route should not be treated as follow-ups to the previous answer.</div></label>' +
            '<label class="editable">' + fieldLabel('Blocked wording', 'Words or phrases this route should avoid in generated answers. One phrase per line.') + '<textarea id="route-blocked-phrases">' + escapeHtml((override.blockedPhrases || []).join('\\n')) + '</textarea></label>' +
          '</div>' +
        '</div>' +
        '<details class="advanced">' +
          '<summary>Advanced: router note <span class="step-note">' + (override.matchHint ? 'has note' : 'optional') + '</span></summary>' +
          '<div class="advanced-body">' +
            '<div class="hint">Usually leave this blank. The fast path should be question examples to vector match to route. Use this only when this route is easy to confuse with another route or when fallback LLM routing needs a warning.</div>' +
            '<label class="editable">' + fieldLabel('Advanced routing note', 'Optional fallback guidance. This is not the primary way the route is selected; examples and embeddings should do that.') + '<textarea id="route-match-hint">' + escapeHtml(override.matchHint || '') + '</textarea></label>' +
          '</div>' +
        '</details>' +
        '<div class="actions"><button id="reset-route-override" class="danger">Reset route override</button></div>' +
      '</div>';
      bindRouteEditor(route);
    }

    function renderAnswerStyleEditor() {
      const styleId = getAnswerStyleOptions()[state.selectedStyle];
      if (!styleId) {
        el('editor').innerHTML = '<div class="empty">No answer style selected.</div>';
        return;
      }
      const style = getEditableAnswerStyle(styleId);
      const routeIds = routesForAnswerStyle(styleId).map((route) => route.id).join(', ') || 'none';
      const isBuiltIn = (state.metadata.builtInAnswerStyles || []).includes(styleId);
      el('editor').innerHTML = '<div class="form">' +
        '<div class="help-panel">' +
          '<div class="help-title">How answer styles work</div>' +
          '<div class="help-line">Routes choose an answer style. This tab edits the guidance used by the bot when that style rewrites indexed-fact answers.</div>' +
          '<div class="help-line">Use short, concrete instructions. Do not put route-specific tool rules here; those belong in Routes.</div>' +
        '</div>' +
        '<div class="grid2">' +
          '<label>' + fieldLabel('Answer style ID', 'Stable lowercase key used by routes. Built-in IDs cannot be renamed; custom IDs are added with the Add style button.') + '<input value="' + escapeAttr(style.id) + '" disabled></label>' +
          '<label>' + fieldLabel('Routes using this style', 'Routes currently configured to use this answer style.') + '<input value="' + escapeAttr(routeIds) + '" disabled></label>' +
        '</div>' +
        '<label>' + fieldLabel('Description', 'Human explanation shown in this editor. Also useful for documenting what the style is for.') + '<textarea id="style-description">' + escapeHtml(style.description || '') + '</textarea></label>' +
        '<label>' + fieldLabel('Instructions', 'One instruction per line. These lines are added to the Gemini rewrite prompt for this answer style.') + '<textarea id="style-instructions">' + escapeHtml((style.instructions || []).join('\\n')) + '</textarea></label>' +
        '<div class="actions"><button id="reset-style-override" class="danger">' + (isBuiltIn ? 'Reset answer style override' : 'Delete custom answer style') + '</button></div>' +
      '</div>';
      bindAnswerStyleEditor(styleId);
    }

    function renderResponseShapeEditor() {
      const shapeId = getResponseShapeOptions()[state.selectedShape];
      if (!shapeId) {
        el('editor').innerHTML = '<div class="empty">No response shape selected.</div>';
        return;
      }
      const shape = getEditableResponseShape(shapeId);
      const routeIds = routesForResponseShape(shapeId).map((route) => route.id).join(', ') || 'none';
      const isBuiltIn = Boolean(state.metadata.responseShapeDefinitions[shapeId]);
      el('editor').innerHTML = '<div class="form">' +
        '<div class="help-panel">' +
          '<div class="help-title">How response shapes work</div>' +
          '<div class="help-line">Routes choose a response shape to describe the structure of the answer, such as synthesis, factual cards, or a full listing.</div>' +
          '<div class="help-line">Some response shapes are backed by deterministic runtime renderers. Custom shape instructions are used by indexed-fact rewrites and generic tool-result interpretation; route-specific instructions can also rewrite deterministic renderer output.</div>' +
        '</div>' +
        '<div class="grid2">' +
          '<label>' + fieldLabel('Response shape ID', 'Stable lowercase key used by routes. Built-in IDs cannot be renamed; custom IDs are added with the Add shape button.') + '<input value="' + escapeAttr(shape.id) + '" disabled></label>' +
          '<label>' + fieldLabel('Routes using this shape', 'Routes currently configured to use this response shape.') + '<input value="' + escapeAttr(routeIds) + '" disabled></label>' +
        '</div>' +
        '<label>' + fieldLabel('Description', 'Human explanation shown in this editor. Use it to document when this shape should be selected.') + '<textarea id="shape-description">' + escapeHtml(shape.description || '') + '</textarea></label>' +
        '<label>' + fieldLabel('Instructions', 'One instruction per line. These document the intended structure for this response shape.') + '<textarea id="shape-instructions">' + escapeHtml((shape.instructions || []).join('\\n')) + '</textarea></label>' +
        '<div class="actions"><button id="reset-shape-override" class="danger">' + (isBuiltIn ? 'Reset response shape override' : 'Delete custom response shape') + '</button></div>' +
      '</div>';
      bindResponseShapeEditor(shapeId);
    }

    function fieldLabel(label, help) {
      return '<span class="label-head">' + escapeHtml(label) + infoIcon(help) + '</span>';
    }

    function infoIcon(help) {
      return '<button type="button" class="info-icon" data-help="' + escapeAttr(help || '') + '" title="' + escapeAttr(help || '') + '" aria-label="Open help">?</button>';
    }

    function renderChips(values, type) {
      return [...new Set(values || [])].filter(Boolean).map((value) => (
        '<span class="chip">' + escapeHtml(value) + '<button data-chip-type="' + type + '" data-chip-value="' + escapeAttr(value) + '" title="Remove">x</button></span>'
      )).join('');
    }

    function renderToolChips(values) {
      return [...new Set(values || [])].filter(Boolean).map((value) => (
        '<span class="chip">' + escapeHtml(formatToolTarget(value)) + '<button data-chip-type="route-tool" data-chip-value="' + escapeAttr(value) + '" title="Remove">x</button></span>'
      )).join('');
    }

    function renderStaticChips(values) {
      return [...new Set(values || [])].filter(Boolean).map((value) => (
        '<span class="chip">' + escapeHtml(value) + '</span>'
      )).join('');
    }

    function optionList(options, selectedValue, labelFormatter = null) {
      return (options || []).map((value) => (
        '<option value="' + escapeAttr(value) + '"' + (value === selectedValue ? ' selected' : '') + '>' + escapeHtml(labelFormatter ? labelFormatter(value) : value) + '</option>'
      )).join('');
    }

    function formatToolTarget(toolName) {
      const meta = state.metadata.toolDisplay?.[toolName] || null;
      if (!meta) return toolName;
      return meta.endpoint ? meta.label + ' · ' + meta.endpoint : meta.label;
    }

    function formatRouteName(route) {
      return route?.displayName || route?.label || route?.id || '';
    }

    function isMcpToolTargetForUi(toolName) {
      return (state.metadata.mcpToolTargets || []).includes(toolName);
    }

    function formatExpectedFamily(family) {
      const labels = {
        indexed_natal: 'Uses cached natal/chart facts',
        indexed_monthly_transits: 'Uses cached current-month transit facts',
        mcp_transits: 'Uses FreeAstro transit tools',
        mcp_synastry: 'Uses FreeAstro synastry tools',
        mcp_relocation: 'Uses FreeAstro relocation tools',
        mcp_progressions: 'Uses FreeAstro progressions, profections, and returns tools',
        mcp_ephemeris: 'Uses FreeAstro ephemeris endpoint',
        mcp_horoscope: 'Uses FreeAstro horoscope tools',
        mcp_electional: 'Uses FreeAstro electional timing tools'
      };
      return labels[family] || family || 'Automatic';
    }

    function formatCacheStrategy(strategy) {
      const labels = {
        none: 'No cache lookup',
        indexed_natal_then_tool: 'Birth chart cache first, tool if missing',
        indexed_transits_then_tool: 'Transit cache first, tool if missing',
        cached_plus_tool: 'Use cache and tool together',
        tool_only: 'Tool only, skip cache'
      };
      return labels[strategy] || strategy || 'No cache rule';
    }

    function formatMcpLoadingMode(mode) {
      const labels = {
        auto: 'Auto: lazy for cached routes',
        before_fast_path: 'Load before cached facts',
        after_fast_path: 'Load only if cached facts fail',
        never: 'Never load MCP tools'
      };
      return labels[mode] || mode || 'Auto';
    }

    function formatDeliveryMode(mode) {
      const labels = {
        standard: 'Standard answer',
        progressive_sections: 'Separate card sections',
        progressive_generate_sections: 'Generate each section live'
      };
      return labels[mode] || mode || 'Standard answer';
    }

    function formatMediaAttachment(value) {
      const labels = {
        natal_chart_png: 'Natal chart PNG',
        ephemeris_month_png: 'Ephemeris month PNG',
        natal_aspects_png: 'Natal aspects PNG'
      };
      return labels[value] || value || 'No media';
    }

    function formatFollowUpPolicy(policy) {
      const labels = {
        auto: 'Auto',
        contextual: 'Can inherit previous topic',
        standalone: 'Always fresh standalone question'
      };
      return labels[policy] || policy || 'Auto';
    }

    function getLockedSourceKindsForStrategy(cacheStrategy) {
      if (cacheStrategy === 'indexed_natal_then_tool') {
        return ['natal'];
      }
      if (cacheStrategy === 'indexed_transits_then_tool') {
        return ['monthly_transit'];
      }
      return [];
    }

    function inferRouteSourceKinds(route, override) {
      const locked = getLockedSourceKindsForStrategy(override.cacheStrategy);
      if (locked.length > 0) {
        return locked;
      }
      const explicit = Array.isArray(override.sourceKinds) && override.sourceKinds.length > 0
        ? override.sourceKinds
        : (Array.isArray(route.sourceKinds) ? route.sourceKinds : []);
      if (explicit.length > 0) {
        return [...new Set(explicit)];
      }
      if (override.cacheStrategy === 'indexed_transits_then_tool' || route.expectedFamily === 'indexed_monthly_transits') {
        return ['monthly_transit'];
      }
      if (override.cacheStrategy === 'indexed_natal_then_tool' || route.expectedFamily === 'indexed_natal') {
        return ['natal'];
      }
      return [];
    }

    function formatCacheBuiltFrom(route, override) {
      const sourceKinds = inferRouteSourceKinds(route, override);
      const parts = [];
      if (sourceKinds.includes('natal')) {
        parts.push('birth chart profile facts and natal insights (v1_natal_calculate, rest_western_natal_insights)');
      }
      if (sourceKinds.includes('monthly_transit')) {
        parts.push('current-month transit timeline and transit insights (v1_western_transits_timeline, rest_western_transits_insights)');
      }
      return parts.length > 0
        ? parts.join('; ')
        : 'the selected indexed fact source. Use Source kinds below to make this explicit.';
    }

    function describeRouteMode(route, override) {
      const cacheStrategy = override.cacheStrategy || route.cacheStrategy || 'none';
      const toolTargets = Array.isArray(override.toolTargets) ? override.toolTargets : (route.toolTargets || []);
      const hasTool = toolTargets.length > 0 || Boolean(route.toolTarget);
      const expectedFamily = route.expectedFamily || '';
      const usesIndexedFacts = cacheStrategy !== 'tool_only' && (
        expectedFamily.startsWith('indexed_') ||
        cacheStrategy.startsWith('indexed_') ||
        cacheStrategy === 'cached_plus_tool' ||
        (Array.isArray(override.sourceKinds) && override.sourceKinds.length > 0)
      );

      if (cacheStrategy === 'cached_plus_tool') {
        return {
          usesIndexedFacts: true,
          title: 'This route combines cached facts and tool output',
          description: 'The intended behavior is to search cached facts, call the tool, then answer from both. Use this for richer routes where natal context plus exact tool output matters.',
          toolHint: 'The first tool is the primary tool result to combine with cached facts.'
        };
      }

      if (cacheStrategy === 'tool_only' || (expectedFamily.startsWith('mcp_') && hasTool && !usesIndexedFacts)) {
        return {
          usesIndexedFacts: false,
          title: 'This route always uses a FreeAstro tool',
          description: formatExpectedFamily(expectedFamily) + '. It does not search cached indexed facts, so source kinds, categories, and tags are not needed.',
          toolHint: 'The first tool is the primary FreeAstro call used at runtime.'
        };
      }

      if (hasTool && cacheStrategy.startsWith('indexed_')) {
        return {
          usesIndexedFacts: true,
          title: 'This route tries cached facts first',
          description: formatCacheStrategy(cacheStrategy) + '. Source kinds, categories, and tags decide which cached facts are searched before tool fallback.',
          toolHint: 'The first tool is used only when cached facts are not enough.'
        };
      }

      return {
        usesIndexedFacts: true,
        title: 'This route uses cached indexed facts',
        description: 'Source kinds, categories, and tags decide which cached chart or transit facts are searched.',
        toolHint: 'Empty means this route uses cached indexed facts only.'
      };
    }

    function getEditableAnswerStyle(styleId) {
      const defaults = state.metadata.answerStyleDefinitions[styleId] || { id: styleId, description: '', instructions: [] };
      const saved = state.answerStyleOverrides[styleId] || {};
      return {
        id: styleId,
        description: saved.description !== undefined ? saved.description : defaults.description,
        instructions: Array.isArray(saved.instructions) ? saved.instructions : (defaults.instructions || [])
      };
    }

    function routesForAnswerStyle(styleId) {
      return state.metadata.routes.filter((route) => route.answerStyle === styleId);
    }

    function getAnswerStyleOptions() {
      return [...new Set([
        ...(state.metadata?.answerStyles || []),
        ...Object.keys(state.answerStyleOverrides || {})
      ])].sort();
    }

    function getResponseShapeOptions() {
      return [...new Set([
        ...(state.metadata?.responseShapes || []),
        ...Object.keys(state.responseShapeOverrides || {})
      ])].sort();
    }

    function defaultFactLimitForRoute(route = {}) {
      const cardLimit = Math.max(1, Math.min(Number(route.cardLimit || 5), 12));
      return Math.max(cardLimit, Math.min(Math.max(cardLimit * 3, 12), 30));
    }

    function getEditableResponseShape(shapeId) {
      const defaults = state.metadata.responseShapeDefinitions[shapeId] || { id: shapeId, description: '', instructions: [] };
      const saved = state.responseShapeOverrides[shapeId] || {};
      return {
        id: shapeId,
        description: saved.description !== undefined ? saved.description : defaults.description,
        instructions: Array.isArray(saved.instructions) ? saved.instructions : (defaults.instructions || [])
      };
    }

    function routesForResponseShape(shapeId) {
      return state.metadata.routes.filter((route) => (route.responseShape || 'synthesis') === shapeId);
    }

    function examplesForRoute(routeId) {
      return state.examples.filter((example) => example.routeId === routeId);
    }

    function getEditableRouteOverride(route) {
      const saved = state.routeOverrides[route.id] || {};
      const toolTargets = Array.isArray(saved.toolTargets)
        ? saved.toolTargets
        : (Array.isArray(route.toolTargets) && route.toolTargets.length > 0
            ? route.toolTargets
            : (route.toolTarget ? [route.toolTarget] : []));
      return {
        displayName: saved.displayName !== undefined ? saved.displayName : (route.displayName || ''),
        toolTargets,
        requiredArgs: Array.isArray(saved.requiredArgs) ? saved.requiredArgs : (route.requiredArgs || []),
        optionalArgs: Array.isArray(saved.optionalArgs) ? saved.optionalArgs : (route.optionalArgs || []),
        sourceKinds: Array.isArray(saved.sourceKinds) ? saved.sourceKinds : (route.sourceKinds || []),
        factSourceTools: Array.isArray(saved.factSourceTools) ? saved.factSourceTools : (route.factSourceTools || []),
        categories: Array.isArray(saved.categories) ? saved.categories : (route.categories || []),
        tags: Array.isArray(saved.tags) ? saved.tags : (route.tags || []),
        answerStyle: saved.answerStyle || route.answerStyle || getAnswerStyleOptions()[0],
        cacheStrategy: saved.cacheStrategy || route.cacheStrategy || 'none',
        responseShape: saved.responseShape || route.responseShape || 'synthesis',
        cardLimit: saved.cardLimit !== undefined ? saved.cardLimit : (route.cardLimit || 5),
        factLimit: saved.factLimit !== undefined ? saved.factLimit : (route.factLimit || defaultFactLimitForRoute({ ...route, cardLimit: saved.cardLimit || route.cardLimit || 5 })),
        responseInstructions: saved.responseInstructions !== undefined ? saved.responseInstructions : (route.responseInstructions || ''),
        mcpLoadingMode: saved.mcpLoadingMode || route.mcpLoadingMode || 'auto',
        deliveryMode: saved.deliveryMode || route.deliveryMode || 'standard',
        mediaAttachments: Array.isArray(saved.mediaAttachments) ? saved.mediaAttachments : (route.mediaAttachments || []),
        productionStatus: saved.productionStatus || route.productionStatus || 'unreviewed',
        productionNotes: saved.productionNotes !== undefined ? saved.productionNotes : (route.productionNotes || ''),
        followUpPolicy: saved.followUpPolicy || route.followUpPolicy || 'auto',
        blockedPhrases: Array.isArray(saved.blockedPhrases) ? saved.blockedPhrases : (route.blockedPhrases || []),
        matchHint: saved.matchHint !== undefined ? saved.matchHint : (route.matchHint || '')
      };
    }

    function bindEditor(example) {
      const update = (patch) => {
        Object.assign(example, patch);
        if (patch.routeId) {
          const route = routeById(patch.routeId);
          example.expectedFamily = route?.expectedFamily || example.expectedFamily;
          renderEditor();
        }
        markDirty();
      };
      el('field-id').addEventListener('input', (event) => update({ id: event.target.value }));
      el('field-locale').addEventListener('change', (event) => update({ locale: event.target.value }));
      el('field-route').addEventListener('change', (event) => update({ routeId: event.target.value }));
      el('field-text').addEventListener('input', (event) => update({ text: event.target.value }));
      el('field-notes').addEventListener('input', (event) => update({ notes: event.target.value }));
    }

    function setRouteOverride(routeId, patch) {
      state.routeOverrides[routeId] = {
        ...(state.routeOverrides[routeId] || {}),
        ...patch
      };
      state.routeOverridesDirty = true;
      markDirty();
      renderList();
    }

    function addRouteArrayValue(route, key, value) {
      if (!value) return;
      const current = getEditableRouteOverride(route)[key] || [];
      setRouteOverride(route.id, { [key]: [...new Set([...current, value])] });
      renderEditor();
    }

    function bindRouteEditor(route) {
      el('route-display-name').addEventListener('input', (event) => {
        setRouteOverride(route.id, { displayName: event.target.value });
      });
      el('route-production-status').addEventListener('change', (event) => {
        setRouteOverride(route.id, { productionStatus: event.target.value });
        renderEditor();
      });
      el('route-production-notes').addEventListener('input', (event) => {
        setRouteOverride(route.id, { productionNotes: event.target.value });
      });
      el('route-answer-style').addEventListener('change', (event) => setRouteOverride(route.id, { answerStyle: event.target.value }));
      el('route-cache-strategy').addEventListener('change', (event) => {
        const cacheStrategy = event.target.value;
        const patch = { cacheStrategy };
        const lockedSourceKinds = getLockedSourceKindsForStrategy(cacheStrategy);
        if (lockedSourceKinds.length > 0) {
          patch.sourceKinds = lockedSourceKinds;
        }
        if (cacheStrategy === 'tool_only') {
          patch.sourceKinds = [];
        }
        setRouteOverride(route.id, patch);
        renderEditor();
      });
      el('route-mcp-loading-mode').addEventListener('change', (event) => {
        setRouteOverride(route.id, { mcpLoadingMode: event.target.value });
      });
      el('route-response-shape').addEventListener('change', (event) => {
        setRouteOverride(route.id, { responseShape: event.target.value });
        renderEditor();
      });
      el('route-delivery-mode').addEventListener('change', (event) => {
        setRouteOverride(route.id, { deliveryMode: event.target.value });
      });
      el('route-media-picker').addEventListener('change', (event) => {
        addRouteArrayValue(route, 'mediaAttachments', event.target.value);
      });
      if (el('route-card-limit')) {
        el('route-card-limit').addEventListener('input', (event) => {
          const value = Math.max(1, Math.min(Number(event.target.value || 5), 12));
          setRouteOverride(route.id, { cardLimit: Math.round(value) });
        });
      }
      if (el('route-fact-limit')) {
        el('route-fact-limit').addEventListener('input', (event) => {
          const value = Math.max(1, Math.min(Number(event.target.value || 12), 30));
          setRouteOverride(route.id, { factLimit: Math.round(value) });
        });
      }
      if (el('route-response-instructions')) {
        el('route-response-instructions').addEventListener('input', (event) => {
          setRouteOverride(route.id, { responseInstructions: event.target.value });
        });
      }
      el('route-follow-up-policy').addEventListener('change', (event) => {
        setRouteOverride(route.id, { followUpPolicy: event.target.value });
      });
      el('route-blocked-phrases').addEventListener('input', (event) => {
        setRouteOverride(route.id, {
          blockedPhrases: event.target.value.split('\\n').map((line) => line.trim()).filter(Boolean)
        });
      });
      el('route-match-hint').addEventListener('input', (event) => setRouteOverride(route.id, { matchHint: event.target.value }));
      el('route-tool-picker').addEventListener('change', (event) => {
        addRouteArrayValue(route, 'toolTargets', event.target.value);
      });
      el('route-required-picker').addEventListener('change', (event) => {
        addRouteArrayValue(route, 'requiredArgs', event.target.value);
      });
      el('route-optional-picker').addEventListener('change', (event) => {
        addRouteArrayValue(route, 'optionalArgs', event.target.value);
      });
      if (el('route-source-kind-picker')) {
        el('route-source-kind-picker').addEventListener('change', (event) => {
          addRouteArrayValue(route, 'sourceKinds', event.target.value);
        });
      }
      if (el('route-fact-source-tool-picker')) {
        el('route-fact-source-tool-picker').addEventListener('change', (event) => {
          addRouteArrayValue(route, 'factSourceTools', event.target.value);
        });
      }
      if (el('route-category-picker')) {
        el('route-category-picker').addEventListener('change', (event) => {
          addRouteArrayValue(route, 'categories', event.target.value);
        });
      }
      if (el('route-tag-picker')) {
        el('route-tag-picker').addEventListener('change', (event) => {
          addRouteArrayValue(route, 'tags', event.target.value);
        });
      }
      el('reset-route-override').addEventListener('click', () => {
        delete state.routeOverrides[route.id];
        state.routeOverridesDirty = true;
        markDirty();
        renderList();
        renderEditor();
      });
      for (const button of document.querySelectorAll('[data-chip-type]')) {
        button.addEventListener('click', () => {
          const key = button.dataset.chipType === 'route-tool'
            ? 'toolTargets'
            : (
                button.dataset.chipType === 'route-required'
                  ? 'requiredArgs'
                  : (
                      button.dataset.chipType === 'route-optional'
                        ? 'optionalArgs'
                        : (
                            button.dataset.chipType === 'route-source-kind'
                              ? 'sourceKinds'
                              : (
                                  button.dataset.chipType === 'route-category'
                                    ? 'categories'
                                    : (
                                        button.dataset.chipType === 'route-fact-source-tool'
                                          ? 'factSourceTools'
                                          : (button.dataset.chipType === 'route-media' ? 'mediaAttachments' : 'tags')
                                      )
                                )
                          )
                    )
              );
          const current = getEditableRouteOverride(route)[key] || [];
          setRouteOverride(route.id, {
            [key]: current.filter((value) => value !== button.dataset.chipValue)
          });
          renderEditor();
        });
      }
    }

    function setAnswerStyleOverride(styleId, patch) {
      state.answerStyleOverrides[styleId] = {
        ...(state.answerStyleOverrides[styleId] || {}),
        ...patch
      };
      markDirty();
      renderList();
    }

    function bindAnswerStyleEditor(styleId) {
      el('style-description').addEventListener('input', (event) => {
        setAnswerStyleOverride(styleId, { description: event.target.value });
      });
      el('style-instructions').addEventListener('input', (event) => {
        setAnswerStyleOverride(styleId, {
          instructions: event.target.value.split('\\n').map((line) => line.trim()).filter(Boolean)
        });
      });
      el('reset-style-override').addEventListener('click', () => {
        delete state.answerStyleOverrides[styleId];
        state.selectedStyle = Math.min(state.selectedStyle, Math.max(0, getAnswerStyleOptions().length - 1));
        markDirty();
        renderList();
        renderEditor();
      });
    }

    function setResponseShapeOverride(shapeId, patch) {
      state.responseShapeOverrides[shapeId] = {
        ...(state.responseShapeOverrides[shapeId] || {}),
        ...patch
      };
      markDirty();
      renderList();
    }

    function bindResponseShapeEditor(shapeId) {
      el('shape-description').addEventListener('input', (event) => {
        setResponseShapeOverride(shapeId, { description: event.target.value });
      });
      el('shape-instructions').addEventListener('input', (event) => {
        setResponseShapeOverride(shapeId, {
          instructions: event.target.value.split('\\n').map((line) => line.trim()).filter(Boolean)
        });
      });
      el('reset-shape-override').addEventListener('click', () => {
        delete state.responseShapeOverrides[shapeId];
        state.selectedShape = Math.min(state.selectedShape, Math.max(0, getResponseShapeOptions().length - 1));
        markDirty();
        renderList();
        renderEditor();
      });
    }

    function addQuestion() {
      const route = state.metadata.routes[0];
      const nextNumber = state.examples.length + 1;
      state.examples.push({
        id: 'new_question_' + String(nextNumber).padStart(3, '0'),
        text: '',
        routeId: route.id,
        locale: 'en',
        expectedFamily: route.expectedFamily
      });
      state.selected = state.examples.length - 1;
      markDirty();
      renderList();
      renderEditor();
    }

    function addResponseShape() {
      const rawId = prompt('New response shape id (lowercase letters, numbers, underscores):');
      if (rawId === null) return;
      const id = rawId.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id)) {
        setStatus('Shape id must use lowercase letters, numbers, and underscores, and start with a letter.', true);
        return;
      }
      if (getResponseShapeOptions().includes(id)) {
        setStatus('Response shape already exists: ' + id, true);
        return;
      }
      state.responseShapeOverrides[id] = {
        description: '',
        instructions: []
      };
      state.selectedShape = getResponseShapeOptions().indexOf(id);
      markDirty();
      renderList();
      renderEditor();
    }

    function addAnswerStyle() {
      const rawId = prompt('New answer style id (lowercase letters, numbers, underscores):');
      if (rawId === null) return;
      const id = rawId.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id)) {
        setStatus('Answer style id must use lowercase letters, numbers, and underscores, and start with a letter.', true);
        return;
      }
      if (getAnswerStyleOptions().includes(id)) {
        setStatus('Answer style already exists: ' + id, true);
        return;
      }
      state.answerStyleOverrides[id] = {
        description: '',
        instructions: []
      };
      state.selectedStyle = getAnswerStyleOptions().indexOf(id);
      markDirty();
      renderList();
      renderEditor();
    }

    function duplicateQuestion() {
      const source = state.examples[state.selected];
      if (!source) return;
      const copy = JSON.parse(JSON.stringify(source));
      copy.id = source.id + '_copy';
      state.examples.splice(state.selected + 1, 0, copy);
      state.selected += 1;
      markDirty();
      renderList();
      renderEditor();
    }

    function deleteQuestion() {
      if (!state.examples[state.selected]) return;
      state.examples.splice(state.selected, 1);
      state.selected = Math.min(state.selected, Math.max(0, state.examples.length - 1));
      markDirty();
      renderList();
      renderEditor();
    }

    async function save() {
      setStatus('Saving...', true);
      if (state.mode === 'routes') {
        const result = await fetchJson('/api/route-overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ routes: state.routeOverrides })
        });
        state.routeOverrides = result.routes || {};
        state.routeOverridesDirty = false;
        state.dirty = false;
        await load();
        setStatus('Saved route overrides', false);
        return;
      }
      if (state.mode === 'styles') {
        const result = await fetchJson('/api/answer-style-overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ styles: state.answerStyleOverrides })
        });
        state.answerStyleOverrides = result.styles || {};
        state.dirty = false;
        await load();
        setStatus('Saved answer style overrides', false);
        return;
      }
      if (state.mode === 'shapes') {
        const result = await fetchJson('/api/response-shape-overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shapes: state.responseShapeOverrides })
        });
        state.responseShapeOverrides = result.shapes || {};
        state.dirty = false;
        await load();
        setStatus('Saved response shape overrides', false);
        return;
      }
      const result = await fetchJson('/api/examples', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ examples: state.examples })
      });
      state.examples = result.examples;
      state.dirty = false;
      renderList();
      renderEditor();
      setStatus('Saved ' + state.examples.length + ' rows', false);
    }

    function setPathForMode() {
      if (state.mode === 'routes') {
        el('path').textContent = state.metadata.routeOverridesPath;
        el('save').textContent = 'Save route overrides';
      } else if (state.mode === 'styles') {
        el('path').textContent = state.metadata.answerStyleOverridesPath;
        el('save').textContent = 'Save answer styles';
      } else if (state.mode === 'shapes') {
        el('path').textContent = state.metadata.responseShapeOverridesPath;
        el('save').textContent = 'Save response shapes';
      } else if (state.mode === 'simulator') {
        el('path').textContent = 'Local browser simulator';
        el('save').textContent = 'Save JSONL';
      } else {
        el('path').textContent = state.metadata.examplesPath;
        el('save').textContent = 'Save JSONL';
      }
      el('search').placeholder = state.mode === 'routes'
        ? 'Search routes, tools, families'
        : (state.mode === 'styles' ? 'Search answer styles' : (state.mode === 'shapes' ? 'Search response shapes' : 'Search questions, ids, routes'));
      const hideFilters = state.mode === 'styles' || state.mode === 'shapes' || state.mode === 'simulator';
      el('familyFilter').style.display = hideFilters ? 'none' : '';
      el('toolFilter').style.display = hideFilters ? 'none' : '';
      el('search').style.display = state.mode === 'simulator' ? 'none' : '';
      el('add').textContent = state.mode === 'styles'
        ? 'Add style'
        : (state.mode === 'shapes' ? 'Add shape' : 'Add question');
    }

    function setMode(mode) {
      state.mode = mode;
      el('tab-questions').className = mode === 'questions' ? 'tab active' : 'tab';
      el('tab-routes').className = mode === 'routes' ? 'tab active' : 'tab';
      el('tab-styles').className = mode === 'styles' ? 'tab active' : 'tab';
      el('tab-shapes').className = mode === 'shapes' ? 'tab active' : 'tab';
      el('tab-simulator').className = mode === 'simulator' ? 'tab active' : 'tab';
      el('main-layout').className = mode === 'simulator' ? 'layout simulator-mode' : 'layout';
      el('add').style.display = (mode === 'questions' || mode === 'styles' || mode === 'shapes') ? '' : 'none';
      el('duplicate').style.display = mode === 'questions' ? '' : 'none';
      el('delete').style.display = mode === 'questions' ? '' : 'none';
      el('save').style.display = mode === 'simulator' ? 'none' : '';
      setPathForMode();
      renderList();
      renderEditor();
    }

    function openHelpModal(help) {
      el('help-modal-title').textContent = 'What this means';
      el('help-modal-body').textContent = help || 'No help text is available for this field.';
      el('help-modal').classList.add('open');
    }

    function closeHelpModal() {
      el('help-modal').classList.remove('open');
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;');
    }

    el('add').addEventListener('click', () => {
      if (state.mode === 'styles') {
        addAnswerStyle();
      } else if (state.mode === 'shapes') {
        addResponseShape();
      } else {
        addQuestion();
      }
    });
    el('duplicate').addEventListener('click', duplicateQuestion);
    el('delete').addEventListener('click', deleteQuestion);
    el('reload').addEventListener('click', () => {
      if (!state.dirty || confirm('Discard unsaved changes and reload?')) {
        load().catch((error) => setStatus(error.message, true));
      }
    });
    el('save').addEventListener('click', () => save().catch((error) => setStatus(error.message, true)));
    el('tab-questions').addEventListener('click', () => setMode('questions'));
    el('tab-routes').addEventListener('click', () => setMode('routes'));
    el('tab-styles').addEventListener('click', () => setMode('styles'));
    el('tab-shapes').addEventListener('click', () => setMode('shapes'));
    el('tab-simulator').addEventListener('click', () => setMode('simulator'));
    el('help-modal-close').addEventListener('click', closeHelpModal);
    el('help-modal').addEventListener('click', (event) => {
      if (event.target === el('help-modal')) {
        closeHelpModal();
      }
    });
    document.addEventListener('click', (event) => {
      const infoButton = event.target.closest('.info-icon');
      if (!infoButton) return;
      event.preventDefault();
      openHelpModal(infoButton.dataset.help);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeHelpModal();
      }
    });
    el('search').addEventListener('input', renderList);
    el('familyFilter').addEventListener('change', renderList);
    el('toolFilter').addEventListener('change', renderList);
    window.addEventListener('beforeunload', (event) => {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    load().catch((error) => setStatus(error.message, true));
  </script>
</body>
</html>`;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && url.pathname === '/') {
      sendText(response, 200, buildHtml(), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/metadata') {
      sendJson(response, 200, buildMetadata());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/simulator/state') {
      const chatId = url.searchParams.get('chatId') || DEFAULT_SIMULATOR_CHAT_ID;
      sendJson(response, 200, { state: compactStateForSimulator(chatId) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/simulator/reset') {
      const body = await readRequestJson(request);
      const chatId = body.chatId || DEFAULT_SIMULATOR_CHAT_ID;
      sendJson(response, 200, { state: resetSimulator(chatId) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/simulator/message') {
      const body = await readRequestJson(request);
      const result = await dispatchSimulatorMessage(body.chatId || DEFAULT_SIMULATOR_CHAT_ID, body.text || '');
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/simulator/message-stream') {
      const body = await readRequestJson(request);
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const writeEvent = (payload) => {
        response.write(`${JSON.stringify(payload)}\n`);
      };
      try {
        const result = await dispatchSimulatorMessage(body.chatId || DEFAULT_SIMULATOR_CHAT_ID, body.text || '', {
          onMessage: (message) => writeEvent({ type: 'message', message }),
          onDeleteMessage: (messageRef) => writeEvent({ type: 'delete_message', messageRef }),
          onLog: (log) => writeEvent({ type: 'log', log })
        });
        writeEvent({
          type: 'done',
          chatId: result.chatId,
          state: result.state || null
        });
      } catch (error) {
        writeEvent({
          type: 'error',
          error: {
            message: error?.message || String(error)
          }
        });
      } finally {
        response.end();
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/routes') {
      sendJson(response, 200, { routes: getRouteOptions() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/route-overrides') {
      sendJson(response, 200, { routes: readRouteOverridesForEditor() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/route-overrides') {
      const body = await readRequestJson(request);
      const routes = writeRouteOverridesForEditor(body.routes || {});
      sendJson(response, 200, { routes });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/answer-style-overrides') {
      sendJson(response, 200, { styles: readAnswerStyleOverridesForEditor() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/answer-style-overrides') {
      const body = await readRequestJson(request);
      const styles = writeAnswerStyleOverridesForEditor(body.styles || {});
      sendJson(response, 200, { styles });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/response-shape-overrides') {
      sendJson(response, 200, { shapes: readResponseShapeOverridesForEditor() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/response-shape-overrides') {
      const body = await readRequestJson(request);
      const shapes = writeResponseShapeOverridesForEditor(body.shapes || {});
      sendJson(response, 200, { shapes });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/examples') {
      sendJson(response, 200, { examples: readRawExamples() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/examples') {
      const body = await readRequestJson(request);
      if (!Array.isArray(body.examples)) {
        throw new Error('Request must include an examples array.');
      }
      const examples = writeExamples(body.examples);
      sendJson(response, 200, { examples });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 400, { error: error?.message || String(error) });
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Routing editor: http://127.0.0.1:${PORT}\n`);
  process.stdout.write(`Questions: ${EXAMPLES_PATH}\n`);
  process.stdout.write(`Route overrides: ${OVERRIDES_PATH}\n`);
  process.stdout.write(`Answer style overrides: ${ANSWER_STYLE_OVERRIDES_PATH}\n`);
  process.stdout.write(`Response shape overrides: ${RESPONSE_SHAPE_OVERRIDES_PATH}\n`);
});
