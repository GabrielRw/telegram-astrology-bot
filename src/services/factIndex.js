const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const { info, reportError } = require('./logger');
const {
  getChatState,
  normalizeNatalProfile,
  resolveIdentity,
  resolveStateKey,
  setFactAvailability
} = require('../state/chatState');

const FACT_TABLE = 'bot_profile_facts';
const NATAL_SOURCE_KIND = 'natal';
const MONTHLY_TRANSIT_SOURCE_KIND = 'monthly_transit';
const NATAL_TOOL_NAME = 'v1_natal_calculate';

const CATEGORY = {
  PLANET_PLACEMENT: 'planet_placement',
  HOUSE_PLACEMENT: 'house_placement',
  ANGLE: 'angle',
  ASPECT: 'aspect',
  STELLIUM: 'stellium',
  NATAL_THEME: 'natal_theme',
  TRANSIT_EVENT: 'transit_event',
  TRANSIT_THEME: 'transit_theme',
  TIMING_WINDOW: 'timing_window'
};

const memoryFacts = new Map();
const pendingSourceWrites = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function addTag(tags, value) {
  const normalized = normalizeTag(value);
  if (normalized) {
    tags.add(normalized);
  }
}

function addEntityTags(tags, label, value, options = {}) {
  const normalized = normalizeTag(value);
  if (!normalized) {
    return;
  }

  addTag(tags, normalized);

  if (options.prefixed !== false && label) {
    addTag(tags, `${label}:${normalized}`);
  }
}

function humanizeIdentifier(value) {
  return String(value || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getInterpretationItems(payload) {
  const sections = payload?.interpretation?.sections;

  if (!sections || typeof sections !== 'object') {
    return [];
  }

  return Object.values(sections)
    .filter(Array.isArray)
    .flat()
    .filter((item) => item?.key && item?.body);
}

function normalizeMonthWindow(timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeFactRecord(record) {
  if (!record) {
    return null;
  }

  return {
    factId: String(record.fact_id || record.factId),
    factKey: String(record.fact_key || record.factKey),
    stateKey: String(record.state_key || record.stateKey),
    channel: String(record.channel || 'telegram'),
    userId: record.user_id ? String(record.user_id) : null,
    chatId: record.chat_id ? String(record.chat_id) : null,
    primaryProfileId: record.primary_profile_id ? String(record.primary_profile_id) : null,
    secondaryProfileId: record.secondary_profile_id ? String(record.secondary_profile_id) : null,
    sourceKind: String(record.source_kind || record.sourceKind),
    sourceToolName: String(record.source_tool_name || record.sourceToolName),
    sourceCacheEntryId: record.source_cache_entry_id ? String(record.source_cache_entry_id) : null,
    cacheMonth: String(record.cache_month || record.cacheMonth || ''),
    category: String(record.category),
    tags: toArray(record.tags).map((tag) => String(tag)),
    title: record.title ? String(record.title) : null,
    factText: String(record.fact_text || record.factText || ''),
    sortOrder: Number.isFinite(Number(record.sort_order ?? record.sortOrder)) ? Number(record.sort_order ?? record.sortOrder) : 0,
    importance: Number.isFinite(Number(record.importance)) ? Number(record.importance) : 0,
    confidence: record.confidence ? String(record.confidence) : null,
    factPayload: clone(record.fact_payload || record.factPayload || {}),
    createdAt: record.created_at || record.createdAt || null,
    updatedAt: record.updated_at || record.updatedAt || null
  };
}

function getMemoryFacts(stateKey) {
  return toArray(memoryFacts.get(stateKey)).map(normalizeFactRecord).filter(Boolean);
}

function setMemoryFacts(stateKey, facts) {
  memoryFacts.set(stateKey, facts.map((fact) => normalizeFactRecord(fact)));
}

function compareFacts(left, right) {
  if (right.importance !== left.importance) {
    return right.importance - left.importance;
  }

  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
}

function shouldReplaceFact(existing, candidate) {
  if (!existing) {
    return true;
  }

  if (Number(candidate.importance || 0) !== Number(existing.importance || 0)) {
    return Number(candidate.importance || 0) > Number(existing.importance || 0);
  }

  return Number(candidate.sortOrder || 0) < Number(existing.sortOrder || 0);
}

function dedupeFactsByFactKey(facts) {
  const deduped = new Map();

  for (const fact of toArray(facts)) {
    const factKey = String(fact?.factKey || '').trim();
    if (!factKey) {
      continue;
    }

    const current = deduped.get(factKey);
    if (!current) {
      deduped.set(factKey, {
        ...fact,
        tags: [...new Set(toArray(fact.tags))],
        factPayload: clone(fact.factPayload || {})
      });
      continue;
    }

    const preferred = shouldReplaceFact(current, fact)
      ? {
          ...fact,
          tags: [...new Set([...toArray(current.tags), ...toArray(fact.tags)])],
          factPayload: clone(fact.factPayload || {})
        }
      : {
          ...current,
          tags: [...new Set([...toArray(current.tags), ...toArray(fact.tags)])],
          factPayload: clone(current.factPayload || {})
        };

    deduped.set(factKey, preferred);
  }

  return [...deduped.values()];
}

function buildFactPayload(identity, scope, fact, timestamp) {
  const normalized = resolveIdentity(identity);

  return {
    fact_id: fact.factId || randomUUID(),
    fact_key: String(fact.factKey),
    state_key: resolveStateKey(identity),
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    primary_profile_id: scope.primaryProfileId || null,
    secondary_profile_id: scope.secondaryProfileId || null,
    source_kind: scope.sourceKind,
    source_tool_name: scope.sourceToolName,
    source_cache_entry_id: scope.sourceCacheEntryId || null,
    cache_month: String(scope.cacheMonth || ''),
    category: fact.category,
    tags: toArray(fact.tags).map(normalizeTag).filter(Boolean),
    title: fact.title || null,
    fact_text: normalizeText(fact.factText),
    sort_order: Number.isFinite(Number(fact.sortOrder)) ? Number(fact.sortOrder) : 0,
    importance: Number.isFinite(Number(fact.importance)) ? Number(fact.importance) : 0,
    confidence: fact.confidence || null,
    fact_payload: clone(fact.factPayload || {}),
    created_at: timestamp,
    updated_at: timestamp
  };
}

function applyNullableEquals(query, column, value) {
  return value === null || value === undefined
    ? query.is(column, null)
    : query.eq(column, value);
}

function matchesSourceScope(fact, scope) {
  return (
    fact.stateKey === scope.stateKey &&
    String(fact.primaryProfileId || '') === String(scope.primaryProfileId || '') &&
    String(fact.secondaryProfileId || '') === String(scope.secondaryProfileId || '') &&
    fact.sourceKind === scope.sourceKind &&
    String(fact.cacheMonth || '') === String(scope.cacheMonth || '')
  );
}

function getSourceScopeKey(scope) {
  return [
    String(scope.stateKey || ''),
    String(scope.primaryProfileId || ''),
    String(scope.secondaryProfileId || ''),
    String(scope.sourceKind || ''),
    String(scope.sourceToolName || ''),
    String(scope.cacheMonth || '')
  ].join('::');
}

function hasPendingSourceWrite(identity, scope) {
  return pendingSourceWrites.has(getSourceScopeKey({
    stateKey: resolveStateKey(identity),
    primaryProfileId: scope.primaryProfileId || null,
    secondaryProfileId: scope.secondaryProfileId || null,
    sourceKind: scope.sourceKind,
    sourceToolName: scope.sourceToolName || '',
    cacheMonth: String(scope.cacheMonth || '')
  }));
}

async function runScopedSourceWrite(scope, task) {
  const scopeKey = getSourceScopeKey(scope);
  if (pendingSourceWrites.has(scopeKey)) {
    return pendingSourceWrites.get(scopeKey);
  }

  const pending = Promise.resolve()
    .then(task)
    .finally(() => {
      pendingSourceWrites.delete(scopeKey);
    });

  pendingSourceWrites.set(scopeKey, pending);
  return pending;
}

async function replaceSourceFacts(identity, scope, facts) {
  const normalizedScope = {
    stateKey: resolveStateKey(identity),
    primaryProfileId: scope.primaryProfileId || null,
    secondaryProfileId: scope.secondaryProfileId || null,
    sourceKind: scope.sourceKind,
    sourceToolName: scope.sourceToolName,
    sourceCacheEntryId: scope.sourceCacheEntryId || null,
    cacheMonth: String(scope.cacheMonth || '')
  };
  return runScopedSourceWrite(normalizedScope, async () => {
    const timestamp = new Date().toISOString();
    const rows = dedupeFactsByFactKey(facts).map((fact) => buildFactPayload(identity, normalizedScope, fact, timestamp));

    if (!isSupabaseConfigured()) {
      const current = getMemoryFacts(normalizedScope.stateKey)
        .filter((fact) => !matchesSourceScope(fact, normalizedScope));
      setMemoryFacts(normalizedScope.stateKey, [...current, ...rows]);
      return rows.map(normalizeFactRecord);
    }

    const client = getSupabaseClient();
    let deleteQuery = client
      .from(FACT_TABLE)
      .delete()
      .eq('state_key', normalizedScope.stateKey)
      .eq('primary_profile_id', normalizedScope.primaryProfileId)
      .eq('source_kind', normalizedScope.sourceKind)
      .eq('cache_month', normalizedScope.cacheMonth);

    deleteQuery = applyNullableEquals(deleteQuery, 'secondary_profile_id', normalizedScope.secondaryProfileId);

    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      throw deleteError;
    }

    if (rows.length === 0) {
      return [];
    }

    const { error: insertError } = await client
      .from(FACT_TABLE)
      .insert(rows);

    if (insertError) {
      throw insertError;
    }

    return rows.map(normalizeFactRecord);
  });
}

function parseStructuredContent(response) {
  if (response?.structuredContent && typeof response.structuredContent === 'object') {
    return response.structuredContent;
  }

  const text = String(response?.text || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function formatDegree(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}°` : null;
}

function buildPlanetImportance(planetId) {
  switch (String(planetId || '').toLowerCase()) {
    case 'sun':
    case 'moon':
      return 98;
    case 'mercury':
    case 'venus':
    case 'mars':
      return 90;
    case 'jupiter':
    case 'saturn':
      return 82;
    default:
      return 72;
  }
}

function buildTransitImportance(category, transit) {
  const base = category === 'slow' ? 92 : category === 'medium' ? 78 : 64;
  const exactBoost = toArray(transit?.exact_hits_in_month).length > 0 ? 6 : 0;
  const continuingPenalty = transit?.continues_from_previous_month && transit?.continues_to_next_month ? -3 : 0;
  return base + exactBoost + continuingPenalty;
}

function buildAspectImportance(aspect) {
  const orb = Number.isFinite(Number(aspect?.orb)) ? Number(aspect.orb) : 8;
  return Math.max(55, 92 - Math.round(orb * 6));
}

function buildInterpretationCategory(key) {
  const normalized = String(key || '').toLowerCase();

  if (normalized.startsWith('planet.') && normalized.includes('.sign.')) {
    return CATEGORY.PLANET_PLACEMENT;
  }

  if (normalized.startsWith('planet.') && normalized.includes('.house.')) {
    return CATEGORY.HOUSE_PLACEMENT;
  }

  if (normalized.startsWith('house.')) {
    return CATEGORY.HOUSE_PLACEMENT;
  }

  if (normalized.startsWith('angle.')) {
    return CATEGORY.ANGLE;
  }

  if (normalized.startsWith('aspect.')) {
    return CATEGORY.ASPECT;
  }

  if (normalized.startsWith('stellium.')) {
    return CATEGORY.STELLIUM;
  }

  return CATEGORY.NATAL_THEME;
}

function extractTagsFromInterpretationKey(key, tags) {
  const parts = String(key || '').toLowerCase().split('.');

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part === 'planet' && parts[index + 1]) {
      addEntityTags(tags, 'planet', parts[index + 1]);
    }

    if (part === 'house' && parts[index + 1]) {
      addEntityTags(tags, 'house', parts[index + 1]);
      addTag(tags, `house_${normalizeTag(parts[index + 1])}`);
    }

    if (part === 'sign' && parts[index + 1]) {
      addEntityTags(tags, 'sign', parts[index + 1]);
    }

    if (part === 'aspect' && parts[index + 2]) {
      addEntityTags(tags, 'planet', parts[index + 1]);
      addEntityTags(tags, 'aspect', parts[index + 2]);
      if (parts[index + 3]) {
        addEntityTags(tags, 'planet', parts[index + 3]);
      }
    }

    if (part === 'angle' && parts[index + 1]) {
      addEntityTags(tags, 'angle', parts[index + 1]);
    }
  }
}

function buildInterpretationTitle(key) {
  const parts = String(key || '')
    .split('.')
    .filter(Boolean)
    .map(humanizeIdentifier);

  return parts.join(' ');
}

function buildImportanceLookup(payload) {
  const map = new Map();

  for (const item of toArray(payload?.importance)) {
    const targetIds = toArray(item?.source_fact_ids);
    if (targetIds.length === 0) {
      continue;
    }

    for (const factId of targetIds) {
      if (!map.has(factId)) {
        map.set(factId, []);
      }
      map.get(factId).push(item);
    }
  }

  for (const items of map.values()) {
    items.sort((left, right) => Number(left?.rank || 999) - Number(right?.rank || 999));
  }

  return map;
}

function buildInsightFallbackTitle(fact) {
  if (fact?.relation_key) {
    return humanizeIdentifier(String(fact.relation_key).replace(/__/g, ' '));
  }

  if (fact?.kind && toArray(fact.subjects).length > 0) {
    return `${humanizeIdentifier(fact.kind)}: ${toArray(fact.subjects).map(humanizeIdentifier).slice(0, 4).join(', ')}`;
  }

  if (fact?.kind) {
    return humanizeIdentifier(fact.kind);
  }

  return humanizeIdentifier(fact?.id || 'Fact');
}

function buildInsightConfidence(strength) {
  const value = Number(strength);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value >= 0.85) {
    return 'high';
  }

  if (value >= 0.65) {
    return 'medium';
  }

  return 'low';
}

function buildInsightFactText(title, fact, importanceItem) {
  const evidence = fact?.evidence && typeof fact.evidence === 'object' ? fact.evidence : {};
  const parts = [title || buildInsightFallbackTitle(fact)];

  if (fact?.category) {
    parts.push(`Category: ${humanizeIdentifier(fact.category)}.`);
  }

  if (fact?.kind) {
    parts.push(`Kind: ${humanizeIdentifier(fact.kind)}.`);
  }

  if (importanceItem?.focus_type) {
    parts.push(`Focus: ${humanizeIdentifier(importanceItem.focus_type)}.`);
  }

  if (evidence.window_type && evidence.focus_point) {
    parts.push(`${humanizeIdentifier(evidence.window_type)} window around ${humanizeIdentifier(evidence.focus_point)}.`);
  }

  if (evidence.start_datetime && evidence.end_datetime) {
    parts.push(`Window: ${evidence.start_datetime} to ${evidence.end_datetime}.`);
  }

  if (evidence.peak_datetime) {
    parts.push(`Peak: ${evidence.peak_datetime}.`);
  }

  if (toArray(fact?.subjects).length > 0) {
    parts.push(`Subjects: ${toArray(fact.subjects).map(humanizeIdentifier).slice(0, 8).join(', ')}.`);
  }

  if (Array.isArray(evidence.houses) && evidence.houses.length > 0) {
    parts.push(`Houses: ${evidence.houses.join(', ')}.`);
  }

  if (Array.isArray(evidence.aspect_types) && evidence.aspect_types.length > 0) {
    parts.push(`Aspects: ${evidence.aspect_types.map(humanizeIdentifier).join(', ')}.`);
  }

  if (typeof fact?.search_text === 'string' && fact.search_text.trim() && parts.length <= 3) {
    parts.push(normalizeText(fact.search_text).slice(0, 280));
  }

  return parts.join(' ').trim();
}

function normalizeInsightTags(fact, sourceKind, cacheMonth) {
  const tags = new Set();

  addTag(tags, sourceKind);
  if (cacheMonth) {
    addTag(tags, cacheMonth);
    addTag(tags, `month:${cacheMonth}`);
  }

  for (const tag of toArray(fact?.tags)) {
    addTag(tags, tag);
  }

  for (const key of toArray(fact?.index_keys)) {
    addTag(tags, key);
  }

  if (fact?.kind) {
    addTag(tags, `kind:${fact.kind}`);
  }

  if (fact?.relation_key) {
    addTag(tags, `relation:${fact.relation_key}`);
  }

  return [...tags];
}

function normalizeInsightFact(fact, options = {}) {
  const importanceLookup = options.importanceLookup || new Map();
  const cacheMonth = String(options.cacheMonth || '');
  const importanceItems = importanceLookup.get(fact?.id) || [];
  const importanceItem = importanceItems[0] || null;
  const title = importanceItem?.title || buildInsightFallbackTitle(fact);

  return {
    factKey: String(fact?.id || randomUUID()),
    category: String(fact?.category || 'general'),
    title,
    factText: buildInsightFactText(title, fact, importanceItem),
    sortOrder: Number.isFinite(Number(importanceItem?.rank)) ? Number(importanceItem.rank) : 1000,
    importance: Number.isFinite(Number(fact?.priority)) ? Number(fact.priority) : 0,
    confidence: buildInsightConfidence(fact?.strength),
    tags: normalizeInsightTags(fact, options.sourceKind, cacheMonth),
    factPayload: {
      raw: clone(fact),
      importance: clone(importanceItems),
      summary: clone(options.summary || null),
      meta: clone(options.meta || null)
    }
  };
}

function extractInsightFacts(payload, options = {}) {
  const importanceLookup = buildImportanceLookup(payload);

  return toArray(payload?.facts).map((fact) => normalizeInsightFact(fact, {
    sourceKind: options.sourceKind,
    cacheMonth: options.cacheMonth,
    importanceLookup,
    summary: payload?.summary || null,
    meta: payload?.meta || null
  }));
}

function extractNatalFacts(profile) {
  const payload = profile?.rawNatalPayload;
  if (!payload) {
    return [];
  }

  const normalized = normalizeNatalProfile(payload, profile.cityLabel, {
    birthCountry: profile.birthCountry
  });
  const facts = [];
  const confidence = normalized.confidence || payload?.confidence?.overall || null;

  for (const planet of toArray(normalized.planets)) {
    const tags = new Set();
    addTag(tags, 'natal');
    addEntityTags(tags, 'planet', planet.id || planet.name);
    addEntityTags(tags, 'sign', planet.sign_id || planet.sign);
    if (planet.house) {
      addEntityTags(tags, 'house', planet.house);
      addTag(tags, `house_${planet.house}`);
    }
    if (planet.retrograde) {
      addTag(tags, 'retrograde');
    }
    if (confidence) {
      addTag(tags, `confidence:${confidence}`);
    }

    facts.push({
      factKey: `planet:${normalizeTag(planet.id || planet.name)}`,
      category: CATEGORY.PLANET_PLACEMENT,
      title: `${planet.name || humanizeIdentifier(planet.id)} placement`,
      factText: [
        `${planet.name || humanizeIdentifier(planet.id)} is in ${humanizeIdentifier(planet.sign_id || planet.sign)}`,
        planet.house ? `in house ${planet.house}` : null,
        formatDegree(planet.pos) ? `at ${formatDegree(planet.pos)}` : null,
        planet.retrograde ? 'and retrograde' : null
      ].filter(Boolean).join(' '),
      sortOrder: 10,
      importance: buildPlanetImportance(planet.id),
      confidence,
      tags: [...tags],
      factPayload: {
        planetId: planet.id || null,
        planetName: planet.name || null,
        signId: planet.sign_id || planet.sign || null,
        house: planet.house || null,
        degree: Number.isFinite(Number(planet.pos)) ? Number(planet.pos) : null,
        retrograde: Boolean(planet.retrograde)
      }
    });
  }

  for (const house of toArray(normalized.houses)) {
    const tags = new Set(['natal']);
    addEntityTags(tags, 'house', house.house);
    addTag(tags, `house_${house.house}`);
    addEntityTags(tags, 'sign', house.sign_id || house.sign);
    if (confidence) {
      addTag(tags, `confidence:${confidence}`);
    }

    facts.push({
      factKey: `house:${house.house}`,
      category: CATEGORY.HOUSE_PLACEMENT,
      title: `House ${house.house}`,
      factText: [
        `House ${house.house} begins in ${humanizeIdentifier(house.sign_id || house.sign)}`,
        formatDegree(house.pos) ? `at ${formatDegree(house.pos)}` : null
      ].filter(Boolean).join(' '),
      sortOrder: 20 + Number(house.house || 0),
      importance: 62,
      confidence,
      tags: [...tags],
      factPayload: {
        house: house.house || null,
        signId: house.sign_id || house.sign || null,
        degree: Number.isFinite(Number(house.pos)) ? Number(house.pos) : null
      }
    });
  }

  for (const [angleKey, angle] of Object.entries(normalized.angles || {})) {
    const tags = new Set(['natal']);
    addEntityTags(tags, 'angle', angleKey);
    addEntityTags(tags, 'sign', angle?.sign_id || angle?.sign);
    if (angle?.house) {
      addEntityTags(tags, 'house', angle.house);
    }

    facts.push({
      factKey: `angle:${normalizeTag(angleKey)}`,
      category: CATEGORY.ANGLE,
      title: humanizeIdentifier(angleKey),
      factText: [
        `${humanizeIdentifier(angleKey)} is in ${humanizeIdentifier(angle?.sign_id || angle?.sign)}`,
        formatDegree(angle?.pos) ? `at ${formatDegree(angle.pos)}` : null
      ].filter(Boolean).join(' '),
      sortOrder: 30,
      importance: angleKey === 'asc' ? 96 : 78,
      confidence,
      tags: [...tags],
      factPayload: {
        angle: angleKey,
        signId: angle?.sign_id || angle?.sign || null,
        house: angle?.house || null,
        degree: Number.isFinite(Number(angle?.pos)) ? Number(angle.pos) : null
      }
    });
  }

  for (const aspect of toArray(normalized.majorAspects)) {
    const tags = new Set(['natal']);
    addEntityTags(tags, 'planet', aspect.p1);
    addEntityTags(tags, 'planet', aspect.p2);
    addEntityTags(tags, 'aspect', aspect.type);
    if (confidence) {
      addTag(tags, `confidence:${confidence}`);
    }

    facts.push({
      factKey: `aspect:${normalizeTag(aspect.p1)}:${normalizeTag(aspect.type)}:${normalizeTag(aspect.p2)}`,
      category: CATEGORY.ASPECT,
      title: `${humanizeIdentifier(aspect.p1)} ${humanizeIdentifier(aspect.type)} ${humanizeIdentifier(aspect.p2)}`,
      factText: [
        `${humanizeIdentifier(aspect.p1)} forms a ${humanizeIdentifier(aspect.type)} with ${humanizeIdentifier(aspect.p2)}`,
        Number.isFinite(Number(aspect.orb)) ? `with an orb of ${Number(aspect.orb).toFixed(2)}°` : null,
        aspect.interpretation ? `Interpretation: ${normalizeText(aspect.interpretation)}` : null
      ].filter(Boolean).join('. '),
      sortOrder: 40,
      importance: buildAspectImportance(aspect),
      confidence,
      tags: [...tags],
      factPayload: {
        p1: aspect.p1 || null,
        p2: aspect.p2 || null,
        aspectType: aspect.type || null,
        orb: Number.isFinite(Number(aspect.orb)) ? Number(aspect.orb) : null,
        degree: Number.isFinite(Number(aspect.deg)) ? Number(aspect.deg) : null,
        interpretation: aspect.interpretation || null
      }
    });
  }

  toArray(payload?.stelliums || normalized.stelliums).forEach((stellium, index) => {
    const members = toArray(stellium?.planets || stellium?.planet_ids || stellium?.bodies || stellium?.members);
    const signId = stellium?.sign_id || stellium?.sign || null;
    const house = stellium?.house || stellium?.house_id || null;
    const tags = new Set(['natal', 'stellium']);

    addEntityTags(tags, 'sign', signId);
    if (house) {
      addEntityTags(tags, 'house', house);
      addTag(tags, `house_${house}`);
    }
    members.forEach((member) => addEntityTags(tags, 'planet', member));

    facts.push({
      factKey: `stellium:${normalizeTag(signId || 'unknown')}:${normalizeTag(house || index + 1)}`,
      category: CATEGORY.STELLIUM,
      title: 'Stellium',
      factText: [
        'Stellium detected',
        signId ? `in ${humanizeIdentifier(signId)}` : null,
        house ? `around house ${house}` : null,
        members.length > 0 ? `with ${members.map((member) => humanizeIdentifier(member)).join(', ')}` : null
      ].filter(Boolean).join(' '),
      sortOrder: 50 + index,
      importance: 86,
      confidence,
      tags: [...tags],
      factPayload: {
        signId,
        house,
        members
      }
    });
  });

  {
    const tags = new Set(['natal', 'theme', 'summary']);
    addEntityTags(tags, 'planet', normalized.sun?.sign ? 'sun' : null);
    addEntityTags(tags, 'planet', normalized.moon?.sign ? 'moon' : null);
    if (normalized.rising?.sign) {
      addEntityTags(tags, 'angle', 'asc');
      addEntityTags(tags, 'sign', normalized.rising.sign);
    }

    facts.push({
      factKey: 'theme:chart_summary',
      category: CATEGORY.NATAL_THEME,
      title: 'Natal overview',
      factText: normalized.summaryText,
      sortOrder: 70,
      importance: 88,
      confidence,
      tags: [...tags],
      factPayload: {
        sun: clone(normalized.sun),
        moon: clone(normalized.moon),
        rising: clone(normalized.rising),
        birthDatetime: normalized.birthDatetime || null,
        city: normalized.city || null
      }
    });
  }

  for (const item of getInterpretationItems(payload)) {
    const tags = new Set(['natal', 'interpretation']);
    const category = buildInterpretationCategory(item.key);
    extractTagsFromInterpretationKey(item.key, tags);
    if (confidence) {
      addTag(tags, `confidence:${confidence}`);
    }

    facts.push({
      factKey: `interpretation:${normalizeTag(item.key)}`,
      category,
      title: buildInterpretationTitle(item.key),
      factText: normalizeText(item.body),
      sortOrder: category === CATEGORY.NATAL_THEME ? 80 : 60,
      importance: category === CATEGORY.NATAL_THEME ? 68 : 58,
      confidence,
      tags: [...tags],
      factPayload: {
        interpretationKey: item.key
      }
    });
  }

  return facts;
}

function buildTransitLabel(transit) {
  return normalizeText(
    transit?.label ||
    [
      humanizeIdentifier(transit?.transit_planet),
      humanizeIdentifier(transit?.aspect_type),
      humanizeIdentifier(transit?.natal_point)
    ].filter(Boolean).join(' ')
  );
}

function buildTransitBaseTags(transit, cacheMonth) {
  const tags = new Set(['monthly_transit']);
  addEntityTags(tags, 'planet', transit?.transit_planet);
  addEntityTags(tags, 'point', transit?.natal_point);
  addEntityTags(tags, 'aspect', transit?.aspect_type);
  addEntityTags(tags, 'speed', transit?.category);
  addEntityTags(tags, 'pass', transit?.pass_type);

  if (cacheMonth) {
    addTag(tags, cacheMonth);
    addTag(tags, `month:${cacheMonth}`);
  }

  if (toArray(transit?.exact_hits_in_month).length > 0) {
    addTag(tags, 'exact_this_month');
  }

  if (transit?.continues_from_previous_month) {
    addTag(tags, 'continues_from_previous_month');
  }

  if (transit?.continues_to_next_month) {
    addTag(tags, 'continues_to_next_month');
  }

  return tags;
}

function extractTransitFacts(cacheEntry) {
  const payload = parseStructuredContent(cacheEntry?.response);
  const transits = toArray(payload?.transits);
  const cacheMonth = String(cacheEntry?.cacheMonth || '');

  return transits.flatMap((transit, index) => {
    const label = buildTransitLabel(transit);
    const importance = buildTransitImportance(transit?.category, transit);
    const baseTags = [...buildTransitBaseTags(transit, cacheMonth)];
    const eventFact = {
      factKey: `event:${normalizeTag(transit?.id || `${transit?.series_key}:${index}`)}`,
      category: CATEGORY.TRANSIT_EVENT,
      title: label,
      factText: [
        `${label} is active`,
        transit?.start_datetime ? `from ${transit.start_datetime}` : null,
        transit?.end_datetime ? `to ${transit.end_datetime}` : null,
        transit?.pass_type ? `(${transit.pass_type} pass)` : null,
        transit?.category ? `as a ${transit.category} transit` : null
      ].filter(Boolean).join(' '),
      sortOrder: Number.isFinite(Number(transit?.visible_start_day)) ? Number(transit.visible_start_day) : index,
      importance,
      confidence: 'high',
      tags: baseTags,
      factPayload: {
        id: transit?.id || null,
        seriesKey: transit?.series_key || null,
        transitPlanet: transit?.transit_planet || null,
        natalPoint: transit?.natal_point || null,
        aspectType: transit?.aspect_type || null,
        startDatetime: transit?.start_datetime || null,
        endDatetime: transit?.end_datetime || null,
        exactDatetimes: toArray(transit?.exact_datetimes),
        exactHitsInMonth: toArray(transit?.exact_hits_in_month),
        durationDays: Number.isFinite(Number(transit?.duration_days)) ? Number(transit.duration_days) : null,
        passType: transit?.pass_type || null,
        visibleStartDay: transit?.visible_start_day || null,
        visibleEndDay: transit?.visible_end_day || null,
        rowKey: transit?.row_key || null,
        pairKey: transit?.pair_key || null,
        houses: clone(transit?.houses || null)
      }
    };
    const timingFact = {
      factKey: `timing:${normalizeTag(transit?.id || `${transit?.series_key}:${index}`)}`,
      category: CATEGORY.TIMING_WINDOW,
      title: `${label} timing`,
      factText: [
        `Visible in ${cacheMonth || 'the requested month'} from day ${transit?.visible_start_day || '?'}`,
        `to day ${transit?.visible_end_day || '?'}`,
        toArray(transit?.exact_hits_in_month).length > 0
          ? `with exact hits on ${toArray(transit.exact_hits_in_month).join(', ')}`
          : 'with no exact hit inside the visible month'
      ].join(' '),
      sortOrder: Number.isFinite(Number(transit?.visible_start_day)) ? Number(transit.visible_start_day) : index,
      importance: importance - 6,
      confidence: 'high',
      tags: [...baseTags, 'timing'],
      factPayload: {
        visibleStartDay: transit?.visible_start_day || null,
        visibleEndDay: transit?.visible_end_day || null,
        continuesFromPreviousMonth: Boolean(transit?.continues_from_previous_month),
        continuesToNextMonth: Boolean(transit?.continues_to_next_month),
        exactHitsInMonth: toArray(transit?.exact_hits_in_month)
      }
    };
    const themeFact = {
      factKey: `theme:${normalizeTag(transit?.id || `${transit?.series_key}:${index}`)}`,
      category: CATEGORY.TRANSIT_THEME,
      title: `${label} theme`,
      factText: [
        `${label} is one of the active ${transit?.category || 'current'} influences for ${cacheMonth || 'this period'}.`,
        transit?.continues_from_previous_month ? 'It was already active before this month.' : null,
        transit?.continues_to_next_month ? 'It continues beyond this month.' : null
      ].filter(Boolean).join(' '),
      sortOrder: Number.isFinite(Number(transit?.visible_start_day)) ? Number(transit.visible_start_day) : index,
      importance: importance - 10,
      confidence: 'high',
      tags: [...baseTags, 'theme'],
      factPayload: {
        label,
        category: transit?.category || null,
        passType: transit?.pass_type || null
      }
    };

    return [eventFact, timingFact, themeFact];
  });
}

function extractNatalInsightFacts(response) {
  const payload = clone(response);
  return extractInsightFacts(payload, {
    sourceKind: NATAL_SOURCE_KIND,
    cacheMonth: ''
  });
}

function extractTransitInsightFacts(response, cacheMonth) {
  const payload = clone(response);
  return extractInsightFacts(payload, {
    sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
    cacheMonth
  });
}

function normalizeSearchTags(tags) {
  return toArray(tags).map(normalizeTag).filter(Boolean);
}

function filterFacts(records, input) {
  const categories = new Set(toArray(input.categories).map(String));
  const sourceKinds = new Set(toArray(input.sourceKinds).map(String));
  const tags = normalizeSearchTags(input.tags);
  const cacheMonth = input.cacheMonth === undefined || input.cacheMonth === null
    ? null
    : String(input.cacheMonth);
  const secondaryProfileId = input.secondaryProfileId === undefined
    ? null
    : (input.secondaryProfileId || null);

  return records
    .filter((record) => record.primaryProfileId === input.primaryProfileId)
    .filter((record) => secondaryProfileId === null
      ? record.secondaryProfileId === null
      : record.secondaryProfileId === secondaryProfileId)
    .filter((record) => categories.size === 0 || categories.has(record.category))
    .filter((record) => sourceKinds.size === 0 || sourceKinds.has(record.sourceKind))
    .filter((record) => cacheMonth === null || record.cacheMonth === cacheMonth)
    .filter((record) => tags.every((tag) => record.tags.includes(tag)))
    .sort(compareFacts);
}

async function searchFacts(identity, input) {
  const startedAt = performance.now();
  const stateKey = resolveStateKey(identity);
  const limit = Math.max(1, Math.min(Number(input.limit || 12), 30));
  const normalizedInput = {
    primaryProfileId: String(input.primaryProfileId || ''),
    secondaryProfileId: input.secondaryProfileId ? String(input.secondaryProfileId) : null,
    categories: toArray(input.categories),
    sourceKinds: toArray(input.sourceKinds),
    tags: normalizeSearchTags(input.tags),
    cacheMonth: input.cacheMonth ? String(input.cacheMonth) : null
  };

  if (!normalizedInput.primaryProfileId) {
    return [];
  }

  if (!isSupabaseConfigured()) {
    const result = filterFacts(getMemoryFacts(stateKey), normalizedInput).slice(0, limit);
    info('fact search complete', {
      stateKey,
      primaryProfileId: normalizedInput.primaryProfileId,
      sourceKinds: normalizedInput.sourceKinds,
      categories: normalizedInput.categories,
      cacheMonth: normalizedInput.cacheMonth,
      count: result.length,
      durationMs: Math.round(performance.now() - startedAt)
    });
    return result;
  }

  const client = getSupabaseClient();
  let query = client
    .from(FACT_TABLE)
    .select('*')
    .eq('state_key', stateKey)
    .eq('primary_profile_id', normalizedInput.primaryProfileId)
    .order('importance', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);

  query = applyNullableEquals(query, 'secondary_profile_id', normalizedInput.secondaryProfileId);

  if (normalizedInput.categories.length > 0) {
    query = query.in('category', normalizedInput.categories);
  }

  if (normalizedInput.sourceKinds.length > 0) {
    query = query.in('source_kind', normalizedInput.sourceKinds);
  }

  if (normalizedInput.cacheMonth !== null) {
    query = query.eq('cache_month', normalizedInput.cacheMonth);
  }

  if (normalizedInput.tags.length > 0) {
    query = query.contains('tags', normalizedInput.tags);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const result = toArray(data).map(normalizeFactRecord).filter(Boolean);
  info('fact search complete', {
    stateKey,
    primaryProfileId: normalizedInput.primaryProfileId,
    sourceKinds: normalizedInput.sourceKinds,
    categories: normalizedInput.categories,
    cacheMonth: normalizedInput.cacheMonth,
    count: result.length,
    durationMs: Math.round(performance.now() - startedAt)
  });
  return result;
}

async function hasFacts(identity, input) {
  const stateKey = resolveStateKey(identity);
  const scope = {
    primaryProfileId: input.primaryProfileId || null,
    secondaryProfileId: input.secondaryProfileId || null,
    sourceKind: input.sourceKind,
    sourceToolName: input.sourceToolName,
    cacheMonth: String(input.cacheMonth || '')
  };

  if (!scope.primaryProfileId) {
    return false;
  }

  if (!isSupabaseConfigured()) {
    return getMemoryFacts(stateKey).some((fact) => (
      fact.primaryProfileId === scope.primaryProfileId &&
      String(fact.secondaryProfileId || '') === String(scope.secondaryProfileId || '') &&
      fact.sourceKind === scope.sourceKind &&
      (!scope.sourceToolName || fact.sourceToolName === scope.sourceToolName) &&
      String(fact.cacheMonth || '') === scope.cacheMonth
    ));
  }

  const client = getSupabaseClient();
  let query = client
    .from(FACT_TABLE)
    .select('fact_id', { count: 'exact', head: true })
    .eq('state_key', stateKey)
    .eq('primary_profile_id', scope.primaryProfileId)
    .eq('source_kind', scope.sourceKind)
    .eq('cache_month', scope.cacheMonth);

  if (scope.sourceToolName) {
    query = query.eq('source_tool_name', scope.sourceToolName);
  }

  query = applyNullableEquals(query, 'secondary_profile_id', scope.secondaryProfileId);

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return Number(count || 0) > 0;
}

async function syncActiveProfileFactAvailability(identity, profile, options = {}) {
  if (!profile) {
    setFactAvailability(identity, {
      hasNatalFacts: false,
      indexedTransitCacheMonth: null
    }, { notify: options.notify });
    return getChatState(identity).factAvailability;
  }

  const currentMonth = options.cacheMonth || normalizeMonthWindow(profile.timezone || 'UTC');
  const [hasNatalFacts, hasMonthlyTransitFacts] = await Promise.all([
    hasFacts(identity, {
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      sourceKind: NATAL_SOURCE_KIND,
      cacheMonth: ''
    }),
    currentMonth
      ? hasFacts(identity, {
          primaryProfileId: profile.profileId,
          secondaryProfileId: null,
          sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
          cacheMonth: currentMonth
        })
      : Promise.resolve(false)
  ]);

  return setFactAvailability(identity, {
    hasNatalFacts,
    indexedTransitCacheMonth: hasMonthlyTransitFacts ? currentMonth : null
  }, { notify: options.notify });
}

async function ensureNatalFacts(identity, profile, options = {}) {
  if (!profile?.profileId || !profile?.rawNatalPayload) {
    return [];
  }

  if (!options.force) {
    const exists = await hasFacts(identity, {
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      sourceKind: NATAL_SOURCE_KIND,
      sourceToolName: NATAL_TOOL_NAME,
      cacheMonth: ''
    });

    if (exists) {
      if (getChatState(identity).activeProfileId === profile.profileId) {
        await syncActiveProfileFactAvailability(identity, profile, { notify: false });
      }
      return [];
    }
  }

  const inserted = await replaceSourceFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: NATAL_SOURCE_KIND,
    sourceToolName: NATAL_TOOL_NAME,
    sourceCacheEntryId: null,
    cacheMonth: ''
  }, extractNatalFacts(profile));

  if (getChatState(identity).activeProfileId === profile.profileId) {
    await syncActiveProfileFactAvailability(identity, profile, { notify: false });
  }

  return inserted;
}

async function ensureTransitFactsFromCacheEntry(identity, profile, cacheEntry, options = {}) {
  if (!profile?.profileId || !cacheEntry?.cacheEntryId) {
    return [];
  }

  const cacheMonth = String(options.cacheMonth || cacheEntry.cacheMonth || '');
  if (!cacheMonth) {
    return [];
  }

  if (!options.force) {
    const exists = await hasFacts(identity, {
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
      sourceToolName: cacheEntry.toolName,
      cacheMonth
    });

    if (exists) {
      if (getChatState(identity).activeProfileId === profile.profileId) {
        await syncActiveProfileFactAvailability(identity, profile, {
          cacheMonth,
          transitToolName: cacheEntry.toolName,
          notify: false
        });
      }
      return [];
    }
  }

  const inserted = await replaceSourceFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
    sourceToolName: cacheEntry.toolName,
    sourceCacheEntryId: cacheEntry.cacheEntryId,
    cacheMonth
  }, extractTransitFacts(cacheEntry));

  if (getChatState(identity).activeProfileId === profile.profileId) {
    await syncActiveProfileFactAvailability(identity, profile, {
      cacheMonth,
      transitToolName: cacheEntry.toolName,
      notify: false
    });
  }

  return inserted;
}

async function storeNatalInsightFacts(identity, profile, insightResponse, cacheEntry, options = {}) {
  if (!profile?.profileId || !insightResponse) {
    return [];
  }

  if (!options.force) {
    const exists = await hasFacts(identity, {
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      sourceKind: NATAL_SOURCE_KIND,
      sourceToolName: options.sourceToolName || cacheEntry?.toolName || 'rest_western_natal_insights',
      cacheMonth: ''
    });

    if (exists) {
      if (getChatState(identity).activeProfileId === profile.profileId) {
        await syncActiveProfileFactAvailability(identity, profile, { notify: false });
      }
      return [];
    }
  }

  const facts = extractNatalInsightFacts(insightResponse);
  if (facts.length === 0) {
    return [];
  }

  const inserted = await replaceSourceFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: NATAL_SOURCE_KIND,
    sourceToolName: options.sourceToolName || cacheEntry?.toolName || 'rest_western_natal_insights',
    sourceCacheEntryId: cacheEntry?.cacheEntryId || null,
    cacheMonth: ''
  }, facts);

  if (getChatState(identity).activeProfileId === profile.profileId) {
    await syncActiveProfileFactAvailability(identity, profile, { notify: false });
  }

  return inserted;
}

async function storeTransitInsightFacts(identity, profile, insightResponse, cacheEntry, options = {}) {
  if (!profile?.profileId || !insightResponse) {
    return [];
  }

  const cacheMonth = String(options.cacheMonth || cacheEntry?.cacheMonth || '');
  if (!cacheMonth) {
    return [];
  }

  if (!options.force) {
    const exists = await hasFacts(identity, {
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
      sourceToolName: options.sourceToolName || cacheEntry?.toolName || 'rest_western_transits_insights',
      cacheMonth
    });

    if (exists) {
      if (getChatState(identity).activeProfileId === profile.profileId) {
        await syncActiveProfileFactAvailability(identity, profile, {
          cacheMonth,
          notify: false
        });
      }
      return [];
    }
  }

  const facts = extractTransitInsightFacts(insightResponse, cacheMonth);
  if (facts.length === 0) {
    return [];
  }

  const inserted = await replaceSourceFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: MONTHLY_TRANSIT_SOURCE_KIND,
    sourceToolName: options.sourceToolName || cacheEntry?.toolName || 'rest_western_transits_insights',
    sourceCacheEntryId: cacheEntry?.cacheEntryId || null,
    cacheMonth
  }, facts);

  if (getChatState(identity).activeProfileId === profile.profileId) {
    await syncActiveProfileFactAvailability(identity, profile, {
      cacheMonth,
      notify: false
    });
  }

  return inserted;
}

async function safeEnsureNatalFacts(identity, profile, options = {}) {
  try {
    const facts = await ensureNatalFacts(identity, profile, options);
    if (facts.length > 0) {
      info('natal facts indexed', {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId,
        count: facts.length
      });
    }
    return facts;
  } catch (error) {
    await reportError('fact-index.natal', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile?.profileId || null
    });
    return [];
  }
}

async function safeEnsureTransitFacts(identity, profile, cacheEntry, options = {}) {
  try {
    const facts = await ensureTransitFactsFromCacheEntry(identity, profile, cacheEntry, options);
    if (facts.length > 0) {
      info('monthly transit facts indexed', {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId,
        cacheMonth: cacheEntry.cacheMonth,
        count: facts.length
      });
    }
    return facts;
  } catch (error) {
    await reportError('fact-index.monthly-transits', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile?.profileId || null,
      cacheEntryId: cacheEntry?.cacheEntryId || null
    });
    return [];
  }
}

async function safeStoreNatalInsightFacts(identity, profile, insightResponse, cacheEntry, options = {}) {
  try {
    const facts = await storeNatalInsightFacts(identity, profile, insightResponse, cacheEntry, options);
    if (facts.length > 0) {
      info('natal insight facts indexed', {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId,
        count: facts.length
      });
    }
    return facts;
  } catch (error) {
    await reportError('fact-index.natal-insights', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile?.profileId || null,
      cacheEntryId: cacheEntry?.cacheEntryId || null
    });
    return [];
  }
}

async function safeStoreTransitInsightFacts(identity, profile, insightResponse, cacheEntry, options = {}) {
  try {
    const facts = await storeTransitInsightFacts(identity, profile, insightResponse, cacheEntry, options);
    if (facts.length > 0) {
      info('transit insight facts indexed', {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId,
        cacheMonth: options.cacheMonth || cacheEntry?.cacheMonth || null,
        count: facts.length
      });
    }
    return facts;
  } catch (error) {
    await reportError('fact-index.transit-insights', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile?.profileId || null,
      cacheEntryId: cacheEntry?.cacheEntryId || null
    });
    return [];
  }
}

module.exports = {
  CATEGORY,
  FACT_TABLE,
  MONTHLY_TRANSIT_SOURCE_KIND,
  NATAL_SOURCE_KIND,
  NATAL_TOOL_NAME,
  ensureNatalFacts,
  extractNatalInsightFacts,
  extractTransitInsightFacts,
  ensureTransitFactsFromCacheEntry,
  extractNatalFacts,
  extractTransitFacts,
  hasFacts,
  hasPendingSourceWrite,
  safeEnsureNatalFacts,
  safeEnsureTransitFacts,
  safeStoreNatalInsightFacts,
  safeStoreTransitInsightFacts,
  searchFacts,
  storeNatalInsightFacts,
  storeTransitInsightFacts,
  syncActiveProfileFactAvailability
};
