const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const factIndex = require('./factIndex');
const { getNatalInsights, getTransitInsights } = require('./freeastro');
const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const { info, reportError } = require('./logger');
const mcpService = require('./freeastroMcp');
const { resolveIdentity, resolveStateKey } = require('../state/chatState');

const CACHE_TABLE = 'bot_tool_cache_entries';
const LOG_TABLE = 'bot_tool_call_logs';
const TRANSIT_TOOL = 'v1_western_transits_timeline';
const NATAL_INSIGHTS_TOOL = 'rest_western_natal_insights';
const TRANSIT_INSIGHTS_TOOL = 'rest_western_transits_insights';

const memoryEntries = new Map();
const memoryLogs = [];

function scheduleAsync(label, meta, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      reportError(label, error, meta);
    });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((accumulator, key) => {
      accumulator[key] = sortObject(value[key]);
      return accumulator;
    }, {});
}

function canonicalizeArgs(args) {
  return sortObject(clone(args || {}));
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function buildRequestHash(args) {
  return createHash('sha256').update(stableStringify(args)).digest('hex');
}

function getProfilePairKey(primaryProfileId, secondaryProfileId) {
  return `${String(primaryProfileId || '')}|${String(secondaryProfileId || '')}`;
}

function getMonthParts(timezone) {
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

  return { year, month };
}

function getCurrentMonthWindow(timezone) {
  const parts = getMonthParts(timezone);
  if (!parts) {
    return null;
  }

  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const cacheMonth = `${parts.year}-${String(parts.month).padStart(2, '0')}`;

  return {
    cacheMonth,
    rangeStart: `${cacheMonth}-01`,
    rangeEnd: `${cacheMonth}-${String(lastDay).padStart(2, '0')}`
  };
}

function normalizeCacheEntry(record) {
  if (!record) {
    return null;
  }

  return {
    cacheEntryId: String(record.cache_entry_id || record.cacheEntryId),
    stateKey: String(record.state_key || record.stateKey),
    channel: String(record.channel || 'telegram'),
    userId: record.user_id ? String(record.user_id) : null,
    chatId: record.chat_id ? String(record.chat_id) : null,
    primaryProfileId: record.primary_profile_id ? String(record.primary_profile_id) : null,
    secondaryProfileId: record.secondary_profile_id ? String(record.secondary_profile_id) : null,
    profilePairKey: String(record.profile_pair_key || record.profilePairKey || ''),
    toolName: String(record.tool_name || record.toolName),
    requestHash: String(record.request_hash || record.requestHash),
    cacheMonth: String(record.cache_month || record.cacheMonth || ''),
    source: String(record.source || 'runtime'),
    requestArgs: clone(record.request_args || record.requestArgs || {}),
    response: clone(record.response || {}),
    responseText: record.response_text || record.responseText || null,
    createdAt: record.created_at || record.createdAt || null,
    updatedAt: record.updated_at || record.updatedAt || null,
    lastUsedAt: record.last_used_at || record.lastUsedAt || null
  };
}

function buildMemoryKey(identity, toolName, requestHash, primaryProfileId, secondaryProfileId, cacheMonth) {
  return [
    resolveStateKey(identity),
    String(primaryProfileId || ''),
    String(secondaryProfileId || ''),
    String(toolName || ''),
    String(requestHash || ''),
    String(cacheMonth || '')
  ].join('::');
}

async function findCacheEntry(identity, input) {
  const stateKey = resolveStateKey(identity);
  const profilePairKey = getProfilePairKey(input.primaryProfileId, input.secondaryProfileId);
  const cacheMonth = String(input.cacheMonth || '');

  if (!isSupabaseConfigured()) {
    const key = buildMemoryKey(identity, input.toolName, input.requestHash, input.primaryProfileId, input.secondaryProfileId, cacheMonth);
    return normalizeCacheEntry(memoryEntries.get(key) || null);
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(CACHE_TABLE)
    .select('*')
    .eq('state_key', stateKey)
    .eq('profile_pair_key', profilePairKey)
    .eq('tool_name', input.toolName)
    .eq('request_hash', input.requestHash)
    .eq('cache_month', cacheMonth)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeCacheEntry(data);
}

async function storeCacheEntry(identity, input) {
  const normalized = resolveIdentity(identity);
  const stateKey = resolveStateKey(identity);
  const timestamp = new Date().toISOString();
  const payload = {
    cache_entry_id: input.cacheEntryId || randomUUID(),
    state_key: stateKey,
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    primary_profile_id: input.primaryProfileId || null,
    secondary_profile_id: input.secondaryProfileId || null,
    profile_pair_key: getProfilePairKey(input.primaryProfileId, input.secondaryProfileId),
    tool_name: input.toolName,
    request_hash: input.requestHash,
    cache_month: String(input.cacheMonth || ''),
    source: input.source || 'runtime',
    request_args: canonicalizeArgs(input.requestArgs),
    response: clone(input.response),
    response_text: input.responseText || null,
    created_at: input.createdAt || timestamp,
    updated_at: timestamp,
    last_used_at: timestamp
  };

  if (!isSupabaseConfigured()) {
    const key = buildMemoryKey(identity, payload.tool_name, payload.request_hash, payload.primary_profile_id, payload.secondary_profile_id, payload.cache_month);
    memoryEntries.set(key, payload);
    return normalizeCacheEntry(payload);
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(CACHE_TABLE)
    .upsert(payload, {
      onConflict: 'state_key,profile_pair_key,tool_name,request_hash,cache_month'
    });

  if (error) {
    throw error;
  }

  return normalizeCacheEntry(payload);
}

async function markCacheEntryUsed(identity, entry) {
  const timestamp = new Date().toISOString();

  if (!entry) {
    return;
  }

  if (!isSupabaseConfigured()) {
    const key = buildMemoryKey(identity, entry.toolName, entry.requestHash, entry.primaryProfileId, entry.secondaryProfileId, entry.cacheMonth);
    const current = memoryEntries.get(key);
    if (current) {
      current.last_used_at = timestamp;
      current.updated_at = timestamp;
    }
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(CACHE_TABLE)
    .update({
      last_used_at: timestamp,
      updated_at: timestamp
    })
    .eq('cache_entry_id', entry.cacheEntryId);

  if (error) {
    throw error;
  }
}

async function logToolCall(identity, input) {
  const normalized = resolveIdentity(identity);
  const payload = {
    log_id: randomUUID(),
    state_key: resolveStateKey(identity),
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    primary_profile_id: input.primaryProfileId || null,
    secondary_profile_id: input.secondaryProfileId || null,
    tool_name: input.toolName,
    request_hash: input.requestHash,
    question_text: input.questionText || null,
    cache_hit: Boolean(input.cacheHit),
    cache_entry_id: input.cacheEntryId || null,
    source: input.source || 'runtime',
    request_args: canonicalizeArgs(input.requestArgs),
    created_at: new Date().toISOString()
  };

  if (!isSupabaseConfigured()) {
    memoryLogs.push(payload);
    return payload;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(LOG_TABLE)
    .insert(payload);

  if (error) {
    throw error;
  }

  return payload;
}

function inferCacheMonth(toolName, requestArgs, activeTimezone) {
  if (toolName !== TRANSIT_TOOL) {
    return '';
  }

  const currentMonth = getCurrentMonthWindow(activeTimezone);
  if (!currentMonth) {
    return '';
  }

  return (
    requestArgs?.range_start === currentMonth.rangeStart &&
    requestArgs?.range_end === currentMonth.rangeEnd
  ) ? currentMonth.cacheMonth : '';
}

async function resolveCachedToolCall(identity, input) {
  const requestArgs = canonicalizeArgs(input.requestArgs);
  const requestHash = buildRequestHash(requestArgs);
  const cacheMonth = String(input.cacheMonth || '');

  const cached = await findCacheEntry(identity, {
    toolName: input.toolName,
    requestHash,
    primaryProfileId: input.primaryProfileId,
    secondaryProfileId: input.secondaryProfileId,
    cacheMonth
  });

  if (cached) {
    await markCacheEntryUsed(identity, cached);
    if (input.toolName === TRANSIT_TOOL && input.profile) {
      scheduleAsync('tool-cache.timeline-fact-index', {
        stateKey: resolveStateKey(identity),
        profileId: input.profile.profileId,
        cacheEntryId: cached.cacheEntryId,
        cacheMonth
      }, () => factIndex.safeEnsureTransitFacts(identity, input.profile, cached, { cacheMonth }));
    }
    await logToolCall(identity, {
      ...input,
      requestArgs,
      requestHash,
      cacheHit: true,
      cacheEntryId: cached.cacheEntryId,
      cacheMonth
    });
    return {
      result: clone(cached.response),
      cacheHit: true,
      cacheEntry: cached
    };
  }

  let result;
  try {
    result = await input.executor(requestArgs);
  } catch (error) {
    await logToolCall(identity, {
      ...input,
      requestArgs,
      requestHash,
      cacheHit: false,
      cacheEntryId: null,
      cacheMonth
    });
    throw error;
  }

  const stored = await storeCacheEntry(identity, {
    toolName: input.toolName,
    primaryProfileId: input.primaryProfileId,
    secondaryProfileId: input.secondaryProfileId,
    requestHash,
    requestArgs,
    response: result,
    responseText: result?.text || null,
    cacheMonth,
    source: input.source || 'runtime'
  });

  if (input.toolName === TRANSIT_TOOL && input.profile) {
    scheduleAsync('tool-cache.timeline-fact-index', {
      stateKey: resolveStateKey(identity),
      profileId: input.profile.profileId,
      cacheEntryId: stored.cacheEntryId,
      cacheMonth
    }, () => factIndex.safeEnsureTransitFacts(identity, input.profile, stored, { cacheMonth }));
  }

  await logToolCall(identity, {
    ...input,
    requestArgs,
    requestHash,
    cacheHit: false,
    cacheEntryId: stored.cacheEntryId,
    cacheMonth
  });

  return {
    result,
    cacheHit: false,
    cacheEntry: stored
  };
}

function buildTransitTimelineArgs(profile, monthWindow) {
  if (!profile?.natalRequestPayload || !monthWindow) {
    return null;
  }

  return {
    natal: clone(profile.natalRequestPayload),
    range_start: monthWindow.rangeStart,
    range_end: monthWindow.rangeEnd,
    mode: 'month'
  };
}

function buildNatalInsightsArgs(profile) {
  const natal = profile?.natalRequestPayload;
  if (!natal) {
    return null;
  }

  return {
    year: natal.year,
    month: natal.month,
    day: natal.day,
    hour: natal.time_known === false ? undefined : natal.hour,
    minute: natal.time_known === false ? undefined : natal.minute,
    time_known: natal.time_known !== false,
    city: natal.city,
    lat: natal.lat,
    lng: natal.lng,
    tz_str: natal.tz_str || profile.timezone || 'AUTO',
    house_system: natal.house_system || 'placidus',
    zodiac_type: natal.zodiac_type || 'tropical',
    include_minor_aspects: natal.include_minor_aspects === true,
    include_features: Array.isArray(natal.include_features) ? natal.include_features : ['chiron', 'lilith', 'true_node'],
    lang: 'en'
  };
}

function buildTransitInsightsArgs(profile, monthWindow) {
  const natal = buildNatalInsightsArgs(profile);
  if (!natal || !monthWindow) {
    return null;
  }

  return {
    natal,
    range_start: monthWindow.rangeStart,
    range_end: monthWindow.rangeEnd,
    mode: 'month',
    include_houses: profile.timeKnown !== false,
    transit_planets: ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron', 'true_node'],
    natal_points: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'ascendant', 'midheaven', 'descendant', 'ic'],
    aspect_types: ['conjunction', 'square', 'opposition', 'trine', 'sextile', 'quincunx']
  };
}

async function ensureNatalInsights(identity, profile, options = {}) {
  if (!profile) {
    return null;
  }

  const startedAt = performance.now();
  const stateKey = resolveStateKey(identity);

  const requestArgs = buildNatalInsightsArgs(profile);
  if (!requestArgs) {
    return null;
  }

  const factsReady = await factIndex.hasFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: factIndex.NATAL_SOURCE_KIND,
    cacheMonth: ''
  });
  const factsPending = factIndex.hasPendingSourceWrite(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: factIndex.NATAL_SOURCE_KIND,
    sourceToolName: NATAL_INSIGHTS_TOOL,
    cacheMonth: ''
  });

  if ((factsReady || factsPending) && options.force !== true) {
    info('natal insights ready from indexed facts', {
      stateKey,
      profileId: profile.profileId,
      pending: factsPending,
      durationMs: Math.round(performance.now() - startedAt)
    });
    return {
      skipped: true,
      factsReady: factsReady || factsPending,
      cacheHit: true,
      cacheEntry: null,
      result: null
    };
  }

  try {
    const resolved = await resolveCachedToolCall(identity, {
      toolName: NATAL_INSIGHTS_TOOL,
      requestArgs,
      profile,
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      cacheMonth: '',
      questionText: options.questionText || null,
      source: options.source || 'runtime',
      executor: (args) => getNatalInsights(args)
    });

    const indexTask = () => factIndex.safeStoreNatalInsightFacts(identity, profile, resolved.result, resolved.cacheEntry, {
      sourceToolName: NATAL_INSIGHTS_TOOL
    });

    if (options.awaitIndexing) {
      await indexTask();
    } else {
      scheduleAsync('tool-cache.natal-insights-index', {
        stateKey,
        profileId: profile.profileId,
        cacheEntryId: resolved.cacheEntry?.cacheEntryId || null
      }, indexTask);
    }

    info('natal insights ensured', {
      stateKey,
      profileId: profile.profileId,
      cacheHit: resolved.cacheHit,
      durationMs: Math.round(performance.now() - startedAt)
    });

    return resolved;
  } catch (error) {
    await reportError('tool-cache.natal-insights', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile.profileId
    });
    await factIndex.safeEnsureNatalFacts(identity, profile, { force: options.force });
    return null;
  }
}

async function ensureMonthlyTransitInsights(identity, profile, options = {}) {
  if (!profile) {
    return null;
  }

  const startedAt = performance.now();
  const stateKey = resolveStateKey(identity);

  const monthWindow = getCurrentMonthWindow(profile.timezone || 'UTC');
  const requestArgs = buildTransitInsightsArgs(profile, monthWindow);

  if (!requestArgs || !monthWindow) {
    return null;
  }

  const factsReady = await factIndex.hasFacts(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: factIndex.MONTHLY_TRANSIT_SOURCE_KIND,
    cacheMonth: monthWindow.cacheMonth
  });
  const factsPending = factIndex.hasPendingSourceWrite(identity, {
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    sourceKind: factIndex.MONTHLY_TRANSIT_SOURCE_KIND,
    sourceToolName: TRANSIT_INSIGHTS_TOOL,
    cacheMonth: monthWindow.cacheMonth
  });

  if ((factsReady || factsPending) && options.force !== true) {
    info('monthly transit insights ready from indexed facts', {
      stateKey,
      profileId: profile.profileId,
      cacheMonth: monthWindow.cacheMonth,
      pending: factsPending,
      durationMs: Math.round(performance.now() - startedAt)
    });
    return {
      skipped: true,
      factsReady: factsReady || factsPending,
      cacheHit: true,
      cacheMonth: monthWindow.cacheMonth,
      cacheEntry: null,
      result: null
    };
  }

  try {
    const resolved = await resolveCachedToolCall(identity, {
      toolName: TRANSIT_INSIGHTS_TOOL,
      requestArgs,
      profile,
      primaryProfileId: profile.profileId,
      secondaryProfileId: null,
      cacheMonth: monthWindow.cacheMonth,
      questionText: options.questionText || null,
      source: options.source || 'runtime',
      executor: (args) => getTransitInsights(args)
    });

    const indexTask = () => factIndex.safeStoreTransitInsightFacts(identity, profile, resolved.result, resolved.cacheEntry, {
      cacheMonth: monthWindow.cacheMonth,
      sourceToolName: TRANSIT_INSIGHTS_TOOL
    });

    if (options.awaitIndexing) {
      await indexTask();
    } else {
      scheduleAsync('tool-cache.transit-insights-index', {
        stateKey,
        profileId: profile.profileId,
        cacheEntryId: resolved.cacheEntry?.cacheEntryId || null,
        cacheMonth: monthWindow.cacheMonth
      }, indexTask);
    }

    info('monthly transit insights ensured', {
      stateKey,
      profileId: profile.profileId,
      cacheHit: resolved.cacheHit,
      cacheMonth: monthWindow.cacheMonth,
      durationMs: Math.round(performance.now() - startedAt)
    });

    return {
      ...resolved,
      cacheMonth: monthWindow.cacheMonth
    };
  } catch (error) {
    await reportError('tool-cache.transit-insights', error, {
      stateKey: resolveStateKey(identity),
      profileId: profile.profileId
    });
    const monthlyTransitCache = await getCurrentMonthTransitCache(identity, profile);
    if (monthlyTransitCache) {
      await factIndex.safeEnsureTransitFacts(identity, profile, monthlyTransitCache, {
        cacheMonth: monthlyTransitCache.cacheMonth
      });
    }
    return null;
  }
}

async function ensureMonthlyTransitTimeline(identity, profile, options = {}) {
  if (!profile) {
    return null;
  }

  const monthWindow = getCurrentMonthWindow(profile.timezone || 'UTC');
  const requestArgs = buildTransitTimelineArgs(profile, monthWindow);

  if (!requestArgs) {
    return null;
  }

  const resolved = await resolveCachedToolCall(identity, {
    toolName: TRANSIT_TOOL,
    requestArgs,
    profile,
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    cacheMonth: monthWindow.cacheMonth,
    questionText: options.questionText || null,
    source: options.source || 'runtime',
    executor: (args) => mcpService.callToolByOriginalName(TRANSIT_TOOL, args)
  });

  return {
    ...resolved,
    cacheMonth: monthWindow.cacheMonth
  };
}

async function getCurrentMonthTransitCache(identity, profile) {
  if (!profile) {
    return null;
  }

  const monthWindow = getCurrentMonthWindow(profile.timezone || 'UTC');
  if (!monthWindow) {
    return null;
  }

  const requestArgs = buildTransitTimelineArgs(profile, monthWindow);
  const requestHash = buildRequestHash(canonicalizeArgs(requestArgs));

  return findCacheEntry(identity, {
    toolName: TRANSIT_TOOL,
    requestHash,
    primaryProfileId: profile.profileId,
    secondaryProfileId: null,
    cacheMonth: monthWindow.cacheMonth
  });
}

function prewarmMonthlyTransitTimeline(identity, profile) {
  if (!profile) {
    return;
  }

  Promise.resolve()
    .then(async () => {
      const timelineResult = await ensureMonthlyTransitTimeline(identity, profile, { source: 'prewarm' });
      const insightResult = await ensureMonthlyTransitInsights(identity, profile, { source: 'prewarm' });
      return { timelineResult, insightResult };
    })
    .then(({ timelineResult, insightResult }) => {
      if (!timelineResult && !insightResult) {
        return;
      }

      info('monthly transit prewarm ready', {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId,
        timelineCacheHit: timelineResult?.cacheHit ?? null,
        insightsCacheHit: insightResult?.cacheHit ?? null,
        cacheMonth: timelineResult?.cacheMonth || insightResult?.cacheMonth || null
      });
    })
    .catch((error) => {
      reportError('tool-cache.prewarm-transits', error, {
        stateKey: resolveStateKey(identity),
        profileId: profile.profileId
      });
    });
}

module.exports = {
  NATAL_INSIGHTS_TOOL,
  TRANSIT_INSIGHTS_TOOL,
  TRANSIT_TOOL,
  buildRequestHash,
  canonicalizeArgs,
  ensureNatalInsights,
  ensureMonthlyTransitInsights,
  ensureMonthlyTransitTimeline,
  getCurrentMonthTransitCache,
  getCurrentMonthWindow,
  inferCacheMonth,
  prewarmMonthlyTransitTimeline,
  resolveCachedToolCall
};
