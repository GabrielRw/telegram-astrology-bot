const fs = require('node:fs');
const path = require('node:path');
const { getAnswerStyleIds } = require('./answerStyleOverrides');
const { getResponseShapeIds } = require('./responseShapeOverrides');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ROUTE_OVERRIDES_PATH = path.join(REPO_ROOT, 'data', 'routing', 'route-overrides.json');

const ANSWER_STYLES = new Set([
  'natal_theme',
  'planet_focus',
  'house_focus',
  'aspect_focus',
  'life_area_theme',
  'current_sky',
  'personal_transits',
  'synastry',
  'system_answer'
]);

const CACHE_STRATEGIES = new Set([
  'none',
  'indexed_natal_then_tool',
  'indexed_transits_then_tool',
  'cached_plus_tool',
  'tool_only'
]);

const RESPONSE_SHAPES = new Set([
  'synthesis',
  'factual_cards',
  'full_listing'
]);
const FOLLOW_UP_POLICIES = new Set([
  'auto',
  'standalone',
  'contextual'
]);
const MCP_LOADING_MODES = new Set([
  'auto',
  'before_fast_path',
  'after_fast_path',
  'never'
]);
const DELIVERY_MODES = new Set([
  'standard',
  'progressive_sections',
  'progressive_generate_sections'
]);
const MEDIA_ATTACHMENTS = new Set([
  'natal_chart_png',
  'ephemeris_month_png',
  'natal_aspects_png'
]);
const PRODUCTION_STATUSES = new Set([
  'unreviewed',
  'needs_work',
  'check',
  'ready'
]);
const SOURCE_KINDS = new Set(['natal', 'monthly_transit']);
const MIN_CARD_LIMIT = 1;
const MAX_CARD_LIMIT = 12;
const MIN_FACT_LIMIT = 1;
const MAX_FACT_LIMIT = 30;
const LOCAL_TOOL_TARGETS = new Set([
  'search_cached_profile_facts',
  'get_cached_natal_summary',
  'get_cached_planet_placement',
  'get_cached_angle_info',
  'get_cached_house_info',
  'get_cached_monthly_transits',
  'get_profile_completeness',
  'rest_ephemeris',
  'rest_horoscope_daily_personal_text'
]);

function isMcpToolTarget(toolName) {
  const value = String(toolName || '').trim();
  if (!value || LOCAL_TOOL_TARGETS.has(value)) {
    return false;
  }
  return /^(?:mcp_|v\d+_)/.test(value);
}

function getAllowedResponseShapes() {
  return new Set(getResponseShapeIds());
}

function getAllowedAnswerStyles() {
  return new Set(getAnswerStyleIds());
}

function getRouteOverridesPath() {
  return path.resolve(process.env.ROUTE_OVERRIDES_PATH || DEFAULT_ROUTE_OVERRIDES_PATH);
}

function normalizeStringArray(value, fieldName, routeId) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Route override "${routeId}" field "${fieldName}" must be an array.`);
  }

  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
}

function readRouteOverrides(filePath = getRouteOverridesPath()) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, routes: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Route overrides must be a JSON object.');
  }

  return {
    version: Number(parsed.version || 1),
    routes: parsed.routes && typeof parsed.routes === 'object' && !Array.isArray(parsed.routes)
      ? parsed.routes
      : parsed
  };
}

function normalizeRouteOverride(routeId, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    throw new Error(`Route override "${routeId}" must be an object.`);
  }

  const normalized = {};
  const toolTargets = normalizeStringArray(
    override.toolTargets !== undefined
      ? override.toolTargets
      : (override.toolTarget ? [override.toolTarget] : undefined),
    'toolTargets',
    routeId
  );
  const requiredArgs = normalizeStringArray(override.requiredArgs, 'requiredArgs', routeId);
  const optionalArgs = normalizeStringArray(override.optionalArgs, 'optionalArgs', routeId);
  const sourceKinds = normalizeStringArray(override.sourceKinds, 'sourceKinds', routeId);
  const factSourceTools = normalizeStringArray(override.factSourceTools, 'factSourceTools', routeId);
  const categories = normalizeStringArray(override.categories, 'categories', routeId);
  const tags = normalizeStringArray(override.tags, 'tags', routeId);
  const blockedPhrases = normalizeStringArray(override.blockedPhrases, 'blockedPhrases', routeId);
  const mediaAttachments = normalizeStringArray(override.mediaAttachments, 'mediaAttachments', routeId);

  if (toolTargets !== undefined) {
    normalized.toolTargets = toolTargets;
    normalized.toolTarget = toolTargets[0] || null;
  }
  if (requiredArgs !== undefined) {
    normalized.requiredArgs = requiredArgs;
  }
  if (optionalArgs !== undefined) {
    normalized.optionalArgs = optionalArgs;
  }
  if (sourceKinds !== undefined) {
    const invalidSourceKind = sourceKinds.find((sourceKind) => !SOURCE_KINDS.has(sourceKind));
    if (invalidSourceKind) {
      throw new Error(`Route override "${routeId}" has invalid sourceKind "${invalidSourceKind}".`);
    }
    normalized.sourceKinds = sourceKinds;
  }
  if (factSourceTools !== undefined) {
    normalized.factSourceTools = factSourceTools;
  }
  if (categories !== undefined) {
    normalized.categories = categories;
  }
  if (tags !== undefined) {
    normalized.tags = tags;
  }
  if (blockedPhrases !== undefined) {
    normalized.blockedPhrases = blockedPhrases;
  }
  if (mediaAttachments !== undefined) {
    const invalidAttachment = mediaAttachments.find((attachment) => !MEDIA_ATTACHMENTS.has(attachment));
    if (invalidAttachment) {
      throw new Error(`Route override "${routeId}" has invalid mediaAttachment "${invalidAttachment}".`);
    }
    normalized.mediaAttachments = mediaAttachments;
  }

  if (override.answerStyle !== undefined) {
    const answerStyle = String(override.answerStyle || '').trim();
    if (!getAllowedAnswerStyles().has(answerStyle)) {
      throw new Error(`Route override "${routeId}" has invalid answerStyle "${answerStyle}".`);
    }
    normalized.answerStyle = answerStyle;
  }

  if (override.displayName !== undefined) {
    normalized.displayName = String(override.displayName || '').trim() || null;
  }

  if (override.cacheStrategy !== undefined) {
    const cacheStrategy = String(override.cacheStrategy || '').trim();
    if (!CACHE_STRATEGIES.has(cacheStrategy)) {
      throw new Error(`Route override "${routeId}" has invalid cacheStrategy "${cacheStrategy}".`);
    }
    normalized.cacheStrategy = cacheStrategy;
  }

  if (override.responseShape !== undefined) {
    const responseShape = String(override.responseShape || '').trim();
    if (!getAllowedResponseShapes().has(responseShape)) {
      throw new Error(`Route override "${routeId}" has invalid responseShape "${responseShape}".`);
    }
    normalized.responseShape = responseShape;
  }

  if (override.cardLimit !== undefined) {
    const cardLimit = Number(override.cardLimit);
    if (!Number.isFinite(cardLimit) || cardLimit < MIN_CARD_LIMIT || cardLimit > MAX_CARD_LIMIT) {
      throw new Error(`Route override "${routeId}" field "cardLimit" must be a number from ${MIN_CARD_LIMIT} to ${MAX_CARD_LIMIT}.`);
    }
    normalized.cardLimit = Math.round(cardLimit);
  }

  if (override.factLimit !== undefined) {
    const factLimit = Number(override.factLimit);
    if (!Number.isFinite(factLimit) || factLimit < MIN_FACT_LIMIT || factLimit > MAX_FACT_LIMIT) {
      throw new Error(`Route override "${routeId}" field "factLimit" must be a number from ${MIN_FACT_LIMIT} to ${MAX_FACT_LIMIT}.`);
    }
    normalized.factLimit = Math.round(factLimit);
  }

  if (override.responseInstructions !== undefined) {
    normalized.responseInstructions = String(override.responseInstructions || '').trim() || null;
  }

  if (override.followUpPolicy !== undefined) {
    const followUpPolicy = String(override.followUpPolicy || '').trim();
    if (!FOLLOW_UP_POLICIES.has(followUpPolicy)) {
      throw new Error(`Route override "${routeId}" has invalid followUpPolicy "${followUpPolicy}".`);
    }
    normalized.followUpPolicy = followUpPolicy;
  }

  if (override.mcpLoadingMode !== undefined) {
    const mcpLoadingMode = String(override.mcpLoadingMode || '').trim();
    if (!MCP_LOADING_MODES.has(mcpLoadingMode)) {
      throw new Error(`Route override "${routeId}" has invalid mcpLoadingMode "${mcpLoadingMode}".`);
    }
    normalized.mcpLoadingMode = mcpLoadingMode;
  }

  if (override.deliveryMode !== undefined) {
    const deliveryMode = String(override.deliveryMode || '').trim();
    if (!DELIVERY_MODES.has(deliveryMode)) {
      throw new Error(`Route override "${routeId}" has invalid deliveryMode "${deliveryMode}".`);
    }
    normalized.deliveryMode = deliveryMode;
  }

  if (override.productionStatus !== undefined) {
    const productionStatus = String(override.productionStatus || '').trim();
    if (!PRODUCTION_STATUSES.has(productionStatus)) {
      throw new Error(`Route override "${routeId}" has invalid productionStatus "${productionStatus}".`);
    }
    normalized.productionStatus = productionStatus;
  }

  if (override.productionNotes !== undefined) {
    normalized.productionNotes = String(override.productionNotes || '').trim() || null;
  }

  if (override.matchHint !== undefined) {
    normalized.matchHint = String(override.matchHint || '').trim() || null;
  }

  if (normalized.mcpLoadingMode === 'never' && Array.isArray(normalized.toolTargets)) {
    const invalidTool = normalized.toolTargets.find((tool) => isMcpToolTarget(tool));
    if (invalidTool) {
      throw new Error(`Route override "${routeId}" cannot set mcpLoadingMode "never" while using MCP tool "${invalidTool}".`);
    }
  }

  return normalized;
}

function normalizeRouteOverrides(rawOverrides, knownRouteIds = null) {
  const source = rawOverrides?.routes && typeof rawOverrides.routes === 'object'
    ? rawOverrides.routes
    : (rawOverrides || {});
  const normalized = {};

  for (const [routeId, override] of Object.entries(source)) {
    const id = String(routeId || '').trim();
    if (!id) {
      throw new Error('Route override id cannot be empty.');
    }
    if (knownRouteIds && !knownRouteIds.has(id)) {
      throw new Error(`Route override uses unknown routeId "${id}".`);
    }

    const normalizedOverride = normalizeRouteOverride(id, override);
    if (Object.keys(normalizedOverride).length > 0) {
      normalized[id] = normalizedOverride;
    }
  }

  return normalized;
}

function loadRouteOverrides(options = {}) {
  const raw = readRouteOverrides(options.filePath || getRouteOverridesPath());
  return normalizeRouteOverrides(raw, options.knownRouteIds || null);
}

function applyRouteOverrides(routes, options = {}) {
  const routeList = Array.isArray(routes) ? routes : [];
  const overrides = options.overrides || loadRouteOverrides();

  return routeList.map((route) => {
    const override = overrides[route.id];
    if (!override) {
      return route;
    }

    const merged = {
      ...route,
      ...override
    };
    if (Array.isArray(override.toolTargets)) {
      merged.toolTargets = override.toolTargets;
      merged.toolTarget = override.toolTargets[0] || null;
    }
    return merged;
  });
}

function writeRouteOverrides(overrides, options = {}) {
  const filePath = options.filePath || getRouteOverridesPath();
  const normalized = normalizeRouteOverrides(overrides, options.knownRouteIds || null);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, routes: normalized }, null, 2)}\n`);
  return normalized;
}

module.exports = {
  ANSWER_STYLES,
  CACHE_STRATEGIES,
  DEFAULT_ROUTE_OVERRIDES_PATH,
  DELIVERY_MODES,
  MEDIA_ATTACHMENTS,
  FOLLOW_UP_POLICIES,
  MAX_FACT_LIMIT,
  MCP_LOADING_MODES,
  MIN_FACT_LIMIT,
  PRODUCTION_STATUSES,
  RESPONSE_SHAPES,
  SOURCE_KINDS,
  applyRouteOverrides,
  getAllowedAnswerStyles,
  getAllowedResponseShapes,
  getRouteOverridesPath,
  isMcpToolTarget,
  loadRouteOverrides,
  normalizeRouteOverride,
  normalizeRouteOverrides,
  readRouteOverrides,
  writeRouteOverrides
};
