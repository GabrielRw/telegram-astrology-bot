const { performance } = require('node:perf_hooks');
const { detectConversationIntent } = require('../config/conversationIntents');
const {
  getCommonQuestionRouteById
} = require('../config/commonQuestionRoutes');
const {
  getWesternCanonicalRouteById,
  listWesternCanonicalRoutes
} = require('../config/westernCanonicalRoutes');
const factIndex = require('./factIndex');
const mcpService = require('./freeastroMcp');
const profiles = require('./profiles');
const toolCache = require('./toolCache');
const { appendUnmatchedCanonicalQuestion } = require('./unmatchedCanonicalLog');
const { createLocalFunctionDeclarations, generatePlainText, getFastPathModelName, runFunctionCallingLoop } = require('./gemini');
const { info } = require('./logger');
const {
  consumePendingSynastryQuestion,
  getConversationContext,
  getChatState,
  normalizeNatalProfile,
  pushHistory,
  setConversationContext,
  setLastToolResults
} = require('../state/chatState');
const { getLocale } = require('./locale');
const { searchCities } = require('./freeastro');

const LOCALE_INSTRUCTION = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish'
};

const SYNSTRY_TOOL_NAMES = new Set([
  'v1_western_synastry',
  'v1_western_synastry_summary',
  'v1_western_synastry_simplified',
  'v1_western_synastry_horoscope',
  'v1_western_synastrycards'
]);

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

const EXECUTION_FAMILIES = new Set([
  'indexed_natal',
  'indexed_monthly_transits',
  'mcp_transits',
  'mcp_synastry',
  'mcp_relocation',
  'mcp_progressions',
  'mcp_ephemeris',
  'mcp_horoscope',
  'mcp_electional'
]);

const ELECTIONAL_ROUTE_CONFIGS = [
  {
    id: 'wedding_election_search',
    toolTarget: 'v2_western_electional_wedding_search',
    primaryNatalKey: 'partner_a_natal',
    secondaryNatalKey: 'partner_b_natal',
    topicPatterns: [
      /\b(wedding|marriage|marry|mariage|marier|marrier|epouser)\b/
    ]
  },
  {
    id: 'making_contracts_election_search',
    toolTarget: 'v2_western_electional_making_contracts_search',
    primaryNatalKey: 'principal_natal',
    topicPatterns: [
      /\b(contract|contracts|agreement|agreements|contrat|contrats|accord)\b/
    ]
  },
  {
    id: 'job_audition_election_search',
    toolTarget: 'v2_western_electional_job_audition_search',
    primaryNatalKey: 'candidate_natal',
    topicPatterns: [
      /\b(audition|casting)\b/,
      /\b(job|emploi|embauche|career)\b.*\b(interview|entretien|audition)\b/,
      /\b(interview|entretien)\b.*\b(job|emploi|embauche|career)\b/
    ]
  },
  {
    id: 'purchase_property_election_search',
    toolTarget: 'v2_western_electional_purchase_property_search',
    primaryNatalKey: 'buyer_natal',
    topicPatterns: [
      /\b(buy|purchase|acheter|achat)\b.*\b(property|real estate|house|home|apartment|immobilier|maison|appartement|bien immobilier)\b/,
      /\b(property|real estate|immobilier|bien immobilier)\b.*\b(buy|purchase|acheter|achat)\b/
    ]
  },
  {
    id: 'purchase_car_election_search',
    toolTarget: 'v2_western_electional_purchase_car_search',
    primaryNatalKey: 'buyer_natal',
    topicPatterns: [
      /\b(buy|purchase|acheter|achat)\b.*\b(car|vehicle|auto|voiture|vehicule)\b/,
      /\b(car|vehicle|auto|voiture|vehicule)\b.*\b(buy|purchase|acheter|achat)\b/
    ]
  },
  {
    id: 'move_into_new_home_election_search',
    toolTarget: 'v2_western_electional_move_into_new_home_search',
    primaryNatalKey: 'resident_natal',
    topicPatterns: [
      /\b(move into|moving into|move in|new home|new house|new apartment|nouveau logement|nouvelle maison|emmenag|demenag)\b/
    ]
  },
  {
    id: 'starting_journey_election_search',
    toolTarget: 'v2_western_electional_starting_journey_search',
    primaryNatalKey: 'traveler_natal',
    topicPatterns: [
      /\b(journey|trip|travel|traveling|travelling|voyage|voyager|voyagerai|voyagerais|departure|depart|partir)\b/
    ]
  },
  {
    id: 'legal_proceedings_election_search',
    toolTarget: 'v2_western_electional_legal_proceedings_search',
    primaryNatalKey: 'plaintiff_natal',
    topicPatterns: [
      /\b(legal proceedings|lawsuit|court case|legal action|hearing|tribunal|proces|procedure judiciaire|justice)\b/
    ]
  },
  {
    id: 'physical_examination_election_search',
    toolTarget: 'v2_western_electional_physical_examination_search',
    primaryNatalKey: 'patient_natal',
    topicPatterns: [
      /\b(physical examination|medical examination|medical exam|checkup|check-up|doctor appointment|medical appointment|medical test|examen medical|examen physique|visite medicale|bilan de sante)\b/
    ]
  },
  {
    id: 'invest_money_election_search',
    toolTarget: 'v2_western_electional_invest_money_search',
    primaryNatalKey: 'investor_natal',
    topicPatterns: [
      /\b(invest|investment|investir|investissement|placement|portfolio|bourse)\b/
    ]
  }
];

const ELECTIONAL_ROUTE_CONFIG_BY_ID = new Map(
  ELECTIONAL_ROUTE_CONFIGS.map((config) => [config.id, config])
);

const ELECTIONAL_ROUTE_IDS = new Set(
  ELECTIONAL_ROUTE_CONFIGS.map((config) => config.id)
);

const ELECTIONAL_TIMING_CUE_PATTERN = /\b(best|better|good|when|quand|date|day|jour|journee|journée|hour|heure|moment|timing|election|electional|favorable|favourable|auspicious|ideal|optimal|meilleur(?:e)?|bonne?\s+date|bon\s+moment|this year|this month|cette annee|cette annee|cette année|ce mois|should i|devrais[- ]?je)\b/;

const RAW_INTERPRETIVE_PATTERNS = [
  /\bthis means\b/i,
  /\bthis suggests\b/i,
  /\byou tend to\b/i,
  /\byou are likely to\b/i,
  /\btu as tendance à\b/i,
  /\bcela signifie\b/i,
  /\bcela sugg[èe]re\b/i,
  /\bdas bedeutet\b/i,
  /\bdas deutet darauf hin\b/i,
  /\besto significa\b/i,
  /\besto sugiere\b/i
];

function findPlanet(profile, planet) {
  const key = String(planet || '').trim().toLowerCase();
  return profile?.planetsById?.[key] || null;
}

function findHouse(profile, house) {
  return profile?.housesById?.[String(house)] || null;
}

function findAngle(profile, angle) {
  return profile?.angles?.[String(angle || '').trim().toLowerCase()] || null;
}

function describeSynastryContext(context) {
  if (!context?.secondaryProfile) {
    return 'No comparison profile selected.';
  }

  return [
    `Active profile: ${context.activeProfile.profileName}`,
    `Comparison profile: ${context.secondaryProfile.profileName}`,
    'For relationship questions, default to synastry summary first and use full synastry only if the summary is insufficient.'
  ].join('\n');
}

function buildSystemInstruction(chatState, mcpStatus, intent, options = {}) {
  const profileSummary = options.subjectProfileSummary || chatState.natalProfile?.summaryText || 'No natal profile available.';
  const locale = getLocale(chatState);
  const relocationRules = intent.id === 'relocation'
    ? [
        'Relocation and astrocartography should prefer FreeAstro MCP astrocartography tools unless the local cache already answers the question clearly.',
        'If relocation data is incomplete, ask for the smallest missing detail instead of guessing.'
      ]
    : [];

  const lines = [
    'You are a concise professional astrologer answering natal-chart questions in a messaging chat.',
    `Always answer in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Write in plain text only. Do not use Markdown emphasis, especially **.',
    'Keep each response block short. Aim for multiple small blocks, with no block over 80 words.',
    'Do not repeat the same point twice in one answer, even in different wording.',
    'Ground every answer in the user natal chart, cached tool results, or explicit tool results.',
    'Never invent placements, houses, angles, aspects, timings, or predictions.',
    'If information is missing, say so clearly and ask a narrow follow-up only when required.',
    'If the user asks for transits, ephemeris, or a month-specific forecast and the needed date window is missing, first prefer the cached monthly transit timeline.',
    'Do not give medical, legal, or financial advice.',
    'Never answer personal astrology questions without natal data.',
    'For natal and monthly transit questions, prefer search_cached_profile_facts first when the local index clearly covers the request.',
    'If indexed facts are weak, incomplete, or do not match the requested scope, continue with the relevant FreeAstro MCP tools instead of forcing a local-only answer.',
    'Use only indexed facts, cached local tools, and the declared FreeAstro MCP tools.',
    'When using tool data, interpret it like an astrologer, but stay specific to the chart and concise.',
    'Never answer a system or clarification question with an astrology reading.',
    `Response mode: ${options.responseMode || 'interpreted'}.`,
    ...relocationRules,
    `Conversation route: ${options.routeKind || 'astrology_natal'}.`,
    `Common route match: ${options.commonRouteId || 'none'}.`,
    `Required answer style: ${options.answerStyle || 'natal_theme'}.`,
    `Response perspective: ${options.responsePerspective || 'second_person'}.`,
    `Target profile label: ${options.targetProfileLabel || options.activeProfileName || 'Chart User'}.`,
    `Detected user intent: ${intent.id}.`,
    `Routing guidance: ${intent.guidance}`,
    `Preferred cached tools: ${intent.prefersCachedTools.join(', ') || 'none'}.`,
    `Execution target preference: ${options.executionTarget || 'auto'}.`,
    `Preferred result family: ${options.executionFamily || 'auto'}.`,
    'Preferred MCP tool family should match the selected execution family.',
    `MCP status: ${mcpStatus}.`,
    `Active profile name: ${options.activeProfileName || 'Unknown'}.`,
    `Indexed natal facts: ${options.factAvailability?.hasNatalFacts ? 'available' : 'not indexed yet'}.`,
    `Indexed monthly transit facts: ${options.factAvailability?.indexedTransitCacheMonth || 'not indexed for the active month'}.`,
    `Cached monthly transit timeline: ${options.monthlyTransitAvailable ? 'available for the active month' : 'not cached yet'}.`
  ];

  if (options.includeNatalSummary !== false) {
    lines.push(
      '',
      'Natal profile facts:',
      profileSummary
    );
  }

  lines.push(
    '',
    'Synastry context:',
    describeSynastryContext(options.synastryContext)
  );

  if (options.responseMode === 'raw') {
    lines.push(
      '',
      'Raw mode is active.',
      'Never interpret, infer meaning, or produce an astrologer-style reading.',
      'Only organize and present literal grounded results, values, dates, titles, and tool outputs in a clean readable structure.'
    );
  }

  return lines.join('\n');
}

function shouldUseThirdPersonVoice(userText, subjectProfile, activeProfile) {
  if (!subjectProfile?.profileId) {
    return false;
  }

  if (!activeProfile?.profileId) {
    return detectThirdPartyPronoun(userText);
  }

  if (subjectProfile.profileId !== activeProfile.profileId) {
    return true;
  }

  return detectThirdPartyPronoun(userText);
}

function getLastResolvedQuestion(conversationContext, history = [], userText = '') {
  if (conversationContext?.lastResolvedQuestion) {
    return String(conversationContext.lastResolvedQuestion);
  }

  const previousUserQuestion = (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'user' && String(item.text || '').trim() !== String(userText || '').trim());

  return previousUserQuestion?.text || null;
}

function getPreviousUserQuestion(history = [], userText = '') {
  return (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'user' && String(item.text || '').trim() !== String(userText || '').trim())
    ?.text || null;
}

function getPreviousAssistantAnswer(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'model' && String(item.text || '').trim())
    ?.text || null;
}

function truncateArtifactSummary(text, maxLength = 320) {
  const normalized = normalizeAssistantText(text);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getLastAnswerArtifact(conversationContext) {
  if (!conversationContext?.lastAnswerArtifact || typeof conversationContext.lastAnswerArtifact !== 'object') {
    return null;
  }

  const artifact = conversationContext.lastAnswerArtifact;
  return {
    family: artifact.family ? String(artifact.family) : null,
    routeKind: artifact.routeKind ? String(artifact.routeKind) : null,
    routeId: artifact.routeId ? String(artifact.routeId) : null,
    summary: artifact.summary ? String(artifact.summary) : null,
    toolNames: Array.isArray(artifact.toolNames) ? artifact.toolNames.map((value) => String(value)) : []
  };
}

function buildConversationAnswerArtifact(route, executionIntent = null, queryState = null, finalText = '', toolResults = []) {
  const routeId = queryState?.canonicalRouteId || route?.commonRouteId || null;
  const toolNames = asArray(toolResults)
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean)
    .slice(-4);

  return {
    family: executionIntent?.family || route?.kind || null,
    routeKind: route?.kind || null,
    routeId,
    summary: truncateArtifactSummary(finalText),
    toolNames
  };
}

function sanitizeStructuredQueryPatch(patch = {}) {
  if (!patch || typeof patch !== 'object') {
    return {};
  }

  const next = {};
  const normalizedPlanet = patch.planet ? parsePlanetFromQuestion(String(patch.planet)) : null;
  const normalizedTransitPlanet = patch.transitPlanet ? parseTransitPlanetFromQuestion(String(patch.transitPlanet)) : null;
  const normalizedNatalPoint = patch.natalPoint ? parseNatalPointFromQuestion(String(patch.natalPoint)) : null;
  const normalizedFocus = patch.focus ? parseFocusFromQuestion(String(patch.focus)) : null;
  const normalizedCountryScope = typeof patch.countryScope === 'string'
    ? String(patch.countryScope).trim().toLowerCase()
    : null;
  const normalizedCountries = Array.isArray(patch.countries)
    ? patch.countries
      .map((value) => sanitizeCountryCode(value))
      .filter(Boolean)
    : [];
  const normalizedAspectTypes = Array.isArray(patch.aspectTypes)
    ? patch.aspectTypes
      .map((value) => parseAspectTypesFromQuestion(String(value)))
      .flat()
      .filter(Boolean)
    : [];

  if (normalizedPlanet) {
    next.planet = normalizedPlanet;
  }

  if (normalizedTransitPlanet) {
    next.transitPlanet = normalizedTransitPlanet;
  }

  if (normalizedNatalPoint) {
    next.natalPoint = normalizedNatalPoint;
  }

  if (normalizedAspectTypes.length > 0) {
    next.aspectTypes = [...new Set(normalizedAspectTypes)];
  }

  if (patch.aspectClass === 'major' || patch.aspectClass === 'minor') {
    next.aspectClass = patch.aspectClass;
  }

  if (typeof patch.sort === 'string' && patch.sort.trim()) {
    next.sort = patch.sort.trim();
  }

  if (typeof patch.timeframe === 'string' && patch.timeframe.trim()) {
    next.timeframe = patch.timeframe.trim();
  }

  if (normalizedFocus) {
    next.focus = normalizedFocus;
  }

  if (['own_country', 'selected_countries', 'all'].includes(normalizedCountryScope || '')) {
    next.countryScope = normalizedCountryScope;
  }

  if (normalizedCountries.length > 0) {
    next.countries = normalizedCountries;
  }

  if (typeof patch.body === 'string' && patch.body.trim()) {
    next.body = patch.body.trim();
  }

  if (typeof patch.sign === 'string' && patch.sign.trim()) {
    next.sign = patch.sign.trim();
  }

  if (typeof patch.limit === 'number' && Number.isFinite(patch.limit) && patch.limit > 0) {
    next.limit = Math.min(Math.round(patch.limit), 200);
  }

  if (typeof patch.durationDays === 'number' && Number.isFinite(patch.durationDays) && patch.durationDays > 0) {
    next.durationDays = Math.min(Math.round(patch.durationDays), 366);
  }

  const normalizedRangeStart = parseIsoDateString(patch.rangeStart);
  const normalizedRangeEnd = parseIsoDateString(patch.rangeEnd);
  if (normalizedRangeStart && normalizedRangeEnd && normalizedRangeStart <= normalizedRangeEnd) {
    next.rangeStart = normalizedRangeStart;
    next.rangeEnd = normalizedRangeEnd;
  }

  if (patch.month && typeof patch.month === 'object') {
    const year = Number(patch.month.year);
    const month = Number(patch.month.month);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      next.month = { year, month };
    }
  }

  if (patch.fullListing === true || patch.fullListing === false) {
    next.fullListing = patch.fullListing;
  }

  return next;
}

function getLastQueryState(conversationContext) {
  if (!conversationContext?.lastQueryState || typeof conversationContext.lastQueryState !== 'object') {
    return null;
  }

  const value = conversationContext.lastQueryState;
  return {
    canonicalRouteId: value.canonicalRouteId ? String(value.canonicalRouteId) : null,
    routeKind: value.routeKind ? String(value.routeKind) : null,
    baseQuestion: value.baseQuestion ? String(value.baseQuestion) : null,
    parameters: sanitizeStructuredQueryPatch(value.parameters || {})
  };
}

function parseDurationDaysFromQuestion(text) {
  const value = String(text || '').toLowerCase();
  const match = value.match(/\b(?:for|de|sur|pendant|over)?\s*(\d{1,3})\s*(?:days?|jours?)\b/i);
  const days = match ? Number(match[1]) : null;
  return Number.isFinite(days) && days > 0 ? days : null;
}

function inferStructuredQueryParameters(routeId, text, subjectProfile, timezone = 'UTC') {
  const value = String(text || '');
  const explicitDateRange = parseExplicitDateRangeFromQuestion(value, timezone);
  const explicitSingleDate = explicitDateRange ? null : parseExplicitSingleDateFromQuestion(value, timezone);
  const limit = parseRequestedResultLimit(value);
  const strongest = wantsStrongestSubset(value);
  const parsedMonth = (explicitDateRange || explicitSingleDate) ? null : parseMonthFromQuestion(value, timezone);
  const wantsToday = /\b(today|aujourd'hui|aujourdhui|du jour|heute|hoy)\b/i.test(value);
  const wantsWeek = /\b(this week|current week|for the week|de la semaine|cette semaine|semaine en cours|diese woche|esta semana)\b/i.test(value);
  const explicitYear = parseYearFromQuestion(value);
  const durationDays = parseDurationDaysFromQuestion(value);

  if (ELECTIONAL_ROUTE_IDS.has(routeId)) {
    const wantsCurrentMonth = /\b(this month|ce mois|ce mois ci|dieser monat|este mes)\b/i.test(value);
    const wantsCurrentYear = /\b(this year|cette annee|cette année|dieses jahr|este ano|este año)\b/i.test(value);
    return sanitizeStructuredQueryPatch({
      rangeStart: explicitDateRange?.start || null,
      rangeEnd: explicitDateRange?.end || null,
      ...(explicitSingleDate ? {
        rangeStart: explicitSingleDate.start,
        rangeEnd: explicitSingleDate.end
      } : {}),
      month: parsedMonth,
      timeframe: explicitDateRange
        ? 'explicit_range'
        : explicitSingleDate
        ? 'explicit_day'
        : durationDays
        ? 'rolling_days'
        : parsedMonth
        ? 'specific_month'
        : wantsToday
        ? 'current_day'
        : wantsWeek
        ? 'current_week'
        : wantsCurrentMonth
        ? 'current_month'
        : (explicitYear || wantsCurrentYear)
        ? 'current_year'
        : null,
      durationDays,
      limit
    });
  }

  switch (routeId) {
    case 'all_natal_aspects':
      return sanitizeStructuredQueryPatch({
        planet: parsePlanetFromQuestion(value),
        aspectClass: wantsMinorAspects(value) ? 'minor' : 'major',
        limit,
        sort: strongest ? 'strength_desc' : null,
        fullListing: true
      });
    case 'current_sky_today':
    case 'today_transits_me':
      return sanitizeStructuredQueryPatch({
        timeframe: 'current_day',
        limit,
        sort: strongest ? 'strength_desc' : null
      });
    case 'month_ahead_transits':
    case 'all_monthly_transits':
      return sanitizeStructuredQueryPatch({
        month: parsedMonth,
        timeframe: parsedMonth ? 'specific_month' : (wantsToday ? 'current_day' : (wantsWeek ? 'current_week' : 'current_month')),
        limit,
        sort: strongest ? 'strength_desc' : null,
        fullListing: routeId === 'all_monthly_transits'
      });
    case 'monthly_transits_for_planet':
      return sanitizeStructuredQueryPatch({
        planet: parseRequestedMonthlyTransitPlanet(value) || parsePlanetFromQuestion(value),
        month: parsedMonth,
        timeframe: parsedMonth ? 'specific_month' : (wantsToday ? 'current_day' : (wantsWeek ? 'current_week' : 'current_month')),
        limit,
        sort: strongest ? 'strength_desc' : null
      });
    case 'transit_search_exact': {
      const timeframe = /\b(depuis ma naissance|since birth|since i was born|from birth)\b/i.test(value)
        ? 'since_birth'
        : parsedMonth
        ? 'specific_month'
        : parseYearFromQuestion(value)
        ? 'specific_year'
        : null;
      return sanitizeStructuredQueryPatch({
        transitPlanet: parseTransitPlanetFromQuestion(value),
        natalPoint: parseNatalPointFromTransitSearchQuestion(value),
        aspectTypes: parseAspectTypesFromQuestion(value),
        month: parsedMonth,
        timeframe,
        limit,
        fullListing: wantsFullListingRequest(value)
      });
    }
    case 'ephemeris':
      return sanitizeStructuredQueryPatch({
        month: parsedMonth,
        fullListing: wantsFullListingRequest(value)
      });
    default:
      return {};
  }
}

function buildStructuredQueryState({
  route,
  canonicalRoute,
  commonRoute,
  userText,
  plannerQuestionText,
  conversationContext,
  subjectProfile,
  explicitFollowUp,
  timezone = 'UTC'
}) {
  const previousState = getLastQueryState(conversationContext);
  const inferredRouteId = canonicalRoute?.id
    || commonRoute?.id
    || route?.commonRouteId
    || (
      route?.kind === 'astrology_transits'
        ? (
            isExplicitTransitSearchQuestion(plannerQuestionText || userText)
              ? 'transit_search_exact'
              : (/\b(today|aujourd'hui|aujourdhui|du jour|heute|hoy)\b/i.test(String(plannerQuestionText || userText || ''))
                  ? (/\b(current sky|sky|ciel du jour|ciel actuel)\b/i.test(String(plannerQuestionText || userText || ''))
                      ? 'current_sky_today'
                      : 'today_transits_me')
                : (parseRequestedMonthlyTransitPlanet(plannerQuestionText || userText) ? 'monthly_transits_for_planet' : 'month_ahead_transits')
                )
          )
        : (
          route?.kind === 'astrology_natal' && /\baspect/i.test(String(plannerQuestionText || userText || ''))
            ? 'all_natal_aspects'
            : null
        )
    );
  const routeId = explicitFollowUp?.canonicalRouteId
    || inferredRouteId
    || (explicitFollowUp ? previousState?.canonicalRouteId : null)
    || null;
  const reusesPreviousState = Boolean(explicitFollowUp && previousState && previousState.canonicalRouteId === routeId);
  const baseQuestion = reusesPreviousState
    ? (previousState.baseQuestion || plannerQuestionText || userText)
    : (plannerQuestionText || userText);
  let parameters = reusesPreviousState
    ? { ...(previousState.parameters || {}) }
    : inferStructuredQueryParameters(routeId, plannerQuestionText || userText, subjectProfile, timezone);

  if (!reusesPreviousState && explicitFollowUp?.rewrittenQuestion && explicitFollowUp.rewrittenQuestion !== plannerQuestionText) {
    parameters = {
      ...parameters,
      ...inferStructuredQueryParameters(routeId, explicitFollowUp.rewrittenQuestion, subjectProfile, timezone)
    };
  }

  if (explicitFollowUp?.queryPatch) {
    parameters = {
      ...parameters,
      ...sanitizeStructuredQueryPatch(explicitFollowUp.queryPatch)
    };
  }

  return {
    canonicalRouteId: routeId,
    routeKind: route?.kind || canonicalRoute?.routeKind || previousState?.routeKind || null,
    baseQuestion,
    parameters: sanitizeStructuredQueryPatch(parameters)
  };
}

function parseRequestedResultLimit(text) {
  const value = String(text || '').toLowerCase();
  const patterns = [
    /\btop\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s+(?:transits?|aspects?|results?|r[ée]sultats?)\b/i,
    /\buniquement\s+les?\s+(\d{1,3})\b/i,
    /\bseulement\s+les?\s+(\d{1,3})\b/i,
    /\bonly\s+the\s+(\d{1,3})\b/i,
    /\bjust\s+the\s+(\d{1,3})\b/i,
    /\bles?\s+(\d{1,3})\s+plus\s+forts?\b/i,
    /\bthe\s+(\d{1,3})\s+strongest\b/i,
    /\b(\d{1,3})\s+les?\s+plus\s+forts?\b/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, 200);
      }
    }
  }

  return null;
}

function looksLikeReferentialFollowUp(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value || value.length > 220) {
    return false;
  }

  const referentialCue = /\b(this|that|these|those|it|them|ce|cette|ces|cela|ca|ça|das|diese|dieser|esto|eso|estos|esas|esa)\b/i.test(value);
  const followUpCue = /\b(why|verify|recheck|check|confirm|clarify|explain|details?|meaning|factors?|risks?|cautions?|which one|which ones|what about|and in|and for|pourquoi|verifie|vérifie|confirme|explique|detaille|détaille|plus de details|plus de détails|facteurs?|risques?|prudence|quels?|quelles?|et en|et pour|welche|warum|prufe|prüfe|erklare|erkläre|faktoren|risiken|y en|y para|verifica|explica|detalles|factores|riesgos)\b/i.test(value);
  const shortReferential = /^(?:ok|okay|d accord|dac|alors|et|and|und|y|dis moi|tell me)\b/i.test(value);

  return (referentialCue && followUpCue) || shortReferential || followUpCue;
}

function detectArtifactFollowUpLocally(userText, conversationContext, history = []) {
  const value = String(userText || '').trim();
  const artifact = getLastAnswerArtifact(conversationContext);
  const lastResolvedQuestion = getLastResolvedQuestion(conversationContext, history, userText);
  const lastQueryState = getLastQueryState(conversationContext);
  const lastRouteKind = conversationContext?.lastResponseRoute || null;

  if (!artifact || !lastResolvedQuestion || !lastRouteKind) {
    return null;
  }

  if (looksLikeStandaloneAstrologyQuery(value) && !looksLikeReferentialFollowUp(value)) {
    return null;
  }

  if (!looksLikeReferentialFollowUp(value)) {
    return null;
  }

  return {
    followUpType: 'artifact_follow_up',
    rewrittenQuestion: `${lastQueryState?.baseQuestion || lastResolvedQuestion}\n\nFollow-up request: ${value}`,
    routeKind: lastRouteKind,
    canonicalRouteId: lastQueryState?.canonicalRouteId || artifact.routeId || null,
    artifactFamily: artifact.family || null
  };
}

function wantsStrongestSubset(text) {
  return /\b(plus forts?|strongest|top)\b/i.test(String(text || ''));
}

function looksLikeStandaloneAstrologyQuery(text) {
  if (inferElectionalRouteConfigFromQuestion(text)) {
    return true;
  }

  const value = String(text || '').toLowerCase();
  const hasCoreTopic = /(transits?|aspects?|theme|thème|chart|ephemerides|éphémérides|solar return|retour solaire|relocation|synastr)/.test(value);
  const hasSpecificScope = (
    /(ce mois|ce mois ci|ce mois-ci|this month|since birth|depuis ma naissance|from birth|soleil|sun|lune|moon|mercure|mercury|venus|mars|jupiter|saturne|saturn|uranus|neptune|pluton|pluto|chiron)/.test(value) ||
    parseAspectTypesFromQuestion(value).length > 0
  );
  return (hasCoreTopic && hasSpecificScope) || isBroadRelocationRecommendationQuestion(value);
}

function wantsMinorAspects(text) {
  return /\b(minor(?:\s+\w+)?\s+aspects?|aspects?\s+mineurs?)\b/i.test(String(text || ''));
}

function wantsFullListingRequest(text) {
  return /\b(absolutely all|every single|full list|list every|list all|all exact|absolument toutes?|absolument tous|toutes? les|liste compl[eè]te|liste exhaustive)\b/i.test(String(text || ''));
}

function looksLikeStandaloneCityReply(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 80) {
    return false;
  }

  if (looksLikeStandaloneAstrologyQuery(value)) {
    return false;
  }

  if (parsePlanetFromQuestion(value) || parseSignFromQuestion(value) || parseFocusFromQuestion(value)) {
    return false;
  }

  const normalized = normalizeMatchingText(value);
  return /^[a-z'., -]{2,}$/i.test(normalized) && normalized.split(/\s+/).filter(Boolean).length <= 5;
}

function looksLikeStandaloneRelocationFocusReply(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 40) {
    return false;
  }

  if (looksLikeStandaloneAstrologyQuery(value)) {
    return false;
  }

  const focus = parseFocusFromQuestion(value);
  if (!focus) {
    return false;
  }

  const normalized = normalizeMatchingText(value)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return false;
  }

  if (/\b(where|best|live|relocate|move|vivre|habiter|meilleur|meilleure|meilleures|endroit|ville|lieu|monde|world|dans|pour moi)\b/.test(normalized)) {
    return false;
  }

  return normalized.split(/\s+/).filter(Boolean).length <= 3;
}

function buildQuantitativeFollowUpQuestion(lastResolvedQuestion, limit, conversationContext) {
  if (!lastResolvedQuestion || !limit) {
    return null;
  }

  const lastQueryState = getLastQueryState(conversationContext);
  const baseQuestion = lastQueryState?.baseQuestion || lastResolvedQuestion;
  const routeId = conversationContext?.lastCommonRouteId || null;
  if (routeId === 'monthly_transits_for_planet') {
    return `${baseQuestion}\n\nReturn only the top ${limit} strongest monthly transits related to the requested planet.`;
  }

  if (routeId === 'month_ahead_transits' || routeId === 'all_monthly_transits') {
    return `${baseQuestion}\n\nReturn only the top ${limit} strongest transits from that month.`;
  }

  if (routeId === 'all_natal_aspects') {
    return `${baseQuestion}\n\nReturn only the top ${limit} strongest major aspects.`;
  }

  return `${baseQuestion}\n\nReturn only the top ${limit} strongest results.`;
}

function buildTopicFollowUpQuestion(topic, lastRouteKind) {
  const normalizedTopic = String(topic || '').toLowerCase();
  const transitMode = lastRouteKind === 'astrology_transits';

  switch (normalizedTopic) {
    case 'love':
    case 'relationship':
    case 'relationships':
      return transitMode ? 'What is happening in love for me right now?' : 'What are my relationship patterns?';
    case 'money':
      return transitMode ? 'What is happening with money for me right now?' : 'What is my relationship with money?';
    case 'career':
    case 'work':
      return transitMode ? 'What is happening in my career right now?' : 'What is my career signature?';
    case 'family':
    case 'home':
      return transitMode ? 'What is happening with home and family for me right now?' : 'What is my family pattern in the chart?';
    case 'spiritual':
      return transitMode ? 'What is happening spiritually for me right now?' : 'What is my spiritual path?';
    case 'mind':
    case 'mental':
      return transitMode ? 'What is happening mentally for me right now?' : 'What does Mercury say about my mind?';
    case 'emotion':
    case 'emotions':
      return transitMode ? 'What is happening emotionally for me right now?' : 'What does the Moon say about my emotions?';
    default:
      return null;
  }
}

function detectExplicitFollowUp(userText, conversationContext, history = []) {
  const value = String(userText || '').trim();
  const normalized = value.toLowerCase();
  const lastRouteKind = conversationContext?.lastResponseRoute || null;
  const lastQueryState = getLastQueryState(conversationContext);

  if (!lastRouteKind || ['system_meta', 'clarification', 'profile_management'].includes(lastRouteKind)) {
    return null;
  }

  const lastResolvedQuestion = getLastResolvedQuestion(conversationContext, history, userText);

  const topicSwitch = normalized.match(/^(?:and|et|und|y|also|what about|quid de|et pour|und was ist mit|que hay de)\s+(love|relationship|relationships|money|career|work|family|home|spiritual|mind|mental|emotion|emotions)\??$/i);
  if (topicSwitch) {
    const rewrittenQuestion = buildTopicFollowUpQuestion(topicSwitch[1], lastRouteKind);
    if (rewrittenQuestion) {
      return {
        followUpType: 'topic_switch',
        rewrittenQuestion,
        routeKind: lastRouteKind
      };
    }
  }

  if (/^(?:why|why is that|go deeper|explain more|more detail|more details|develop|développe|detaille|détaille|mehr details|explica mas)\??$/i.test(normalized) && lastResolvedQuestion) {
    return {
      followUpType: 'drill_down',
      rewrittenQuestion: `${lastResolvedQuestion}\n\nExplain this in more detail.`,
      routeKind: lastRouteKind
    };
  }

  if (/^(?:today specifically|right now specifically|and today|and now|aujourdhui precisement|maintenant precisement|heute genau|ahora mismo precisamente)\??$/i.test(normalized) && lastResolvedQuestion && lastRouteKind === 'astrology_transits') {
    return {
      followUpType: 'timing_refinement',
      rewrittenQuestion: `${lastResolvedQuestion}\n\nFocus on today specifically.`,
      routeKind: lastRouteKind
    };
  }

  const relocationFocus = parseFocusFromQuestion(value);
  if (
    lastResolvedQuestion &&
    lastRouteKind === 'astrology_relocation' &&
    relocationFocus &&
    looksLikeStandaloneRelocationFocusReply(value)
  ) {
    return {
      followUpType: 'relocation_focus_refinement',
      rewrittenQuestion: `${lastQueryState?.baseQuestion || lastResolvedQuestion}\n\nFocus on ${relocationFocus}.`,
      routeKind: lastRouteKind,
      queryPatch: {
        focus: relocationFocus
      }
    };
  }

  if (
    lastResolvedQuestion &&
    lastRouteKind === 'astrology_relocation' &&
    looksLikeStandaloneCityReply(value)
  ) {
    return {
      followUpType: 'relocation_city_reply',
      rewrittenQuestion: `${lastQueryState?.baseQuestion || lastResolvedQuestion}\n\nSelected city: ${value}`,
      routeKind: lastRouteKind
    };
  }

  const requestedDurationDays = parseDurationDaysFromQuestion(value);
  if (
    requestedDurationDays &&
    lastResolvedQuestion &&
    ELECTIONAL_ROUTE_IDS.has(lastQueryState?.canonicalRouteId || '')
  ) {
    return {
      followUpType: 'electional_duration_refinement',
      rewrittenQuestion: `${lastQueryState?.baseQuestion || lastResolvedQuestion}\n\nUse a ${requestedDurationDays}-day search window starting today.`,
      routeKind: lastRouteKind,
      canonicalRouteId: lastQueryState?.canonicalRouteId || null,
      queryPatch: {
        timeframe: 'rolling_days',
        durationDays: requestedDurationDays
      }
    };
  }

  const explicitElectionalRange = parseExplicitDateRangeFromQuestion(value);
  const explicitElectionalSingleDate = explicitElectionalRange ? null : parseExplicitSingleDateFromQuestion(value);
  if (
    (explicitElectionalRange || explicitElectionalSingleDate) &&
    lastResolvedQuestion &&
    ELECTIONAL_ROUTE_IDS.has(lastQueryState?.canonicalRouteId || '')
  ) {
    const range = explicitElectionalRange || explicitElectionalSingleDate;
    return {
      followUpType: 'electional_window_refinement',
      rewrittenQuestion: `${lastQueryState?.baseQuestion || lastResolvedQuestion}\n\nUse a search window from ${range.start} to ${range.end}.`,
      routeKind: lastRouteKind,
      canonicalRouteId: lastQueryState?.canonicalRouteId || null,
      queryPatch: {
        timeframe: 'explicit_range',
        rangeStart: range.start,
        rangeEnd: range.end
      }
    };
  }

  if (
    lastResolvedQuestion &&
    conversationContext?.lastCommonRouteId === 'all_natal_aspects' &&
    /^(?:(?:and|et|und|y)\s+)?(?:(?:les?|the)\s+)?(?:(?:minor|mineurs?)\s+)?aspects?\s*\??$|^(?:(?:and|et|und|y)\s+)?(?:(?:les?|the)\s+)?aspects?\s+(?:mineurs?|minor)\s*\??$/i.test(normalized)
  ) {
    const previousUserQuestion = lastQueryState?.baseQuestion || getPreviousUserQuestion(history, userText);
    return {
      followUpType: 'aspect_scope_refinement',
      rewrittenQuestion: `${previousUserQuestion || lastResolvedQuestion}\n\nReturn the minor natal aspects only.`,
      routeKind: lastRouteKind,
      queryPatch: {
        aspectClass: 'minor'
      }
    };
  }

  const requestedLimit = parseRequestedResultLimit(normalized);
  if (
    requestedLimit &&
    lastResolvedQuestion &&
    !looksLikeStandaloneAstrologyQuery(normalized) &&
    /^(?:retourne|montre|affiche|donne|garde|only|just|show|return|keep|uniquement|seulement|juste|les?|the|top|\d+)/i.test(normalized) &&
    (wantsStrongestSubset(normalized) || /^(?:retourne|montre|affiche|donne|only|just|show|return|uniquement|seulement)/i.test(normalized))
  ) {
    const rewrittenQuestion = buildQuantitativeFollowUpQuestion(lastResolvedQuestion, requestedLimit, conversationContext);
    if (rewrittenQuestion) {
      return {
        followUpType: 'quantitative_limit',
        rewrittenQuestion,
        routeKind: lastRouteKind,
        queryPatch: {
          limit: requestedLimit,
          sort: 'strength_desc'
        }
      };
    }
  }

  return null;
}

function detectConversationRoute(text, history = []) {
  const value = String(text || '').trim();
  const normalized = value.toLowerCase();
  const intent = detectConversationIntent(value, history);
  const repeatsPreviousQuestion = /\b(same question|same thing|same request|same for|for him too|for her too|for elie too|for gabriel too)\b/i.test(value)
    || /\b(r[ée]ponds? [àa] la m[êe]me question|la m[êe]me question|pareil pour|m[êe]me chose pour)\b/i.test(value);

  if (/\b(how many|combien|list|liste|which|quel|quelle)\b.*\b(profile|profiles|profil|profils)\b/i.test(value) ||
      /\bactive profile\b/i.test(value) ||
      /\bprofil actif\b/i.test(value)) {
    return { kind: 'system_meta', intent, answerStyle: 'system_answer' };
  }

  if (/^(tu parles de moi|tu parle de moi|are you talking about me|do you mean me|tu parles de lui|tu parles d'elle|are you talking about him|are you talking about her)\??$/i.test(normalized)) {
    return { kind: 'clarification', intent, answerStyle: 'system_answer' };
  }

  if (/\b(add|switch|change|use|select|set)\b.*\b(profile|profil)\b/i.test(value) ||
      /\b(ajoute|ajouter|change|changer|utilise|utiliser|sélectionne|selectionne)\b.*\b(profil|profile)\b/i.test(value)) {
    return { kind: 'profile_management', intent, answerStyle: 'system_answer' };
  }

  if (intent.id === 'relocation') {
    return { kind: 'astrology_relocation', intent, answerStyle: 'system_answer' };
  }

  if (repeatsPreviousQuestion) {
    return {
      kind: 'astrology_natal',
      intent,
      answerStyle: 'natal_theme',
      inheritsPreviousQuestion: true
    };
  }

  if (isExplicitTransitSearchQuestion(value)) {
    return {
      kind: 'astrology_transits',
      intent: {
        ...intent,
        id: 'transits',
        guidance: 'Use transit search MCP tools for exact planet-to-point aspect searches across a date range or since birth.'
      },
      answerStyle: 'personal_transits'
    };
  }

  if (intent.id === 'synastry' || /\b(compare|comparison|compatib|synastry|between\b.+\band\b|compare\b.+\b(et|and)\b)\b/i.test(value)) {
    return { kind: 'astrology_synastry', intent, answerStyle: 'synastry' };
  }

  if (intent.id === 'transits' || /\b(current sky|sky right now|today|aujourd'hui|right now|ce mois|this month|current energies|du jour)\b/i.test(value)) {
    return {
      kind: 'astrology_transits',
      intent: { ...intent, id: 'transits' },
      answerStyle: /\b(current sky|sky|ciel du jour|ciel actuel)\b/i.test(value) ? 'current_sky' : 'personal_transits'
    };
  }

  return {
    kind: 'astrology_natal',
    intent,
    answerStyle: deriveDefaultAnswerStyle(intent, value)
  };
}

function isExplicitDailyTransitQuestion(text) {
  const value = String(text || '').toLowerCase();

  if (!value) {
    return false;
  }

  const mentionsTransit = /\btransits?\b|\btr[áa]nsitos?\b/.test(value);
  const mentionsDay = /\btoday\b|\baujourd'hui\b|\baujourdhui\b|\bdu jour\b|\bheute\b|\bhoy\b/.test(value);
  const mentionsHoroscope = /\bhoroscope\b/.test(value);
  const mentionsSky = /\bcurrent sky\b|\bsky\b|\bciel du jour\b|\bciel actuel\b/.test(value);

  return mentionsTransit && mentionsDay && !mentionsHoroscope && !mentionsSky;
}

function deriveDefaultAnswerStyle(intent, userText) {
  const value = String(userText || '').toLowerCase();

  if (intent?.id === 'major_aspects') {
    return 'aspect_focus';
  }

  if (intent?.id === 'house_question') {
    return 'house_focus';
  }

  if (intent?.id === 'planet_placement' || intent?.id === 'rising_sign') {
    return 'planet_focus';
  }

  if (/\b(rare|rares|signature|signatures|career|work|love|money|purpose|relationship|patterns?|sch[ée]mas)\b/i.test(value)) {
    return 'life_area_theme';
  }

  return 'natal_theme';
}

function detectThirdPartyPronoun(text) {
  return /\b(son|sa|ses|lui|elle|leur|leurs|his|her|hers|him|their|them)\b/i.test(String(text || ''));
}

const EXTERNAL_PROFILE_ROUTE_KINDS = new Set([
  'astrology_natal',
  'astrology_transits',
  'astrology_synastry',
  'astrology_relocation',
  'astrology_progressions',
  'astrology_profections',
  'astrology_returns',
  'astrology_ephemeris',
  'astrology_horoscope'
]);

const NON_PROFILE_NAME_TOKENS = new Set([
  'mon', 'ma', 'mes', 'moi', 'me', 'my', 'mine', 'meu', 'pour', 'for', 'about', 'avec', 'with',
  'et', 'and', 'und', 'y', 'why', 'pourquoi',
  'theme', 'thème', 'astro', 'astral', 'natal', 'chart', 'birth', 'carte', 'profil', 'profile',
  'horoscope', 'transit', 'transits', 'progression', 'progressions', 'profection', 'profections',
  'solar', 'return', 'returns', 'ephemeris', 'ephemerides', 'éphémérides', 'synastrie', 'synastry',
  'relocation', 'relocalisation', 'relocalisation', 'astrocartography', 'astrocartographie',
  'day', 'days', 'week', 'month', 'year', 'jour', 'jours', 'semaine', 'mois', 'annee', 'année', 'today', 'today?', 'tomorrow', 'hier', 'demain', 'cette', 'this',
  'career', 'work', 'love', 'home', 'family', 'wellbeing', 'health', 'creativity', 'spiritual',
  'carrière', 'amour', 'foyer', 'famille', 'bien-être', 'santé', 'créativité', 'spirituel',
  'wedding', 'marriage', 'marry', 'mariage', 'marier', 'marrier', 'epouser',
  'contract', 'contracts', 'agreement', 'agreements', 'contrat', 'contrats', 'accord',
  'audition', 'interview', 'entretien', 'embauche', 'emploi', 'casting',
  'property', 'real', 'estate', 'house', 'apartment', 'immobilier', 'maison', 'appartement', 'bien',
  'car', 'vehicle', 'auto', 'voiture', 'vehicule',
  'journey', 'trip', 'travel', 'traveling', 'travelling', 'voyage', 'voyager', 'voyagerai', 'voyagerais', 'departure', 'depart', 'partir',
  'legal', 'proceedings', 'lawsuit', 'court', 'hearing', 'tribunal', 'proces', 'justice',
  'physical', 'examination', 'medical', 'exam', 'checkup', 'check-up', 'doctor', 'bilan',
  'invest', 'investment', 'investir', 'investissement', 'placement', 'money', 'argent', 'portfolio', 'bourse',
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturne', 'uranus', 'neptune',
  'pluto', 'pluton', 'node', 'north', 'south', 'ascendant', 'mc', 'ic', 'descendant'
]);

function normalizeExternalProfileCandidate(candidate) {
  return String(candidate || '')
    .trim()
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’?!.,:;]+$/g, '')
    .replace(/\s+/g, ' ');
}

function isLikelyExternalProfileName(candidate) {
  const normalized = normalizeExternalProfileCandidate(candidate);
  const normalizedMatchText = normalizeMatchingText(normalized);

  if (!normalized || normalized.length < 2 || normalized.length > 60) {
    return false;
  }

  if (/\b(this|current|cette|cet|ce|esta|este|dieses|dieser)\s+(year|month|week|annee|année|mois|semaine|ano|año|mes|woche|jahr)\b/i.test(normalizedMatchText)) {
    return false;
  }

  const tokens = normalized
    .split(/[\s'-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  if (parseMonthFromQuestion(normalized, 'UTC') || parseYearFromQuestion(normalized)) {
    return false;
  }

  if (/\b\d{4}\b/.test(normalized) || /^\d+$/.test(normalized.replace(/\s+/g, ''))) {
    return false;
  }

  if (parseDurationDaysFromQuestion(normalized)) {
    return false;
  }

  if (tokens.some((token) => NON_PROFILE_NAME_TOKENS.has(token))) {
    return false;
  }

  if (tokens.every((token) => token.length === 1)) {
    return false;
  }

  return true;
}

function extractRequestedExternalProfileName(userText, route, activeProfile, savedProfiles = []) {
  if (!EXTERNAL_PROFILE_ROUTE_KINDS.has(route?.kind)) {
    return null;
  }

  if (inferElectionalRouteConfigFromQuestion(userText)) {
    return null;
  }

  if (route?.kind === 'astrology_ephemeris' || route?.kind === 'astrology_relocation') {
    return null;
  }

  const value = String(userText || '').trim();
  if (!value) {
    return null;
  }

  const normalizedValue = value.replace(/[?!.,:;]+$/g, '').trim();
  const activeName = String(activeProfile?.profileName || '').trim().toLowerCase();
  const savedNames = new Set(
    savedProfiles
      .map((profile) => String(profile?.profileName || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const patterns = [
    /\b(?:theme|thème|chart|profil|profile|horoscope|transits?|progressions?|profections?|solar return|return|returns?|synastr(?:y|ie)|relocali(?:sation|zation)|astro(?:cartography|cartographie)?|ephemeris|éphémérides?)\b(?:\s+\w+){0,5}?\s+(?:de|d'|du profil de|du thème de|for|about)\s+(.+)$/iu,
    /\b(?:parle(?:\s+moi)?|talk(?:\s+to\s+me)?|tell\s+me|show\s+me|fais|faites|do|give)\b(?:\s+\w+){0,5}?\s+(?:de|d'|for|about)\s+(.+)$/iu,
    /\b(?:pour|for)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,60})$/u
  ];

  for (const pattern of patterns) {
    const match = normalizedValue.match(pattern);
    const candidate = normalizeExternalProfileCandidate(match?.[1]);

    if (!candidate || !isLikelyExternalProfileName(candidate)) {
      continue;
    }

    const loweredCandidate = candidate.toLowerCase();
    if (loweredCandidate === activeName) {
      return null;
    }

    if (savedNames.has(loweredCandidate)) {
      return null;
    }

    return candidate;
  }

  return null;
}

function buildSystemMetaResponse(locale, chatState, activeProfile) {
  const profiles = Array.isArray(chatState.profileDirectory) ? chatState.profileDirectory : [];
  const activeName = activeProfile?.profileName || profiles.find((profile) => profile.isActive)?.profileName || null;

  if (locale === 'fr') {
    if (profiles.length === 0) {
      return 'Aucun profil sauvegardé pour le moment.';
    }

    if (activeName) {
      return `${profiles.length} profil${profiles.length > 1 ? 's' : ''} sauvegardé${profiles.length > 1 ? 's' : ''}. Le profil actif est ${activeName}.`;
    }

    return `${profiles.length} profil${profiles.length > 1 ? 's' : ''} sauvegardé${profiles.length > 1 ? 's' : ''}.`;
  }

  if (profiles.length === 0) {
    return 'There are no saved profiles yet.';
  }

  if (activeName) {
    return `There ${profiles.length === 1 ? 'is' : 'are'} ${profiles.length} saved profile${profiles.length === 1 ? '' : 's'}. The active profile is ${activeName}.`;
  }

  return `There ${profiles.length === 1 ? 'is' : 'are'} ${profiles.length} saved profile${profiles.length === 1 ? '' : 's'}.`;
}

function buildProfileManagementResponse(locale) {
  return locale === 'fr'
    ? 'Je peux gérer les profils, mais il faut préciser l’action: ajouter un profil, changer le profil actif, ou afficher les profils sauvegardés.'
    : 'I can manage profiles, but I need the exact action: add a profile, switch the active profile, or list saved profiles.';
}

function buildMissingExternalProfileResponse(locale, profileName = null) {
  if (locale === 'fr') {
    return profileName
      ? `Je n’ai pas encore de profil enregistré pour ${profileName}. J’ai besoin de son nom et de ses données de naissance pour le créer.`
      : 'Je n’ai pas encore ce profil enregistré. J’ai besoin du nom et des données de naissance de cette personne pour le créer.';
  }

  if (locale === 'de') {
    return profileName
      ? `Ich habe noch kein gespeichertes Profil für ${profileName}. Ich brauche den Namen und die Geburtsdaten, um es anzulegen.`
      : 'Ich habe dieses Profil noch nicht gespeichert. Ich brauche den Namen und die Geburtsdaten dieser Person, um es anzulegen.';
  }

  if (locale === 'es') {
    return profileName
      ? `Todavía no tengo un perfil guardado para ${profileName}. Necesito su nombre y sus datos de nacimiento para crearlo.`
      : 'Todavía no tengo este perfil guardado. Necesito el nombre y los datos de nacimiento de esa persona para crearlo.';
  }

  return profileName
    ? `I do not have a saved profile for ${profileName} yet. I need their name and birth details to create it.`
    : 'I do not have this profile saved yet. I need this person’s name and birth details to create it.';
}

function buildClarificationResponse(locale, activeProfile, referencedProfile, conversationContext) {
  const lastResponseProfileId = conversationContext?.lastResponseProfileId || null;
  const talkingAboutActive = activeProfile?.profileId && lastResponseProfileId === activeProfile.profileId;
  const targetName = referencedProfile?.profileName || activeProfile?.profileName || 'this profile';

  if (locale === 'fr') {
    if (!lastResponseProfileId) {
      return 'Je n’avais pas de cible clairement établie dans ma réponse précédente.';
    }

    return talkingAboutActive
      ? `Oui, je parlais bien de vous, c’est-à-dire du profil actif ${targetName}.`
      : `Non, je parlais de ${targetName}, pas de vous.`;
  }

  if (!lastResponseProfileId) {
    return 'I did not have a clearly established subject in my previous answer.';
  }

  return talkingAboutActive
    ? `Yes, I was talking about you, meaning the active profile ${targetName}.`
    : `No, I was talking about ${targetName}, not you.`;
}

function inheritRouteFromConversation(route, conversationContext, userText) {
  if (!route?.inheritsPreviousQuestion) {
    return route;
  }

  const lastRouteKind = conversationContext?.lastResponseRoute || null;
  const lastIntentId = conversationContext?.lastIntentId || null;
  const lastAnswerStyle = conversationContext?.lastAnswerStyle || null;

  if (!lastRouteKind || lastRouteKind === 'system_meta' || lastRouteKind === 'clarification' || lastRouteKind === 'profile_management') {
    return route;
  }

  const nextIntentId = lastIntentId || (lastRouteKind === 'astrology_transits' ? 'transits' : route.intent?.id || 'fallback');

  return {
    ...route,
    kind: lastRouteKind,
    intent: {
      ...(route.intent || {}),
      id: nextIntentId
    },
    answerStyle: ANSWER_STYLES.has(lastAnswerStyle) ? lastAnswerStyle : route.answerStyle,
    inheritedFromPreviousQuestion: true,
    inheritedPrompt: String(userText || '').trim()
  };
}

function resolveQuestionForPlanner(route, userText, history = []) {
  if (!route?.inheritedFromPreviousQuestion) {
    return String(userText || '');
  }

  const previousUserQuestion = (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'user' && String(item.text || '').trim() !== String(userText || '').trim());

  return previousUserQuestion?.text || String(userText || '');
}

function buildEffectiveUserQuestion(route, userText, plannerQuestionText, subjectProfile) {
  if (!route?.inheritedFromPreviousQuestion) {
    return String(userText || '');
  }

  const profileName = subjectProfile?.profileName || 'the referenced profile';
  return `${plannerQuestionText}\n\nAnswer this for ${profileName}.`;
}

function buildCanonicalRouteCatalog(routeKind = null) {
  return listWesternCanonicalRoutes(routeKind ? { routeKind } : {})
    .map((route) => ({
      id: route.id,
      routeKind: route.routeKind,
      family: route.family,
      scope: route.scope,
      answerStyle: route.answerStyle,
      intentSample: route.intentSample,
      matchHint: route.matchHint || null,
      aliases: Array.isArray(route.aliases) ? route.aliases.slice(0, 8) : []
    }));
}

function buildCanonicalHintRouteForExecutionFamily(route, family = null) {
  if (!family) {
    return route;
  }

  switch (family) {
    case 'indexed_monthly_transits':
    case 'mcp_transits':
    case 'mcp_progressions':
    case 'mcp_ephemeris':
    case 'mcp_horoscope':
    case 'mcp_electional':
      return { ...route, kind: 'astrology_transits' };
    case 'indexed_natal':
      return { ...route, kind: 'astrology_natal' };
    case 'mcp_synastry':
      return { ...route, kind: 'astrology_synastry' };
    case 'mcp_relocation':
      return { ...route, kind: 'astrology_relocation' };
    default:
      return route;
  }
}

function shouldUseDirectCanonicalMcpExecution(executionIntent, canonicalRoute = null) {
  if (executionIntent?.target !== 'mcp') {
    return false;
  }

  if (!canonicalRoute?.toolTarget) {
    return false;
  }

  return (
    executionIntent.family === 'mcp_synastry' ||
    executionIntent.family === 'mcp_relocation' ||
    executionIntent.family === 'mcp_progressions' ||
    executionIntent.family === 'mcp_ephemeris' ||
    executionIntent.family === 'mcp_horoscope' ||
    executionIntent.family === 'mcp_electional'
  );
}

function getElectionalRouteConfig(routeId = null) {
  return routeId ? (ELECTIONAL_ROUTE_CONFIG_BY_ID.get(routeId) || null) : null;
}

function inferElectionalRouteConfigFromQuestion(text) {
  const value = normalizeMatchingText(text);
  if (!value) {
    return null;
  }

  if (!ELECTIONAL_TIMING_CUE_PATTERN.test(value)) {
    return null;
  }

  return ELECTIONAL_ROUTE_CONFIGS.find((config) => config.topicPatterns.some((pattern) => pattern.test(value))) || null;
}

function inferDirectCanonicalRouteForExecutionFamily(executionIntent, userText, queryState = null) {
  const existing = queryState?.canonicalRouteId
    ? getWesternCanonicalRouteById(queryState.canonicalRouteId)
    : null;
  const value = normalizeMatchingText(userText);
  switch (executionIntent?.family) {
    case 'mcp_relocation': {
      if (
        /\bwhere should i (?:relocate|live|move)\b|\bbest places? to live\b|\bwhere is the best place .* live\b|\bo[uù]\b.*\b(?:habiter|vivre|d[ée]m[ée]nager|relocaliser)\b|\bmeilleur(?:e)?(?:s)? (?:endroit|ville|lieu|places?) .*vivre\b/.test(value)
      ) {
        return getWesternCanonicalRouteById('relocation_recommendations');
      }
      if (/selected city:/i.test(String(userText || ''))) {
        return getWesternCanonicalRouteById('relocation_city_check');
      }
      if (/\b(check|city|ville|what about|living in|vivre a|vivre a|habiter a|habiter a)\b/.test(value)) {
        return getWesternCanonicalRouteById('relocation_city_check');
      }
      return existing?.toolTarget ? existing : getWesternCanonicalRouteById('relocation_recommendations');
    }
    case 'mcp_progressions':
      if (/\bprofection/.test(value)) {
        return getWesternCanonicalRouteById('annual_profections');
      }
      if (/\bsolar return\b|\bretour solaire\b/.test(value)) {
        return getWesternCanonicalRouteById('solar_return');
      }
      if (/\bexact\b.*\bprogress/.test(value) || /\bprogress.*\bexact/.test(value)) {
        return getWesternCanonicalRouteById('secondary_progressions_exact_aspects');
      }
      if (/\bsecondary progress/.test(value) || /\bprogressions? secondaires?\b/.test(value)) {
        return getWesternCanonicalRouteById('secondary_progressions');
      }
      return existing?.toolTarget ? existing : null;
    case 'mcp_synastry':
      if (/\bcouples?\s+horoscope\b|\brelationship horoscope\b|\bhoroscope de couple\b/.test(value)) {
        return getWesternCanonicalRouteById('couples_horoscope');
      }
      if (/\bdetailed synastry\b|\bfull synastry\b|\bsynastrie detaillee\b|\bsynastrie complete\b/.test(value)) {
        return getWesternCanonicalRouteById('synastry_detailed');
      }
      if (/\bcompare\b|\bcompatibilit(?:y|e)\b|\bsynastr(?:y|ie)\b/.test(value)) {
        return existing?.toolTarget ? existing : getWesternCanonicalRouteById('synastry_summary');
      }
      return existing?.toolTarget ? existing : null;
    case 'mcp_ephemeris':
      return /\bephemerides?\b|\bephemeris\b|\beph[eé]m[eé]rides?\b/.test(value)
        ? getWesternCanonicalRouteById('ephemeris')
        : (existing?.toolTarget ? existing : null);
    case 'mcp_horoscope':
      return /\bhoroscope\b/.test(value)
        ? getWesternCanonicalRouteById('personal_horoscope')
        : (existing?.toolTarget ? existing : null);
    case 'mcp_electional': {
      const electionalConfig = inferElectionalRouteConfigFromQuestion(value);
      if (electionalConfig) {
        return getWesternCanonicalRouteById(electionalConfig.id);
      }
      return ELECTIONAL_ROUTE_IDS.has(existing?.id) ? existing : null;
    }
    default:
      return existing?.toolTarget ? existing : null;
  }
}

async function resolveCanonicalCommonRouteWithAi(locale, userText, route) {
  const catalog = buildCanonicalRouteCatalog(route?.kind || null);

  if (catalog.length === 0) {
    return null;
  }

  const systemInstruction = [
    'You map a user astrology question to the closest existing canonical question route.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: canonicalQuestionId, confidence, reason.',
    'canonicalQuestionId must be one of the provided route ids, or null if none fits well.',
    'confidence must be a number between 0 and 1.',
    'Prefer the closest semantic match even when the wording is different.',
    'Only return null when the question is truly outside the supported western registry.'
  ].join('\n');

  const prompt = [
    `User question: ${String(userText || '').trim()}`,
    `Detected route kind hint: ${route?.kind || 'unknown'}`,
    'The detected route kind can be wrong. Infer the best canonical route from the full question semantics.',
    'Canonical routes:',
    JSON.stringify(catalog),
    '',
    'Return JSON now.'
  ].join('\n');

  let parsed = null;

  try {
    parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
  } catch (error) {
    info('canonical route ai match failed', {
      routeKind: route?.kind || null,
      error: error?.message || String(error)
    });
    const nextError = new Error('Canonical route AI matching is unavailable.');
    nextError.code = 'CANONICAL_ROUTE_AI_UNAVAILABLE';
    nextError.cause = error;
    throw nextError;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const confidence = Number(parsed.confidence || 0);
  const selected = getWesternCanonicalRouteById(parsed.canonicalQuestionId);

  if (!selected || !Number.isFinite(confidence) || confidence < 0.62) {
    return null;
  }

  return {
    ...selected,
    score: confidence,
    aiMatched: true,
    aiReason: parsed.reason ? String(parsed.reason) : null
  };
}

async function resolveFollowUpWithAi(locale, userText, conversationContext, route) {
  const lastResolvedQuestion = getLastResolvedQuestion(conversationContext, [], userText);
  const lastQueryState = getLastQueryState(conversationContext);
  if (!lastResolvedQuestion) {
    return null;
  }

  const value = String(userText || '').trim();
  if (!value || value.length > 120) {
    return null;
  }

  if (looksLikeStandaloneAstrologyQuery(value)) {
    return null;
  }

  const systemInstruction = [
    'You detect whether a short astrology user message is a follow-up to the previous question.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: isFollowUp, rewrittenQuestion, refinement, confidence, reason.',
    'The refinement object may contain only these keys: planet, transitPlanet, natalPoint, aspectTypes, aspectClass, limit, sort, timeframe, month, rangeStart, rangeEnd, focus, body, sign, fullListing.',
    'If it is a follow-up, rewrite it as one complete standalone astrology question that preserves the previous scope and adds the new refinement.',
    'If it is not a follow-up, set isFollowUp to false and rewrittenQuestion to null.'
  ].join('\n');

  const prompt = [
    `Current short message: ${value}`,
    `Previous resolved question: ${lastResolvedQuestion}`,
    `Previous base question: ${lastQueryState?.baseQuestion || 'none'}`,
    `Previous canonical route id: ${conversationContext?.lastCommonRouteId || 'none'}`,
    `Previous route kind: ${conversationContext?.lastResponseRoute || route?.kind || 'unknown'}`,
    `Previous execution target: ${conversationContext?.lastExecutionTarget || 'unknown'}`,
    `Previous result family: ${conversationContext?.lastResultFamily || 'unknown'}`,
    'Return JSON now.'
  ].join('\n');

  let parsed = null;
  try {
    parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
  } catch (_error) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const confidence = Number(parsed.confidence || 0);
  const queryPatch = sanitizeStructuredQueryPatch(parsed.refinement || {});
  if (parsed.isFollowUp !== true || confidence < 0.7 || (!parsed.rewrittenQuestion && Object.keys(queryPatch).length === 0)) {
    return null;
  }

  return {
    followUpType: 'ai_follow_up',
    rewrittenQuestion: parsed.rewrittenQuestion
      ? String(parsed.rewrittenQuestion)
      : (lastQueryState?.baseQuestion || lastResolvedQuestion),
    queryPatch,
    routeKind: conversationContext?.lastResponseRoute || route?.kind || null
  };
}

async function resolveArtifactFollowUpWithAi(locale, userText, conversationContext, history = [], route = null) {
  const artifact = getLastAnswerArtifact(conversationContext);
  const lastResolvedQuestion = getLastResolvedQuestion(conversationContext, history, userText);
  const lastQueryState = getLastQueryState(conversationContext);
  const lastAssistantAnswer = getPreviousAssistantAnswer(history);

  if (!artifact || !lastResolvedQuestion) {
    return null;
  }

  const value = String(userText || '').trim();
  if (!value || value.length > 220) {
    return null;
  }

  if (looksLikeStandaloneAstrologyQuery(value) && !looksLikeReferentialFollowUp(value)) {
    return null;
  }

  const systemInstruction = [
    'You detect whether the user is referring to the previous astrology answer, even when the wording is short, vague, or indirect.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: isFollowUp, intentType, rewrittenQuestion, confidence, reason.',
    'intentType must be one of: explain_previous_answer, verify_previous_answer, refine_previous_answer, compare_previous_answer, new_question.',
    'If it is a follow-up, rewrite it as one complete standalone astrology question that keeps the previous scope and target.'
  ].join('\n');

  const prompt = [
    `Current message: ${value}`,
    `Previous resolved question: ${lastResolvedQuestion}`,
    `Previous route kind: ${conversationContext?.lastResponseRoute || route?.kind || 'unknown'}`,
    `Previous result family: ${artifact.family || conversationContext?.lastResultFamily || 'unknown'}`,
    `Previous route id: ${artifact.routeId || conversationContext?.lastCommonRouteId || 'unknown'}`,
    `Previous artifact summary: ${artifact.summary || 'none'}`,
    `Previous answer excerpt: ${truncateArtifactSummary(lastAssistantAnswer || '', 420) || 'none'}`,
    'Return JSON now.'
  ].join('\n');

  let parsed = null;
  try {
    parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
  } catch (_error) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const confidence = Number(parsed.confidence || 0);
  if (parsed.isFollowUp !== true || confidence < 0.72 || !parsed.rewrittenQuestion) {
    return null;
  }

  return {
    followUpType: 'artifact_ai_follow_up',
    rewrittenQuestion: String(parsed.rewrittenQuestion),
    routeKind: conversationContext?.lastResponseRoute || route?.kind || null,
    canonicalRouteId: lastQueryState?.canonicalRouteId || artifact.routeId || null,
    artifactFamily: artifact.family || null,
    artifactIntentType: parsed.intentType ? String(parsed.intentType) : null
  };
}

async function extractTransitSearchRefinementWithAi(locale, userText, subjectProfile, currentQueryState = null) {
  if (currentQueryState?.canonicalRouteId !== 'transit_search_exact') {
    return {
      patch: null,
      confidence: 0,
      usedAiTransitSearchExtraction: false
    };
  }

  const value = String(userText || '').trim();
  if (!value) {
    return {
      patch: null,
      confidence: 0,
      usedAiTransitSearchExtraction: false
    };
  }

  const timezone = subjectProfile?.timezone || subjectProfile?.birthTimezone || subjectProfile?.rawNatalPayload?.subject?.location?.timezone || 'UTC';
  const systemInstruction = [
    'You extract structured parameters for an exact astrology transit-search question.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: transitPlanet, natalPoint, aspectTypes, timeframe, month, fullListing, confidence.',
    'transitPlanet must be one of: sun, moon, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto, chiron.',
    'natalPoint must be one of: sun, moon, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto, chiron, ascendant, descendant, midheaven, ic.',
    'aspectTypes must contain only: conjunction, square, opposition, trine, sextile.',
    'timeframe must be one of: since_birth, specific_month, specific_year, current_year, null.',
    'fullListing must be true when the user explicitly asks for every single hit, absolutely all hits, a full list, or an exhaustive list.',
    'When the user asks "between X and Y", treat the first body as the transiting body and the second as the natal point unless the wording clearly says otherwise.',
    'Do not swap Mercury and Sun just because one is more common in astrology examples.',
    'If the user mentions "since birth" or "depuis ma naissance", timeframe must be since_birth.',
    'confidence must be a number between 0 and 1.'
  ].join('\n');

  const prompt = [
    `User question: ${value}`,
    `Timezone: ${timezone}`,
    `Current deterministic parameters: ${JSON.stringify(currentQueryState?.parameters || {})}`,
    'Examples:',
    '- "Show exact Saturn transits to my Moon since birth" -> {"transitPlanet":"saturn","natalPoint":"moon","aspectTypes":[],"timeframe":"since_birth","confidence":0.95}',
    '- "Retourne toutes les oppositions entre mercure et le soleil depuis ma naissance" -> {"transitPlanet":"mercury","natalPoint":"sun","aspectTypes":["opposition"],"timeframe":"since_birth","fullListing":true,"confidence":0.96}',
    '- "Return all trines between Jupiter and my Moon in 2027" -> {"transitPlanet":"jupiter","natalPoint":"moon","aspectTypes":["trine"],"timeframe":"specific_year","confidence":0.94}',
    'Return JSON now.'
  ].join('\n');

  try {
    const parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));

    if (!parsed || typeof parsed !== 'object') {
      return {
        patch: null,
        confidence: 0,
        usedAiTransitSearchExtraction: false
      };
    }

    const confidence = Number(parsed.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < 0.68) {
      return {
        patch: null,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        usedAiTransitSearchExtraction: false
      };
    }

    return {
      patch: sanitizeStructuredQueryPatch({
        transitPlanet: parsed.transitPlanet || null,
        natalPoint: parsed.natalPoint || null,
        aspectTypes: Array.isArray(parsed.aspectTypes) ? parsed.aspectTypes : [],
        timeframe: typeof parsed.timeframe === 'string' ? parsed.timeframe : null,
        month: parsed.month && typeof parsed.month === 'object' ? parsed.month : null,
        fullListing: parsed.fullListing === true
      }),
      confidence,
      usedAiTransitSearchExtraction: true
    };
  } catch (_error) {
    return {
      patch: null,
      confidence: 0,
      usedAiTransitSearchExtraction: false
    };
  }
}

async function extractFullListingPreferenceWithAi(locale, userText, currentQueryState = null) {
  const routeId = currentQueryState?.canonicalRouteId || null;
  if (!['all_natal_aspects', 'ephemeris'].includes(routeId)) {
    return {
      fullListing: null,
      confidence: 0,
      usedAiFullListingExtraction: false
    };
  }

  const value = String(userText || '').trim();
  if (!value) {
    return {
      fullListing: null,
      confidence: 0,
      usedAiFullListingExtraction: false
    };
  }

  const systemInstruction = [
    'You classify whether the user explicitly wants an exhaustive full listing rather than a summary or a top subset.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object with exactly these keys: fullListing, confidence.',
    'fullListing must be true only when the user clearly asks for absolutely all results, a complete list, an exhaustive list, or every single entry.',
    'If the user asks a normal overview, short answer, top subset, or unspecified default answer, fullListing must be false.',
    'confidence must be a number between 0 and 1.'
  ].join('\n');

  const prompt = [
    `Route: ${routeId}`,
    `User question: ${value}`,
    'Examples:',
    '- "show me all my aspects" -> {"fullListing":true,"confidence":0.96}',
    '- "donne-moi absolument toutes mes éphémérides pour mai 2027" -> {"fullListing":true,"confidence":0.97}',
    '- "parle moi de mes aspects" -> {"fullListing":false,"confidence":0.88}',
    '- "give me the ephemeris for may 2027" -> {"fullListing":false,"confidence":0.82}',
    'Return JSON now.'
  ].join('\n');

  try {
    const parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));

    if (!parsed || typeof parsed !== 'object') {
      return {
        fullListing: null,
        confidence: 0,
        usedAiFullListingExtraction: false
      };
    }

    const confidence = Number(parsed.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < 0.72 || typeof parsed.fullListing !== 'boolean') {
      return {
        fullListing: null,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        usedAiFullListingExtraction: false
      };
    }

    return {
      fullListing: parsed.fullListing,
      confidence,
      usedAiFullListingExtraction: true
    };
  } catch (_error) {
    return {
      fullListing: null,
      confidence: 0,
      usedAiFullListingExtraction: false
    };
  }
}

async function maybeRefineStructuredQueryStateWithAi(locale, userText, subjectProfile, currentQueryState = null) {
  if (!currentQueryState?.canonicalRouteId) {
    return currentQueryState;
  }

  if (currentQueryState.canonicalRouteId === 'transit_search_exact') {
    const aiRefinement = await extractTransitSearchRefinementWithAi(
      locale,
      userText,
      subjectProfile,
      currentQueryState
    );

    const refinementPatch = aiRefinement?.patch && typeof aiRefinement.patch === 'object'
      ? aiRefinement.patch
      : null;
    const nextParameters = refinementPatch && Object.keys(refinementPatch).length > 0
      ? sanitizeStructuredQueryPatch({
          ...(currentQueryState.parameters || {}),
          ...refinementPatch
        })
      : (currentQueryState.parameters || {});

    return {
      ...currentQueryState,
      parameters: nextParameters,
      transitSearchExtractionMeta: {
        usedAiTransitSearchExtraction: Boolean(aiRefinement?.usedAiTransitSearchExtraction),
        aiExtractionConfidence: Number(aiRefinement?.confidence || 0)
      }
    };
  }

  if (['all_natal_aspects', 'ephemeris'].includes(currentQueryState.canonicalRouteId)) {
    const fullListingPreference = await extractFullListingPreferenceWithAi(locale, userText, currentQueryState);
    if (typeof fullListingPreference.fullListing !== 'boolean') {
      return currentQueryState;
    }

    return {
      ...currentQueryState,
      parameters: sanitizeStructuredQueryPatch({
        ...(currentQueryState.parameters || {}),
        fullListing: fullListingPreference.fullListing
      }),
      fullListingExtractionMeta: {
        usedAiFullListingExtraction: Boolean(fullListingPreference.usedAiFullListingExtraction),
        aiFullListingConfidence: Number(fullListingPreference.confidence || 0)
      }
    };
  }

  return currentQueryState;
}

function buildTransitSearchWindowFromQueryState(queryState, subjectProfile, timezone = 'UTC') {
  const month = queryState?.parameters?.month;
  if (month && typeof month === 'object') {
    const range = buildMonthDateRange(month);
    if (range) {
      return {
        range_start: range.start,
        range_end: range.end,
        timeframe: 'specific_month'
      };
    }
  }

  const timeframe = queryState?.parameters?.timeframe || null;
  if (timeframe === 'since_birth') {
    const birthDate = buildBirthDateStringFromProfile(subjectProfile);
    if (!birthDate) {
      return null;
    }

    const currentDate = getDateStringInTimezone(timezone);
    const birthYear = Number(String(birthDate).slice(0, 4));
    const currentYear = getCurrentLocalDateParts(timezone).year;
    const ageYears = Math.max(0, currentYear - birthYear);

    if (ageYears <= 50) {
      return {
        range_start: birthDate,
        range_end: currentDate,
        timeframe
      };
    }

    return {
      age_start_years: 0,
      age_end_years: 50,
      timeframe
    };
  }

  if (timeframe === 'current_year') {
    const range = buildCurrentYearRange(timezone);
    return {
      range_start: range.start,
      range_end: range.end,
      timeframe
    };
  }

  return null;
}

function inferTransitSearchTimeframeFromQuestion(userText, timezone = 'UTC') {
  const value = String(userText || '').toLowerCase();
  if (/\b(depuis ma naissance|since birth|since i was born|from birth)\b/i.test(value)) {
    return 'since_birth';
  }
  if (parseMonthFromQuestion(userText, timezone)) {
    return 'specific_month';
  }
  if (/\b(this year|cette annee|cette année)\b/i.test(value)) {
    return 'current_year';
  }
  if (parseYearFromQuestion(userText)) {
    return 'specific_year';
  }
  return null;
}

function summarizeTransitSearchExtractionMeta(queryState, userText, subjectProfile, timezone = 'UTC') {
  const aiMeta = queryState?.transitSearchExtractionMeta || {};
  const queryTransitPlanet = queryState?.parameters?.transitPlanet || null;
  const queryNatalPoint = queryState?.parameters?.natalPoint || null;
  const queryAspectTypes = Array.isArray(queryState?.parameters?.aspectTypes)
    ? queryState.parameters.aspectTypes
    : [];
  const queryWindow = buildTransitSearchWindowFromQueryState(queryState, subjectProfile, timezone);
  const fallbackTransitPlanet = queryTransitPlanet ? null : parseTransitPlanetFromQuestion(userText);
  const fallbackNatalPoint = queryNatalPoint ? null : parseNatalPointFromTransitSearchQuestion(userText);
  const fallbackAspectTypes = queryAspectTypes.length > 0 ? [] : parseAspectTypesFromQuestion(userText);
  const fallbackWindow = queryWindow ? null : buildTransitSearchWindow(userText, subjectProfile, timezone);
  const finalTimeframe = queryWindow?.timeframe || queryState?.parameters?.timeframe || inferTransitSearchTimeframeFromQuestion(userText, timezone);

  return {
    transitPlanet: queryTransitPlanet || fallbackTransitPlanet,
    natalPoint: queryNatalPoint || fallbackNatalPoint,
    aspectTypes: queryAspectTypes.length > 0 ? queryAspectTypes : fallbackAspectTypes,
    range: queryWindow || fallbackWindow || buildCurrentYearRange(timezone),
    timeframe: finalTimeframe || 'current_year',
    fullListing: queryState?.parameters?.fullListing === true,
    usedAiTransitSearchExtraction: Boolean(aiMeta.usedAiTransitSearchExtraction),
    aiExtractionConfidence: Number(aiMeta.aiExtractionConfidence || 0),
    usedDeterministicFallback: Boolean(
      !aiMeta.usedAiTransitSearchExtraction ||
      fallbackTransitPlanet ||
      fallbackNatalPoint ||
      fallbackAspectTypes.length > 0 ||
      fallbackWindow
    )
  };
}

function buildUnsupportedAstrologyQuestionResponse(locale, route, suggestions = []) {
  if (locale === 'fr') {
    return 'Je ne suis pas encore capable de répondre à cette question pour le moment.';
  }

  return 'I am not able to answer that question yet.';
}

function applyCanonicalRoute(route, canonicalRoute, plannerQuestionText) {
  if (!canonicalRoute) {
    return route;
  }

  return {
    ...route,
    kind: canonicalRoute.routeKind,
    intent: detectConversationIntent(canonicalRoute.intentSample || plannerQuestionText),
    answerStyle: canonicalRoute.answerStyle,
    commonRouteId: canonicalRoute.id,
    commonRouteScore: canonicalRoute.score
  };
}

function buildCanonicalMatcherUnavailableResponse(locale) {
  return locale === 'fr'
    ? 'Le moteur de routage IA est indisponible pour le moment. Réessayez plus tard.'
    : 'The AI routing engine is unavailable right now. Please try again later.';
}

function buildExecutionRouterUnavailableResponse(locale) {
  return locale === 'fr'
    ? 'Le moteur de routage IA est indisponible pour le moment. Réessayez plus tard.'
    : 'The AI routing engine is unavailable right now. Please try again later.';
}

function normalizeExecutionFamily(value, routeKind = null) {
  const family = String(value || '').trim();
  if (EXECUTION_FAMILIES.has(family)) {
    return family;
  }

  if (routeKind === 'astrology_synastry') {
    return 'mcp_synastry';
  }

  if (routeKind === 'astrology_relocation') {
    return 'mcp_relocation';
  }

  if (routeKind === 'astrology_transits') {
    return 'mcp_transits';
  }

  return 'indexed_natal';
}

async function routeConversationExecutionWithAi(locale, userText, route, subjectProfile, factAvailability, conversationContext, queryState = null) {
  const electionalConfig = inferElectionalRouteConfigFromQuestion(userText)
    || getElectionalRouteConfig(queryState?.canonicalRouteId);
  if (electionalConfig) {
    return {
      target: 'mcp',
      family: 'mcp_electional',
      confidence: 0.99,
      reason: `Electional timing question matched ${electionalConfig.id}.`
    };
  }

  const currentMonthAvailable = Boolean(factAvailability?.indexedTransitCacheMonth);
  const systemInstruction = [
    'You decide whether an astrology question should be answered from indexed local facts or through the FreeAstro MCP tool family.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: target, family, confidence, reason.',
    'target must be indexed_facts or mcp.',
    'family must be one of: indexed_natal, indexed_monthly_transits, mcp_transits, mcp_synastry, mcp_relocation, mcp_progressions, mcp_ephemeris, mcp_horoscope, mcp_electional.',
    'Use indexed_natal only for obvious natal/chart/theme/aspect/house/sign questions that local natal facts or cached natal data can answer well.',
    'Use indexed_monthly_transits only for current-month transit questions that the indexed current month can answer well, including filtered current-month follow-ups.',
    'Use mcp_transits for exact transit searches, date ranges, since-birth searches, non-current-month transit requests, or whenever the local index is too rigid.',
    'Use mcp_synastry for compatibility or two-person comparison.',
    'Use mcp_relocation for relocation or astrocartography.',
    'Use mcp_progressions for progressions, profections, solar returns, or planet returns.',
    'Use mcp_ephemeris for ephemeris requests.',
    'Use mcp_horoscope for horoscope requests.',
    'Use mcp_electional for electional timing requests such as the best date or moment to marry, wedding timing, signing contracts, or moving into a new home when the MCP exposes a dedicated electional search.',
    'Prefer MCP when there is any real doubt that indexed facts are sufficient.',
    'Confidence must be a number between 0 and 1.'
  ].join('\n');

  const prompt = [
    `User question: ${String(userText || '').trim()}`,
    `Detected route kind hint: ${route?.kind || 'unknown'}`,
    `Active profile: ${subjectProfile?.profileName || 'Chart User'}`,
    `Indexed natal facts: ${factAvailability?.hasNatalFacts ? 'yes' : 'no'}`,
    `Indexed current month transit facts: ${currentMonthAvailable ? factAvailability.indexedTransitCacheMonth : 'none'}`,
    `Previous execution target: ${conversationContext?.lastExecutionTarget || 'none'}`,
    `Previous result family: ${conversationContext?.lastResultFamily || 'none'}`,
    `Structured query parameters: ${JSON.stringify(queryState?.parameters || {})}`,
    '',
    'Return JSON now.'
  ].join('\n');

  let parsed = null;
  try {
    parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
  } catch (error) {
    info('execution router ai match failed', {
      routeKind: route?.kind || null,
      error: error?.message || String(error)
    });
    const nextError = new Error('Execution routing AI is unavailable.');
    nextError.code = 'EXECUTION_ROUTE_AI_UNAVAILABLE';
    nextError.cause = error;
    throw nextError;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const confidence = Number(parsed.confidence || 0);
  if (!Number.isFinite(confidence) || confidence < 0.55) {
    return null;
  }

  const family = normalizeExecutionFamily(parsed.family, route?.kind);
  const target = family.startsWith('indexed_') ? 'indexed_facts' : 'mcp';

  return {
    target,
    family,
    confidence,
    reason: parsed.reason ? String(parsed.reason) : null
  };
}

function getRequestedListingLimit(userText, routeId, fallback = null) {
  const parsed = parseRequestedResultLimit(userText);
  if (parsed) {
    return parsed;
  }

  if (wantsStrongestSubset(userText)) {
    if (routeId === 'month_ahead_transits') {
      return 5;
    }

    if (routeId === 'monthly_transits_for_planet' || routeId === 'all_natal_aspects') {
      return 5;
    }
  }

  return fallback;
}

function suggestCanonicalQuestions(userText, route, limit = 3) {
  const routeKindFilter = route?.kind === 'astrology_transits' || route?.kind === 'astrology_natal' || route?.kind === 'astrology_synastry' || route?.kind === 'astrology_relocation'
    ? route.kind
    : null;
  const candidates = listWesternCanonicalRoutes(routeKindFilter ? { routeKind: routeKindFilter } : {});
  const normalizedQuestion = String(userText || '').toLowerCase();

  return candidates
    .map((candidate) => {
      const score = candidate.aliases.reduce((best, alias) => {
        const aliasValue = String(alias || '').toLowerCase();
        if (!aliasValue) {
          return best;
        }

        if (normalizedQuestion === aliasValue) {
          return Math.max(best, 1);
        }

        if (normalizedQuestion.includes(aliasValue) || aliasValue.includes(normalizedQuestion)) {
          return Math.max(best, 0.85);
        }

        const aliasTokens = aliasValue.split(/\s+/).filter(Boolean);
        const overlap = aliasTokens.filter((token) => normalizedQuestion.includes(token)).length;
        return Math.max(best, overlap / Math.max(aliasTokens.length, 1));
      }, 0);

      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function buildPlannedRouteFromCommonQuestion(commonRoute, subjectProfile, factAvailability) {
  if (!commonRoute || !subjectProfile?.profileId) {
    return null;
  }

  const includesTransit = commonRoute.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND);
  const isMonthlyTransitOverview = commonRoute.id === 'month_ahead_transits';
  const isDailyTransitOverview = commonRoute.id === 'today_transits_me' || commonRoute.id === 'current_sky_today';

  return {
    target: 'indexed_facts',
    primaryProfileId: subjectProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: commonRoute.sourceKinds,
    categories: commonRoute.categories || [],
    tags: commonRoute.tags || [],
    cacheMonth: includesTransit ? (factAvailability?.indexedTransitCacheMonth || null) : null,
    limit: isMonthlyTransitOverview ? 20 : (isDailyTransitOverview ? 20 : (includesTransit ? 8 : 4)),
    reason: `Matched common question route ${commonRoute.id}`,
    answerStyle: commonRoute.answerStyle,
    commonRouteId: commonRoute.id
  };
}

function isCurrentMonthRequest(userText, timezone = 'UTC') {
  const parsedMonth = parseMonthFromQuestion(userText, timezone);
  if (!parsedMonth) {
    return true;
  }

  const current = getCurrentLocalDateParts(timezone);
  return parsedMonth.year === current.year && parsedMonth.month === current.month;
}

function buildCanonicalIndexedRoute(canonicalRoute, userText, subjectProfile, factAvailability) {
  if (!canonicalRoute || !subjectProfile?.profileId) {
    return null;
  }

  if (canonicalRoute.id === 'current_sky_today' || canonicalRoute.id === 'today_transits_me') {
    return {
      target: 'indexed_facts',
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: factAvailability?.indexedTransitCacheMonth || null,
      limit: 20,
      reason: `Matched canonical route ${canonicalRoute.id} for current month cache`,
      answerStyle: canonicalRoute.answerStyle,
      commonRouteId: canonicalRoute.id
    };
  }

  if (
    canonicalRoute.id === 'monthly_transits_for_planet' &&
    isCurrentMonthRequest(userText, subjectProfile.timezone || 'UTC')
  ) {
    return {
      target: 'indexed_facts',
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: factAvailability?.indexedTransitCacheMonth || null,
      limit: 200,
      reason: `Matched canonical route ${canonicalRoute.id} for current month cache`,
      answerStyle: canonicalRoute.answerStyle,
      commonRouteId: canonicalRoute.id
    };
  }

  return null;
}

function buildPlannedRouteFromExecutionIntent(executionIntent, subjectProfile, factAvailability, queryState = null) {
  if (!executionIntent || executionIntent.target !== 'indexed_facts' || !subjectProfile?.profileId) {
    return null;
  }

  if (executionIntent.family === 'indexed_monthly_transits') {
    const currentMonth = factAvailability?.indexedTransitCacheMonth || null;
    const requestedLimit = Number(queryState?.parameters?.limit || 10);
    return {
      target: 'indexed_facts',
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: currentMonth,
      limit: Math.max(3, Math.min(requestedLimit || 10, 200)),
      reason: `Execution router selected ${executionIntent.family}`,
      answerStyle: 'personal_transits',
      commonRouteId: queryState?.canonicalRouteId || null
    };
  }

  return {
    target: 'indexed_facts',
    primaryProfileId: subjectProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: [],
    tags: [],
    cacheMonth: null,
    limit: Math.max(3, Math.min(Number(queryState?.parameters?.limit || 5), 12)),
    reason: `Execution router selected ${executionIntent.family}`,
    answerStyle: 'natal_theme',
    commonRouteId: queryState?.canonicalRouteId || null
  };
}

function matchesMcpFamilyTool(toolName, family) {
  const value = String(toolName || '').toLowerCase();
  switch (family) {
    case 'mcp_transits':
      return value.includes('western_transits_');
    case 'mcp_synastry':
      return value.includes('western_synastry');
    case 'mcp_relocation':
      return value.includes('astrocartography') || value.includes('western_relocation');
    case 'mcp_progressions':
      return (
        value.includes('western_progressions_') ||
        value.includes('western_profections_') ||
        value.includes('western_solar_') ||
        value.includes('western_returns_')
      );
    case 'mcp_ephemeris':
      return value.includes('ephemeris');
    case 'mcp_horoscope':
      return value.includes('horoscope');
    case 'mcp_electional':
      return value.includes('electional_');
    default:
      return true;
  }
}

function filterMcpDeclarationsByFamily(functionDeclarations = [], family = null) {
  if (!family || !String(family).startsWith('mcp_')) {
    return functionDeclarations;
  }

  const filtered = functionDeclarations.filter((tool) => matchesMcpFamilyTool(tool?.name, family));
  return filtered.length > 0 ? filtered : functionDeclarations;
}

function stableSerializeToolArgs(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeToolArgs(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerializeToolArgs(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildToolCallCacheKey(name, args = {}) {
  return `${String(name || '')}:${stableSerializeToolArgs(args || {})}`;
}

function classifyToolBudgetFamily(name) {
  const value = String(name || '');
  if (/western_transits_search/i.test(value)) {
    return 'transit_search';
  }
  if (/western_transits_timeline/i.test(value)) {
    return 'transit_timeline';
  }
  if (/western_synastry/i.test(value)) {
    return 'synastry';
  }
  if (/astrocartography|western_relocation/i.test(value)) {
    return 'relocation';
  }
  if (/western_progressions_|western_profections_|western_solar_|western_returns_/i.test(value)) {
    return 'progressions';
  }
  if (/ephemeris/i.test(value)) {
    return 'ephemeris';
  }
  if (/horoscope/i.test(value)) {
    return 'horoscope';
  }
  if (/electional/i.test(value)) {
    return 'electional';
  }
  return null;
}

function cloneToolResult(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isExactTransitSearchExecution(executionIntent, queryState = null) {
  return (
    executionIntent?.family === 'mcp_transits' &&
    Boolean(queryState?.parameters?.transitPlanet) &&
    Boolean(queryState?.parameters?.natalPoint) &&
    Array.isArray(queryState?.parameters?.aspectTypes) &&
    queryState.parameters.aspectTypes.length > 0
  );
}

function buildTransitSearchExecutionHint(queryState, subjectProfile, userText) {
  if (!queryState?.parameters?.transitPlanet || !queryState?.parameters?.natalPoint) {
    return null;
  }

  const timezone = subjectProfile?.timezone || subjectProfile?.birthTimezone || 'UTC';
  const range = buildTransitSearchWindow(userText, subjectProfile, timezone);
  const hint = {
    tool: 'mcp_v1_western_transits_search',
    transit_planet: queryState.parameters.transitPlanet,
    natal_point: queryState.parameters.natalPoint,
    aspect_types: queryState.parameters.aspectTypes || []
  };

  if (range?.range_start && range?.range_end) {
    hint.range_start = range.range_start;
    hint.range_end = range.range_end;
  } else if (range?.age_start_years !== undefined && range?.age_end_years !== undefined) {
    hint.age_start_years = range.age_start_years;
    hint.age_end_years = range.age_end_years;
  }

  const natal = subjectProfile?.natalRequestPayload || {};
  if (natal.year && natal.month && natal.day) {
    hint.natal = {
      year: natal.year,
      month: natal.month,
      day: natal.day,
      ...(subjectProfile?.cityLabel ? { city: subjectProfile.cityLabel } : {})
    };
  }

  return hint;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getCurrentLocalDateParts(timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return { year, month, day };
}

function getDateStringInTimezone(timezone = 'UTC') {
  const { year, month, day } = getCurrentLocalDateParts(timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildFlatNatalRequestFromProfile(profile) {
  if (!profile?.natalRequestPayload) {
    return null;
  }

  return cloneValue(profile.natalRequestPayload);
}

function buildNestedNatalRequestFromProfile(profile) {
  const natal = profile?.natalRequestPayload;
  if (!natal) {
    return null;
  }

  const datetime = profile?.rawNatalPayload?.subject?.datetime
    || [
      natal.year,
      String(natal.month || '').padStart(2, '0'),
      String(natal.day || '').padStart(2, '0')
    ].filter(Boolean).join('-');

  return {
    name: profile.profileName || 'User',
    datetime,
    time_known: natal.time_known !== false,
    location: {
      city: natal.city,
      lat: natal.lat ?? null,
      lng: natal.lng ?? null,
      tz_str: natal.tz_str || profile.timezone || 'AUTO'
    }
  };
}

const WESTERN_PLANETS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron'];
const PLANET_SYNONYMS = {
  sun: 'sun',
  soleil: 'sun',
  sonne: 'sun',
  sol: 'sun',
  moon: 'moon',
  lune: 'moon',
  mond: 'moon',
  luna: 'moon',
  mercury: 'mercury',
  mercure: 'mercury',
  merkur: 'mercury',
  mercurio: 'mercury',
  venus: 'venus',
  vénus: 'venus',
  mars: 'mars',
  jupiter: 'jupiter',
  saturn: 'saturn',
  saturne: 'saturn',
  saturno: 'saturn',
  uranus: 'uranus',
  urano: 'uranus',
  neptune: 'neptune',
  neptuno: 'neptune',
  pluto: 'pluto',
  pluton: 'pluto',
  chiron: 'chiron',
  quiron: 'chiron'
};
const NATAL_POINT_SYNONYMS = {
  ascendant: 'ascendant',
  ascendance: 'ascendant',
  rising: 'ascendant',
  asc: 'ascendant',
  ascendante: 'ascendant',
  descendant: 'descendant',
  desc: 'descendant',
  midheaven: 'midheaven',
  ciel: 'midheaven',
  mc: 'midheaven',
  ic: 'ic',
  sun: 'sun',
  soleil: 'sun',
  moon: 'moon',
  lune: 'moon',
  mercury: 'mercury',
  mercure: 'mercury',
  venus: 'venus',
  mars: 'mars',
  jupiter: 'jupiter',
  saturn: 'saturn',
  saturne: 'saturn',
  uranus: 'uranus',
  neptune: 'neptune',
  pluto: 'pluto',
  pluton: 'pluto',
  chiron: 'chiron'
};
const ZODIAC_SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const MONTH_NAME_MAP = {
  january: 1, janvier: 1, januar: 1, enero: 1,
  february: 2, fevrier: 2, février: 2, februar: 2, febrero: 2,
  march: 3, mars: 3, marz: 3, märz: 3, marzo: 3,
  april: 4, avril: 4, abril: 4,
  may: 5, mai: 5, mayo: 5,
  june: 6, juin: 6, junio: 6, juni: 6,
  july: 7, juillet: 7, julio: 7, juli: 7,
  august: 8, aout: 8, août: 8, agosto: 8,
  september: 9, septembre: 9, septiembre: 9,
  october: 10, octobre: 10, octubre: 10, oktober: 10,
  november: 11, novembre: 11, noviembre: 11,
  december: 12, decembre: 12, décembre: 12, diciembre: 12, dezember: 12
};
const ASPECT_TYPE_SYNONYMS = {
  conjunction: 'conjunction',
  conjunctions: 'conjunction',
  conjonction: 'conjunction',
  conjonctions: 'conjunction',
  conjunct: 'conjunction',
  square: 'square',
  squares: 'square',
  carre: 'square',
  carré: 'square',
  carres: 'square',
  carrés: 'square',
  opposition: 'opposition',
  oppose: 'opposition',
  oppositions: 'opposition',
  trine: 'trine',
  trines: 'trine',
  trigone: 'trine',
  trigones: 'trine',
  sextiles: 'sextile',
  sextile: 'sextile'
};

function normalizeMatchingText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NORMALIZED_MONTH_NAME_MAP = Object.fromEntries(
  Object.entries(MONTH_NAME_MAP).map(([name, monthNumber]) => [normalizeMatchingText(name), monthNumber])
);
const MONTH_NAME_PATTERN = Object.keys(NORMALIZED_MONTH_NAME_MAP)
  .sort((left, right) => right.length - left.length)
  .map((name) => escapeRegExp(name))
  .join('|');

function findEarliestMappedToken(text, synonymMap = {}) {
  const value = normalizeMatchingText(text);
  let best = null;

  for (const [needle, mappedValue] of Object.entries(synonymMap)) {
    const normalizedNeedle = normalizeMatchingText(needle);
    const pattern = new RegExp(`\\b${normalizedNeedle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
    const match = pattern.exec(value);
    if (!match) {
      continue;
    }

    if (!best || match.index < best.index) {
      best = {
        index: match.index,
        value: mappedValue
      };
    }
  }

  return best?.value || null;
}

function parsePlanetFromQuestion(text) {
  return findEarliestMappedToken(text, PLANET_SYNONYMS)
    || WESTERN_PLANETS.find((planet) => new RegExp(`\\b${planet}\\b`, 'i').test(normalizeMatchingText(text))) || null;
}

function parseTransitPlanetFromQuestion(text) {
  const value = normalizeMatchingText(text);
  const pairPatterns = [
    /\bbetween\s+(?:my\s+|the\s+)?([a-z]+)\s+and\s+(?:my\s+|the\s+)?([a-z]+)\b/i,
    /\bentre\s+(?:(?:m(?:on|a|es)|l(?:e|a|es))\s+)?([a-z]+)\s+et\s+(?:(?:m(?:on|a|es)|l(?:e|a|es))\s+)?([a-z]+)\b/i
  ];
  for (const pattern of pairPatterns) {
    const match = value.match(pattern);
    if (match?.[2]) {
      const mapped = PLANET_SYNONYMS[String(match[2]).toLowerCase()];
      if (mapped) {
        return mapped;
      }
    }
  }

  const targetedPatterns = [
    /\b(?:transit|transiting|transits|transit de|transits de|transits exacts de)\s+([a-zà-ÿ]+)\b/i,
    /\b([a-zà-ÿ]+)\s+transits?\b/i
  ];

  for (const pattern of targetedPatterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const mapped = PLANET_SYNONYMS[String(match[1]).toLowerCase()];
      if (mapped) {
        return mapped;
      }
    }
  }

  const matches = Array.from(value.matchAll(/\b([a-z]+)\b/ig))
    .map((match) => PLANET_SYNONYMS[String(match[1]).toLowerCase()])
    .filter(Boolean);

  return matches[0] || null;
}

function parseNatalPointFromQuestion(text) {
  return findEarliestMappedToken(text, NATAL_POINT_SYNONYMS);
}

function parseNatalPointFromTransitSearchQuestion(text) {
  const value = normalizeMatchingText(text);
  const targetedPatterns = [
    /\bbetween\s+(?:my\s+|the\s+)?([a-z]+)\s+and\s+(?:my\s+|the\s+)?([a-z]+)\b/i,
    /\bentre\s+(?:(?:m(?:on|a|es)|l(?:e|a|es))\s+)?([a-z]+)\s+et\s+(?:(?:m(?:on|a|es)|l(?:e|a|es))\s+)?([a-z]+)\b/i,
    /\b(?:to|against|vers|sur|à)\s+my\s+([a-z]+)/i,
    /\b(?:to|against|vers|sur|à)\s+(ascendant|rising|asc|descendant|desc|midheaven|mc|ic|sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|chiron)\b/i,
    /\bmy\s+(ascendant|rising|asc|descendant|desc|midheaven|mc|ic|sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|chiron)\b/i
  ];

  for (const pattern of targetedPatterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      return NATAL_POINT_SYNONYMS[String(match[1]).toLowerCase()] || null;
    }
  }

  return parseNatalPointFromQuestion(value);
}

function parseFocusFromQuestion(text) {
  const value = String(text || '').toLowerCase();
  const pairs = [
    ['career', /\bcareer\b|\bwork\b|\bprofession\b|\bcarri[èe]re\b/i],
    ['love', /\blove\b|\bromance\b|\bamour\b/i],
    ['home', /\bhome\b|\bfamily\b|\bfoyer\b|\bfamille\b/i],
    ['health', /\bwellbeing\b|\bwell-being\b|\bhealth\b|\bhealthy\b|\bsant[ée]\b|\bbien[- ]?[êe]tre\b/i],
    ['creativity', /\bcreativity\b|\bcreative\b|\bcr[ée]ativit[ée]\b/i],
    ['spiritual growth', /\bspiritual\b|\bspirituel\b/i]
  ];

  const match = pairs.find(([, pattern]) => pattern.test(value));
  return match ? match[0] : null;
}

function normalizeRelocationFocusForMcp(focus) {
  switch (String(focus || '').trim().toLowerCase()) {
    case 'love':
      return 'romance';
    case 'spiritual growth':
      return 'spiritual';
    case 'health':
    case 'career':
    case 'home':
      return String(focus || '').trim().toLowerCase();
    default:
      return null;
  }
}

const RELOCATION_COUNTRY_NAME_TO_CODE = {
  fr: 'FR',
  france: 'FR',
  french: 'FR',
  espagne: 'ES',
  espana: 'ES',
  spain: 'ES',
  espagnol: 'ES',
  portugal: 'PT',
  portugais: 'PT',
  italy: 'IT',
  italie: 'IT',
  italian: 'IT',
  deutschland: 'DE',
  germany: 'DE',
  allemagne: 'DE',
  german: 'DE',
  uk: 'GB',
  gb: 'GB',
  britain: 'GB',
  britanique: 'GB',
  england: 'GB',
  'royaume uni': 'GB',
  'united kingdom': 'GB',
  'etats unis': 'US',
  etatsunis: 'US',
  'etats-unis': 'US',
  usa: 'US',
  us: 'US',
  'united states': 'US',
  canada: 'CA',
  japon: 'JP',
  japan: 'JP',
  inde: 'IN',
  india: 'IN',
  mexique: 'MX',
  mexico: 'MX',
  bresil: 'BR',
  brazil: 'BR',
  australie: 'AU',
  australia: 'AU',
  suisse: 'CH',
  switzerland: 'CH',
  belgique: 'BE',
  belgium: 'BE',
  'pays bas': 'NL',
  'pays-bas': 'NL',
  netherlands: 'NL',
  hollande: 'NL',
  irlande: 'IE',
  ireland: 'IE',
  suede: 'SE',
  sweden: 'SE',
  norvege: 'NO',
  norway: 'NO',
  danemark: 'DK',
  denmark: 'DK'
};

function sanitizeCountryCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

async function extractRelocationCountryConstraintWithAi(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  const systemInstruction = [
    'You extract country restrictions for broad astrocartography relocation recommendation questions.',
    'Understand English, French, German, and Spanish.',
    'Return one JSON object and nothing else.',
    'Allowed keys: countryCode, confidence.',
    'countryCode must be an ISO-3166 alpha-2 code.',
    'Return countryCode null when the user names a city instead of constraining recommendations to a country.',
    'Return countryCode null when no country restriction is present.'
  ].join('\n');

  const prompt = [
    `User text: ${value}`,
    'Examples:',
    '- "Where should I relocate for health in France?" -> {"countryCode":"FR","confidence":0.97}',
    '- "Ou devrais-je habiter pour ma carriere en Espagne ?" -> {"countryCode":"ES","confidence":0.96}',
    '- "What about Paris for health?" -> {"countryCode":null,"confidence":0.92}',
    '- "Where should I relocate?" -> {"countryCode":null,"confidence":0.9}',
    'Return JSON now.'
  ].join('\n');

  try {
    const parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const confidence = Number(parsed.confidence || 0);
    const countryCode = sanitizeCountryCode(parsed.countryCode);
    if (!countryCode || !Number.isFinite(confidence) || confidence < 0.7) {
      return null;
    }
    return {
      countryScope: 'selected_countries',
      countries: [countryCode]
    };
  } catch (_error) {
    return null;
  }
}

async function extractRelocationCountryConstraint(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  const normalized = normalizeMatchingText(value)
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const directCodeMatch = value.match(/\b(?:in|within|inside|to|en|au|aux|dans)\s+([A-Z]{2})\b/);
  const directCode = sanitizeCountryCode(directCodeMatch?.[1]);
  if (directCode) {
    return {
      countryScope: 'selected_countries',
      countries: [directCode]
    };
  }

  for (const [name, code] of Object.entries(RELOCATION_COUNTRY_NAME_TO_CODE)) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) {
      return {
        countryScope: 'selected_countries',
        countries: [code]
      };
    }
  }

  return extractRelocationCountryConstraintWithAi(value);
}

function isBroadRelocationRecommendationQuestion(text) {
  const value = normalizeMatchingText(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /\bwhere should i (?:relocate|live|move)\b|\bbest places to live\b|\bo[uù] devrais je habiter\b|\bo[uù] est ce que je dois habiter\b|\bo[uù] vivre\b|\bmeilleures villes pour vivre\b|\bmeilleur(?:e)?(?:s)? (?:endroit|ville|lieu|places?) .*vivre\b/.test(value);
}

function parseYearFromQuestion(text) {
  const match = String(text || '').match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function buildIsoDateString(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (
    !Number.isInteger(normalizedYear) ||
    !Number.isInteger(normalizedMonth) ||
    !Number.isInteger(normalizedDay) ||
    normalizedMonth < 1 ||
    normalizedMonth > 12 ||
    normalizedDay < 1 ||
    normalizedDay > 31
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay));
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== normalizedYear ||
    candidate.getUTCMonth() !== normalizedMonth - 1 ||
    candidate.getUTCDate() !== normalizedDay
  ) {
    return null;
  }

  return `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}-${String(normalizedDay).padStart(2, '0')}`;
}

function parseIsoDateString(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return buildIsoDateString(Number(match[1]), Number(match[2]), Number(match[3]));
}

function extractTextualDateMentions(text) {
  const normalized = normalizeMatchingText(text).replace(/[–—]/g, '-');
  if (!normalized || !MONTH_NAME_PATTERN) {
    return [];
  }

  const mentions = [];
  const dayMonthPattern = new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_NAME_PATTERN})(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'gi');
  const monthDayPattern = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:er|st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'gi');

  for (const pattern of [dayMonthPattern, monthDayPattern]) {
    let match = pattern.exec(normalized);
    while (match) {
      const isDayMonth = pattern === dayMonthPattern;
      const day = Number(isDayMonth ? match[1] : match[2]);
      const monthToken = normalizeMatchingText(isDayMonth ? match[2] : match[1]);
      const year = match[3] ? Number(match[3]) : null;
      const month = NORMALIZED_MONTH_NAME_MAP[monthToken] || null;
      if (month && Number.isInteger(day)) {
        mentions.push({
          index: match.index,
          endIndex: match.index + match[0].length,
          day,
          month,
          year
        });
      }
      match = pattern.exec(normalized);
    }
  }

  return mentions
    .sort((left, right) => left.index - right.index || right.endIndex - left.endIndex)
    .filter((mention, index, all) => index === 0 || mention.index >= all[index - 1].endIndex);
}

function resolveTextualDateRange(startMention, endMention, timezone = 'UTC', fallbackYear = null) {
  if (!startMention || !endMention) {
    return null;
  }

  const currentYear = getCurrentLocalDateParts(timezone).year;
  const compareMonthDay = (left, right) => (left.month - right.month) || (left.day - right.day);
  let startYear = Number.isInteger(startMention.year) ? startMention.year : null;
  let endYear = Number.isInteger(endMention.year) ? endMention.year : null;

  if (!startYear && !endYear) {
    startYear = fallbackYear || currentYear;
    endYear = fallbackYear || currentYear;
    if (compareMonthDay(endMention, startMention) < 0) {
      endYear += 1;
    }
  } else if (startYear && !endYear) {
    endYear = startYear;
    if (compareMonthDay(endMention, startMention) < 0) {
      endYear += 1;
    }
  } else if (!startYear && endYear) {
    startYear = endYear;
    if (compareMonthDay(startMention, endMention) > 0) {
      startYear -= 1;
    }
  }

  const start = buildIsoDateString(startYear, startMention.month, startMention.day);
  const end = buildIsoDateString(endYear, endMention.month, endMention.day);
  if (!start || !end || start > end) {
    return null;
  }

  return { start, end };
}

function parseExplicitDateRangeFromQuestion(text, timezone = 'UTC') {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  const normalized = normalizeMatchingText(value).replace(/[–—]/g, '-');
  const isoRangeMatch = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b\s*(?:and|to|through|until|till|au|a|et|-)\s*\b(20\d{2}-\d{2}-\d{2})\b/i);
  if (isoRangeMatch) {
    const start = parseIsoDateString(isoRangeMatch[1]);
    const end = parseIsoDateString(isoRangeMatch[2]);
    if (start && end && start <= end) {
      return { start, end };
    }
  }

  const mentions = extractTextualDateMentions(normalized);
  const fallbackYear = parseYearFromQuestion(normalized) || null;
  for (let index = 0; index < mentions.length - 1; index += 1) {
    const startMention = mentions[index];
    const endMention = mentions[index + 1];
    const prefix = normalized.slice(Math.max(0, startMention.index - 24), startMention.index);
    const connector = normalized.slice(startMention.endIndex, endMention.index);
    const hasRangeLeadIn = /\b(between|from|du|de|entre)\s*$/i.test(prefix);
    const hasRangeConnector = /\b(and|to|through|until|till|au|a|et)\b|[-]/i.test(connector);
    if (!hasRangeLeadIn && !hasRangeConnector) {
      continue;
    }

    const range = resolveTextualDateRange(startMention, endMention, timezone, fallbackYear);
    if (range) {
      return range;
    }
  }

  return null;
}

function parseExplicitSingleDateFromQuestion(text, timezone = 'UTC') {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  const normalized = normalizeMatchingText(value).replace(/[–—]/g, '-');
  const isoMatch = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    const date = parseIsoDateString(isoMatch[1]);
    return date ? { start: date, end: date } : null;
  }

  const mentions = extractTextualDateMentions(normalized);
  if (mentions.length !== 1) {
    return null;
  }

  const mention = mentions[0];
  const year = mention.year || parseYearFromQuestion(normalized) || getCurrentLocalDateParts(timezone).year;
  const date = buildIsoDateString(year, mention.month, mention.day);
  return date ? { start: date, end: date } : null;
}

function parseMonthFromQuestion(text, timezone = 'UTC') {
  const value = String(text || '').toLowerCase();
  const requestedMonthlyPlanet = parseRequestedMonthlyTransitPlanet(value);
  for (const [monthName, monthNumber] of Object.entries(MONTH_NAME_MAP)) {
    if (monthName === 'mars' && requestedMonthlyPlanet === 'mars') {
      continue;
    }
    if (new RegExp(`\\b${monthName}\\b`, 'i').test(value)) {
      const parsedYear = parseYearFromQuestion(value) || getCurrentLocalDateParts(timezone).year;
      return { year: parsedYear, month: monthNumber };
    }
  }

  return null;
}

function parseAspectTypesFromQuestion(text) {
  const value = String(text || '').toLowerCase();
  const matches = [];

  for (const [needle, aspectType] of Object.entries(ASPECT_TYPE_SYNONYMS)) {
    if (new RegExp(`\\b${needle}\\b`, 'i').test(value) && !matches.includes(aspectType)) {
      matches.push(aspectType);
    }
  }

  return matches;
}

function isExplicitTransitSearchQuestion(text) {
  const value = String(text || '');
  const hasPair = Boolean(parseTransitPlanetFromQuestion(value) && parseNatalPointFromTransitSearchQuestion(value));
  const hasAspectType = parseAspectTypesFromQuestion(value).length > 0;
  const hasTransitTimeframe = /\b(depuis ma naissance|since birth|from birth|between my|entre mon|entre ma|all the squares|tous les carrés|tous les trigones|tous les sextiles|toutes les oppositions|toutes les conjonctions)\b/i.test(value);
  return hasPair && (hasAspectType || hasTransitTimeframe);
}

function buildMonthDateRange(monthInfo) {
  if (!monthInfo?.year || !monthInfo?.month) {
    return null;
  }

  const lastDay = new Date(Date.UTC(monthInfo.year, monthInfo.month, 0)).getUTCDate();
  return {
    start: `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}-01`,
    end: `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  };
}

function buildElectionalSearchTuningForRange(range) {
  const start = range?.start ? new Date(`${range.start}T00:00:00Z`) : null;
  const end = range?.end ? new Date(`${range.end}T00:00:00Z`) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { mode: 'direct' };
  }

  const durationDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return durationDays > 14
    ? {
        mode: 'year',
        coarse_step_minutes: 720
      }
    : { mode: 'direct' };
}

function buildCurrentYearRange(timezone = 'UTC', yearOverride = null) {
  const year = yearOverride || getCurrentLocalDateParts(timezone).year;
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`
  };
}

function buildCurrentDayRange(timezone = 'UTC') {
  const currentDate = getDateStringInTimezone(timezone);
  return {
    start: currentDate,
    end: currentDate
  };
}

function buildCurrentWeekRange(timezone = 'UTC') {
  const current = getCurrentLocalDateParts(timezone);
  const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const dayOfWeek = currentDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(currentDate);
  monday.setUTCDate(currentDate.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const toDateString = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return {
    start: toDateString(monday),
    end: toDateString(sunday)
  };
}

function buildRollingDaysRange(durationDays, timezone = 'UTC') {
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  const current = getCurrentLocalDateParts(timezone);
  const startDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + Math.max(0, Math.round(days) - 1));
  const toDateString = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  return {
    start: toDateString(startDate),
    end: toDateString(endDate)
  };
}

function getTimeframeRange(timeframe, timezone = 'UTC') {
  switch (String(timeframe || '').toLowerCase()) {
    case 'current_day':
      return buildCurrentDayRange(timezone);
    case 'current_week':
      return buildCurrentWeekRange(timezone);
    default:
      return null;
  }
}

function getEntryDateWindow(entry) {
  const { evidence } = getRawFactCore(entry || {});
  const start = evidence.startDatetime || evidence.start_datetime || entry?.start_datetime || entry?.startDatetime || null;
  const end = evidence.endDatetime || evidence.end_datetime || entry?.end_datetime || entry?.endDatetime || null;
  if (start || end) {
    return { start, end };
  }

  const cacheMonth = entry?.cacheMonth || entry?.cache_month || evidence.cache_month || null;
  const visibleStartDay = evidence.visibleStartDay || evidence.visible_start_day || null;
  const visibleEndDay = evidence.visibleEndDay || evidence.visible_end_day || null;
  if (cacheMonth && (visibleStartDay || visibleEndDay)) {
    const monthPrefix = String(cacheMonth).slice(0, 7);
    return {
      start: visibleStartDay ? `${monthPrefix}-${String(visibleStartDay).padStart(2, '0')}` : null,
      end: visibleEndDay ? `${monthPrefix}-${String(visibleEndDay).padStart(2, '0')}` : null
    };
  }
  return { start, end };
}

function normalizeDateForCompare(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function entryIntersectsRange(entry, range) {
  if (!range?.start || !range?.end) {
    return true;
  }
  const window = getEntryDateWindow(entry);
  const start = normalizeDateForCompare(window.start);
  const end = normalizeDateForCompare(window.end);
  if (!start && !end) {
    return true;
  }
  const effectiveStart = start || end;
  const effectiveEnd = end || start;
  return effectiveStart <= range.end && effectiveEnd >= range.start;
}

function filterTransitEntriesByTimeframe(entries, timeframe, timezone = 'UTC') {
  const range = getTimeframeRange(timeframe, timezone);
  if (!range) {
    return asArray(entries);
  }
  return asArray(entries).filter((entry) => entryIntersectsRange(entry, range));
}

function buildTransitTimeframeTitle(locale, subjectProfile, itemCount, options = {}) {
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const cacheMonth = formatScalarValue(options.cacheMonth || null);
  const timeframe = String(options.timeframe || '').toLowerCase();
  if (timeframe === 'current_day') {
    const dateLabel = getDateStringInTimezone(options.timezone || 'UTC');
    return formatRawLabel(locale, {
      en: `Top ${itemCount} active transits today for ${subject} — ${dateLabel}`,
      fr: `Top ${itemCount} des transits actifs du jour pour ${subject} — ${dateLabel}`,
      de: `Top ${itemCount} der heutigen aktiven Transite für ${subject} — ${dateLabel}`,
      es: `Top ${itemCount} de los tránsitos activos de hoy para ${subject} — ${dateLabel}`
    });
  }
  if (timeframe === 'current_week') {
    const range = getTimeframeRange('current_week', options.timezone || 'UTC');
    return formatRawLabel(locale, {
      en: `Top ${itemCount} active transits this week for ${subject} — ${range?.start || '?'} → ${range?.end || '?'}`,
      fr: `Top ${itemCount} des transits actifs de la semaine pour ${subject} — ${range?.start || '?'} → ${range?.end || '?'}`,
      de: `Top ${itemCount} der aktiven Transite dieser Woche für ${subject} — ${range?.start || '?'} → ${range?.end || '?'}`,
      es: `Top ${itemCount} de los tránsitos activos de esta semana para ${subject} — ${range?.start || '?'} → ${range?.end || '?'}`
    });
  }
  return buildMonthlyTransitOverviewTitle(locale, subjectProfile, itemCount, cacheMonth, options.responseMode || 'raw');
}

function buildBirthDateStringFromProfile(profile) {
  const natal = profile?.natalRequestPayload;
  if (!natal?.year || !natal?.month || !natal?.day) {
    return null;
  }

  return `${natal.year}-${String(natal.month).padStart(2, '0')}-${String(natal.day).padStart(2, '0')}`;
}

function buildTransitSearchWindow(userText, subjectProfile, timezone = 'UTC') {
  const value = String(userText || '').toLowerCase();
  if (/\b(depuis ma naissance|since birth|since i was born|from birth)\b/i.test(value)) {
    const birthDate = buildBirthDateStringFromProfile(subjectProfile);
    if (!birthDate) {
      return null;
    }

    const currentDate = getDateStringInTimezone(timezone);
    const birthYear = Number(String(birthDate).slice(0, 4));
    const currentYear = getCurrentLocalDateParts(timezone).year;
    const ageYears = Math.max(0, currentYear - birthYear);

    if (ageYears <= 50) {
      return {
        range_start: birthDate,
        range_end: currentDate
      };
    }

    return {
      age_start_years: 0,
      age_end_years: 50
    };
  }

  const parsedMonth = parseMonthFromQuestion(userText, timezone);
  if (parsedMonth) {
    const range = buildMonthDateRange(parsedMonth);
    if (range) {
      return {
        range_start: range.start,
        range_end: range.end
      };
    }
  }

  if (/\b(this month|ce mois|ce mois ci|this year|cette annee|cette année)\b/i.test(value)) {
    if (/\b(this month|ce mois|ce mois ci)\b/i.test(value)) {
      const current = toolCache.getCurrentMonthWindow(timezone);
      if (current) {
        return {
          range_start: current.rangeStart,
          range_end: current.rangeEnd
        };
      }
    }

    if (/\b(this year|cette annee|cette année)\b/i.test(value)) {
      const range = buildCurrentYearRange(timezone);
      return {
        range_start: range.start,
        range_end: range.end
      };
    }
  }

  const explicitYear = parseYearFromQuestion(userText);
  if (explicitYear) {
    const range = buildCurrentYearRange(timezone, explicitYear);
    return {
      range_start: range.start,
      range_end: range.end
    };
  }

  return null;
}

function buildElectionalSearchWindow(userText, queryState = null, timezone = 'UTC') {
  const value = String(userText || '').toLowerCase();
  const timeframe = String(queryState?.parameters?.timeframe || '').toLowerCase();
  const explicitRange = queryState?.parameters?.rangeStart && queryState?.parameters?.rangeEnd
    ? {
        start: queryState.parameters.rangeStart,
        end: queryState.parameters.rangeEnd
      }
    : parseExplicitDateRangeFromQuestion(userText, timezone);
  const explicitSingleDate = explicitRange ? null : parseExplicitSingleDateFromQuestion(userText, timezone);
  const requestedMonth = queryState?.parameters?.month || parseMonthFromQuestion(userText, timezone);
  const durationDays = Number(queryState?.parameters?.durationDays || parseDurationDaysFromQuestion(userText) || 0);

  if (explicitRange?.start && explicitRange?.end) {
    return {
      searchWindow: explicitRange,
      searchTuning: buildElectionalSearchTuningForRange(explicitRange)
    };
  }

  if (explicitSingleDate?.start && explicitSingleDate?.end) {
    return {
      searchWindow: explicitSingleDate,
      searchTuning: { mode: 'direct' }
    };
  }

  if (timeframe === 'rolling_days' && durationDays > 0) {
    const range = buildRollingDaysRange(durationDays, timezone);
    if (range) {
      return {
        searchWindow: range,
        searchTuning: buildElectionalSearchTuningForRange(range)
      };
    }
  }

  if (requestedMonth) {
    const range = buildMonthDateRange(requestedMonth);
    if (range) {
      return {
        searchWindow: range,
        searchTuning: buildElectionalSearchTuningForRange(range)
      };
    }
  }

  if (timeframe === 'current_day' || /\b(today|aujourd'hui|aujourdhui|du jour|heute|hoy)\b/i.test(value)) {
    return {
      searchWindow: buildCurrentDayRange(timezone),
      searchTuning: { mode: 'direct' }
    };
  }

  if (timeframe === 'current_week' || /\b(this week|current week|de la semaine|cette semaine|semaine en cours|diese woche|esta semana)\b/i.test(value)) {
    return {
      searchWindow: buildCurrentWeekRange(timezone),
      searchTuning: { mode: 'direct' }
    };
  }

  if (timeframe === 'current_month' || /\b(this month|ce mois|ce mois ci|dieser monat|este mes)\b/i.test(value)) {
    const currentMonth = toolCache.getCurrentMonthWindow(timezone);
    if (currentMonth) {
      const range = {
        start: currentMonth.rangeStart,
        end: currentMonth.rangeEnd
      };
      return {
        searchWindow: range,
        searchTuning: buildElectionalSearchTuningForRange(range)
      };
    }
  }

  const explicitYear = parseYearFromQuestion(userText);
  if (explicitYear) {
    return {
      searchWindow: buildCurrentYearRange(timezone, explicitYear),
      searchTuning: {
        mode: 'year',
        coarse_step_minutes: 720
      }
    };
  }

  if (timeframe === 'current_year' || /\b(this year|cette annee|cette année|dieses jahr|este ano|este año)\b/i.test(value)) {
    return {
      searchWindow: buildCurrentYearRange(timezone),
      searchTuning: {
        mode: 'year',
        coarse_step_minutes: 720
      }
    };
  }

  return null;
}

function buildElectionalNatalRequestFromProfile(profile, defaultName = 'Partner') {
  const natal = profile?.natalRequestPayload;
  const rawLocation = profile?.rawNatalPayload?.subject?.location || {};
  if (!natal?.year || !natal?.month || !natal?.day) {
    return null;
  }

  const lat = Number.isFinite(Number(natal.lat))
    ? Number(natal.lat)
    : (Number.isFinite(Number(profile?.lat)) ? Number(profile.lat) : (Number.isFinite(Number(rawLocation.lat)) ? Number(rawLocation.lat) : null));
  const lng = Number.isFinite(Number(natal.lng))
    ? Number(natal.lng)
    : (Number.isFinite(Number(profile?.lng)) ? Number(profile.lng) : (Number.isFinite(Number(rawLocation.lng)) ? Number(rawLocation.lng) : null));

  return {
    name: profile?.profileName || defaultName,
    year: natal.year,
    month: natal.month,
    day: natal.day,
    hour: Number.isFinite(Number(natal.hour)) ? Number(natal.hour) : null,
    minute: Number.isFinite(Number(natal.minute)) ? Number(natal.minute) : null,
    time_known: natal.time_known !== false,
    city: natal.city || profile?.cityName || rawLocation.city || rawLocation.name || null,
    lat,
    lng,
    tz_str: natal.tz_str || profile?.timezone || rawLocation.timezone || 'AUTO'
  };
}

function buildElectionalLocationFromProfile(profile, timezone = 'UTC') {
  const natal = profile?.natalRequestPayload || {};
  const rawLocation = profile?.rawNatalPayload?.subject?.location || {};
  const lat = Number.isFinite(Number(natal.lat))
    ? Number(natal.lat)
    : (Number.isFinite(Number(profile?.lat)) ? Number(profile.lat) : (Number.isFinite(Number(rawLocation.lat)) ? Number(rawLocation.lat) : null));
  const lng = Number.isFinite(Number(natal.lng))
    ? Number(natal.lng)
    : (Number.isFinite(Number(profile?.lng)) ? Number(profile.lng) : (Number.isFinite(Number(rawLocation.lng)) ? Number(rawLocation.lng) : null));
  const city = natal.city || profile?.cityName || rawLocation.city || rawLocation.name || null;

  if (!city && lat === null && lng === null) {
    return null;
  }

  return {
    city,
    lat,
    lng,
    tz_str: natal.tz_str || profile?.timezone || rawLocation.timezone || timezone || 'AUTO'
  };
}

function parseSignFromQuestion(text) {
  const value = String(text || '').toLowerCase();
  return ZODIAC_SIGNS.find((sign) => new RegExp(`\\b${sign}\\b`, 'i').test(value)) || null;
}

function sanitizeCityQueryCandidate(value) {
  return String(value || '')
    .replace(/\bfor\s+(career|love|romance|home|family|wellbeing|well-being|health|creativity|creative|spiritual(?:\s+growth)?)\b.*$/i, '')
    .replace(/\b(pour|carri[èe]re|amour|foyer|famille|sant[ée]|bien[- ]?[êe]tre|cr[ée]ativit[ée]|spirituel(?:le)?)(?:\b.*)?$/i, '')
    .replace(/^(?:city|ville)\s*[:\-]\s*/i, '')
    .replace(/[?!.,\s]+$/g, '')
    .trim();
}

async function resolveCityQueryWithSearch(query) {
  const normalizedQuery = sanitizeCityQueryCandidate(query);
  if (!normalizedQuery) {
    return null;
  }

  try {
    const results = await searchCities(normalizedQuery, 3);
    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }
    if (results.length === 1) {
      const resolved = results[0];
      return {
        name: resolved.name,
        country: resolved.country,
        lat: resolved.lat,
        lng: resolved.lng,
        timezone: resolved.timezone,
        admin1: resolved.admin1 || resolved.region || null
      };
    }
    return {
      needsUserChoice: true,
      query: normalizedQuery,
      candidates: results.slice(0, 3)
    };
  } catch (_error) {
    return {
      name: normalizedQuery
    };
  }
}

async function extractRelocationCityWithAi(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  const systemInstruction = [
    'You extract the city mentioned in a relocation or city-check astrology question.',
    'Understand English, French, German, and Spanish.',
    'Return one JSON object and nothing else.',
    'Allowed keys: cityQuery, countryHint, confidence, isCityOnlyReply.',
    'cityQuery must be the literal city or metropolitan place name to resolve with geocoding.',
    'countryHint is optional and should be a short country code only when clearly implied.',
    'confidence must be a number between 0 and 1.',
    'If no city is present, set cityQuery to null.'
  ].join('\n');

  const prompt = [
    `User text: ${value}`,
    'Examples:',
    '- "Is it a good idea for me to live in Hong Kong?" -> {"cityQuery":"Hong Kong","countryHint":"HK","confidence":0.94}',
    '- "What about Tokyo for career?" -> {"cityQuery":"Tokyo","countryHint":"JP","confidence":0.9}',
    '- "Hong kong" -> {"cityQuery":"Hong Kong","countryHint":"HK","confidence":0.9,"isCityOnlyReply":true}',
    'Return JSON now.'
  ].join('\n');

  try {
    const parsed = extractJsonObject(await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    }));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const confidence = Number(parsed.confidence || 0);
    const cityQuery = sanitizeCityQueryCandidate(parsed.cityQuery || '');
    const countryHint = parsed.countryHint ? String(parsed.countryHint).trim().toUpperCase() : null;
    if (!cityQuery || !Number.isFinite(confidence) || confidence < 0.58) {
      return null;
    }
    return {
      cityQuery,
      countryHint,
      confidence,
      isCityOnlyReply: parsed.isCityOnlyReply === true
    };
  } catch (_error) {
    return null;
  }
}

async function parseCityFromQuestion(text) {
  const value = String(text || '').trim();
  const cleanedValue = value
    .replace(/[?!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const selectedCityMatch = value.match(/selected city:\s*([^,\n]+)(?:,\s*([A-Za-z]{2,3}))?(?:\s*\[([\-0-9.]+)\s*,\s*([\-0-9.]+)\])?/i);
  if (selectedCityMatch) {
    return {
      name: String(selectedCityMatch[1] || '').trim(),
      country: selectedCityMatch[2] ? String(selectedCityMatch[2]).trim().toUpperCase() : undefined,
      lat: selectedCityMatch[3] ? Number(selectedCityMatch[3]) : undefined,
      lng: selectedCityMatch[4] ? Number(selectedCityMatch[4]) : undefined
    };
  }

  const aiExtraction = await extractRelocationCityWithAi(cleanedValue);
  if (aiExtraction?.cityQuery) {
    const resolved = await resolveCityQueryWithSearch(
      aiExtraction.countryHint
        ? `${aiExtraction.cityQuery}, ${aiExtraction.countryHint}`
        : aiExtraction.cityQuery
    );
    if (resolved) {
      return resolved;
    }
  }

  const patterns = [
    /\b(?:check|compare|review|analyse|analyze|test)\s+([A-Za-zÀ-ÿ'., -]{2,}?)(?:\s+for\s+me)?$/i,
    /\b(?:check|compare|living in|live in|move to|relocate to)\s+([A-Za-zÀ-ÿ'., -]{2,})$/i,
    /\b(?:habiter|vivre)\s+(?:a|à|au|aux|en)?\s*([A-Za-zÀ-ÿ'., -]{2,}?)(?:\s+pour\b.*)?$/i,
    /\b(?:à|a|au|aux|en)\s+([A-Za-zÀ-ÿ'., -]{2,})$/i,
    /\b(?:tokyo|paris|london|new york|berlin|madrid|barcelona|rome|lisbon|montreal|singapore)(?:,\s*[A-Za-z]{2,3})?\b/i
  ];

  for (const pattern of patterns) {
    const match = cleanedValue.match(pattern);
    const cityQuery = match ? (match[1] || match[0]) : null;
    if (!cityQuery) {
      continue;
    }
    const normalizedQuery = sanitizeCityQueryCandidate(cityQuery);
    if (!normalizedQuery) {
      continue;
    }
    const resolved = await resolveCityQueryWithSearch(normalizedQuery);
    if (resolved) {
      return resolved;
    }
  }

  const standaloneCityCandidate = cleanedValue
    .replace(/[.,]+$/g, '');

  if (
    standaloneCityCandidate &&
    standaloneCityCandidate.length >= 2 &&
    !/\d/.test(standaloneCityCandidate) &&
    !looksLikeStandaloneAstrologyQuery(standaloneCityCandidate) &&
    !parsePlanetFromQuestion(standaloneCityCandidate) &&
    !parseSignFromQuestion(standaloneCityCandidate)
  ) {
    const resolved = await resolveCityQueryWithSearch(standaloneCityCandidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function buildCanonicalMissingArgsResponse(locale, route, missing) {
  const first = Array.isArray(missing) ? missing[0] : missing;

  const fr = {
    focus: 'Je peux répondre à cette question, mais il me faut d’abord votre objectif principal: carrière, amour, foyer, bien-être, créativité ou croissance spirituelle.',
    city: 'Je peux répondre à cette question, mais il me faut d’abord une ville précise.',
    searchWindow: 'Je peux répondre à cette question, mais il me faut d’abord une fenêtre de temps précise, par exemple cette semaine, ce mois-ci ou entre deux dates.',
    transitPlanet: 'Je peux répondre à cette question, mais il me faut d’abord la planète en transit visée.',
    natalPoint: 'Je peux répondre à cette question, mais il me faut d’abord le point natal visé.',
    year: 'Je peux répondre à cette question, mais il me faut d’abord une année précise.',
    body: 'Je peux répondre à cette question, mais il me faut d’abord la planète du retour concerné.',
    sign: 'Je peux répondre à cette question, mais il me faut d’abord le signe concerné.',
    targetDate: 'Je peux répondre à cette question, mais il me faut d’abord une date cible.',
    range: 'Je peux répondre à cette question, mais il me faut d’abord une période de recherche.',
    secondaryProfile: 'Je peux répondre à cette question, mais il me faut d’abord le second profil sauvegardé à comparer.'
  };

  const en = {
    focus: 'I can answer that question, but I first need your main goal: career, love, home, health, creativity, or spiritual growth.',
    city: 'I can answer that question, but I first need a specific city.',
    searchWindow: 'I can answer that question, but I first need a specific time window, for example this week, this month, or between two dates.',
    transitPlanet: 'I can answer that question, but I first need the transit planet.',
    natalPoint: 'I can answer that question, but I first need the natal point.',
    year: 'I can answer that question, but I first need a specific year.',
    body: 'I can answer that question, but I first need the return planet.',
    sign: 'I can answer that question, but I first need the sign.',
    targetDate: 'I can answer that question, but I first need a target date.',
    range: 'I can answer that question, but I first need a search period.',
    secondaryProfile: 'I can answer that question, but I first need the second saved profile to compare.'
  };

  return (locale === 'fr' ? fr[first] : en[first]) || (locale === 'fr'
    ? 'Je peux répondre à cette question, mais il me manque un paramètre nécessaire.'
    : 'I can answer that question, but I am missing a required parameter.');
}

function buildRelocationReplayQuestion(userText, queryState = null) {
  const baseQuestion = String(queryState?.baseQuestion || userText || '').trim();
  const focus = queryState?.parameters?.focus || null;

  if (!baseQuestion) {
    return String(userText || '').trim();
  }

  if (focus && !parseFocusFromQuestion(baseQuestion)) {
    return `${baseQuestion}\n\nFocus on ${focus}.`;
  }

  return baseQuestion;
}

function buildCanonicalToolPrompt(route, userText, subjectProfile, result, locale) {
  const systemInstruction = [
    'You are a concise professional astrologer.',
    `Always answer in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Answer only from the grounded FreeAstro result provided.',
    'Do not invent facts, dates, placements, or meanings not present in the result.',
    'Keep the answer concise and directly tied to the user question.'
  ].join('\n');

  const toolPayload = JSON.stringify(result?.structuredContent || result || {}, null, 2).slice(0, 12000);
  const userPrompt = [
    `Question: ${String(userText || '').trim()}`,
    `Canonical route: ${route.id}`,
    `Profile: ${subjectProfile?.profileName || 'Chart User'}`,
    'Grounded result:',
    toolPayload,
    '',
    'Write the final answer now.'
  ].join('\n');

  return { systemInstruction, userPrompt };
}

async function presentCanonicalToolResult(locale, route, userText, subjectProfile, toolCallResult, responseMode, channel = null, queryState = null) {
  const toolResults = [{
    name: route.toolTarget,
    result: toolCallResult
  }];
  const timelinePayload = extractTransitTimelinePayload(toolCallResult);
  const transitSearchPayload = extractTransitSearchPayload(toolCallResult);
  const structuredPayload = extractStructuredToolPayload(toolCallResult);
  const requestedMonthlyPlanet = parseRequestedMonthlyTransitPlanet(userText);
  const timeframe = route.id === 'current_sky_today' || route.id === 'today_transits_me'
    ? 'current_day'
    : inferStructuredQueryParameters(route.id, userText, subjectProfile, subjectProfile?.timezone || 'UTC')?.timeframe || null;

  if ((route.id === 'month_ahead_transits' || route.id === 'current_sky_today' || route.id === 'today_transits_me') && Array.isArray(timelinePayload?.transits)) {
    const requestedLimit = getRequestedListingLimit(userText, 'month_ahead_transits', 10);
    const visibleTransits = filterTransitEntriesByTimeframe(
      requestedMonthlyPlanet
        ? timelinePayload.transits.filter((entry) => matchesTransitPlanetFilter(entry, requestedMonthlyPlanet))
        : timelinePayload.transits,
      timeframe,
      subjectProfile?.timezone || 'UTC'
    );

    const filteredTitle = requestedMonthlyPlanet
      ? formatRawLabel(locale, {
          en: `${humanizeRawKey(requestedMonthlyPlanet)} monthly transits for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
          fr: `Transits mensuels liés à ${humanizeRawKey(requestedMonthlyPlanet)} pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
          de: `Monatstransite zu ${humanizeRawKey(requestedMonthlyPlanet)} für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
          es: `Tránsitos mensuales relacionados con ${humanizeRawKey(requestedMonthlyPlanet)} para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`
        })
      : null;

    if (responseMode === 'raw' && channel === 'telegram') {
      const pseudoFacts = visibleTransits.map((transit, index) => ({
        title: transit.label || `Transit ${index + 1}`,
        source_kind: factIndex.MONTHLY_TRANSIT_SOURCE_KIND,
        cache_month: toolCallResult?.cacheMonth || '',
        fact_payload: transit
      }));

      return {
        text: buildRawTransitTable(locale, pseudoFacts, subjectProfile, {
          limit: requestedMonthlyPlanet ? Math.max(1, Math.min(200, requestedLimit)) : requestedLimit,
          includeFollowUp: !requestedMonthlyPlanet,
          responseMode,
          requestedPlanet: requestedMonthlyPlanet,
          strictPlanetMatch: Boolean(requestedMonthlyPlanet),
          timeframe,
          timezone: subjectProfile?.timezone || 'UTC'
        }),
        renderMode: 'telegram_pre'
      };
    }

    return buildMonthlyTransitOverviewFromTimeline(locale, visibleTransits, subjectProfile, {
      cacheMonth: toolCallResult?.cacheMonth || '',
      responseMode,
      limit: requestedMonthlyPlanet ? (getRequestedListingLimit(userText, 'monthly_transits_for_planet', visibleTransits.length || 200)) : requestedLimit,
      includeFollowUp: !requestedMonthlyPlanet,
      title: filteredTitle,
      requestedPlanet: requestedMonthlyPlanet,
      strictPlanetMatch: Boolean(requestedMonthlyPlanet),
      timeframe,
      timezone: subjectProfile?.timezone || 'UTC'
    });
  }

  if (route.id === 'monthly_transits_for_planet' && Array.isArray(timelinePayload?.transits)) {
    const planet = parsePlanetFromQuestion(userText);
    const matchingTransits = timelinePayload.transits.filter((entry) => matchesTransitPlanetFilter(entry, planet));
    const requestedLimit = getRequestedListingLimit(userText, 'monthly_transits_for_planet', matchingTransits.length || 200);
    const title = formatRawLabel(locale, {
      en: `${planet ? humanizeRawKey(planet) : 'Selected'} monthly transits for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
      fr: `Transits mensuels liés à ${planet ? humanizeRawKey(planet) : 'la planète demandée'} pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
      de: `Monatstransite zu ${planet ? humanizeRawKey(planet) : 'dem gewählten Planeten'} für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`,
      es: `Tránsitos mensuales relacionados con ${planet ? humanizeRawKey(planet) : 'el planeta solicitado'} para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${toolCallResult?.cacheMonth ? ` — ${toolCallResult.cacheMonth}` : ''}`
    });
    return buildMonthlyTransitOverviewFromTimeline(locale, matchingTransits, subjectProfile, {
      cacheMonth: toolCallResult?.cacheMonth || '',
      responseMode,
      limit: requestedLimit,
      includeFollowUp: false,
      title,
      requestedPlanet: planet,
      strictPlanetMatch: true,
      timeframe,
      timezone: subjectProfile?.timezone || 'UTC'
    }) || buildCanonicalMissingArgsResponse(locale, route, ['transitPlanet']);
  }

  if (route.id === 'transit_search_exact' && transitSearchPayload) {
    if (queryState?.parameters?.fullListing) {
      return buildTransitSearchFullListingResponse(locale, transitSearchPayload, subjectProfile, responseMode);
    }
    if (responseMode === 'raw') {
      return buildTransitSearchRawResponse(locale, transitSearchPayload, subjectProfile);
    }
  }

  if (route.id === 'ephemeris' && structuredPayload && queryState?.parameters?.fullListing) {
    return buildEphemerisRawResponse(locale, structuredPayload, subjectProfile);
  }

  if (responseMode === 'raw') {
    const synastryPayload = extractSynastryPayload(toolCallResult);

    if ((route.id === 'relocation_recommendations' || route.id === 'relocation_city_check') && structuredPayload) {
      return route.id === 'relocation_city_check'
        ? buildRelocationCityCheckRawResponse(locale, structuredPayload, subjectProfile, userText)
        : buildRelocationRawResponse(locale, structuredPayload, subjectProfile, userText);
    }

    if (route.id === 'secondary_progressions' && structuredPayload) {
      return buildSecondaryProgressionsRawResponse(locale, structuredPayload, subjectProfile);
    }

    if (route.id === 'annual_profections' && structuredPayload) {
      return buildAnnualProfectionsRawResponse(locale, structuredPayload, subjectProfile);
    }

    if (route.id === 'solar_return' && structuredPayload) {
      return buildSolarReturnRawResponse(locale, structuredPayload, subjectProfile);
    }

    if (route.id === 'ephemeris' && structuredPayload) {
      return buildEphemerisRawResponse(locale, structuredPayload, subjectProfile);
    }

    if ((route.id === 'personal_horoscope' || route.id === 'sign_horoscope') && structuredPayload) {
      return buildHoroscopeRawResponse(locale, structuredPayload, subjectProfile);
    }

    if ((route.id === 'synastry_summary' || route.id === 'synastry_detailed' || route.id === 'couples_horoscope') && synastryPayload) {
      return buildSynastryRawResponse(locale, synastryPayload, subjectProfile);
    }
  }

  if (responseMode === 'raw') {
    return buildRawToolLoopResponse(locale, subjectProfile, toolResults, {
      channel,
      userText
    });
  }

  const { systemInstruction, userPrompt } = buildCanonicalToolPrompt(route, userText, subjectProfile, toolCallResult, locale);

  try {
    const text = await generatePlainText({
      systemInstruction,
      userText: userPrompt,
      history: [],
      model: getFastPathModelName()
    });
    return normalizeAssistantText(text);
  } catch (error) {
    info('canonical tool interpretation failed', {
      canonicalRouteId: route.id,
      toolTarget: route.toolTarget,
      error: error?.message || String(error)
    });
    return buildRawToolLoopResponse(locale, subjectProfile, toolResults, {
      channel,
      userText
    });
  }
}

async function buildCanonicalToolExecution(identity, route, userText, subjectProfile, secondaryProfile, locale, queryState = null) {
  const flatNatal = buildFlatNatalRequestFromProfile(subjectProfile);
  const nestedNatal = buildNestedNatalRequestFromProfile(subjectProfile);
  const timezone = subjectProfile?.timezone || flatNatal?.tz_str || 'UTC';
  const currentMonthWindow = toolCache.getCurrentMonthWindow(timezone);
  const currentDate = getDateStringInTimezone(timezone);
  const electionalConfig = getElectionalRouteConfig(route?.id);

  if (electionalConfig) {
    const search = buildElectionalSearchWindow(userText, queryState, timezone);
    const location = buildElectionalLocationFromProfile(subjectProfile, timezone);
    const primaryNatal = buildElectionalNatalRequestFromProfile(subjectProfile, subjectProfile.profileName || 'Chart User');
    const secondaryNatal = electionalConfig.secondaryNatalKey && secondaryProfile
      ? buildElectionalNatalRequestFromProfile(secondaryProfile, secondaryProfile.profileName || 'Partner B')
      : null;
    if (!search) {
      return { missing: ['searchWindow'] };
    }
    if (!location) {
      return { missing: ['location'] };
    }
    return {
      toolName: electionalConfig.toolTarget,
      requestArgs: {
        search_window: search.searchWindow,
        location,
        search_tuning: search.searchTuning,
        ...(primaryNatal ? { [electionalConfig.primaryNatalKey]: primaryNatal } : {}),
        ...(secondaryNatal ? { [electionalConfig.secondaryNatalKey]: secondaryNatal } : {}),
        max_results: Math.max(1, Math.min(Number(queryState?.parameters?.limit || 5), 10))
      },
      cacheMonth: '',
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: secondaryNatal ? (secondaryProfile?.profileId || null) : null
    };
  }

  switch (route.id) {
    case 'natal_overview':
    case 'relationship_patterns':
    case 'career_signature':
    case 'money_pattern':
      return flatNatal ? {
        toolName: 'v1_western_natal_insights',
        requestArgs: flatNatal,
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['profile'] };
    case 'rising_sign':
    case 'sun_sign':
    case 'moon_sign':
    case 'midheaven_sign':
      return flatNatal ? {
        toolName: route.toolTarget,
        requestArgs: flatNatal,
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['profile'] };
    case 'current_sky_today':
    case 'today_transits_me':
    case 'month_ahead_transits':
    case 'monthly_transits_for_planet': {
      const parsedMonth = queryState?.parameters?.month || parseMonthFromQuestion(userText, timezone);
      const timeframe = queryState?.parameters?.timeframe || inferStructuredQueryParameters(route.id, userText, subjectProfile, timezone)?.timeframe || null;
      const requestedMonthRange = parsedMonth ? buildMonthDateRange(parsedMonth) : null;
      const selectedWindow = requestedMonthRange || getTimeframeRange(timeframe, timezone) || (currentMonthWindow ? {
        rangeStart: currentMonthWindow.rangeStart,
        rangeEnd: currentMonthWindow.rangeEnd,
        cacheMonth: currentMonthWindow.cacheMonth
      } : null);
      return flatNatal && selectedWindow ? {
        toolName: 'v1_western_transits_timeline',
        requestArgs: {
          natal: flatNatal,
          range_start: selectedWindow.rangeStart || selectedWindow.start,
          range_end: selectedWindow.rangeEnd || selectedWindow.end,
          mode: timeframe === 'current_day' ? 'day' : (timeframe === 'current_week' ? 'week' : 'month'),
          include_houses: subjectProfile.timeKnown !== false
        },
        cacheMonth: selectedWindow.cacheMonth || (parsedMonth ? `${parsedMonth.year}-${String(parsedMonth.month).padStart(2, '0')}` : ''),
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['profile'] };
    }
    case 'transit_search_exact': {
      const extractionMeta = summarizeTransitSearchExtractionMeta(queryState, userText, subjectProfile, timezone);
      const transitPlanet = extractionMeta.transitPlanet;
      const natalPoint = extractionMeta.natalPoint;
      const range = extractionMeta.range;
      const aspectTypes = extractionMeta.aspectTypes;
      if (!transitPlanet) {
        info('transit search extraction resolved', {
          canonicalRouteId: route.id,
          usedAiTransitSearchExtraction: extractionMeta.usedAiTransitSearchExtraction,
          aiExtractionConfidence: extractionMeta.aiExtractionConfidence,
          finalTransitPlanet: null,
          finalNatalPoint: natalPoint,
          finalAspectTypes: aspectTypes,
          finalTimeframe: extractionMeta.timeframe,
          fullListing: extractionMeta.fullListing,
          toolArgsFinal: null,
          usedDeterministicFallback: true,
          missing: ['transitPlanet']
        });
        return { missing: ['transitPlanet'] };
      }
      if (!natalPoint) {
        info('transit search extraction resolved', {
          canonicalRouteId: route.id,
          usedAiTransitSearchExtraction: extractionMeta.usedAiTransitSearchExtraction,
          aiExtractionConfidence: extractionMeta.aiExtractionConfidence,
          finalTransitPlanet: transitPlanet,
          finalNatalPoint: null,
          finalAspectTypes: aspectTypes,
          finalTimeframe: extractionMeta.timeframe,
          fullListing: extractionMeta.fullListing,
          toolArgsFinal: null,
          usedDeterministicFallback: true,
          missing: ['natalPoint']
        });
        return { missing: ['natalPoint'] };
      }
      const requestArgs = {
        natal: flatNatal,
        transit_planet: transitPlanet,
        natal_point: natalPoint,
        ...(range.range_start && range.range_end ? {
          range_start: range.range_start,
          range_end: range.range_end
        } : {
          range_start: range.start,
          range_end: range.end
        }),
        ...(range.age_start_years !== undefined && range.age_end_years !== undefined ? {
          age_start_years: range.age_start_years,
          age_end_years: range.age_end_years
        } : {}),
        ...(aspectTypes.length > 0 ? { aspect_types: aspectTypes } : {}),
        include_context: true
      };
      info('transit search extraction resolved', {
        canonicalRouteId: route.id,
        usedAiTransitSearchExtraction: extractionMeta.usedAiTransitSearchExtraction,
        aiExtractionConfidence: extractionMeta.aiExtractionConfidence,
        finalTransitPlanet: transitPlanet,
        finalNatalPoint: natalPoint,
        finalAspectTypes: aspectTypes,
        finalTimeframe: extractionMeta.timeframe,
        fullListing: extractionMeta.fullListing,
        toolArgsFinal: requestArgs,
        usedDeterministicFallback: extractionMeta.usedDeterministicFallback
      });
      return {
        toolName: 'v1_western_transits_search',
        requestArgs,
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    }
    case 'synastry_summary':
    case 'synastry_detailed':
      if (!secondaryProfile) {
        return { missing: ['secondaryProfile'] };
      }
      return {
        toolName: route.toolTarget,
        requestArgs: {
          person_a: profiles.buildSynastryPersonPayload(subjectProfile),
          person_b: profiles.buildSynastryPersonPayload(secondaryProfile)
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: secondaryProfile.profileId
      };
    case 'couples_horoscope':
      if (!secondaryProfile) {
        return { missing: ['secondaryProfile'] };
      }
      return {
        toolName: route.toolTarget,
        requestArgs: {
          person_a: profiles.buildSynastryPersonPayload(subjectProfile),
          person_b: profiles.buildSynastryPersonPayload(secondaryProfile),
          date: currentDate,
          tz_str: timezone
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: secondaryProfile.profileId
      };
    case 'relocation_recommendations': {
      const focus = queryState?.parameters?.focus || parseFocusFromQuestion(userText);
      const mcpFocus = normalizeRelocationFocusForMcp(focus);
      if (!mcpFocus) {
        return { missing: ['focus'] };
      }
      const countryConstraint = queryState?.parameters?.countries?.length
        ? {
            countryScope: queryState?.parameters?.countryScope || 'selected_countries',
            countries: queryState.parameters.countries
          }
        : await extractRelocationCountryConstraint(userText);
      const defaultWorldScope = !countryConstraint && isBroadRelocationRecommendationQuestion(userText)
        ? { countryScope: 'all' }
        : null;
      const effectiveCountryConstraint = countryConstraint || defaultWorldScope;
      return {
        toolName: route.toolTarget,
        requestArgs: {
          natal: flatNatal,
          focus: mcpFocus,
          ...(effectiveCountryConstraint?.countryScope ? { country_scope: effectiveCountryConstraint.countryScope } : {}),
          ...(Array.isArray(effectiveCountryConstraint?.countries) && effectiveCountryConstraint.countries.length > 0
            ? { countries: effectiveCountryConstraint.countries }
            : {}),
          limit: 5,
          include_map_lines: true,
          include_crossings: true,
          include_paran_summary: true,
          include_relocation_summary: true
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    }
    case 'relocation_city_check': {
      const city = await parseCityFromQuestion(userText);
      if (!city) {
        return { missing: ['city'] };
      }
      if (city.needsUserChoice && Array.isArray(city.candidates) && city.candidates.length > 0) {
        return {
          requiresCitySelection: true,
          candidates: city.candidates,
          cityQuery: city.query || null
        };
      }
      return {
        toolName: route.toolTarget,
        requestArgs: {
          natal: flatNatal,
          city: city.name,
          country: city.country || undefined,
          lat: city.latitude || city.lat || undefined,
          lng: city.longitude || city.lng || undefined,
          include_map_lines: true,
          include_crossings: true,
          include_paran_summary: true,
          include_relocation_summary: true
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    }
    case 'astrocartography_lines':
    case 'astrocartography_parans':
      return {
        toolName: route.toolTarget,
        requestArgs: {
          natal: flatNatal
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    case 'secondary_progressions': {
      const year = parseYearFromQuestion(userText) || getCurrentLocalDateParts(timezone).year;
      return nestedNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          natal: nestedNatal,
          response_mode: 'full',
          secondary_progression: {
            target_date: `${year}-12-31`
          }
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['targetDate'] };
    }
    case 'secondary_progressions_exact_aspects': {
      const year = parseYearFromQuestion(userText) || getCurrentLocalDateParts(timezone).year;
      const range = buildCurrentYearRange(timezone, year);
      return nestedNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          natal: nestedNatal,
          search: {
            from: range.start,
            to: range.end,
            limit: 100,
            order: 'asc'
          },
          include_angles: true
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['range'] };
    }
    case 'annual_profections': {
      const year = parseYearFromQuestion(userText) || getCurrentLocalDateParts(timezone).year;
      return flatNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          ...flatNatal,
          annual_profection: { year }
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['year'] };
    }
    case 'solar_return': {
      const year = parseYearFromQuestion(userText) || getCurrentLocalDateParts(timezone).year;
      return nestedNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          natal: nestedNatal,
          solar_return: {
            year,
            location: cloneValue(nestedNatal.location)
          }
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['year'] };
    }
    case 'planet_return': {
      const body = parsePlanetFromQuestion(userText);
      if (!body) {
        return { missing: ['body'] };
      }
      return nestedNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          natal: nestedNatal,
          return_target: {
            body,
            search_start: currentDate,
            location: cloneValue(nestedNatal.location)
          }
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['body'] };
    }
    case 'ephemeris': {
      const parsedMonth = parseMonthFromQuestion(userText, timezone);
      const range = parsedMonth ? buildMonthDateRange(parsedMonth) : currentMonthWindow ? {
        start: currentMonthWindow.rangeStart,
        end: currentMonthWindow.rangeEnd
      } : null;
      if (!range) {
        return { missing: ['range'] };
      }
      return {
        toolName: route.toolTarget,
        requestArgs: {
          start: range.start,
          end: range.end,
          step: '1d',
          timezone,
          include_speed: true,
          include_retrograde: true,
          include_aspects: true,
          include_minor_aspects: false
        },
        cacheMonth: currentMonthWindow?.cacheMonth || '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    }
    case 'personal_horoscope':
      return flatNatal ? {
        toolName: route.toolTarget,
        requestArgs: {
          birth: {
            year: flatNatal.year,
            month: flatNatal.month,
            day: flatNatal.day,
            hour: flatNatal.hour,
            minute: flatNatal.minute,
            city: flatNatal.city,
            lat: flatNatal.lat,
            lng: flatNatal.lng,
            tz_str: flatNatal.tz_str || timezone
          },
          date: currentDate,
          timezone,
          tz_str: timezone,
          locale
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      } : { missing: ['profile'] };
    case 'sign_horoscope': {
      const sign = parseSignFromQuestion(userText);
      if (!sign) {
        return { missing: ['sign'] };
      }
      return {
        toolName: route.toolTarget,
        requestArgs: {
          sign,
          date: currentDate,
          tz_str: timezone,
          locale
        },
        cacheMonth: '',
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null
      };
    }
    default:
      return null;
  }
}

async function executeCanonicalToolRoute(identity, route, userText, subjectProfile, secondaryProfile, locale, responseMode, queryState = null) {
  if (!route?.toolTarget) {
    return null;
  }

  const execution = await buildCanonicalToolExecution(identity, route, userText, subjectProfile, secondaryProfile, locale, queryState);
  if (!execution) {
    return null;
  }

  if (execution.missing) {
    return {
      text: buildCanonicalMissingArgsResponse(locale, route, execution.missing),
      usedTools: [],
      renderMode: 'plain'
    };
  }

  if (execution.requiresCitySelection) {
    return {
      requiresCitySelection: true,
      candidates: execution.candidates || [],
      cityQuery: execution.cityQuery || null,
      replayQuestion: route.id === 'relocation_city_check'
        ? buildRelocationReplayQuestion(userText, queryState)
        : (queryState?.baseQuestion || userText),
      text: buildCanonicalMissingArgsResponse(locale, route, ['city']),
      usedTools: [],
      renderMode: 'plain'
    };
  }

  const resolved = await toolCache.resolveCachedToolCall(identity, {
    toolName: execution.toolName,
    requestArgs: execution.requestArgs,
    profile: subjectProfile,
    primaryProfileId: execution.primaryProfileId,
    secondaryProfileId: execution.secondaryProfileId,
    questionText: userText,
    cacheMonth: execution.cacheMonth || '',
    source: 'canonical',
    executor: (resolvedArgs) => mcpService.callToolByOriginalName(execution.toolName, resolvedArgs)
  });

  const presented = await presentCanonicalToolResult(
    locale,
    route,
    userText,
    subjectProfile,
    resolved.result,
    responseMode,
    identity?.channel || null,
    queryState
  );
  return {
    text: typeof presented === 'string' ? presented : presented.text,
    textParts: typeof presented === 'string' ? undefined : presented.textParts,
    renderMode: typeof presented === 'string' ? 'plain' : (presented.renderMode || 'plain'),
    usedTools: [{
      name: execution.toolName,
      args: execution.requestArgs,
      result: resolved.result
    }]
  };
}

async function resolveConversationTargets(identity, userText, route, activeProfile) {
  const conversationContext = getConversationContext(identity);
  const allProfiles = await profiles.listProfiles(identity);
  const active = activeProfile || allProfiles.find((profile) => profile.isActive) || allProfiles[0] || null;
  const mentionedProfiles = await profiles.findMentionedProfiles(identity, userText);
  const distinctMentionedProfiles = mentionedProfiles.filter((profile, index, entries) => (
    entries.findIndex((entry) => entry.profileId === profile.profileId) === index
  ));
  const nonActiveProfiles = allProfiles.filter((profile) => profile.profileId !== active?.profileId);
  const pronounRefersToOther = detectThirdPartyPronoun(userText);
  const requestedExternalProfileName = extractRequestedExternalProfileName(userText, route, active, allProfiles);
  const inferredElectionalRoute = inferElectionalRouteConfigFromQuestion(userText);
  const isExplicitWeddingQuestion = inferredElectionalRoute?.id === 'wedding_election_search';
  const canReusePreviousWeddingPair = (
    !isExplicitWeddingQuestion &&
    route.kind === 'astrology_transits' &&
    conversationContext.lastCommonRouteId === 'wedding_election_search'
  );

  if (isExplicitWeddingQuestion || canReusePreviousWeddingPair) {
    if (distinctMentionedProfiles.length >= 2) {
      return {
        activeProfile: active,
        subjectProfile: distinctMentionedProfiles[0],
        secondaryProfile: distinctMentionedProfiles[1],
        needsClarification: false,
        requestedProfileName: null,
        needsProfileCreation: false
      };
    }

    if (
      canReusePreviousWeddingPair &&
      distinctMentionedProfiles.length === 0 &&
      conversationContext.lastReferencedProfileId &&
      conversationContext.lastComparedProfileId
    ) {
      const spouseA = await profiles.getProfileById(identity, conversationContext.lastReferencedProfileId);
      const spouseB = await profiles.getProfileById(identity, conversationContext.lastComparedProfileId);

      if (spouseA && spouseB && spouseA.profileId !== spouseB.profileId) {
        return {
          activeProfile: active,
          subjectProfile: spouseA,
          secondaryProfile: spouseB,
          needsClarification: false,
          requestedProfileName: null,
          needsProfileCreation: false
        };
      }
    }

    if (isExplicitWeddingQuestion) {
      return {
        activeProfile: active,
        subjectProfile: null,
        secondaryProfile: null,
        needsClarification: false,
        needsWeddingProfileSelection: true,
        candidates: allProfiles
      };
    }
  }

  if (route.kind === 'astrology_synastry') {
    const comparedProfiles = distinctMentionedProfiles.filter((profile) => profile.profileId !== active?.profileId);
    let secondaryProfile = null;

    if (comparedProfiles.length === 1) {
      secondaryProfile = comparedProfiles[0];
    } else if (comparedProfiles.length === 0 && conversationContext.lastComparedProfileId) {
      secondaryProfile = await profiles.getProfileById(identity, conversationContext.lastComparedProfileId);
    } else if (comparedProfiles.length === 0 && nonActiveProfiles.length === 1) {
      secondaryProfile = nonActiveProfiles[0];
    }

    if (!active || !secondaryProfile || active.profileId === secondaryProfile.profileId) {
      return {
        activeProfile: active,
        subjectProfile: active,
        secondaryProfile: null,
        needsClarification: true
      };
    }

    return {
      activeProfile: active,
      subjectProfile: active,
      secondaryProfile,
      needsClarification: false
    };
  }

  if (!active) {
    return {
      activeProfile: null,
      subjectProfile: null,
      secondaryProfile: null,
      needsClarification: false
    };
  }

  if (distinctMentionedProfiles.length > 1) {
    return {
      activeProfile: active,
      subjectProfile: active,
      secondaryProfile: null,
      needsClarification: true
    };
  }

  if (distinctMentionedProfiles.length === 1) {
    return {
      activeProfile: active,
      subjectProfile: distinctMentionedProfiles[0],
      secondaryProfile: null,
      needsClarification: false,
      requestedProfileName: null,
      needsProfileCreation: false
    };
  }

  if (requestedExternalProfileName) {
    return {
      activeProfile: active,
      subjectProfile: null,
      secondaryProfile: null,
      needsClarification: false,
      requestedProfileName: requestedExternalProfileName,
      needsProfileCreation: true
    };
  }

  if (pronounRefersToOther && conversationContext.lastReferencedProfileId && conversationContext.lastReferencedProfileId !== active.profileId) {
    const referencedProfile = await profiles.getProfileById(identity, conversationContext.lastReferencedProfileId);
    if (referencedProfile) {
      return {
        activeProfile: active,
        subjectProfile: referencedProfile,
        secondaryProfile: null,
        needsClarification: false,
        requestedProfileName: null,
        needsProfileCreation: false
      };
    }
  }

  if (pronounRefersToOther) {
    return {
      activeProfile: active,
      subjectProfile: null,
      secondaryProfile: null,
      needsClarification: false,
      requestedProfileName: null,
      needsProfileCreation: true
    };
  }

  return {
    activeProfile: active,
    subjectProfile: active,
    secondaryProfile: null,
    needsClarification: false,
    requestedProfileName: null,
    needsProfileCreation: false
  };
}

function normalizeAssistantText(text) {
  const cleaned = String(text || '')
    .replace(/\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .trim();

  return dedupeRepeatedSentences(cleaned);
}

function normalizeStructuredAssistantText(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeRawPresentationText(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSentenceForCompare(sentence) {
  return String(sentence || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWordSet(sentence) {
  return new Set(
    normalizeSentenceForCompare(sentence)
      .split(' ')
      .filter((word) => word.length > 2)
  );
}

function sentenceSimilarity(left, right) {
  const leftWords = getWordSet(left);
  const rightWords = getWordSet(right);

  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftWords.size, rightWords.size);
}

function dedupeRepeatedSentences(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const keptSentences = [];
  const keptParagraphs = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const uniqueSentences = [];

    for (const sentence of sentences) {
      const signature = normalizeSentenceForCompare(sentence);
      const isDuplicate = keptSentences.some((existing) => {
        if (existing.signature === signature) {
          return true;
        }

        const wordCount = signature.split(' ').filter(Boolean).length;
        if (wordCount < 6) {
          return false;
        }

        return sentenceSimilarity(existing.text, sentence) >= 0.8;
      });

      if (!isDuplicate) {
        keptSentences.push({ signature, text: sentence });
        uniqueSentences.push(sentence);
      }
    }

    if (uniqueSentences.length > 0) {
      keptParagraphs.push(uniqueSentences.join(' '));
    }
  }

  return keptParagraphs.join('\n\n').trim();
}

function isLocalOnlyPreferred(intent, factAvailability) {
  if (!intent || intent.id === 'relocation' || intent.id === 'synastry') {
    return false;
  }

  if (intent.id === 'transits') {
    return Boolean(factAvailability?.indexedTransitCacheMonth);
  }

  return Boolean(factAvailability?.hasNatalFacts);
}

function isFactFastPathEligible(intent, factAvailability) {
  if (!intent || intent.id === 'relocation' || intent.id === 'synastry') {
    return false;
  }

  if (intent.id === 'transits') {
    return Boolean(factAvailability?.indexedTransitCacheMonth);
  }

  return Boolean(factAvailability?.hasNatalFacts);
}

function hasIndexedCoverage(factAvailability) {
  return Boolean(factAvailability?.hasNatalFacts || factAvailability?.indexedTransitCacheMonth);
}

function extractQuestionTags(text) {
  const value = String(text || '').toLowerCase();
  const tags = new Set();

  const keywordMap = [
    ['career', ['life_path', 'structure', 'career', 'work', 'profession', 'public_life']],
    ['work', ['life_path', 'structure', 'career', 'work']],
    ['job', ['life_path', 'structure', 'career', 'work']],
    ['purpose', ['life_path', 'identity']],
    ['relationship', ['relationships', 'love', 'partnership']],
    ['love', ['relationships', 'love', 'partnership']],
    ['partner', ['relationships', 'partnership']],
    ['money', ['resources', 'money', 'security']],
    ['emotion', ['emotions', 'feelings']],
    ['feel', ['emotions', 'feelings']],
    ['mind', ['mind', 'thinking', 'communication']],
    ['communication', ['mind', 'communication']],
    ['family', ['roots', 'family', 'home']],
    ['home', ['roots', 'home', 'family']],
    ['identity', ['identity', 'self']],
    ['strength', ['identity', 'strength', 'talent']],
    ['challenge', ['challenge', 'growth', 'pressure']],
    ['transit', ['transit']],
    ['month', ['month']],
    ['forecast', ['forecast', 'month']],
    ['today', ['timing', 'current']],
    ['current', ['timing', 'current']],
    ['sky', ['current', 'sky', 'transit']],
    ['now', ['current', 'timing', 'transit']],
    ['energy', ['current', 'transit']],
    ['energies', ['current', 'transit']]
  ];

  keywordMap.forEach(([needle, mappedTags]) => {
    if (value.includes(needle)) {
      mappedTags.forEach((tag) => tags.add(tag));
    }
  });

  const planets = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron'];
  planets.forEach((planet) => {
    if (new RegExp(`\\b${planet}\\b`, 'i').test(value)) {
      tags.add(`planet:${planet}`);
    }
  });

  for (let house = 1; house <= 12; house += 1) {
    if (new RegExp(`\\b${house}(st|nd|rd|th)?\\b`, 'i').test(value) || new RegExp(`\\bhouse\\s+${house}\\b`, 'i').test(value)) {
      tags.add(`house:${house}`);
    }
  }

  if (/\brising|ascendant|asc\b/i.test(value)) {
    tags.add('angle:asc');
  }

  if (/\bmidheaven|mc\b/i.test(value)) {
    tags.add('angle:mc');
  }

  return [...tags];
}

function buildFactSearchInput(intent, userText, activeProfile, factAvailability) {
  const tags = extractQuestionTags(userText);
  const value = String(userText || '').toLowerCase();
  const transitBiased = /\bcurrent sky\b|\bsky right now\b|\bright now\b|\bcurrent energies\b|\bwhat'?s happening now\b|\bwhat is happening now\b|\bsky\b/.test(value);
  const input = {
    primaryProfileId: activeProfile.profileId,
    secondaryProfileId: null,
    categories: [],
    tags,
    sourceKinds: [],
    cacheMonth: null,
    limit: 6
  };

  if (intent.id === 'transits' || transitBiased) {
    input.sourceKinds = [factIndex.MONTHLY_TRANSIT_SOURCE_KIND];
    input.cacheMonth = factAvailability?.indexedTransitCacheMonth || null;
    input.limit = 5;
  } else {
    input.sourceKinds = [factIndex.NATAL_SOURCE_KIND];
  }

  return input;
}

function isTransitBiasedQuestion(text) {
  return /\bcurrent sky\b|\bsky right now\b|\bright now\b|\bcurrent energies\b|\bwhat'?s happening now\b|\bwhat is happening now\b|\bsky\b|\btoday\b|\bthis month\b|\bthis months\b|\bce mois\b/.test(String(text || '').toLowerCase());
}

function normalizePlannerArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function extractJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      return null;
    }
  }
}

async function planFactSearchQuery(locale, userText, intent, activeProfile, factAvailability) {
  const systemInstruction = [
    'You route astrology user questions to either indexed facts or MCP tools and, when applicable, generate structured search parameters for the fact index.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: target, sourceKinds, categories, tags, cacheMonth, limit, reason, answerStyle.',
    'target must be either indexed_facts or mcp.',
    'sourceKinds must be an array containing natal and/or monthly_transit.',
    'answerStyle must be one of natal_theme, planet_focus, house_focus, aspect_focus, life_area_theme, current_sky, personal_transits, synastry, system_answer.',
    'categories must be broad retrieval categories such as identity, emotions, relationships, structure, transformation, growth, drive, life_path, chart_pattern, mind, transit_event, transit_theme, timing_window.',
    'tags must be short exact-ish lookup terms like current, sky, relationship, love, career, work, planet:venus, planet:mars, angle:asc, angle:mc, house:7.',
    'If the question is about the current sky, now, today, current energies, or what is happening right now, prefer monthly_transit.',
    'If the question is about personality, natal chart, life pattern, relationship style, or birth chart themes, prefer natal.',
    'If the question is about synastry, compatibility, comparing two people, relocation, maps, astrocartography, or a capability not present in natal/monthly transit facts, use target mcp.',
    'If uncertain, use indexed_facts when natal or monthly transit facts could answer it.',
    'Include both natal and monthly_transit only when the question genuinely mixes both.',
    'For current month transit lookups, set cacheMonth to the provided active transit month.',
    'Keep limit between 3 and 6.'
  ].join('\n');

  const prompt = [
    `Question: ${String(userText || '').trim()}`,
    `Detected intent: ${intent.id}`,
    `Active profile: ${activeProfile.profileName || 'Chart User'}`,
    `Natal facts indexed: ${factAvailability?.hasNatalFacts ? 'yes' : 'no'}`,
    `Current indexed transit month: ${factAvailability?.indexedTransitCacheMonth || 'none'}`,
    '',
    'Return JSON now.'
  ].join('\n');

  const planned = extractJsonObject(await generatePlainText({
    systemInstruction,
    userText: prompt,
    history: [],
    model: getFastPathModelName()
  }));

  if (!planned || typeof planned !== 'object') {
    return null;
  }

  const target = planned.target === 'mcp' ? 'mcp' : 'indexed_facts';
  const sourceKinds = normalizePlannerArray(planned.sourceKinds)
    .filter((value) => [factIndex.NATAL_SOURCE_KIND, factIndex.MONTHLY_TRANSIT_SOURCE_KIND].includes(value));
  const categories = normalizePlannerArray(planned.categories);
  const tags = normalizePlannerArray(planned.tags);
  const requestedCacheMonth = planned.cacheMonth ? String(planned.cacheMonth).trim() : null;
  const limit = Math.max(3, Math.min(Number(planned.limit || 4), 6));
  const answerStyle = ANSWER_STYLES.has(String(planned.answerStyle || '').trim())
    ? String(planned.answerStyle).trim()
    : deriveDefaultAnswerStyle(intent, userText);

  return {
    target,
    primaryProfileId: activeProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : [factIndex.NATAL_SOURCE_KIND],
    categories,
    tags,
    cacheMonth: requestedCacheMonth || null,
    limit,
    reason: planned.reason ? String(planned.reason) : null,
    answerStyle
  };
}

function sentenceCase(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return text.endsWith('.') || text.endsWith('!') || text.endsWith('?')
    ? text
    : `${text}.`;
}

function formatRawLabel(locale, labels) {
  return labels[locale] || labels.en;
}

function localizeRawType(locale, typeLabel) {
  const normalized = String(typeLabel || '').toLowerCase();

  if (normalized === 'pressure window') {
    return formatRawLabel(locale, {
      en: 'Pressure Window',
      fr: 'Fenêtre de pression',
      de: 'Druckfenster',
      es: 'Ventana de presión'
    });
  }

  if (normalized === 'support window') {
    return formatRawLabel(locale, {
      en: 'Support Window',
      fr: 'Fenêtre de soutien',
      de: 'Unterstützungsfenster',
      es: 'Ventana de apoyo'
    });
  }

  if (normalized === 'stellium') {
    return formatRawLabel(locale, {
      en: 'Stellium',
      fr: 'Stellium',
      de: 'Stellium',
      es: 'Stellium'
    });
  }

  return typeLabel;
}

function formatScalarValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function humanizeRawKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRawTitle(value) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  const cleaned = text
    .replace(/\s+Category:.*$/i, '')
    .replace(/\s+Kind:.*$/i, '')
    .replace(/\s+Subjects:.*$/i, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  const machineLike = /[.:]/.test(cleaned) || /\d{4}-\d{2}-\d{2}t/i.test(cleaned);
  if (machineLike) {
    return humanizeRawKey(
      cleaned
        .replace(/^transit_insight[.:]/i, '')
        .replace(/\.\d{4}-\d{2}-\d{2}t[\d:z-]+$/i, '')
    );
  }

  return cleaned;
}

function formatRawDate(value) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!match) {
    return text;
  }

  return match[2] ? `${match[1]} ${match[2]} UTC` : match[1];
}

function formatRawDateWindow(startValue, endValue) {
  const start = formatRawDate(startValue);
  const end = formatRawDate(endValue);

  if (start && end) {
    return `${start} → ${end}`;
  }

  return start || end || null;
}

function localizeRawSectionTitle(locale, key) {
  const labels = {
    placements: {
      en: 'Planet placements',
      fr: 'Placements des planètes',
      de: 'Planetenstellungen',
      es: 'Posiciones planetarias'
    },
    aspects: {
      en: 'Major aspects',
      fr: 'Aspects majeurs',
      de: 'Wichtige Aspekte',
      es: 'Aspectos mayores'
    },
    structures: {
      en: 'Main structures',
      fr: 'Structures principales',
      de: 'Hauptstrukturen',
      es: 'Estructuras principales'
    },
    natalFacts: {
      en: 'Natal chart facts',
      fr: 'Faits du thème natal',
      de: 'Fakten des Geburtshoroskops',
      es: 'Hechos de la carta natal'
    }
  };

  return labels[key]?.[locale] || labels[key]?.en || key;
}

function normalizeRawList(values, formatter = formatScalarValue) {
  return (Array.isArray(values) ? values : [])
    .map((value) => formatter(value))
    .filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getRawFactCore(fact) {
  const payload = fact?.factPayload || fact?.fact_payload || {};
  const raw = payload?.raw && typeof payload.raw === 'object' ? payload.raw : null;
  const evidence = raw?.evidence && typeof raw.evidence === 'object'
    ? raw.evidence
    : (payload?.evidence && typeof payload.evidence === 'object' ? payload.evidence : payload);
  const entities = raw?.entities && typeof raw.entities === 'object' ? raw.entities : {};
  const importance = Array.isArray(payload?.importance) ? payload.importance : [];

  return {
    payload,
    raw: raw || payload,
    evidence: evidence || {},
    entities,
    importance: importance[0] || null
  };
}

function normalizeDriverLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const houseRulerMatch = text.match(/^(\d+)(?:st|nd|rd|th)?_ruler_house_(\d+)$/i);
  if (houseRulerMatch) {
    return `${houseRulerMatch[1]}th ruler in house ${houseRulerMatch[2]}`;
  }

  const houseMatch = text.match(/^house_(\d+)$/i);
  if (houseMatch) {
    return `House ${houseMatch[1]}`;
  }

  return humanizeRawKey(text);
}

function normalizeEntityList(values, formatter = humanizeRawKey) {
  return normalizeRawList(values, (value) => {
    const rendered = formatScalarValue(value);
    return rendered ? formatter(rendered) : null;
  });
}

function formatRawJoinedList(values, limit = 4) {
  const items = values.filter(Boolean).slice(0, limit);
  return items.length > 0 ? items.join(', ') : null;
}

function buildMonthlyTransitFollowUpPrompt(locale) {
  return formatRawLabel(locale, {
    en: 'If you want, I can also show the minor transits or absolutely all transits for the month.',
    fr: 'Si vous voulez, je peux aussi montrer les transits mineurs ou absolument tous les transits du mois.',
    de: 'Wenn du möchtest, kann ich dir auch die kleineren Transite oder absolut alle Monatstransite zeigen.',
    es: 'Si quieres, también puedo mostrar los tránsitos menores o absolutamente todos los tránsitos del mes.'
  });
}

function isTopMonthlyTransitRoute(routeOrId) {
  if (!routeOrId) {
    return false;
  }

  const id = typeof routeOrId === 'string'
    ? routeOrId
    : (routeOrId.commonRouteId || routeOrId.id || null);

  return id === 'month_ahead_transits' || id === 'current_sky_today' || id === 'today_transits_me';
}

function isMonthlyTransitListingRoute(routeOrId) {
  if (!routeOrId) {
    return false;
  }

  const id = typeof routeOrId === 'string'
    ? routeOrId
    : (routeOrId.commonRouteId || routeOrId.id || null);

  return id === 'month_ahead_transits' || id === 'monthly_transits_for_planet' || id === 'current_sky_today' || id === 'today_transits_me';
}

function extractTransitTimelinePayload(result) {
  const candidates = [
    result,
    result?.structuredContent,
    result?.timeline,
    result?.structuredContent?.timeline,
    result?.data,
    result?.structuredContent?.data
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (Array.isArray(candidate?.transits)) {
      return candidate;
    }

    if (candidate?.data && Array.isArray(candidate.data.transits)) {
      return candidate.data;
    }

    if (candidate?.timeline && Array.isArray(candidate.timeline.transits)) {
      return candidate.timeline;
    }

    if (candidate?.timeline?.data && Array.isArray(candidate.timeline.data.transits)) {
      return candidate.timeline.data;
    }

    const rawText = typeof candidate?.text === 'string'
      ? candidate.text
      : (typeof candidate === 'string' ? candidate : null);

    if (!rawText) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed?.transits)) {
        return parsed;
      }
      if (parsed?.data && Array.isArray(parsed.data.transits)) {
        return parsed.data;
      }
      if (parsed?.timeline && Array.isArray(parsed.timeline.transits)) {
        return parsed.timeline;
      }
      if (parsed?.timeline?.data && Array.isArray(parsed.timeline.data.transits)) {
        return parsed.timeline.data;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function extractTransitSearchPayload(result) {
  const candidates = [
    result,
    result?.structuredContent,
    result?.data,
    result?.structuredContent?.data
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (Array.isArray(candidate?.passes) || Array.isArray(candidate?.cycles) || candidate?.search_summary) {
      return candidate;
    }

    const rawText = typeof candidate?.text === 'string'
      ? candidate.text
      : (typeof candidate === 'string' ? candidate : null);

    if (!rawText) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed?.passes) || Array.isArray(parsed?.cycles) || parsed?.search_summary) {
        return parsed;
      }
      if (parsed?.structuredContent && (Array.isArray(parsed.structuredContent?.passes) || Array.isArray(parsed.structuredContent?.cycles) || parsed.structuredContent?.search_summary)) {
        return parsed.structuredContent;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function extractStructuredToolPayload(result) {
  const candidates = [
    result?.structuredContent,
    result?.data,
    result?.structuredContent?.data,
    result
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (candidate.results || candidate.progressed_chart || candidate.profection || candidate.planets || candidate.meta) {
        return candidate;
      }
    }

    const rawText = typeof candidate?.text === 'string'
      ? candidate.text
      : (typeof candidate === 'string' ? candidate : null);
    if (!rawText) {
      continue;
    }

    const parsed = extractJsonObject(rawText);
    if (parsed && typeof parsed === 'object') {
      return parsed.structuredContent && typeof parsed.structuredContent === 'object'
        ? parsed.structuredContent
        : parsed;
    }
  }

  return null;
}

function getLatestElectionalToolResult(toolResults = []) {
  const entries = Array.isArray(toolResults) ? toolResults : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!/^v2_western_electional_/i.test(String(entry?.name || ''))) {
      continue;
    }

    const payload = extractStructuredToolPayload(entry?.result);
    const topResult = asArray(payload?.results)[0] || null;
    if (!payload || !topResult) {
      continue;
    }

    return {
      toolName: String(entry.name),
      toolArgs: entry?.args || null,
      payload,
      topResult
    };
  }

  return null;
}

function isElectionalResultExplanationFollowUp(text) {
  const value = normalizeMatchingText(text)
    .replace(/[^a-z0-9?' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value || value.length > 160) {
    return false;
  }

  return /\b(why|what are (these|those) conditions|which conditions|what conditions|what are (these|those) factors|which factors|what factors|what makes (it|this window|this date) (good|favorable|favourable)|why (that|this date|this window)|explain (this|that|the window|the date)|details? on (this|that)|quelles? sont ces conditions|quels? sont ces facteurs|c est quoi ces conditions|c est quoi ces facteurs|pourquoi|pourquoi (cette date|ce moment|ce creneau)|explique (ce|cette) (date|moment|creneau)|plus de details?|detaille|developpe|welche faktoren|was sind diese faktoren|que factores|cuales son estos factores)\b/i.test(value);
}

function localizeElectionalQuality(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    fr: {
      strong: 'solide',
      very_strong: 'très solide',
      excellent: 'excellente',
      good: 'bonne',
      mixed: 'mitigée',
      moderate: 'modérée',
      weak: 'faible',
      poor: 'faible',
      rejected: 'défavorable'
    },
    en: {
      very_strong: 'very strong'
    },
    de: {
      strong: 'stark',
      very_strong: 'sehr stark',
      excellent: 'ausgezeichnet',
      good: 'gut',
      mixed: 'gemischt',
      moderate: 'moderat',
      weak: 'schwach',
      poor: 'schwach',
      rejected: 'ungünstig'
    },
    es: {
      strong: 'sólida',
      very_strong: 'muy sólida',
      excellent: 'excelente',
      good: 'buena',
      mixed: 'mixta',
      moderate: 'moderada',
      weak: 'débil',
      poor: 'débil',
      rejected: 'desfavorable'
    }
  };

  return localized[locale]?.[normalized] || localized.en?.[normalized] || humanizeRawKey(normalized).toLowerCase();
}

function localizeElectionalVerdict(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    fr: {
      sound: 'favorable',
      acceptable: 'acceptable',
      mixed: 'mitigé',
      weak: 'fragile',
      rejected: 'déconseillé'
    },
    de: {
      sound: 'tragfähig',
      acceptable: 'akzeptabel',
      mixed: 'gemischt',
      weak: 'fragil',
      rejected: 'nicht empfohlen'
    },
    es: {
      sound: 'favorable',
      acceptable: 'aceptable',
      mixed: 'mixto',
      weak: 'frágil',
      rejected: 'desaconsejado'
    }
  };

  return localized[locale]?.[normalized] || humanizeRawKey(normalized).toLowerCase();
}

function joinLocalizedList(locale, values = []) {
  const items = asArray(values).filter(Boolean);
  if (items.length === 0) {
    return null;
  }

  if (items.length === 1) {
    return items[0];
  }

  const conjunction = locale === 'fr'
    ? ' et '
    : (locale === 'de' ? ' und ' : (locale === 'es' ? ' y ' : ' and '));
  return `${items.slice(0, -1).join(', ')}${conjunction}${items[items.length - 1]}`;
}

function formatEnglishOrdinal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value || '');
  }

  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${number}th`;
  }

  switch (number % 10) {
    case 1:
      return `${number}st`;
    case 2:
      return `${number}nd`;
    case 3:
      return `${number}rd`;
    default:
      return `${number}th`;
  }
}

function formatElectionalHouseLabel(locale, houseNumber) {
  if (locale === 'fr') {
    return `le maître de la maison ${houseNumber}`;
  }

  if (locale === 'de') {
    return `der Herrscher des ${houseNumber}. Hauses`;
  }

  if (locale === 'es') {
    return `el regente de la casa ${houseNumber}`;
  }

  return `the ruler of the ${formatEnglishOrdinal(houseNumber)} house`;
}

function localizePlanetName(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    en: {
      sun: 'Sun',
      moon: 'Moon',
      mercury: 'Mercury',
      venus: 'Venus',
      mars: 'Mars',
      jupiter: 'Jupiter',
      saturn: 'Saturn',
      uranus: 'Uranus',
      neptune: 'Neptune',
      pluto: 'Pluto'
    },
    fr: {
      sun: 'le Soleil',
      moon: 'la Lune',
      mercury: 'Mercure',
      venus: 'Vénus',
      mars: 'Mars',
      jupiter: 'Jupiter',
      saturn: 'Saturne',
      uranus: 'Uranus',
      neptune: 'Neptune',
      pluto: 'Pluton'
    },
    de: {
      sun: 'die Sonne',
      moon: 'der Mond',
      mercury: 'Merkur',
      venus: 'Venus',
      mars: 'Mars',
      jupiter: 'Jupiter',
      saturn: 'Saturn',
      uranus: 'Uranus',
      neptune: 'Neptun',
      pluto: 'Pluto'
    },
    es: {
      sun: 'el Sol',
      moon: 'la Luna',
      mercury: 'Mercurio',
      venus: 'Venus',
      mars: 'Marte',
      jupiter: 'Júpiter',
      saturn: 'Saturno',
      uranus: 'Urano',
      neptune: 'Neptuno',
      pluto: 'Plutón'
    }
  };

  return localized[locale]?.[normalized] || null;
}

function localizeAngleName(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    ascendant: {
      en: 'Ascendant',
      fr: 'Ascendant',
      de: 'Aszendent',
      es: 'Ascendente'
    },
    midheaven: {
      en: 'Midheaven',
      fr: 'Milieu du Ciel',
      de: 'Medium Coeli',
      es: 'Medio Cielo'
    }
  };

  return localized[normalized]?.[locale] || localized[normalized]?.en || null;
}

function localizeSignName(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    aries: { en: 'Aries', fr: 'Bélier', de: 'Widder', es: 'Aries' },
    taurus: { en: 'Taurus', fr: 'Taureau', de: 'Stier', es: 'Tauro' },
    gemini: { en: 'Gemini', fr: 'Gémeaux', de: 'Zwillinge', es: 'Géminis' },
    cancer: { en: 'Cancer', fr: 'Cancer', de: 'Krebs', es: 'Cáncer' },
    leo: { en: 'Leo', fr: 'Lion', de: 'Löwe', es: 'Leo' },
    virgo: { en: 'Virgo', fr: 'Vierge', de: 'Jungfrau', es: 'Virgo' },
    libra: { en: 'Libra', fr: 'Balance', de: 'Waage', es: 'Libra' },
    scorpio: { en: 'Scorpio', fr: 'Scorpion', de: 'Skorpion', es: 'Escorpio' },
    sagittarius: { en: 'Sagittarius', fr: 'Sagittaire', de: 'Schütze', es: 'Sagitario' },
    capricorn: { en: 'Capricorn', fr: 'Capricorne', de: 'Steinbock', es: 'Capricornio' },
    aquarius: { en: 'Aquarius', fr: 'Verseau', de: 'Wassermann', es: 'Acuario' },
    pisces: { en: 'Pisces', fr: 'Poissons', de: 'Fische', es: 'Piscis' }
  };

  return localized[normalized]?.[locale] || localized[normalized]?.en || humanizeRawKey(value);
}

function localizeAstroPointName(locale, value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  return localizeAngleName(locale, normalized)
    || localizePlanetName(locale, normalized)
    || humanizeRawKey(normalized);
}

function localizeLongitudeText(locale, value) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  return text.replace(
    /\b(Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)\b/g,
    (match) => localizeSignName(locale, match) || match
  );
}

function localizeAspectName(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    conjunction: { en: 'conjunction', fr: 'conjonction', de: 'Konjunktion', es: 'conjunción' },
    opposition: { en: 'opposition', fr: 'opposition', de: 'Opposition', es: 'oposición' },
    trine: { en: 'trine', fr: 'trigone', de: 'Trigon', es: 'trígono' },
    square: { en: 'square', fr: 'carré', de: 'Quadrat', es: 'cuadratura' },
    sextile: { en: 'sextile', fr: 'sextile', de: 'Sextil', es: 'sextil' },
    quincunx: { en: 'quincunx', fr: 'quinconce', de: 'Quinkunx', es: 'quincuncio' },
    inconjunct: { en: 'inconjunct', fr: 'quinconce', de: 'Quinkunx', es: 'quincuncio' }
  };

  return localized[normalized]?.[locale] || localized[normalized]?.en || humanizeRawKey(value);
}

function formatLocalizedHouseToken(locale, value) {
  const number = formatScalarValue(value);
  if (!number) {
    return null;
  }

  return `${formatRawLabel(locale, { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' })} ${number}`;
}

function formatLocalizedDateValue(locale, value, options = {}) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) {
    return text;
  }

  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4];
  const minute = match[5];
  const monthNames = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
    de: ['Januar', 'Februar', 'Marz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  };
  const names = monthNames[locale] || monthNames.en;
  const monthLabel = names[month - 1] || String(month).padStart(2, '0');
  const localSuffix = options.localTime
    ? formatRawLabel(locale, { en: ' (local time)', fr: ' (heure locale)', de: ' (Ortszeit)', es: ' (hora local)' })
    : '';

  if (locale === 'fr') {
    const datePart = `${day} ${monthLabel} ${year}`;
    return hour && minute ? `${datePart} à ${hour}h${minute}${localSuffix}` : datePart;
  }

  if (locale === 'de') {
    const datePart = `${day}. ${monthLabel} ${year}`;
    return hour && minute ? `${datePart} um ${hour}:${minute} Uhr${localSuffix}` : datePart;
  }

  if (locale === 'es') {
    const datePart = `${day} de ${monthLabel} de ${year}`;
    return hour && minute ? `${datePart} a las ${hour}:${minute}${localSuffix}` : datePart;
  }

  const datePart = `${monthLabel} ${day}, ${year}`;
  return hour && minute ? `${datePart} at ${hour}:${minute}${localSuffix}` : datePart;
}

function formatLocalizedDateWindow(locale, startValue, endValue, options = {}) {
  const start = formatLocalizedDateValue(locale, startValue, options);
  const end = formatLocalizedDateValue(locale, endValue, options);

  if (start && end) {
    return `${start} → ${end}`;
  }

  return start || end || null;
}

function formatLocalizedPlanetPosition(locale, label, bodyData = {}) {
  if (!bodyData) {
    return null;
  }

  const renderedLabel = localizeAstroPointName(locale, label);
  const position = localizeLongitudeText(locale, bodyData.position_text)
    || [
      localizeSignName(locale, bodyData.sign_abbr || bodyData.sign || ''),
      formatScalarValue(bodyData.pos)
    ].filter(Boolean).join(' ');

  return [renderedLabel, position].filter(Boolean).join(' ');
}

function localizeRelocationFocus(locale, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const localized = {
    health: { en: 'Health', fr: 'Santé', de: 'Gesundheit', es: 'Salud' },
    love: { en: 'Love', fr: 'Amour', de: 'Liebe', es: 'Amor' },
    career: { en: 'Career', fr: 'Carrière', de: 'Beruf', es: 'Carrera' },
    money: { en: 'Money', fr: 'Argent', de: 'Geld', es: 'Dinero' },
    family: { en: 'Family', fr: 'Famille', de: 'Familie', es: 'Familia' },
    spirituality: { en: 'Spirituality', fr: 'Spiritualité', de: 'Spiritualität', es: 'Espiritualidad' },
    relocation: { en: 'Relocation', fr: 'Relocalisation', de: 'Relokation', es: 'Relocalización' }
  };

  return localized[normalized]?.[locale] || localized[normalized]?.en || humanizeRawKey(value);
}

function formatElectionalEventTimeLabel(locale, topResult = {}) {
  const rawLocal = formatScalarValue(topResult?.event_time_local);
  const rawUtc = formatScalarValue(topResult?.event_time_utc);
  const source = rawLocal || rawUtc;
  if (!source) {
    return '?';
  }

  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) {
    const fallback = formatRawDate(source);
    if (!fallback) {
      return '?';
    }
    if (rawLocal) {
      return locale === 'fr' ? `${fallback} (heure locale)` : `${fallback} (local time)`;
    }
    return fallback;
  }

  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4];
  const minute = match[5];
  const monthNames = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
    de: ['Januar', 'Februar', 'Marz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  };
  const names = monthNames[locale] || monthNames.en;
  const monthLabel = names[month - 1] || String(month).padStart(2, '0');

  if (locale === 'fr') {
    const datePart = `${day} ${monthLabel} ${year}`;
    return hour && minute
      ? `${datePart} à ${hour}h${minute}${rawLocal ? ' (heure locale)' : ' UTC'}`
      : datePart;
  }

  if (locale === 'de') {
    const datePart = `${day}. ${monthLabel} ${year}`;
    return hour && minute
      ? `${datePart} um ${hour}:${minute} Uhr${rawLocal ? ' (Ortszeit)' : ' UTC'}`
      : datePart;
  }

  if (locale === 'es') {
    const datePart = `${day} de ${monthLabel} de ${year}`;
    return hour && minute
      ? `${datePart} a las ${hour}:${minute}${rawLocal ? ' (hora local)' : ' UTC'}`
      : datePart;
  }

  const datePart = `${monthLabel} ${day}, ${year}`;
  return hour && minute
    ? `${datePart} at ${hour}:${minute}${rawLocal ? ' (local time)' : ' UTC'}`
    : datePart;
}

function localizeElectionalFactor(locale, value) {
  const rendered = formatScalarValue(value);
  if (!rendered) {
    return null;
  }

  const normalized = rendered.trim();
  const lower = normalized.toLowerCase();
  const supportiveHouseMatch = normalized.match(/^([A-Za-z]+)\s+in a\s+(.+?)\s+supportive house$/i);

  if (locale === 'fr') {
    if (supportiveHouseMatch) {
      const topic = supportiveHouseMatch[2].toLowerCase() === 'finance'
        ? 'aux finances'
        : `à ${supportiveHouseMatch[2].toLowerCase()}`;
      return `${localizePlanetName(locale, supportiveHouseMatch[1])} se trouve dans une maison favorable ${topic}`;
    }

    const planetDignifiedMatch = normalized.match(/^([A-Za-z]+)\s+dignified$/i);
    if (planetDignifiedMatch) {
      return `${localizePlanetName(locale, planetDignifiedMatch[1])} est en bonne dignité`;
    }

    const planetDebilitatedMatch = normalized.match(/^([A-Za-z]+)\s+debilitated$/i);
    if (planetDebilitatedMatch) {
      return `${localizePlanetName(locale, planetDebilitatedMatch[1])} est affaibli`;
    }

    const planetPressureMatch = normalized.match(/^([A-Za-z]+)\s+under hard malefic pressure$/i);
    if (planetPressureMatch) {
      return `${localizePlanetName(locale, planetPressureMatch[1])} subit une forte pression maléfique`;
    }

    const rulerDignifiedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+dignified$/i);
    if (rulerDignifiedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDignifiedMatch[1])} est en bonne dignité`;
    }

    const rulerDebilitatedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+debilitated$/i);
    if (rulerDebilitatedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDebilitatedMatch[1])} est affaibli`;
    }

    const rulerPressureMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+under hard malefic pressure$/i);
    if (rulerPressureMatch) {
      return `${formatElectionalHouseLabel(locale, rulerPressureMatch[1])} subit une forte pression maléfique`;
    }

    if (lower === 'moon void of course') {
      return 'la Lune est vide de course';
    }
  }

  if (locale === 'de') {
    if (supportiveHouseMatch) {
      const topic = supportiveHouseMatch[2].toLowerCase() === 'finance'
        ? 'für Finanzen'
        : `für ${supportiveHouseMatch[2].toLowerCase()}`;
      return `${localizePlanetName(locale, supportiveHouseMatch[1])} steht in einem Haus, das besonders günstig ${topic} ist`;
    }

    const planetDignifiedMatch = normalized.match(/^([A-Za-z]+)\s+dignified$/i);
    if (planetDignifiedMatch) {
      return `${localizePlanetName(locale, planetDignifiedMatch[1])} steht in guter Würde`;
    }

    const planetDebilitatedMatch = normalized.match(/^([A-Za-z]+)\s+debilitated$/i);
    if (planetDebilitatedMatch) {
      return `${localizePlanetName(locale, planetDebilitatedMatch[1])} ist geschwächt`;
    }

    const planetPressureMatch = normalized.match(/^([A-Za-z]+)\s+under hard malefic pressure$/i);
    if (planetPressureMatch) {
      return `${localizePlanetName(locale, planetPressureMatch[1])} steht unter starkem malefischem Druck`;
    }

    const rulerDignifiedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+dignified$/i);
    if (rulerDignifiedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDignifiedMatch[1])} steht in guter Würde`;
    }

    const rulerDebilitatedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+debilitated$/i);
    if (rulerDebilitatedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDebilitatedMatch[1])} ist geschwächt`;
    }

    const rulerPressureMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+under hard malefic pressure$/i);
    if (rulerPressureMatch) {
      return `${formatElectionalHouseLabel(locale, rulerPressureMatch[1])} steht unter starkem malefischem Druck`;
    }

    if (lower === 'moon void of course') {
      return 'der Mond ist ohne Kurs';
    }
  }

  if (locale === 'es') {
    if (supportiveHouseMatch) {
      const topic = supportiveHouseMatch[2].toLowerCase() === 'finance'
        ? 'las finanzas'
        : supportiveHouseMatch[2].toLowerCase();
      return `${localizePlanetName(locale, supportiveHouseMatch[1])} está en una casa favorable para ${topic}`;
    }

    const planetDignifiedMatch = normalized.match(/^([A-Za-z]+)\s+dignified$/i);
    if (planetDignifiedMatch) {
      return `${localizePlanetName(locale, planetDignifiedMatch[1])} está bien dignificado`;
    }

    const planetDebilitatedMatch = normalized.match(/^([A-Za-z]+)\s+debilitated$/i);
    if (planetDebilitatedMatch) {
      return `${localizePlanetName(locale, planetDebilitatedMatch[1])} está debilitado`;
    }

    const planetPressureMatch = normalized.match(/^([A-Za-z]+)\s+under hard malefic pressure$/i);
    if (planetPressureMatch) {
      return `${localizePlanetName(locale, planetPressureMatch[1])} está bajo fuerte presión maléfica`;
    }

    const rulerDignifiedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+dignified$/i);
    if (rulerDignifiedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDignifiedMatch[1])} está bien dignificado`;
    }

    const rulerDebilitatedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+debilitated$/i);
    if (rulerDebilitatedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDebilitatedMatch[1])} está debilitado`;
    }

    const rulerPressureMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+under hard malefic pressure$/i);
    if (rulerPressureMatch) {
      return `${formatElectionalHouseLabel(locale, rulerPressureMatch[1])} está bajo fuerte presión maléfica`;
    }

    if (lower === 'moon void of course') {
      return 'la Luna está fuera de curso';
    }
  }

  if (locale === 'en') {
    if (supportiveHouseMatch) {
      const topic = supportiveHouseMatch[2].toLowerCase() === 'finance'
        ? 'finance'
        : supportiveHouseMatch[2].toLowerCase();
      return `${localizePlanetName(locale, supportiveHouseMatch[1])} is in a house that supports ${topic}`;
    }

    const planetDignifiedMatch = normalized.match(/^([A-Za-z]+)\s+dignified$/i);
    if (planetDignifiedMatch) {
      return `${localizePlanetName(locale, planetDignifiedMatch[1])} is dignified`;
    }

    const planetDebilitatedMatch = normalized.match(/^([A-Za-z]+)\s+debilitated$/i);
    if (planetDebilitatedMatch) {
      return `${localizePlanetName(locale, planetDebilitatedMatch[1])} is debilitated`;
    }

    const planetPressureMatch = normalized.match(/^([A-Za-z]+)\s+under hard malefic pressure$/i);
    if (planetPressureMatch) {
      return `${localizePlanetName(locale, planetPressureMatch[1])} is under strong malefic pressure`;
    }

    const rulerDignifiedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+dignified$/i);
    if (rulerDignifiedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDignifiedMatch[1])} is dignified`;
    }

    const rulerDebilitatedMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+debilitated$/i);
    if (rulerDebilitatedMatch) {
      return `${formatElectionalHouseLabel(locale, rulerDebilitatedMatch[1])} is debilitated`;
    }

    const rulerPressureMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?\s+ruler\s+under hard malefic pressure$/i);
    if (rulerPressureMatch) {
      return `${formatElectionalHouseLabel(locale, rulerPressureMatch[1])} is under strong malefic pressure`;
    }

    if (lower === 'moon void of course') {
      return 'the Moon is void of course';
    }
  }

  return humanizeRawKey(normalized);
}

function formatElectionalFactorTitles(locale, factors = [], limit = 3) {
  return asArray(factors)
    .slice(0, limit)
    .map((item) => localizeElectionalFactor(locale, item?.title || item?.detail || item?.code))
    .filter(Boolean);
}

function buildElectionalResultExplanationResponse(locale, cachedElectionalResult) {
  const topResult = cachedElectionalResult?.topResult || {};
  const support = formatElectionalFactorTitles(locale, topResult?.supporting_factors, 4);
  const caution = formatElectionalFactorTitles(locale, topResult?.caution_factors, 3);
  const dateLabel = formatElectionalEventTimeLabel(locale, topResult);
  const quality = localizeElectionalQuality(locale, topResult?.quality_band || topResult?.status || '');
  const verdict = localizeElectionalVerdict(locale, topResult?.strict_traditional_verdict || '');
  const bestInWindow = topResult?.best_available_in_window === true;

  if (locale === 'fr') {
    const lines = [
      `Le créneau retenu est le ${dateLabel}.`,
      `Il ressort surtout parce que ${support.length > 0 ? joinLocalizedList(locale, support) : 'plusieurs facteurs de soutien se combinent dans la fenêtre analysée'}.`
    ];

    if (quality || verdict || bestInWindow) {
      const meta = [
        quality ? `la qualité globale est ${quality}` : null,
        verdict ? `le verdict traditionnel reste ${verdict}` : null,
        bestInWindow ? 'c’est le meilleur créneau trouvé dans cette fenêtre' : null
      ].filter(Boolean);
      if (meta.length > 0) {
        lines.push(`En synthèse, ${joinLocalizedList(locale, meta)}.`);
      }
    }

    if (caution.length > 0) {
      lines.push(`Les points de vigilance sont les suivants : ${joinLocalizedList(locale, caution)}.`);
    }

    return normalizeAssistantText(lines.join('\n\n'));
  }

  if (locale === 'de') {
    const lines = [
      `Das ausgewählte Zeitfenster ist ${dateLabel}.`,
      `Ausschlaggebend sind vor allem folgende Faktoren: ${support.length > 0 ? joinLocalizedList(locale, support) : 'mehrere unterstützende Faktoren im geprüften Zeitraum'}.`
    ];

    if (quality || verdict || bestInWindow) {
      const meta = [
        quality ? `die Gesamtqualität ist ${quality}` : null,
        verdict ? `das traditionelle Urteil bleibt ${verdict}` : null,
        bestInWindow ? 'es ist das beste gefundene Zeitfenster in diesem Bereich' : null
      ].filter(Boolean);
      if (meta.length > 0) {
        lines.push(`Zusammengefasst gilt: ${joinLocalizedList(locale, meta)}.`);
      }
    }

    if (caution.length > 0) {
      lines.push(`Die wichtigsten Vorsichtspunkte sind: ${joinLocalizedList(locale, caution)}.`);
    }

    return normalizeAssistantText(lines.join('\n\n'));
  }

  if (locale === 'es') {
    const lines = [
      `La franja seleccionada es ${dateLabel}.`,
      `Destaca sobre todo porque ${support.length > 0 ? joinLocalizedList(locale, support) : 'varios factores de apoyo coinciden dentro de la ventana analizada'}.`
    ];

    if (quality || verdict || bestInWindow) {
      const meta = [
        quality ? `la calidad general es ${quality}` : null,
        verdict ? `el veredicto tradicional sigue siendo ${verdict}` : null,
        bestInWindow ? 'es la mejor franja encontrada dentro de esta ventana' : null
      ].filter(Boolean);
      if (meta.length > 0) {
        lines.push(`En resumen, ${joinLocalizedList(locale, meta)}.`);
      }
    }

    if (caution.length > 0) {
      lines.push(`Los principales puntos de cautela son: ${joinLocalizedList(locale, caution)}.`);
    }

    return normalizeAssistantText(lines.join('\n\n'));
  }

  const lines = [
    `The selected window is ${dateLabel}.`,
    `It stands out mainly because ${support.length > 0 ? joinLocalizedList(locale, support) : 'several supportive factors line up in the scanned window'}.`
  ];

  if (quality || verdict || bestInWindow) {
    const meta = [
      quality ? `the overall quality is ${quality}` : null,
      verdict ? `the traditional verdict stays ${verdict}` : null,
      bestInWindow ? 'it is the best window found in that search range' : null
    ].filter(Boolean);
    if (meta.length > 0) {
      lines.push(`In summary, ${joinLocalizedList(locale, meta)}.`);
    }
  }

  if (caution.length > 0) {
    lines.push(`Main caution factors remain ${joinLocalizedList(locale, caution)}.`);
  }

  return normalizeAssistantText(lines.join('\n\n'));
}

function formatAstroLineLabel(locale, body, angle) {
  const angleMap = {
    asc: 'ASC',
    dsc: 'DSC',
    mc: 'MC',
    ic: 'IC'
  };
  return [localizeAstroPointName(locale, body), angleMap[String(angle || '').toLowerCase()] || humanizeRawKey(angle)].filter(Boolean).join(' ');
}

function buildRelocationRawResponse(locale, payload, subjectProfile, userText) {
  const meta = payload?.meta || {};
  const focus = localizeRelocationFocus(locale, meta.focus || parseFocusFromQuestion(userText) || 'relocation');
  const results = asArray(payload?.results);
  const cityEntry = results[0] || payload?.result || payload;
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const title = formatRawLabel(locale, {
    en: `Relocation results for ${subject} — ${focus}`,
    fr: `Résultats de relocalisation pour ${subject} — ${focus}`,
    de: `Relokations-Ergebnisse für ${subject} — ${focus}`,
    es: `Resultados de relocalización para ${subject} — ${focus}`
  });
  const lines = [title];
  const metaParts = [
    meta.signal_strength ? `${formatRawLabel(locale, { en: 'Signal', fr: 'Signal', de: 'Signal', es: 'Señal' })}: ${humanizeRawKey(meta.signal_strength)}` : null,
    meta.confidence ? `${formatRawLabel(locale, { en: 'Confidence', fr: 'Confiance', de: 'Konfidenz', es: 'Confianza' })}: ${humanizeRawKey(meta.confidence)}` : null,
    meta.match_tier ? `${formatRawLabel(locale, { en: 'Tier', fr: 'Niveau', de: 'Stufe', es: 'Nivel' })}: ${humanizeRawKey(meta.match_tier)}` : null
  ].filter(Boolean);
  if (metaParts.length > 0) {
    lines.push(metaParts.join(' • '));
  }

  const renderedResults = (results.length > 0 ? results.slice(0, 5) : [cityEntry]).filter(Boolean).map((entry, index) => {
    const city = entry.city || entry.location || {};
    const heading = [
      `${index + 1}.`,
      [city.name || entry.name || 'Location', city.country].filter(Boolean).join(', '),
      entry.score !== undefined ? `• ${formatRawLabel(locale, { en: 'Score', fr: 'Score', de: 'Score', es: 'Puntuación' })}: ${formatScalarValue(entry.score)}` : null
    ].filter(Boolean).join(' ');
    const block = [heading];
    if (entry.summary) {
      block.push(`${formatRawLabel(locale, { en: 'Summary', fr: 'Résumé', de: 'Zusammenfassung', es: 'Resumen' })}: ${formatScalarValue(entry.summary)}`);
    }
    if (entry.distance_from_natal_km !== undefined) {
      block.push(`${formatRawLabel(locale, { en: 'Distance from natal', fr: 'Distance au natal', de: 'Entfernung zum Radix', es: 'Distancia al natal' })}: ${formatScalarValue(entry.distance_from_natal_km)} km`);
    }
    const favorable = entry.nearest_favorable_line;
    if (favorable?.body || favorable?.angle) {
      block.push(`${formatRawLabel(locale, { en: 'Best line', fr: 'Meilleure ligne', de: 'Beste Linie', es: 'Mejor línea' })}: ${formatAstroLineLabel(locale, favorable.body, favorable.angle)}${favorable.distance_km !== undefined ? ` • ${formatScalarValue(favorable.distance_km)} km` : ''}`);
    }
    const challenging = entry.nearest_challenging_line;
    if (challenging?.body || challenging?.angle) {
      block.push(`${formatRawLabel(locale, { en: 'Challenge', fr: 'Défi', de: 'Herausforderung', es: 'Desafío' })}: ${formatAstroLineLabel(locale, challenging.body, challenging.angle)}${challenging.distance_km !== undefined ? ` • ${formatScalarValue(challenging.distance_km)} km` : ''}`);
    }
    const themes = normalizeRawList(entry?.relocation_summary?.dominant_themes, humanizeRawKey);
    if (themes.length > 0) {
      block.push(`${formatRawLabel(locale, { en: 'Themes', fr: 'Thèmes', de: 'Themen', es: 'Temas' })}: ${themes.join(', ')}`);
    }
    if (entry?.relocation_summary?.summary_caution) {
      block.push(`${formatRawLabel(locale, { en: 'Caution', fr: 'Prudence', de: 'Hinweis', es: 'Precaución' })}: ${formatScalarValue(entry.relocation_summary.summary_caution)}`);
    }
    return block.join('\n');
  });

  if (renderedResults.length > 0) {
    lines.push(...renderedResults);
  }

  const warnings = normalizeRawList(payload?.warnings);
  if (warnings.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Warnings', fr: 'Avertissements', de: 'Hinweise', es: 'Advertencias' })}: ${warnings.slice(0, 2).join(' • ')}`);
  }

  return normalizeRawPresentationText(lines.join('\n\n'));
}

function buildRelocationCityCheckRawResponse(locale, payload, subjectProfile, userText) {
  const detail = payload?.detail || {};
  if (detail?.error) {
    return normalizeRawPresentationText([
      formatRawLabel(locale, {
        en: `City check for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
        fr: `Vérification de ville pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
        de: `Stadtprüfung für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
        es: `Verificación de ciudad para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`
      }),
      `${humanizeRawKey(detail.error)}: ${formatScalarValue(detail.message) || formatRawLabel(locale, {
        en: 'The requested city could not be resolved.',
        fr: 'La ville demandée n’a pas pu être résolue.',
        de: 'Die angefragte Stadt konnte nicht aufgelöst werden.',
        es: 'No se pudo resolver la ciudad solicitada.'
      })}`
    ].join('\n\n'));
  }

  const city = payload?.city || {};
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const title = formatRawLabel(locale, {
    en: `City check for ${subject} — ${[city.name, city.country].filter(Boolean).join(', ') || 'Requested city'}`,
    fr: `Vérification de ville pour ${subject} — ${[city.name, city.country].filter(Boolean).join(', ') || 'Ville demandée'}`,
    de: `Stadtprüfung für ${subject} — ${[city.name, city.country].filter(Boolean).join(', ') || 'Angefragte Stadt'}`,
    es: `Verificación de ciudad para ${subject} — ${[city.name, city.country].filter(Boolean).join(', ') || 'Ciudad solicitada'}`
  });
  const lines = [title];
  if (payload.overall_score !== undefined) {
    lines.push(`${formatRawLabel(locale, { en: 'Overall score', fr: 'Score global', de: 'Gesamtwertung', es: 'Puntuación general' })}: ${formatScalarValue(payload.overall_score)}`);
  }

  const focusScores = Object.entries(payload?.focus_scores || {})
    .map(([focusKey, value]) => ({ focusKey, ...(value || {}) }))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  if (focusScores.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Focus scores', fr: 'Scores par focus', de: 'Fokuswerte', es: 'Puntuaciones por foco' }),
      ...focusScores.slice(0, 5).map((entry, index) => {
        const favorable = entry.nearest_favorable_line;
        const challenge = entry.nearest_challenging_line;
        const base = [`${index + 1}. ${humanizeRawKey(entry.focusKey)} • ${formatScalarValue(entry.score)}`];
        if (entry.summary) {
          base.push(`   ${formatScalarValue(entry.summary)}`);
        }
        if (favorable?.body || favorable?.angle) {
          base.push(`   ${formatRawLabel(locale, { en: 'Best line', fr: 'Meilleure ligne', de: 'Beste Linie', es: 'Mejor línea' })}: ${formatAstroLineLabel(locale, favorable.body, favorable.angle)}${favorable.distance_km !== undefined ? ` • ${formatScalarValue(favorable.distance_km)} km` : ''}`);
        }
        if (challenge?.body || challenge?.angle) {
          base.push(`   ${formatRawLabel(locale, { en: 'Challenge', fr: 'Défi', de: 'Herausforderung', es: 'Desafío' })}: ${formatAstroLineLabel(locale, challenge.body, challenge.angle)}${challenge.distance_km !== undefined ? ` • ${formatScalarValue(challenge.distance_km)} km` : ''}`);
        }
        return base.join('\n');
      })
    ].join('\n\n'));
  }

  const relocationSummary = payload?.relocation_summary || {};
  const themes = normalizeRawList(relocationSummary.dominant_themes, humanizeRawKey);
  if (themes.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Dominant themes', fr: 'Thèmes dominants', de: 'Dominante Themen', es: 'Temas dominantes' })}: ${themes.join(', ')}`);
  }
  if (relocationSummary.summary_short) {
    lines.push(`${formatRawLabel(locale, { en: 'Chart emphasis', fr: 'Accent du thème', de: 'Chart-Fokus', es: 'Énfasis de la carta' })}: ${formatScalarValue(relocationSummary.summary_short)}`);
  }
  if (relocationSummary.summary_caution) {
    lines.push(`${formatRawLabel(locale, { en: 'Caution', fr: 'Prudence', de: 'Hinweis', es: 'Precaución' })}: ${formatScalarValue(relocationSummary.summary_caution)}`);
  }

  return normalizeRawPresentationText(lines.join('\n\n'));
}

function summarizeProgressionPoint(locale, point) {
  if (!point || typeof point !== 'object') {
    return null;
  }
  const name = localizeAstroPointName(locale, point.name || point.id || '');
  const sign = localizeSignName(locale, point.sign?.name || point.sign_id || point.sign || null);
  const longitude = localizeLongitudeText(locale, point.longitude_text);
  const house = formatLocalizedHouseToken(locale, point.house);
  return [name, longitude || sign, house].filter(Boolean).join(' • ');
}

function formatProgressionAspectLine(locale, aspect, index) {
  const left = localizeAstroPointName(locale, aspect.progressed_point || aspect.point_1 || aspect.p1_id || aspect.p1_name || '');
  const right = localizeAstroPointName(locale, aspect.natal_point || aspect.point_2 || aspect.p2_id || aspect.p2_name || '');
  const type = localizeAspectName(locale, aspect.aspect?.name || aspect.type || '');
  const parts = [`${index + 1}. ${[left, type, right].filter(Boolean).join(' ')}`];
  const detail = [
    aspect.orb_deg !== undefined || aspect.orb !== undefined
      ? `${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${formatScalarValue(aspect.orb_deg ?? aspect.orb)}`
      : null,
    aspect.applying !== undefined
      ? humanizeRawKey(aspect.applying ? 'applying' : 'separating')
      : (aspect.is_applying !== undefined ? humanizeRawKey(aspect.is_applying ? 'applying' : 'separating') : null),
    aspect.exact_date ? `${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${formatRawDate(aspect.exact_date)}` : null,
    aspect.strength !== undefined ? `${formatRawLabel(locale, { en: 'Strength', fr: 'Force', de: 'Stärke', es: 'Fuerza' })}: ${formatScalarValue(aspect.strength)}` : null
  ].filter(Boolean);
  if (detail.length > 0) {
    parts.push(detail.join(' • '));
  }
  return parts.join('\n');
}

function buildSecondaryProgressionsRawResponse(locale, payload, subjectProfile) {
  const meta = payload?.meta || {};
  const chart = payload?.progressed_chart || {};
  const aspects = payload?.aspects || {};
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const lines = [formatRawLabel(locale, {
    en: `Secondary progressions for ${subject} — ${formatLocalizedDateValue(locale, meta.target_date || meta.target_datetime) || '?'}`,
    fr: `Progressions secondaires pour ${subject} — ${formatLocalizedDateValue(locale, meta.target_date || meta.target_datetime) || '?'}`,
    de: `Sekundärprogressionen für ${subject} — ${formatLocalizedDateValue(locale, meta.target_date || meta.target_datetime) || '?'}`,
    es: `Progresiones secundarias para ${subject} — ${formatLocalizedDateValue(locale, meta.target_date || meta.target_datetime) || '?'}`
  })];

  const keyPoints = [
    chart?.points?.sun,
    chart?.points?.moon,
    chart?.points?.mercury,
    chart?.points?.venus,
    chart?.points?.mars,
    chart?.angles?.ascendant ? { name: 'Ascendant', ...chart.angles.ascendant } : null,
    chart?.angles?.midheaven ? { name: 'Midheaven', ...chart.angles.midheaven } : null
  ].map((point) => summarizeProgressionPoint(locale, point)).filter(Boolean);
  if (keyPoints.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Key placements', fr: 'Positions clés', de: 'Wichtige Stellungen', es: 'Posiciones clave' }),
      ...keyPoints.slice(0, 7).map((item) => `- ${item}`)
    ].join('\n'));
  }

  const progressedToNatal = asArray(aspects.progressed_to_natal)
    .slice()
    .sort((left, right) => Number(left?.orb_deg ?? 999) - Number(right?.orb_deg ?? 999));
  if (progressedToNatal.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Progressed to natal', fr: 'Progressé vers natal', de: 'Progression zu Radix', es: 'Progresado a natal' }),
      ...progressedToNatal.slice(0, 6).map((aspect, index) => formatProgressionAspectLine(locale, aspect, index))
    ].join('\n\n'));
  }

  const progressedToProgressed = asArray(aspects.progressed_to_progressed)
    .slice()
    .sort((left, right) => Number(left?.orb_deg ?? 999) - Number(right?.orb_deg ?? 999));
  if (progressedToProgressed.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Progressed to progressed', fr: 'Progressé vers progressé', de: 'Progression zu Progression', es: 'Progresado a progresado' }),
      ...progressedToProgressed.slice(0, 4).map((aspect, index) => formatProgressionAspectLine(locale, aspect, index))
    ].join('\n\n'));
  }

  return normalizeRawPresentationText(lines.join('\n\n'));
}

function buildAnnualProfectionsRawResponse(locale, payload, subjectProfile) {
  const annual = payload?.profection?.annual || payload?.structuredContent?.profection?.annual || {};
  const metaAnnual = payload?.meta?.annual_profection || {};
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const lines = [formatRawLabel(locale, {
    en: `Annual profection for ${subject} — ${formatScalarValue(metaAnnual.target_year) || '?'}`,
    fr: `Profection annuelle pour ${subject} — ${formatScalarValue(metaAnnual.target_year) || '?'}`,
    de: `Jahresprofection für ${subject} — ${formatScalarValue(metaAnnual.target_year) || '?'}`,
    es: `Profección anual para ${subject} — ${formatScalarValue(metaAnnual.target_year) || '?'}`
  })];
  lines.push(`${formatRawLabel(locale, { en: 'Activated house', fr: 'Maison activée', de: 'Aktiviertes Haus', es: 'Casa activada' })}: ${formatScalarValue(annual.activated_house)} • ${localizeSignName(locale, annual.activated_sign_name || annual.activated_sign_id) || humanizeRawKey(annual.activated_sign_name || annual.activated_sign_id)}`);
  lines.push(`${formatRawLabel(locale, { en: 'Time lord', fr: 'Maître du temps', de: 'Zeitlord', es: 'Señor del tiempo' })}: ${localizeAstroPointName(locale, annual.time_lord_name || annual.time_lord_id)}`);
  const window = formatLocalizedDateWindow(locale, annual?.period?.start || metaAnnual?.period?.start, annual?.period?.end || metaAnnual?.period?.end);
  if (window) {
    lines.push(`${formatRawLabel(locale, { en: 'Period', fr: 'Période', de: 'Zeitraum', es: 'Periodo' })}: ${window}`);
  }
  return normalizeRawPresentationText(lines.join('\n\n'));
}

function buildSolarReturnRawResponse(locale, payload, subjectProfile) {
  const meta = payload?.meta || {};
  const planets = asArray(payload?.planets);
  const aspects = asArray(payload?.aspects).filter((item) => item?.is_major !== false);
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const lines = [formatRawLabel(locale, {
    en: `Solar return for ${subject} — ${formatScalarValue(meta?.solar_return?.target_year) || '?'}`,
    fr: `Retour solaire pour ${subject} — ${formatScalarValue(meta?.solar_return?.target_year) || '?'}`,
    de: `Solar Return für ${subject} — ${formatScalarValue(meta?.solar_return?.target_year) || '?'}`,
    es: `Retorno solar para ${subject} — ${formatScalarValue(meta?.solar_return?.target_year) || '?'}`
  })];
  const exactMoment = formatLocalizedDateValue(
    locale,
    meta?.solar_return?.exact_moment_local || meta?.solar_return?.exact_moment_utc,
    { localTime: Boolean(meta?.solar_return?.exact_moment_local) }
  );
  if (exactMoment) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact moment', fr: 'Moment exact', de: 'Exakter Moment', es: 'Momento exacto' })}: ${exactMoment}`);
  }
  const keyPlanets = planets
    .filter((planet) => ['sun', 'moon', 'mercury', 'venus', 'mars'].includes(String(planet?.id || '').toLowerCase()))
    .map((planet) => [
      `${localizeAstroPointName(locale, planet.name || planet.id || '')}: ${localizeSignName(locale, planet.sign || planet.sign_id || '')} ${formatScalarValue(planet.pos)}`.trim(),
      planet.house ? formatLocalizedHouseToken(locale, planet.house) : null
    ].filter(Boolean).join(' • '));
  if (keyPlanets.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Key placements', fr: 'Positions clés', de: 'Wichtige Stellungen', es: 'Posiciones clave' }),
      ...keyPlanets.slice(0, 5).map((item) => `- ${item}`)
    ].join('\n'));
  }
  const angles = payload?.angles_details || {};
  const asc = angles.asc;
  const mc = angles.mc;
  if (asc || mc) {
    lines.push([
      formatRawLabel(locale, { en: 'Angles', fr: 'Angles', de: 'Winkel', es: 'Ángulos' }),
      asc ? `- ASC: ${localizeSignName(locale, asc.sign || asc.sign_id || '')} ${formatScalarValue(asc.pos)}` : null,
      mc ? `- MC: ${localizeSignName(locale, mc.sign || mc.sign_id || '')} ${formatScalarValue(mc.pos)}` : null
    ].filter(Boolean).join('\n'));
  }
  if (aspects.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Major aspects', fr: 'Aspects majeurs', de: 'Wichtige Aspekte', es: 'Aspectos mayores' }),
      ...aspects.slice(0, 6).map((aspect, index) => `${index + 1}. ${localizeAstroPointName(locale, aspect.p1_name || aspect.p1_id)} ${localizeAspectName(locale, aspect.type)} ${localizeAstroPointName(locale, aspect.p2_name || aspect.p2_id)} • ${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${formatScalarValue(aspect.orb)}`)
    ].join('\n'))
  }
  return normalizeRawPresentationText(lines.join('\n\n'));
}

function buildEphemerisRawResponse(locale, payload, subjectProfile) {
  const meta = payload?.meta || {};
  const rows = asArray(payload?.data);
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const title = formatRawLabel(locale, {
    en: `Ephemeris for ${subject} — ${formatScalarValue(meta.start) || '?'} → ${formatScalarValue(meta.end) || '?'}`,
    fr: `Éphémérides pour ${subject} — ${formatScalarValue(meta.start) || '?'} → ${formatScalarValue(meta.end) || '?'}`,
    de: `Ephemeride für ${subject} — ${formatScalarValue(meta.start) || '?'} → ${formatScalarValue(meta.end) || '?'}`,
    es: `Efemérides para ${subject} — ${formatScalarValue(meta.start) || '?'} → ${formatScalarValue(meta.end) || '?'}`
  });
  const header = `${title}\n\n${formatRawLabel(locale, { en: 'Step', fr: 'Pas', de: 'Schritt', es: 'Paso' })}: ${formatScalarValue(meta.step)} • ${formatRawLabel(locale, { en: 'Rows', fr: 'Lignes', de: 'Zeilen', es: 'Filas' })}: ${formatScalarValue(meta.rows)}`;
  const chunked = chunkRawItems(rows, 10);
  const textParts = chunked.map((chunk, chunkIndex) => {
    const lines = [chunkIndex === 0 ? header : `${title} (${chunkIndex + 1}/${chunked.length})`];
    lines.push(...chunk.map((row, index) => {
      const bodies = row?.bodies || {};
      const sun = bodies.Sun || bodies.sun;
      const moon = bodies.Moon || bodies.moon;
      const mercury = bodies.Mercury || bodies.mercury;
      const venus = bodies.Venus || bodies.venus;
      const mars = bodies.Mars || bodies.mars;
      const jupiter = bodies.Jupiter || bodies.jupiter;
      const saturn = bodies.Saturn || bodies.saturn;
      const date = formatLocalizedDateValue(locale, row.local_timestamp || row.timestamp) || `${formatRawLabel(locale, { en: 'Row', fr: 'Ligne', de: 'Zeile', es: 'Fila' })} ${index + 1}`;
      const bodyLine = [
        sun ? formatLocalizedPlanetPosition(locale, 'sun', sun) : null,
        moon ? formatLocalizedPlanetPosition(locale, 'moon', moon) : null,
        mercury ? formatLocalizedPlanetPosition(locale, 'mercury', mercury) : null,
        venus ? formatLocalizedPlanetPosition(locale, 'venus', venus) : null,
        mars ? formatLocalizedPlanetPosition(locale, 'mars', mars) : null,
        jupiter ? formatLocalizedPlanetPosition(locale, 'jupiter', jupiter) : null,
        saturn ? formatLocalizedPlanetPosition(locale, 'saturn', saturn) : null
      ].filter(Boolean).join(' • ');
      const notable = [];
      const retrogradeBodies = normalizeRawList(row?.astrology?.retrograde_bodies, (value) => localizeAstroPointName(locale, value));
      if (retrogradeBodies.length > 0) {
        notable.push(`${formatRawLabel(locale, { en: 'Retrograde', fr: 'Rétrograde', de: 'Rückläufig', es: 'Retrógrado' })}: ${retrogradeBodies.join(', ')}`);
      }
      const moonPhase = row?.astrology?.moon_phase?.label;
      if (moonPhase) {
        notable.push(`${formatRawLabel(locale, { en: 'Moon phase', fr: 'Phase lunaire', de: 'Mondphase', es: 'Fase lunar' })}: ${moonPhase}`);
      }
      return [
        `${date}`,
        bodyLine,
        notable.length > 0 ? `   ${notable.join(' • ')}` : null
      ].filter(Boolean).join('\n');
    }));
    return normalizeRawPresentationText(lines.join('\n\n'));
  });

  return {
    text: textParts[0] || header,
    textParts,
    renderMode: 'plain'
  };
}

function buildHoroscopeRawResponse(locale, payload, subjectProfile) {
  const data = payload?.data || {};
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const lines = [formatRawLabel(locale, {
    en: `Daily horoscope for ${subject} — ${formatScalarValue(data.date) || '?'}`,
    fr: `Horoscope du jour pour ${subject} — ${formatScalarValue(data.date) || '?'}`,
    de: `Tageshoroskop für ${subject} — ${formatScalarValue(data.date) || '?'}`,
    es: `Horóscopo diario para ${subject} — ${formatScalarValue(data.date) || '?'}`
  })];
  if (data?.content?.theme) {
    lines.push(`${formatRawLabel(locale, { en: 'Theme', fr: 'Thème', de: 'Thema', es: 'Tema' })}: ${formatScalarValue(data.content.theme)}`);
  }
  const scores = data.scores || {};
  const scoreLine = [
    scores.overall !== undefined ? `${formatRawLabel(locale, { en: 'Overall', fr: 'Global', de: 'Gesamt', es: 'General' })} ${formatScalarValue(scores.overall)}` : null,
    scores.love !== undefined ? `${formatRawLabel(locale, { en: 'Love', fr: 'Amour', de: 'Liebe', es: 'Amor' })} ${formatScalarValue(scores.love)}` : null,
    scores.career !== undefined ? `${formatRawLabel(locale, { en: 'Career', fr: 'Carrière', de: 'Beruf', es: 'Carrera' })} ${formatScalarValue(scores.career)}` : null,
    scores.money !== undefined ? `${formatRawLabel(locale, { en: 'Money', fr: 'Argent', de: 'Geld', es: 'Dinero' })} ${formatScalarValue(scores.money)}` : null,
    scores.health !== undefined ? `${formatRawLabel(locale, { en: 'Health', fr: 'Santé', de: 'Gesundheit', es: 'Salud' })} ${formatScalarValue(scores.health)}` : null
  ].filter(Boolean);
  if (scoreLine.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Scores', fr: 'Scores', de: 'Werte', es: 'Puntuaciones' })}: ${scoreLine.join(' • ')}`);
  }
  const astroHighlights = normalizeRawList(asArray(data?.astro?.highlights).map((item) => item?.label || item?.key));
  if (astroHighlights.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Sky highlights', fr: 'Temps forts du ciel', de: 'Himmelshighlights', es: 'Aspectos del cielo' })}: ${astroHighlights.join(' • ')}`);
  }
  if (data?.content?.text) {
    lines.push(formatScalarValue(data.content.text));
  }
  const lucky = data.lucky || {};
  const luckyParts = [
    lucky?.color?.label ? `${formatRawLabel(locale, { en: 'Color', fr: 'Couleur', de: 'Farbe', es: 'Color' })}: ${lucky.color.label}` : null,
    lucky.number !== undefined ? `${formatRawLabel(locale, { en: 'Number', fr: 'Nombre', de: 'Zahl', es: 'Número' })}: ${formatScalarValue(lucky.number)}` : null,
    lucky?.time_window?.display ? `${formatRawLabel(locale, { en: 'Time', fr: 'Moment', de: 'Zeit', es: 'Hora' })}: ${lucky.time_window.display}` : null
  ].filter(Boolean);
  if (luckyParts.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Lucky', fr: 'Chance', de: 'Glück', es: 'Suerte' })}: ${luckyParts.join(' • ')}`);
  }
  const topTransits = asArray(data?.personal?.transits_top);
  if (topTransits.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Top personal transits', fr: 'Top transits personnels', de: 'Top-Personaltransite', es: 'Tránsitos personales principales' }),
      ...topTransits.slice(0, 5).map((entry, index) => {
        const line = `${index + 1}. ${entry?.transit_planet?.label || humanizeRawKey(entry?.transit_planet?.key)} ${entry?.aspect?.label || humanizeRawKey(entry?.aspect?.key)} ${entry?.natal_planet?.label || humanizeRawKey(entry?.natal_planet?.key)} • ${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${formatScalarValue(entry.orb_deg)} • ${formatRawLabel(locale, { en: 'Score', fr: 'Score', de: 'Wert', es: 'Puntuación' })}: ${formatScalarValue(entry.score)}`;
        return entry?.explanation ? `${line}\n   ${formatScalarValue(entry.explanation)}` : line;
      })
    ].join('\n\n'));
  }
  return normalizeRawPresentationText(lines.join('\n\n'));
}

function extractSynastryPayload(result) {
  const payload = extractStructuredToolPayload(result);
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.summary || payload.synastry || payload.natal) {
    return {
      ...payload,
      __personAName: result?.args?.person_a?.name || payload?.natal?.person_a?.subject?.name || null,
      __personBName: result?.args?.person_b?.name || payload?.natal?.person_b?.subject?.name || null,
      __userText: result?.userText || null
    };
  }
  return null;
}

function extractPartnerNameFromQuestion(userText) {
  const value = String(userText || '').trim();
  if (!value) {
    return null;
  }
  const match = value.match(/\b(?:with|avec|mit|con)\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,40})$/i);
  return match ? match[1].trim() : null;
}

function buildSynastryRawResponse(locale, payload, subjectProfile) {
  const summary = payload?.summary || payload?.synastry || {};
  const synastry = payload?.synastry || {};
  const scores = summary?.scores || synastry?.scores || {};
  const archetype = summary?.archetype || synastry?.archetype || {};
  const strengths = asArray(summary?.strengths);
  const challenges = asArray(summary?.challenges);
  const aspects = asArray(synastry?.aspects);
  const personA = payload?.__personAName || payload?.natal?.person_a?.subject?.name || subjectProfile?.profileName || 'Person A';
  const personB = payload?.__personBName || payload?.natal?.person_b?.subject?.name || extractPartnerNameFromQuestion(payload?.__userText) || 'Person B';
  const lines = [formatRawLabel(locale, {
    en: `Synastry for ${personA} and ${personB}`,
    fr: `Synastrie pour ${personA} et ${personB}`,
    de: `Synastrie für ${personA} und ${personB}`,
    es: `Sinastría para ${personA} y ${personB}`
  })];
  const scoreLine = [
    scores.overall !== undefined ? `${formatRawLabel(locale, { en: 'Overall', fr: 'Global', de: 'Gesamt', es: 'General' })} ${formatScalarValue(scores.overall)}` : null,
    scores.romance !== undefined ? `${formatRawLabel(locale, { en: 'Romance', fr: 'Romance', de: 'Romantik', es: 'Romance' })} ${formatScalarValue(scores.romance)}` : null,
    scores.communication !== undefined ? `${formatRawLabel(locale, { en: 'Communication', fr: 'Communication', de: 'Kommunikation', es: 'Comunicación' })} ${formatScalarValue(scores.communication)}` : null,
    scores.stability !== undefined ? `${formatRawLabel(locale, { en: 'Stability', fr: 'Stabilité', de: 'Stabilität', es: 'Estabilidad' })} ${formatScalarValue(scores.stability)}` : null,
    scores.intimacy !== undefined ? `${formatRawLabel(locale, { en: 'Intimacy', fr: 'Intimité', de: 'Intimität', es: 'Intimidad' })} ${formatScalarValue(scores.intimacy)}` : null,
    scores.growth !== undefined ? `${formatRawLabel(locale, { en: 'Growth', fr: 'Croissance', de: 'Entwicklung', es: 'Crecimiento' })} ${formatScalarValue(scores.growth)}` : null,
    scores.tension !== undefined ? `${formatRawLabel(locale, { en: 'Tension', fr: 'Tension', de: 'Spannung', es: 'Tensión' })} ${formatScalarValue(scores.tension)}` : null
  ].filter(Boolean);
  if (scoreLine.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Scores', fr: 'Scores', de: 'Werte', es: 'Puntuaciones' })}: ${scoreLine.join(' • ')}`);
  }
  if (archetype?.label || archetype?.one_liner) {
    lines.push([
      `${formatRawLabel(locale, { en: 'Archetype', fr: 'Archétype', de: 'Archetyp', es: 'Arquetipo' })}: ${formatScalarValue(archetype.label) || humanizeRawKey(archetype.id)}`,
      archetype.one_liner ? formatScalarValue(archetype.one_liner) : null
    ].filter(Boolean).join('\n'));
  }
  if (strengths.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Strengths', fr: 'Forces', de: 'Stärken', es: 'Fortalezas' }),
      ...strengths.slice(0, 3).map((item, index) => `${index + 1}. ${formatScalarValue(item.summary || item.title)}`)
    ].join('\n'));
  }
  if (challenges.length > 0) {
    lines.push([
      formatRawLabel(locale, { en: 'Challenges', fr: 'Défis', de: 'Herausforderungen', es: 'Desafíos' }),
      ...challenges.slice(0, 3).map((item, index) => `${index + 1}. ${formatScalarValue(item.summary || item.title)}`)
    ].join('\n'));
  }
  if (aspects.length > 0) {
    const sorted = aspects.slice().sort((left, right) => Number(left?.orb_deg ?? 999) - Number(right?.orb_deg ?? 999));
    lines.push([
      formatRawLabel(locale, { en: 'Top contacts', fr: 'Contacts majeurs', de: 'Wichtige Kontakte', es: 'Contactos principales' }),
      ...sorted.slice(0, 6).map((aspect, index) => {
        const left = humanizeRawKey(aspect.a_point?.label || aspect.a_point?.id || aspect.a_point);
        const right = humanizeRawKey(aspect.b_point?.label || aspect.b_point?.id || aspect.b_point);
        const type = humanizeRawKey(aspect.aspect || aspect.kind);
        return `${index + 1}. ${left} ${type} ${right} • ${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${formatScalarValue(aspect.orb_deg)}`;
      })
    ].join('\n\n'));
  }
  return normalizeRawPresentationText(lines.join('\n\n'));
}

function getRawSubjectLabel(locale, subjectLabel) {
  if (subjectLabel && subjectLabel !== 'Chart User') {
    return subjectLabel;
  }

  return formatRawLabel(locale, {
    en: 'you',
    fr: 'vous',
    de: 'dich',
    es: 'ti'
  });
}

function formatTransitSearchHeading(locale, payload, subjectProfile) {
  const input = payload?.input || {};
  const transitPlanet = localizeAstroPointName(locale, formatScalarValue(input.transit_planet) || 'Transit');
  const natalPoint = localizeAstroPointName(locale, formatScalarValue(input.natal_point) || 'Point');
  const aspectType = localizeAspectName(locale, formatScalarValue(asArray(input.aspect_types)[0]) || 'aspect');
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');

  return formatRawLabel(locale, {
    en: `${transitPlanet} ${aspectType} natal ${natalPoint} for ${subject}`,
    fr: `${transitPlanet} ${aspectType} au ${natalPoint} natal pour ${subject}`,
    de: `${transitPlanet} ${aspectType} zum Radix-${natalPoint} für ${subject}`,
    es: `${transitPlanet} ${aspectType} al ${natalPoint} natal para ${subject}`
  });
}

function buildTransitSearchRawResponse(locale, payload, subjectProfile) {
  const heading = formatTransitSearchHeading(locale, payload, subjectProfile);
  const meta = payload?.meta || {};
  const summary = payload?.search_summary || {};
  const cycles = asArray(payload?.cycles);
  const passes = asArray(payload?.passes);
  const lines = [heading];

  const rangeStart = formatLocalizedDateValue(locale, meta.range_start);
  const rangeEnd = formatLocalizedDateValue(locale, meta.range_end);
  if (rangeStart || rangeEnd) {
    lines.push(`${formatRawLabel(locale, { en: 'Range', fr: 'Période', de: 'Zeitraum', es: 'Periodo' })}: ${[rangeStart || '?', rangeEnd || '?'].join(' → ')}`);
  }

  const cycleCount = formatScalarValue(summary.cycle_count);
  const passCount = formatScalarValue(summary.pass_count);
  const hitCount = formatScalarValue(summary.hit_count);
  const summaryParts = [
    cycleCount ? `${formatRawLabel(locale, { en: 'Cycles', fr: 'Cycles', de: 'Zyklen', es: 'Ciclos' })}: ${cycleCount}` : null,
    passCount ? `${formatRawLabel(locale, { en: 'Passes', fr: 'Passages', de: 'Durchgänge', es: 'Pasos' })}: ${passCount}` : null,
    hitCount ? `${formatRawLabel(locale, { en: 'Exact hits', fr: 'Exactitudes', de: 'Exakte Treffer', es: 'Exactitudes' })}: ${hitCount}` : null
  ].filter(Boolean);
  if (summaryParts.length > 0) {
    lines.push(summaryParts.join(' • '));
  }

  const renderedCycles = cycles.map((cycle, index) => {
    const block = [];
    block.push(`${index + 1}. ${normalizeRawTitle(cycle.label) || heading}`);
    block.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${formatLocalizedDateWindow(locale, cycle.cycle_start_datetime, cycle.cycle_end_datetime)}`);
    if (formatScalarValue(cycle.hit_count)) {
      block.push(`${formatRawLabel(locale, { en: 'Exact hits', fr: 'Exactitudes', de: 'Exakte Treffer', es: 'Exactitudes' })}: ${formatScalarValue(cycle.hit_count)}`);
    }
    const closestOrb = formatScalarValue(cycle.closest_orb_deg);
    if (closestOrb) {
      block.push(`${formatRawLabel(locale, { en: 'Closest orb', fr: 'Orbe la plus proche', de: 'Kleinster Orbis', es: 'Orbe más cercano' })}: ${closestOrb}`);
    }
    const exacts = asArray(cycle?.passes).flatMap((pass) => asArray(pass.exact_datetimes)).map((value) => formatLocalizedDateValue(locale, value)).filter(Boolean);
    if (exacts.length > 0) {
      block.push(`${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${exacts.slice(0, 4).join(', ')}`);
    }
    return block.join('\n');
  });

  if (renderedCycles.length > 0) {
    lines.push(formatRawLabel(locale, { en: 'Cycles', fr: 'Cycles', de: 'Zyklen', es: 'Ciclos' }));
    lines.push(...renderedCycles);
  }

  const renderedPasses = passes.map((pass, index) => {
    const block = [];
    block.push(`${index + 1}. ${normalizeRawTitle(pass.label) || heading}`);
    const passType = formatTransitPassTypeLabel(locale, formatScalarValue(pass.pass_type) || '');
    const phase = humanizeRawKey(formatScalarValue(pass.applying_or_separating) || '');
    if (passType || phase) {
      block.push([passType, phase].filter(Boolean).join(' • '));
    }
    block.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${formatLocalizedDateWindow(locale, pass.start_datetime, pass.end_datetime)}`);
    const exacts = asArray(pass.exact_datetimes).map((value) => formatLocalizedDateValue(locale, value)).filter(Boolean);
    if (exacts.length > 0) {
      block.push(`${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${exacts.join(', ')}`);
    }
    const orb = formatScalarValue(pass.closest_orb_deg);
    if (orb) {
      block.push(`${formatRawLabel(locale, { en: 'Closest orb', fr: 'Orbe la plus proche', de: 'Kleinster Orbis', es: 'Orbe más cercano' })}: ${orb}`);
    }
    return block.join('\n');
  });

  if (renderedCycles.length === 0 && renderedPasses.length > 0) {
    lines.push(formatRawLabel(locale, { en: 'Passes', fr: 'Passages', de: 'Durchgänge', es: 'Pasos' }));
    lines.push(...renderedPasses.slice(0, 8));
  }

  return normalizeRawPresentationText(lines.join('\n\n'));
}

function buildTransitSearchInterpretiveResponse(locale, payload, subjectProfile) {
  const summary = payload?.search_summary || {};
  const cycles = asArray(payload?.cycles);
  const firstCycle = cycles[0] || null;
  const exactHits = firstCycle
    ? asArray(firstCycle?.passes).flatMap((pass) => asArray(pass.exact_datetimes)).map((value) => formatLocalizedDateValue(locale, value)).filter(Boolean)
    : [];
  const windowStart = formatLocalizedDateValue(locale, firstCycle?.cycle_start_datetime || payload?.meta?.range_start);
  const windowEnd = formatLocalizedDateValue(locale, firstCycle?.cycle_end_datetime || payload?.meta?.range_end);
  const transitPlanet = localizeAstroPointName(locale, formatScalarValue(payload?.input?.transit_planet) || 'Transit');
  const natalPoint = localizeAstroPointName(locale, formatScalarValue(payload?.input?.natal_point) || 'Point');
  const aspectType = localizeAspectName(locale, formatScalarValue(asArray(payload?.input?.aspect_types)[0] || payload?.input?.aspect_types) || 'aspect');
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const hitCount = Number(summary.hit_count || exactHits.length || 0);

  if (!firstCycle || hitCount === 0) {
    return formatRawLabel(locale, {
      en: `No exact ${transitPlanet} ${aspectType} hits to the natal ${natalPoint} were found for ${subject} in the searched range.`,
      fr: `Aucune exactitude ${transitPlanet} ${aspectType} au ${natalPoint} natal n’a été trouvée pour ${subject} sur la période cherchée.`,
      de: `Keine exakten ${transitPlanet}-${aspectType}-Treffer zum Radix-${natalPoint} wurden für ${subject} im gesuchten Zeitraum gefunden.`,
      es: `No se encontraron exactitudes de ${transitPlanet} ${aspectType} al ${natalPoint} natal para ${subject} en el periodo consultado.`
    });
  }

  const exactText = exactHits[0] || null;
  return formatRawLabel(locale, {
    en: `Since birth, ${transitPlanet} formed a ${aspectType} to the natal point ${natalPoint} for ${subject} in one main cycle from ${windowStart} to ${windowEnd}.${exactText ? ` The exact hit occurred on ${exactText}.` : ''}`,
    fr: `Depuis la naissance, ${transitPlanet} a formé un ${aspectType} au point natal ${natalPoint} pour ${subject} dans un cycle principal allant de ${windowStart} à ${windowEnd}.${exactText ? ` L’exactitude a eu lieu le ${exactText}.` : ''}`,
    de: `Seit der Geburt bildete ${transitPlanet} einen ${aspectType} zum Radixpunkt ${natalPoint} für ${subject} in einem Hauptzyklus von ${windowStart} bis ${windowEnd}.${exactText ? ` Der exakte Treffer lag am ${exactText}.` : ''}`,
    es: `Desde el nacimiento, ${transitPlanet} formó un ${aspectType} al punto natal ${natalPoint} para ${subject} en un ciclo principal de ${windowStart} a ${windowEnd}.${exactText ? ` La exactitud ocurrió el ${exactText}.` : ''}`
  });
}

function formatTransitPassTypeLabel(locale, value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'direct') {
    return formatRawLabel(locale, { en: 'Direct', fr: 'Direct', de: 'Direkt', es: 'Directo' });
  }

  if (normalized === 'retrograde') {
    return formatRawLabel(locale, { en: 'Retrograde', fr: 'Rétrograde', de: 'Rückläufig', es: 'Retrógrado' });
  }

  return humanizeRawKey(normalized);
}

function buildTransitSearchFullListingResponse(locale, payload, subjectProfile, responseMode = 'interpreted') {
  const input = payload?.input || {};
  const passes = asArray(payload?.passes);
  const transitPlanetKey = formatScalarValue(input.transit_planet) || 'transit';
  const natalPointKey = formatScalarValue(input.natal_point) || 'point';
  const aspectTypeKey = formatScalarValue(asArray(input.aspect_types)[0] || input.aspect_types) || 'aspect';
  const transitPlanet = localizeAstroPointName(locale, transitPlanetKey);
  const natalPoint = localizeAstroPointName(locale, natalPointKey);
  const aspectType = localizeAspectName(locale, aspectTypeKey);
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const summary = payload?.search_summary || {};

  const exactEntries = passes.flatMap((pass) => {
    const exacts = asArray(pass?.exact_datetimes);
    if (exacts.length === 0) {
      return [];
    }

    return exacts.map((exactValue, index) => {
      const ageYears = asArray(pass?.exact_age_years)[index];
      const bits = [
        `${formatLocalizedDateValue(locale, exactValue) || '?'}`,
        formatScalarValue(pass?.pass_type) ? formatTransitPassTypeLabel(locale, formatScalarValue(pass.pass_type)) : null,
        Number.isFinite(Number(ageYears))
          ? formatRawLabel(locale, {
              en: `Age ${Number(ageYears).toFixed(2)}`,
              fr: `Âge ${Number(ageYears).toFixed(2)}`,
              de: `Alter ${Number(ageYears).toFixed(2)}`,
              es: `Edad ${Number(ageYears).toFixed(2)}`
            })
          : null
      ].filter(Boolean);
      return bits.join(' • ');
    });
  });

  const uniqueEntries = [...new Set(exactEntries)];
  const totalHits = Number(summary.hit_count || uniqueEntries.length || 0);
  const title = formatRawLabel(locale, {
    en: responseMode === 'raw'
      ? `All exact ${transitPlanet} ${aspectType} hits to the natal ${natalPoint} for ${subject} — ${totalHits}`
      : `Complete list of exact ${transitPlanet} ${aspectType} hits to the natal ${natalPoint} for ${subject} — ${totalHits}`,
    fr: responseMode === 'raw'
      ? `Toutes les ${aspectType.toLowerCase()} exactes de ${transitPlanet} au ${natalPoint} natal pour ${subject} — ${totalHits}`
      : `Liste complète des ${aspectType.toLowerCase()} exactes de ${transitPlanet} au ${natalPoint} natal pour ${subject} — ${totalHits}`,
    de: responseMode === 'raw'
      ? `Alle exakten ${transitPlanet}-${aspectType}-Treffer zum Radix-${natalPoint} für ${subject} — ${totalHits}`
      : `Vollständige Liste der exakten ${transitPlanet}-${aspectType}-Treffer zum Radix-${natalPoint} für ${subject} — ${totalHits}`,
    es: responseMode === 'raw'
      ? `Todas las exactitudes de ${transitPlanet} ${aspectType} al ${natalPoint} natal para ${subject} — ${totalHits}`
      : `Lista completa de exactitudes de ${transitPlanet} ${aspectType} al ${natalPoint} natal para ${subject} — ${totalHits}`
  });

  if (uniqueEntries.length === 0) {
    return {
      text: buildTransitSearchRawResponse(locale, payload, subjectProfile),
      textParts: undefined,
      renderMode: 'plain'
    };
  }

  const items = uniqueEntries.map((entry, index) => `${index + 1}. ${entry}`);
  const textParts = buildRawListingParts(locale, title, items, { itemType: 'line', chunkSize: 20 });
  return {
    text: textParts[0] || title,
    textParts,
    renderMode: 'plain'
  };
}

function extractBestTransitSearchPayload(toolResults = []) {
  const payloads = asArray(toolResults)
    .filter((tool) => isTransitSearchToolName(tool?.name) && tool?.result && !tool.result?.error && !tool.result?.blocked)
    .map((tool) => extractTransitSearchPayload(tool.result))
    .filter(Boolean);

  return payloads[0] || null;
}

function detectFullRawListingRequest(userText) {
  const value = String(userText || '').toLowerCase();

  const allAspects = (
    /\ball (major )?aspects\b/.test(value) ||
    /\ball my aspects\b/.test(value) ||
    /\blist all aspects\b/.test(value) ||
    /\btous les aspects\b/.test(value) ||
    /\bliste tous les aspects\b/.test(value) ||
    /\balle aspekte\b/.test(value) ||
    /\bliste alle aspekte\b/.test(value) ||
    /\btodos los aspectos\b/.test(value) ||
    /\blista todos los aspectos\b/.test(value)
  );

  if (allAspects) {
    return 'all_aspects';
  }

  const allMonthlyTransits = (
    /\ball (monthly )?transits( this month| for this month)?\b/.test(value) ||
    /\blist all (monthly )?transits\b/.test(value) ||
    /\btous les transits du mois\b/.test(value) ||
    /\bliste tous les transits\b/.test(value) ||
    /\balle transite( dieses monats| diesen monat)?\b/.test(value) ||
    /\bliste alle transite\b/.test(value) ||
    /\btodos los tránsitos del mes\b/.test(value) ||
    /\btodos los transitos del mes\b/.test(value) ||
    /\blista todos los transitos\b/.test(value)
  );

  if (allMonthlyTransits) {
    return 'all_monthly_transits';
  }

  return null;
}

function chunkRawItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildRawListingTitle(locale, kind, subjectLabel, extra = null, responseMode = 'raw') {
  const subject = getRawSubjectLabel(locale, subjectLabel);

  if (kind === 'all_aspects') {
    const base = formatRawLabel(locale, {
      en: responseMode === 'raw' ? `All major aspects for ${subject}` : `Complete major aspects for ${subject}`,
      fr: responseMode === 'raw' ? `Tous les aspects majeurs pour ${subject}` : `Liste complète des aspects majeurs pour ${subject}`,
      de: responseMode === 'raw' ? `Alle Hauptaspekte für ${subject}` : `Vollständige Hauptaspekte für ${subject}`,
      es: responseMode === 'raw' ? `Todos los aspectos mayores para ${subject}` : `Lista completa de los aspectos mayores para ${subject}`
    });
    return extra ? `${base} — ${extra}` : base;
  }

  const base = formatRawLabel(locale, {
    en: responseMode === 'raw' ? `All monthly transits for ${subject}` : `Complete monthly transits for ${subject}`,
    fr: responseMode === 'raw' ? `Tous les transits du mois pour ${subject}` : `Liste complète des transits du mois pour ${subject}`,
    de: responseMode === 'raw' ? `Alle Monatstransite für ${subject}` : `Vollständige Monatstransite für ${subject}`,
    es: responseMode === 'raw' ? `Todos los tránsitos del mes para ${subject}` : `Lista completa de los tránsitos del mes para ${subject}`
  });
  return extra ? `${base} — ${extra}` : base;
}

function buildRawListingParts(locale, title, items, options = {}) {
  const itemType = options.itemType || 'line';
  const chunkSize = Math.max(1, Number(options.chunkSize || (itemType === 'block' ? 6 : 18)));
  const chunks = chunkRawItems(items, chunkSize);

  return chunks.map((chunk, index) => {
    const chunkTitle = index === 0
      ? title
      : formatRawLabel(locale, {
          en: `${title} (continued ${index + 1}/${chunks.length})`,
          fr: `${title} (suite ${index + 1}/${chunks.length})`,
          de: `${title} (Fortsetzung ${index + 1}/${chunks.length})`,
          es: `${title} (continuación ${index + 1}/${chunks.length})`
        });

    return itemType === 'block'
      ? normalizeRawPresentationText([chunkTitle, ...chunk].join('\n\n'))
      : normalizeRawPresentationText([chunkTitle, ...chunk].join('\n'));
  });
}

function buildRawFactsIntro(locale, subjectLabel, facts, fallbackIntro = null) {
  if (fallbackIntro) {
    return fallbackIntro;
  }

  const normalizedSubject = getRawSubjectLabel(locale, subjectLabel);
  const firstFact = Array.isArray(facts) ? facts.find(Boolean) : null;
  const cacheMonth = firstFact?.cacheMonth || firstFact?.cache_month || null;

  if (firstFact && isMonthlyTransitFact(firstFact)) {
    return formatRawLabel(locale, {
      en: cacheMonth
        ? `Monthly transits for ${normalizedSubject} — ${cacheMonth}`
        : `Monthly transits for ${normalizedSubject}`,
      fr: cacheMonth
        ? `Transits du mois pour ${normalizedSubject} — ${cacheMonth}`
        : `Transits du mois pour ${normalizedSubject}`,
      de: cacheMonth
        ? `Monatliche Transite für ${normalizedSubject} — ${cacheMonth}`
        : `Monatliche Transite für ${normalizedSubject}`,
      es: cacheMonth
        ? `Tránsitos del mes para ${normalizedSubject} — ${cacheMonth}`
        : `Tránsitos del mes para ${normalizedSubject}`
    });
  }

  return formatRawLabel(locale, {
    en: `Natal chart facts for ${normalizedSubject}`,
    fr: `Faits du thème natal pour ${normalizedSubject}`,
    de: `Radix-Fakten für ${normalizedSubject}`,
    es: `Hechos de la carta natal para ${normalizedSubject}`
  });
}

function sanitizeRawFactText(value, title) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  let cleaned = text
    .replace(/\bCategory:\s*[^.]+\.?/gi, '')
    .replace(/\bKind:\s*[^.]+\.?/gi, '')
    .replace(/\bFocus:\s*[^.]+\.?/gi, '')
    .replace(/\bSubjects:\s*[^.]+\.?/gi, '')
    .replace(/\bSource:\s*[^.]+\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedTitle = normalizeSentenceForCompare(title);
  const normalizedCleaned = normalizeSentenceForCompare(cleaned);
  if (normalizedTitle && normalizedCleaned && normalizedCleaned === normalizedTitle) {
    return null;
  }

  return cleaned || null;
}

function isMonthlyTransitFact(fact) {
  return (fact.sourceKind || fact.source_kind) === factIndex.MONTHLY_TRANSIT_SOURCE_KIND;
}

function extractFactTagValues(fact, prefix) {
  return asArray(fact?.tags)
    .map((tag) => String(tag || ''))
    .filter((tag) => tag.toLowerCase().startsWith(String(prefix || '').toLowerCase()))
    .map((tag) => tag.slice(String(prefix || '').length))
    .filter(Boolean);
}

function buildTransitFactLines(locale, fact) {
  const { evidence, entities, raw, importance } = getRawFactCore(fact);
  const lines = [];
  const title = normalizeRawTitle(fact.title) || formatRawLabel(locale, {
    en: 'Transit',
    fr: 'Transit',
    de: 'Transit',
    es: 'Tránsito'
  });

  const type = evidence.windowType
    || evidence.window_type
    || evidence.passType
    || raw.kind
    || raw.category
    || extractFactTagValues(fact, 'kind:')[0]
    || extractFactTagValues(fact, 'category:')[0];
  const windowText = formatRawDateWindow(
    evidence.startDatetime || evidence.start_datetime,
    evidence.endDatetime || evidence.end_datetime
  );
  const peak = formatRawDate(
    evidence.peakDatetime || evidence.peak_datetime || importance?.peak_datetime
  );
  const exactHits = normalizeRawList(evidence.exactHitsInMonth || evidence.exact_hits_in_month, (value) => formatScalarValue(value));
  const exactDatetimes = normalizeRawList(evidence.exactDatetimes || evidence.exact_datetimes, formatRawDate);
  const visibleWindow = (
    evidence.visibleStartDay || evidence.visibleEndDay || evidence.visible_start_day || evidence.visible_end_day
      ? `${evidence.visibleStartDay || evidence.visible_start_day || '?'} → ${evidence.visibleEndDay || evidence.visible_end_day || '?'}`
      : null
  );
  const transitPlanetSource = evidence.transitPlanet || evidence.transit_planet || asArray(evidence.transit_planets)[0] || extractFactTagValues(fact, 'planet:')[0];
  const transitPlanet = formatScalarValue(transitPlanetSource)
    ? humanizeRawKey(formatScalarValue(transitPlanetSource))
    : null;
  const natalPointSource = evidence.natalPoint || evidence.natal_point || asArray(evidence.natal_points)[0];
  const natalPoint = formatScalarValue(natalPointSource)
    ? humanizeRawKey(formatScalarValue(natalPointSource))
    : null;
  const aspectType = formatScalarValue(evidence.aspectType || evidence.aspect_type || normalizeEntityList(entities.aspect_types)[0] || extractFactTagValues(fact, 'aspect_type:')[0]);
  const houses = normalizeRawList(
    evidence.houses || entities.houses || extractFactTagValues(fact, 'house:'),
    (value) => humanizeRawKey(formatScalarValue(value))
  );

  lines.push(title);

  if (type) {
    const normalizedType = humanizeRawKey(type);
    const typeLabel = /window/i.test(String(raw.kind || '')) && !/window/i.test(normalizedType)
      ? `${normalizedType} Window`
      : normalizedType;
    lines.push(`${formatRawLabel(locale, { en: 'Type', fr: 'Type', de: 'Typ', es: 'Tipo' })}: ${localizeRawType(locale, typeLabel)}`);
  }

  if (windowText) {
    lines.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${windowText}`);
  } else if (visibleWindow && (fact.cacheMonth || fact.cache_month)) {
    lines.push(`${formatRawLabel(locale, { en: 'Days in month', fr: 'Jours dans le mois', de: 'Tage im Monat', es: 'Días del mes' })}: ${visibleWindow}`);
  }

  if (peak) {
    lines.push(`${formatRawLabel(locale, { en: 'Peak', fr: 'Pic', de: 'Höhepunkt', es: 'Pico' })}: ${peak}`);
  } else if (exactDatetimes.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact hits', fr: 'Exactitudes', de: 'Exakte Treffer', es: 'Exactitudes' })}: ${exactDatetimes.join(', ')}`);
  } else if (exactHits.length > 0 && (fact.cacheMonth || fact.cache_month)) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact days', fr: 'Jours exacts', de: 'Exakte Tage', es: 'Días exactos' })}: ${exactHits.join(', ')}`);
  }

  if (transitPlanet || natalPoint || aspectType) {
    const focus = [transitPlanet, aspectType ? humanizeRawKey(aspectType) : null, natalPoint].filter(Boolean).join(' ');
    if (focus) {
      lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${focus}`);
    }
  }

  if (houses.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Houses', fr: 'Maisons', de: 'Häuser', es: 'Casas' })}: ${houses.join(', ')}`);
  }

  if (evidence.continuesFromPreviousMonth || evidence.continues_from_previous_month) {
    lines.push(formatRawLabel(locale, {
      en: 'Carries over from the previous month',
      fr: 'Se prolonge depuis le mois précédent',
      de: 'Läuft aus dem Vormonat weiter',
      es: 'Se arrastra desde el mes anterior'
    }));
  }

  if (evidence.continuesToNextMonth || evidence.continues_to_next_month) {
    lines.push(formatRawLabel(locale, {
      en: 'Continues into the next month',
      fr: 'Se prolonge sur le mois suivant',
      de: 'Läuft in den nächsten Monat weiter',
      es: 'Continúa en el mes siguiente'
    }));
  }

  const fallbackFactText = sanitizeRawFactText(fact.factText || fact.fact_text, title);
  if (fallbackFactText && lines.length <= 2) {
    lines.push(fallbackFactText);
  }

  const filtered = lines.filter(Boolean);
  return filtered.length > 1 ? filtered : [];
}

function buildNatalFactLines(locale, fact) {
  const { evidence, entities, raw } = getRawFactCore(fact);
  const title = normalizeRawTitle(fact.title);
  const lines = [];

  if (title) {
    lines.push(title);
  }

  const primaryFields = [
    [{ en: 'Planets', fr: 'Planètes', de: 'Planeten', es: 'Planetas' }, formatRawJoinedList(normalizeEntityList(entities.planets))],
    [{ en: 'Signs', fr: 'Signes', de: 'Zeichen', es: 'Signos' }, formatRawJoinedList(normalizeEntityList(entities.signs))],
    [{ en: 'Houses', fr: 'Maisons', de: 'Häuser', es: 'Casas' }, formatRawJoinedList(normalizeEntityList(entities.houses))],
    [{ en: 'Aspects', fr: 'Aspects', de: 'Aspekte', es: 'Aspectos' }, formatRawJoinedList(normalizeEntityList(entities.aspect_types))],
    [{ en: 'Structures', fr: 'Structures', de: 'Strukturen', es: 'Estructuras' }, formatRawJoinedList(normalizeEntityList(entities.configuration_types || entities.signature_types))]
  ]
    .map(([label, value]) => {
      const rendered = formatScalarValue(value);
      return rendered ? `${formatRawLabel(locale, label)}: ${humanizeRawKey(rendered)}` : null;
    })
    .filter(Boolean);

  lines.push(...primaryFields.slice(0, 3));

  const drivers = normalizeEntityList(evidence.drivers, normalizeDriverLabel);
  if (drivers.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Factors', fr: 'Facteurs', de: 'Faktoren', es: 'Factores' })}: ${drivers.slice(0, 4).join(', ')}`);
  }

  const factText = sanitizeRawFactText(fact.factText || fact.fact_text, title);
  if (factText) {
    lines.push(factText);
  }

  const filtered = lines.filter(Boolean);
  if (filtered.length > 1) {
    return filtered;
  }

  const wordCount = String(title || '').split(/\s+/).filter(Boolean).length;
  return wordCount >= 3 ? filtered : [];
}

function buildNatalStructureLines(locale, fact) {
  const title = normalizeRawTitle(fact.title);
  const { evidence, entities, raw } = getRawFactCore(fact);
  const lines = [];

  const structureTypes = normalizeEntityList(
    entities.configuration_types?.length > 0 ? entities.configuration_types : entities.signature_types
  );
  const kind = humanizeRawKey(raw?.kind || '');
  const scope = formatScalarValue(evidence.scope)
    ? humanizeRawKey(formatScalarValue(evidence.scope))
    : null;
  const sign = formatScalarValue(evidence.sign_id || asArray(entities.signs)[0])
    ? humanizeRawKey(formatScalarValue(evidence.sign_id || asArray(entities.signs)[0]))
    : null;
  const house = formatScalarValue(evidence.house || evidence.house_id || asArray(entities.houses)[0]);
  const bodies = [...new Set(normalizeEntityList(evidence.bodies?.length > 0 ? evidence.bodies : entities.planets))];
  const handle = formatScalarValue(evidence.handle_id)
    ? humanizeRawKey(formatScalarValue(evidence.handle_id))
    : null;
  const count = formatScalarValue(evidence.count);
  const scopeLabel = scope ? scope.toLowerCase() : null;
  const primaryStructure = structureTypes[0] || null;
  const compactTitle = (
    kind === 'Stellium' && scopeLabel === 'house' && house
      ? `${formatRawLabel(locale, { en: 'Stellium in House', fr: 'Stellium en maison', de: 'Stellium in Haus', es: 'Stellium en casa' })} ${house}`
      : kind === 'Stellium' && scopeLabel === 'sign' && sign
        ? `${formatRawLabel(locale, { en: 'Stellium in', fr: 'Stellium en', de: 'Stellium in', es: 'Stellium en' })} ${sign}`
        : primaryStructure === 'bucket' && handle
          ? `${formatRawLabel(locale, { en: 'Bucket shape', fr: 'Figure en seau', de: 'Eimerfigur', es: 'Figura de cubo' })} • ${formatRawLabel(locale, { en: 'Handle', fr: 'Poignée', de: 'Henkel', es: 'Asa' })} ${handle}`
          : primaryStructure === 'intercepted_sign' && sign
            ? `${formatRawLabel(locale, { en: 'Intercepted sign', fr: 'Signe intercepté', de: 'Eingeschlossenes Zeichen', es: 'Signo interceptado' })} • ${sign}`
            : title
  );

  if (compactTitle) {
    lines.push(compactTitle);
  }

  if (kind) {
    lines.push(`${formatRawLabel(locale, { en: 'Type', fr: 'Type', de: 'Typ', es: 'Tipo' })}: ${kind}`);
  }

  if (structureTypes.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Structure', fr: 'Structure', de: 'Struktur', es: 'Estructura' })}: ${structureTypes.join(', ')}`);
  }

  if (scope || sign || house) {
    const parts = [
      scope ? `${formatRawLabel(locale, { en: 'Scope', fr: 'Portée', de: 'Bereich', es: 'Alcance' })}: ${scope}` : null,
      sign ? `${formatRawLabel(locale, { en: 'Sign', fr: 'Signe', de: 'Zeichen', es: 'Signo' })}: ${sign}` : null,
      house ? `${formatRawLabel(locale, { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' })}: ${house}` : null
    ].filter(Boolean);

    if (parts.length > 0) {
      lines.push(parts.join(' • '));
    }
  }

  if (count) {
    lines.push(`${formatRawLabel(locale, { en: 'Bodies', fr: 'Corps', de: 'Körper', es: 'Cuerpos' })}: ${count}`);
  }

  if (bodies.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Planets', fr: 'Planètes', de: 'Planeten', es: 'Planetas' })}: ${bodies.slice(0, 8).join(', ')}`);
  }

  if (handle) {
    lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${handle}`);
  }

  return lines.filter(Boolean);
}

function formatPlanetPlacementLine(locale, planet) {
  if (!planet) {
    return null;
  }

  const planetName = humanizeRawKey(planet.id || planet.name || 'planet');
  const signName = humanizeRawKey(planet.sign_id || planet.sign || '');
  const houseValue = formatScalarValue(planet.house);
  const retrograde = planet.is_retrograde ? formatRawLabel(locale, {
    en: 'Rx',
    fr: 'Rx',
    de: 'Rx',
    es: 'Rx'
  }) : null;
  const parts = [
    `${planetName}: ${signName || '?'}`,
    houseValue ? `${formatRawLabel(locale, { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' })} ${houseValue}` : null,
    retrograde
  ].filter(Boolean);

  return parts.join(' • ');
}

function formatAspectLine(locale, aspect) {
  if (!aspect) {
    return null;
  }

  const point1 = humanizeRawKey(aspect.planet1_id || aspect.point1_id || aspect.planet1 || aspect.point1 || aspect.p1 || '');
  const point2 = humanizeRawKey(aspect.planet2_id || aspect.point2_id || aspect.planet2 || aspect.point2 || aspect.p2 || '');
  const aspectType = humanizeRawKey(aspect.aspect_name || aspect.aspect_type || aspect.aspect || aspect.type || '');
  const normalizedPoint1 = normalizeMatchingText(point1);
  const normalizedPoint2 = normalizeMatchingText(point2);
  if (!point1 || !point2 || !aspectType || (normalizedPoint1 && normalizedPoint1 === normalizedPoint2)) {
    return null;
  }
  const orb = formatScalarValue(aspect.orb);
  const pieces = [
    [point1, aspectType, point2].filter(Boolean).join(' ')
  ];

  if (orb) {
    pieces.push(`${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${orb}`);
  }

  return pieces.join(' • ');
}

function formatAspectFactLine(locale, fact) {
  const title = normalizeRawTitle(fact.title);
  const { entities, raw, evidence } = getRawFactCore(fact);
  const planets = [...new Set(asArray(entities.planets).map((value) => humanizeRawKey(value)).filter(Boolean))];
  const aspectType = humanizeRawKey(
    evidence?.aspect_type
    || evidence?.aspectType
    || asArray(entities.aspect_types)[0]
    || raw?.aspect_type
    || raw?.aspectType
    || fact?.aspect_type
    || ''
  );
  const parts = [];

  if (planets.length >= 2) {
    if (normalizeMatchingText(planets[0]) === normalizeMatchingText(planets[1])) {
      return null;
    }
    parts.push([planets[0], aspectType, planets[1]].filter(Boolean).join(' '));
  } else if (title) {
    if (/north node\s+north node|true node\s+true node|mean node\s+mean node/i.test(title)) {
      return null;
    }
    parts.push(title);
  }

  const orb = formatScalarValue(evidence?.orb || raw?.orb || fact?.orb);
  if (orb) {
    parts.push(`${formatRawLabel(locale, { en: 'Orb', fr: 'Orbe', de: 'Orbis', es: 'Orbe' })}: ${orb}`);
  }

  return parts.filter(Boolean).join(' • ');
}

function scoreNatalAspectForOverview(aspect = {}) {
  const point1 = normalizeMatchingText(aspect.planet1_id || aspect.point1_id || aspect.planet1 || aspect.point1 || aspect.p1 || '');
  const point2 = normalizeMatchingText(aspect.planet2_id || aspect.point2_id || aspect.planet2 || aspect.point2 || aspect.p2 || '');
  const personalPoints = new Set(['sun', 'moon', 'mercury', 'venus', 'mars', 'ascendant', 'mc', 'midheaven']);
  let score = 0;

  const orb = Number(aspect.orb);
  if (Number.isFinite(orb)) {
    score += Math.max(0, 12 - orb);
  }

  if (point1 && personalPoints.has(point1)) score += 5;
  if (point2 && personalPoints.has(point2)) score += 5;

  const aspectType = normalizeMatchingText(aspect.aspect_name || aspect.aspect_type || aspect.aspect || aspect.type || '');
  if (aspectType === 'conjunction' || aspectType === 'opposition' || aspectType === 'square') score += 2;

  return score;
}

function collectNatalOverviewAspectLines(locale, normalizedProfile, options = {}) {
  const seen = new Set();
  return asArray(normalizedProfile?.majorAspects)
    .filter((aspect) => {
      const point1 = normalizeMatchingText(aspect?.planet1_id || aspect?.point1_id || aspect?.planet1 || aspect?.point1 || aspect?.p1 || '');
      const point2 = normalizeMatchingText(aspect?.planet2_id || aspect?.point2_id || aspect?.planet2 || aspect?.point2 || aspect?.p2 || '');
      const aspectType = normalizeMatchingText(aspect?.aspect_name || aspect?.aspect_type || aspect?.aspect || aspect?.type || '');
      if (!point1 || !point2 || !aspectType || point1 === point2) {
        return false;
      }
      const key = [point1, aspectType, point2].sort().join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => scoreNatalAspectForOverview(right) - scoreNatalAspectForOverview(left))
    .map((aspect) => formatAspectLine(locale, aspect))
    .filter(Boolean)
    .slice(0, options.limit || 5);
}

function matchesNatalAspectPlanetFilter(source, requestedPlanet) {
  const normalizedPlanet = normalizeMatchingText(requestedPlanet);
  if (!normalizedPlanet) {
    return true;
  }

  const values = [];
  if (source?.factPayload || source?.entities || source?.title) {
    const fact = source;
    const { entities, evidence, raw } = getRawFactCore(fact);
    values.push(
      ...asArray(entities?.planets),
      evidence?.planet1,
      evidence?.planet2,
      evidence?.point1,
      evidence?.point2,
      raw?.planet1,
      raw?.planet2,
      raw?.point1,
      raw?.point2,
      fact?.title
    );
  } else {
    values.push(
      source?.planet1_id,
      source?.planet2_id,
      source?.point1_id,
      source?.point2_id,
      source?.planet1,
      source?.planet2,
      source?.point1,
      source?.point2
    );
  }

  return values
    .map((value) => normalizeMatchingText(value))
    .filter(Boolean)
    .some((value) => value === normalizedPlanet || new RegExp(`\\b${normalizedPlanet}\\b`, 'i').test(value));
}

function buildNormalizedNatalAspects(payload, majorOnly = true) {
  return asArray(payload?.aspects)
    .filter((aspect) => majorOnly ? aspect?.is_major : !aspect?.is_major)
    .sort((left, right) => (Number(left?.orb) || 999) - (Number(right?.orb) || 999))
    .map((aspect) => ({ ...aspect }));
}

function buildRawNatalAspectListing(locale, subjectProfile, aspects, options = {}) {
  const requestedPlanet = options.requestedPlanet || null;
  const minorOnly = Boolean(options.minorOnly);
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const lines = asArray(aspects).map((aspect) => formatAspectLine(locale, aspect)).filter(Boolean);
  if (lines.length === 0) {
    return {
      textParts: [normalizeRawPresentationText(formatRawLabel(locale, {
        en: `No ${minorOnly ? 'minor' : 'major'} aspects are available for ${subject}.`,
        fr: `Aucun aspect ${minorOnly ? 'mineur' : 'majeur'} n’est disponible pour ${subject}.`,
        de: `Keine ${minorOnly ? 'Neben' : 'Haupt'}aspekte für ${subject} verfügbar.`,
        es: `No hay aspectos ${minorOnly ? 'menores' : 'mayores'} disponibles para ${subject}.`
      }))],
      renderMode: 'plain'
    };
  }

  const title = requestedPlanet
    ? formatRawLabel(locale, {
        en: `${minorOnly ? 'Minor' : 'Major'} aspects involving ${humanizeRawKey(requestedPlanet)} for ${subject} — ${lines.length}`,
        fr: `Aspects ${minorOnly ? 'mineurs' : 'majeurs'} impliquant ${humanizeRawKey(requestedPlanet)} pour ${subject} — ${lines.length}`,
        de: `${minorOnly ? 'Neben' : 'Haupt'}aspekte mit ${humanizeRawKey(requestedPlanet)} für ${subject} — ${lines.length}`,
        es: `Aspectos ${minorOnly ? 'menores' : 'mayores'} con ${humanizeRawKey(requestedPlanet)} para ${subject} — ${lines.length}`
      })
    : formatRawLabel(locale, {
        en: `${minorOnly ? 'All minor aspects' : 'All major aspects'} for ${subject} — ${lines.length}`,
        fr: `${minorOnly ? 'Tous les aspects mineurs' : 'Tous les aspects majeurs'} pour ${subject} — ${lines.length}`,
        de: `${minorOnly ? 'Alle Nebenaspekte' : 'Alle Hauptaspekte'} für ${subject} — ${lines.length}`,
        es: `${minorOnly ? 'Todos los aspectos menores' : 'Todos los aspectos mayores'} para ${subject} — ${lines.length}`
      });

  return {
    textParts: buildRawListingParts(locale, title, lines, { itemType: 'line', chunkSize: 18 }),
    renderMode: 'plain'
  };
}

function filterNatalAspectsByPlanet(aspects, requestedPlanet) {
  const normalizedPlanet = normalizeMatchingText(requestedPlanet);
  if (!normalizedPlanet) {
    return asArray(aspects);
  }

  return asArray(aspects).filter((aspect) => {
    const candidates = [
      aspect?.p1,
      aspect?.p2,
      aspect?.planet1_id,
      aspect?.planet2_id,
      aspect?.point1_id,
      aspect?.point2_id,
      aspect?.planet1,
      aspect?.planet2,
      aspect?.point1,
      aspect?.point2
    ]
      .map((value) => normalizeMatchingText(value))
      .filter(Boolean);

    return candidates.includes(normalizedPlanet);
  });
}

function buildTransitTimelineEntryLines(locale, transit) {
  const title = normalizeRawTitle(transit.label) || formatRawLabel(locale, {
    en: 'Transit',
    fr: 'Transit',
    de: 'Transit',
    es: 'Tránsito'
  });
  const lines = [title];
  const windowText = formatRawDateWindow(transit.start_datetime, transit.end_datetime);
  const exactHits = normalizeRawList(transit.exact_datetimes, formatRawDate);
  const peak = formatRawDate(transit.peak_datetime);
  const focus = [transit.transit_planet, transit.aspect_type ? humanizeRawKey(transit.aspect_type) : null, transit.natal_point]
    .map((item) => {
      const rendered = formatScalarValue(item);
      return rendered ? humanizeRawKey(rendered) : null;
    })
    .filter(Boolean)
    .join(' ');
  const houses = normalizeRawList(transit.houses, (value) => humanizeRawKey(formatScalarValue(value)));

  if (windowText) {
    lines.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${windowText}`);
  }

  if (peak) {
    lines.push(`${formatRawLabel(locale, { en: 'Peak', fr: 'Pic', de: 'Höhepunkt', es: 'Pico' })}: ${peak}`);
  } else if (exactHits.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${exactHits.slice(0, 3).join(', ')}`);
  }

  if (focus) {
    lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${focus}`);
  }

  if (houses.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Houses', fr: 'Maisons', de: 'Häuser', es: 'Casas' })}: ${houses.join(', ')}`);
  }

  return lines.filter(Boolean).join('\n');
}

function scoreTransitTimelineEntry(transit) {
  const title = String(normalizeRawTitle(transit?.label) || '').toLowerCase();
  let score = 0;

  if (transit?.start_datetime) score += 20;
  if (transit?.peak_datetime) score += 20;
  if (asArray(transit?.exact_datetimes).length > 0) score += 15;
  if (asArray(transit?.houses).length > 0) score += 6;
  if (formatScalarValue(transit?.transit_planet)) score += 8;
  if (/(pressure window|support window|stellium|station|ingress|configuration|t square|grand trine|kite)/.test(title)) score += 12;

  return score;
}

function selectTopMonthlyTransitFacts(facts, limit = 10, options = {}) {
  const requestedPlanet = options.requestedPlanet || null;
  return selectRawDisplayFacts(
    filterTransitEntriesByTimeframe(
      asArray(facts).filter((fact) => isMonthlyTransitFact(fact) && (!requestedPlanet || matchesTransitPlanetFilter(fact, requestedPlanet, options.strictPlanetMatch))),
      options.timeframe,
      options.timezone || 'UTC'
    ),
    { ...options, limit }
  ).slice(0, limit);
}

function selectTopMonthlyTimelineEntries(transits, limit = 10, options = {}) {
  return filterTransitEntriesByTimeframe(asArray(transits), options.timeframe, options.timezone || 'UTC')
    .filter(Boolean)
    .slice()
    .sort((left, right) => scoreTransitTimelineEntry(right) - scoreTransitTimelineEntry(left))
    .slice(0, limit);
}

function matchesTransitPlanetFilter(entry, planet, strict = false) {
  if (!planet) {
    return true;
  }

  const normalizedPlanet = String(planet || '').toLowerCase();
  const { evidence, entities, raw } = getRawFactCore(entry || {});
  const focusedCandidates = [
    entry?.transit_planet,
    entry?.natal_point,
    entry?.label,
    entry?.title,
    raw?.transit_planet,
    raw?.natal_point,
    evidence?.transitPlanet,
    evidence?.transit_planet,
    evidence?.natalPoint,
    evidence?.natal_point
  ];
  const broadCandidates = [
    ...focusedCandidates,
    ...(asArray(entities?.planets)),
    ...(asArray(entities?.drivers)),
    ...(asArray(entities?.natal_points)),
    ...(asArray(entities?.transit_planets)),
    ...(strict ? [] : extractFactTagValues(entry || {}, 'planet:')),
    ...(strict ? [] : extractFactTagValues(entry || {}, 'planet_id:'))
  ]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);

  const haystack = strict ? focusedCandidates : broadCandidates;
  return haystack.some((value) => new RegExp(`\\b${normalizedPlanet}\\b`, 'i').test(String(value || '').toLowerCase()));
}

function parseRequestedMonthlyTransitPlanet(text) {
  const rawValue = String(text || '');
  const value = normalizeMatchingText(rawValue);
  const relationCue = /\b(en rapport avec|lie a|related to|about|regarding|concernant|pour|for)\b/i.test(value);
  const monthlyCue = /\b(transits?|transit)\b/i.test(value) && /\b(mois|month|mensuel|monthly)\b/i.test(value);
  if (!relationCue && !monthlyCue) {
    return null;
  }

  return parsePlanetFromQuestion(rawValue);
}

function collectRawNatalOverviewData(locale, subjectProfile, facts, options = {}) {
  const normalizedProfile = normalizeNatalProfile(
    subjectProfile?.rawNatalPayload,
    subjectProfile?.cityLabel,
    { birthCountry: subjectProfile?.birthCountry }
  );

  const preferredPlanetOrder = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'north_node', 'chiron'];
  const seenPlanets = new Set();
  const placements = asArray(normalizedProfile.planets)
    .filter((planet) => planet?.id && planet.id !== 'true_node' && planet.id !== 'lilith')
    .filter((planet) => {
      const id = String(planet.id || '').toLowerCase();
      if (seenPlanets.has(id)) {
        return false;
      }

      seenPlanets.add(id);
      return true;
    })
    .sort((left, right) => preferredPlanetOrder.indexOf(String(left.id || '').toLowerCase()) - preferredPlanetOrder.indexOf(String(right.id || '').toLowerCase()))
    .map((planet) => formatPlanetPlacementLine(locale, planet))
    .filter(Boolean);

  const indexedAspectLines = asArray(options.aspectFacts)
    .map((fact) => formatAspectFactLine(locale, fact))
    .filter(Boolean);
  const overviewAspectLines = collectNatalOverviewAspectLines(locale, normalizedProfile, { limit: 5 });
  const aspects = (overviewAspectLines.length > 0 ? overviewAspectLines : indexedAspectLines).slice(0, 5);

  const structureBlocks = [];
  const seenStructureHeadings = new Set();
  selectRawDisplayFacts(facts, options)
    .filter((fact) => !isMonthlyTransitFact(fact))
    .forEach((fact) => {
      if (structureBlocks.length >= 5) {
        return;
      }

      const lines = buildNatalStructureLines(locale, fact);
      const heading = String(lines[0] || '').trim();
      if (lines.length > 0 && heading && !seenStructureHeadings.has(heading.toLowerCase())) {
        seenStructureHeadings.add(heading.toLowerCase());
        structureBlocks.push(lines);
      }
    });

  return {
    title: formatRawLabel(locale, {
      en: `Raw natal overview for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
      fr: `Vue brute du thème natal pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
      de: `Rohe Radix-Übersicht für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
      es: `Vista bruta de la carta natal para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`
    }),
    placements,
    aspects,
    structureBlocks
  };
}

function buildRawNatalOverview(locale, subjectProfile, facts, options = {}) {
  const {
    title,
    placements,
    aspects,
    structureBlocks
  } = collectRawNatalOverviewData(locale, subjectProfile, facts, options);

  const formatBulletedLines = (items = []) => items.map((item) => `- ${item}`).join('\n');
  const formatStructuredBlock = (lines, index) => {
    const [titleLine, ...detailLines] = asArray(lines).filter(Boolean);
    if (!titleLine) {
      return null;
    }

    const body = detailLines.map((line) => `   ${line}`).join('\n');
    return body
      ? [`${index + 1}. ${titleLine}`, body].join('\n')
      : `${index + 1}. ${titleLine}`;
  };

  const blocks = [title];

  if (placements.length > 0) {
    blocks.push([
      localizeRawSectionTitle(locale, 'placements'),
      formatBulletedLines(placements)
    ].join('\n'));
  }

  if (aspects.length > 0) {
    blocks.push([
      localizeRawSectionTitle(locale, 'aspects'),
      formatBulletedLines(aspects)
    ].join('\n'));
  }

  if (structureBlocks.length > 0) {
    blocks.push([
      localizeRawSectionTitle(locale, 'structures'),
      ...structureBlocks
        .map((lines, index) => formatStructuredBlock(lines, index))
        .filter(Boolean)
    ].join('\n\n'));
  }

  return normalizeRawPresentationText(blocks.join('\n\n'));
}

function buildRawNatalStructuresOverview(locale, subjectProfile, facts, options = {}) {
  const { title, structureBlocks } = collectRawNatalOverviewData(locale, subjectProfile, facts, options);
  const blocks = [title];

  if (structureBlocks.length > 0) {
    blocks.push([
      localizeRawSectionTitle(locale, 'structures'),
      ...structureBlocks
        .map((lines, index) => {
          const [heading, ...detailLines] = asArray(lines).filter(Boolean);
          const body = detailLines.map((line) => `   ${line}`).join('\n');
          return body ? [`${index + 1}. ${heading}`, body].join('\n') : `${index + 1}. ${heading}`;
        })
        .filter(Boolean)
    ].join('\n\n'));
  }

  if (blocks.length === 1) {
    blocks.push(formatRawLabel(locale, {
      en: 'No chart structures were found in the grounded natal facts.',
      fr: 'Aucune structure de thème n’a été trouvée dans les faits natals fondés.',
      de: 'In den fundierten Radix-Fakten wurden keine Strukturen gefunden.',
      es: 'No se encontraron estructuras de carta en los hechos natales fundamentados.'
    }));
  }

  return normalizeRawPresentationText(blocks.join('\n\n'));
}

function buildTelegramRawNatalOverviewHtml(locale, subjectProfile, facts, options = {}) {
  const {
    title,
    placements,
    aspects,
    structureBlocks
  } = collectRawNatalOverviewData(locale, subjectProfile, facts, options);

  const sections = [`<b>${escapeTelegramHtml(title)}</b>`];

  if (placements.length > 0) {
    sections.push([
      `<b>${escapeTelegramHtml(localizeRawSectionTitle(locale, 'placements'))}</b>`,
      ...placements.map((item) => `• ${escapeTelegramHtml(item)}`)
    ].join('\n'));
  }

  if (aspects.length > 0) {
    sections.push([
      `<b>${escapeTelegramHtml(localizeRawSectionTitle(locale, 'aspects'))}</b>`,
      ...aspects.map((item) => `• ${escapeTelegramHtml(item)}`)
    ].join('\n'));
  }

  if (structureBlocks.length > 0) {
    const renderedBlocks = structureBlocks.map((lines, index) => {
      const [heading, ...detailLines] = asArray(lines).filter(Boolean);
      const pieces = [`<b>${index + 1}. ${escapeTelegramHtml(heading || '')}</b>`];
      pieces.push(...detailLines.map((line) => escapeTelegramHtml(line)));
      return pieces.join('\n');
    });

    sections.push([
      `<b>${escapeTelegramHtml(localizeRawSectionTitle(locale, 'structures'))}</b>`,
      ...renderedBlocks
    ].join('\n\n'));
  }

  return sections;
}

function buildTelegramRawNatalStructuresHtml(locale, subjectProfile, facts, options = {}) {
  const { title, structureBlocks } = collectRawNatalOverviewData(locale, subjectProfile, facts, options);
  const sections = [`<b>${escapeTelegramHtml(title)}</b>`];

  if (structureBlocks.length > 0) {
    const renderedBlocks = structureBlocks.map((lines, index) => {
      const [heading, ...detailLines] = asArray(lines).filter(Boolean);
      const pieces = [`<b>${index + 1}. ${escapeTelegramHtml(heading || '')}</b>`];
      pieces.push(...detailLines.map((line) => escapeTelegramHtml(line)));
      return pieces.join('\n');
    });

    sections.push([
      `<b>${escapeTelegramHtml(localizeRawSectionTitle(locale, 'structures'))}</b>`,
      ...renderedBlocks
    ].join('\n\n'));
  } else {
    sections.push(escapeTelegramHtml(formatRawLabel(locale, {
      en: 'No chart structures were found in the grounded natal facts.',
      fr: 'Aucune structure de thème n’a été trouvée dans les faits natals fondés.',
      de: 'In den fundierten Radix-Fakten wurden keine Strukturen gefunden.',
      es: 'No se encontraron estructuras de carta en los hechos natales fundamentados.'
    })));
  }

  return sections;
}

function splitTelegramHtmlSections(sections, maxLength = 3500) {
  const chunks = [];
  let current = '';

  for (const section of asArray(sections).filter(Boolean)) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = section;
      continue;
    }

    chunks.push(section);
    current = '';
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function scoreRawDisplayFact(fact, options = {}) {
  const userText = String(options.userText || '').toLowerCase();
  const answerStyle = String(options.answerStyle || '');
  const isTransit = isMonthlyTransitFact(fact);
  const title = String(normalizeRawTitle(fact.title) || '').toLowerCase();
  const tags = Array.isArray(fact.tags) ? fact.tags.map((tag) => String(tag).toLowerCase()) : [];
  const { evidence, entities, raw } = getRawFactCore(fact);
  let score = Number(fact.importance || 0);

  if (isTransit) {
    const requestedPlanet = options.requestedPlanet || null;
    const tagPlanets = [
      ...extractFactTagValues(fact, 'planet:'),
      ...extractFactTagValues(fact, 'planet_id:')
    ].map((value) => String(value || '').toLowerCase());
    const tagPlanetSet = [...new Set(tagPlanets)];
    if (evidence.start_datetime || evidence.startDatetime) score += 20;
    if (evidence.peak_datetime || evidence.peakDatetime) score += 20;
    if (asArray(evidence.exact_datetimes || evidence.exactDatetimes).length > 0) score += 15;
    if (asArray(evidence.transit_planets || entities.planets).length > 0) score += 8;
    if (asArray(evidence.houses || entities.houses).length > 0) score += 6;
    if (/pressure window|support window|stellium|station|ingress|configuration|t square|grand trine|kite/.test(title)) score += 12;
    if (requestedPlanet) {
      if (matchesTransitPlanetFilter(fact, requestedPlanet)) {
        score += 40;
        if (title.includes(String(requestedPlanet).toLowerCase())) score += 20;
        if (tagPlanetSet.includes(String(requestedPlanet).toLowerCase())) score += 20;
        if (/topic window|background theme|activation cluster/.test(title)) score -= 35;
        if (tagPlanetSet.length >= 5) score -= 15;
      } else {
        score -= 120;
      }
    }
    return score;
  }

  const broadNatalQuestion = !/(career|work|money|love|relationship|family|spiritual|mind|mental|emotion|aspect|house|ruler|saturn|jupiter|venus|mars|mercury|moon|sun|chiron|pluto|uranus|neptune)/.test(userText)
    && (answerStyle === 'natal_theme' || /theme|chart|natal|astro/.test(userText));

  if (broadNatalQuestion) {
    if (/(chart ruler|asc|ascendant|midheaven|mc|stellium|bucket|intercepted|shape|dominant|house stellium)/.test(title)) score += 40;
    if (['placement', 'angle', 'stellium', 'configuration', 'dominant', 'ruler'].includes(String(raw?.kind || '').toLowerCase())) score += 28;
    if (asArray(entities.planets).length > 0) score += 10;
    if (asArray(entities.houses).length > 0 || asArray(entities.signs).length > 0) score += 8;
    if (String(raw?.kind || '').toLowerCase() === 'signature') score -= 18;
  }

  if (/rare/.test(title) && !/rare|special|structure|interception/.test(userText)) {
    score -= 50;
  }

  if (/signature rare/.test(title)) {
    score -= 80;
  }

  return score;
}

function isBroadRawNatalQuestion(userText, answerStyle) {
  const value = String(userText || '').toLowerCase();
  return (
    !/(career|work|money|love|relationship|family|spiritual|mind|mental|emotion|aspect|house|ruler|saturn|jupiter|venus|mars|mercury|moon|sun|chiron|pluto|uranus|neptune|interception|rare|signature|stellium)/.test(value) &&
    (answerStyle === 'natal_theme' || /theme|chart|natal|astro|thème/.test(value))
  );
}

function isStructureFocusedRawNatalQuestion(userText) {
  const value = String(userText || '').toLowerCase();
  return /(structure|structures|motif|motifs|pattern|patterns|configuration|configurations)/.test(value);
}

function countConcreteRawNatalFacts(facts) {
  return asArray(facts).filter((fact) => {
    const title = String(normalizeRawTitle(fact.title) || '').toLowerCase();
    const { raw, entities } = getRawFactCore(fact);
    return (
      ['placement', 'angle', 'stellium', 'configuration', 'ruler', 'dominant'].includes(String(raw?.kind || '').toLowerCase()) ||
      /(chart ruler|asc|ascendant|midheaven|mc|stellium|bucket|intercepted|shape|dominant)/.test(title) ||
      asArray(entities.houses).length > 0 ||
      asArray(entities.signs).length > 0
    );
  }).length;
}

function countUsableRawCards(locale, facts, options = {}) {
  return asArray(facts).filter((fact) => {
    const lines = isMonthlyTransitFact(fact)
      ? buildTransitFactLines(locale, fact)
      : buildNatalFactLines(locale, fact);
    return lines.length > 0 && String(lines[0] || '').trim();
  }).length;
}

function selectRawDisplayFacts(facts, options = {}) {
  const unique = new Map();
  asArray(facts).forEach((fact) => {
    const normalizedTitle = String(normalizeRawTitle(fact.title) || '').toLowerCase();
    const key = isMonthlyTransitFact(fact)
      ? `${fact.sourceKind || fact.source_kind}:${normalizedTitle || String(fact.factKey || '')}:${String(fact.factKey || '')}`
      : `${fact.sourceKind || fact.source_kind}:${normalizedTitle || String(fact.factKey || '')}`;
    if (!unique.has(key)) {
      unique.set(key, fact);
    }
  });

  const requestedLimit = Math.max(1, Math.min(Number(options.limit || 5), 12));
  const candidateLimit = Math.max(requestedLimit, Math.min(requestedLimit * 3, 24));
  return [...unique.values()]
    .sort((left, right) => scoreRawDisplayFact(right, options) - scoreRawDisplayFact(left, options))
    .slice(0, candidateLimit);
}

function buildRawFactCards(locale, facts, options = {}) {
  const subjectLabel = options.subjectLabel || 'Chart User';
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 12));
  const rankedFacts = selectRawDisplayFacts(facts, options);
  const intro = buildRawFactsIntro(locale, subjectLabel, rankedFacts, options.intro || null);
  const blocks = [intro];

  const usableFacts = [];
  rankedFacts.forEach((fact) => {
    if (usableFacts.length >= limit) {
      return;
    }

    const lines = isMonthlyTransitFact(fact)
      ? buildTransitFactLines(locale, fact)
      : buildNatalFactLines(locale, fact);

    if (lines.length === 0 || !String(lines[0] || '').trim()) {
      return;
    }

    usableFacts.push(lines);
  });

  usableFacts.forEach((lines, index) => {
    blocks.push([`${index + 1}. ${lines[0]}`, ...lines.slice(1)].join('\n'));
  });

  if (blocks.length === 1) {
    blocks.push(formatRawLabel(locale, {
      en: 'No usable raw facts were found.',
      fr: 'Aucun fait brut exploitable n’a été trouvé.',
      de: 'Es wurden keine brauchbaren Rohfakten gefunden.',
      es: 'No se encontraron hechos brutos utilizables.'
    }));
  }

  return normalizeRawPresentationText(blocks.join('\n\n'));
}

function buildMonthlyTransitOverviewTitle(locale, subjectProfile, itemCount, cacheMonth, responseMode = 'raw') {
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const modeAwareLabel = responseMode === 'raw'
    ? {
        en: `Top ${itemCount} major monthly transits for ${subject}`,
        fr: `Top ${itemCount} des transits majeurs du mois pour ${subject}`,
        de: `Top ${itemCount} der wichtigsten Monatstransite für ${subject}`,
        es: `Top ${itemCount} de los tránsitos mayores del mes para ${subject}`
      }
    : {
        en: `Top ${itemCount} major monthly transits for ${subject}`,
        fr: `Top ${itemCount} des transits majeurs du mois pour ${subject}`,
        de: `Top ${itemCount} der wichtigsten Monatstransite für ${subject}`,
        es: `Top ${itemCount} de los tránsitos mayores del mes para ${subject}`
      };

  const base = formatRawLabel(locale, modeAwareLabel);
  return cacheMonth ? `${base} — ${cacheMonth}` : base;
}

function buildTransitOverviewTitle(locale, subjectProfile, itemCount, options = {}) {
  const timeframe = String(options.timeframe || '').toLowerCase();
  if (timeframe === 'current_day' || timeframe === 'current_week') {
    return buildTransitTimeframeTitle(locale, subjectProfile, itemCount, options);
  }
  return buildMonthlyTransitOverviewTitle(
    locale,
    subjectProfile,
    itemCount,
    options.cacheMonth,
    options.responseMode || 'raw'
  );
}

function buildMonthlyTransitOverviewFromFacts(locale, facts, subjectProfile, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 200));
  const rows = selectTopMonthlyTransitFacts(facts, limit, options);
  if (rows.length === 0) {
    return null;
  }

  const cacheMonth = rows[0]?.cacheMonth || rows[0]?.cache_month || null;
  const usableRows = rows
    .map((fact) => buildTransitFactLines(locale, fact))
    .filter((lines) => lines.length > 0 && String(lines[0] || '').trim());

  if (usableRows.length === 0) {
    return null;
  }

  const title = options.title || buildTransitOverviewTitle(locale, subjectProfile, usableRows.length, {
    cacheMonth,
    timeframe: options.timeframe,
    timezone: options.timezone,
    responseMode: options.responseMode || 'raw'
  });
  const blocks = [title];

  usableRows.forEach((lines, index) => {
    blocks.push([`${index + 1}. ${lines[0]}`, ...lines.slice(1)].join('\n'));
  });

  if (options.includeFollowUp !== false) {
    blocks.push(buildMonthlyTransitFollowUpPrompt(locale));
  }
  return normalizeRawPresentationText(blocks.join('\n\n'));
}

function buildMonthlyTransitOverviewFromTimeline(locale, transits, subjectProfile, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 200));
  const filteredTransits = options.requestedPlanet
    ? asArray(transits).filter((transit) => matchesTransitPlanetFilter(transit, options.requestedPlanet, options.strictPlanetMatch))
    : asArray(transits);
  const rows = selectTopMonthlyTimelineEntries(filteredTransits, limit, options);
  if (rows.length === 0) {
    return null;
  }

  const cacheMonth = formatScalarValue(options.cacheMonth || null);
  const renderedRows = rows
    .map((transit) => buildTransitTimelineEntryLines(locale, transit))
    .filter(Boolean);

  if (renderedRows.length === 0) {
    return null;
  }

  const title = options.title || buildTransitOverviewTitle(locale, subjectProfile, renderedRows.length, {
    cacheMonth,
    timeframe: options.timeframe,
    timezone: options.timezone,
    responseMode: options.responseMode || 'raw'
  });
  const blocks = [title];

  renderedRows.forEach((block, index) => {
    const lines = block.split('\n');
    blocks.push([`${index + 1}. ${lines[0]}`, ...lines.slice(1)].join('\n'));
  });

  if (options.includeFollowUp !== false) {
    blocks.push(buildMonthlyTransitFollowUpPrompt(locale));
  }
  return normalizeRawPresentationText(blocks.join('\n\n'));
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fitCell(value, width) {
  const text = formatScalarValue(value) || '';
  const shortened = text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;
  return shortened.padEnd(width, ' ');
}

function buildRawTransitTable(locale, facts, subjectProfile, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 10));
  const rows = selectTopMonthlyTransitFacts(facts, limit, { ...options, limit });

  if (rows.length === 0) {
    return null;
  }

  const cacheMonth = rows[0]?.cacheMonth || rows[0]?.cache_month || null;
  const title = buildTransitOverviewTitle(locale, subjectProfile, rows.length, {
    cacheMonth,
    timeframe: options.timeframe,
    timezone: options.timezone,
    responseMode: 'raw'
  });

  const header = `${fitCell('#', 2)} ${fitCell('Transit', 24)} ${fitCell('Window', 23)} ${fitCell('Peak', 16)} ${fitCell('Focus', 18)}`;
  const divider = `${'-'.repeat(2)} ${'-'.repeat(24)} ${'-'.repeat(23)} ${'-'.repeat(16)} ${'-'.repeat(18)}`;
  const body = rows.map((fact, index) => {
    const { evidence } = getRawFactCore(fact);
    const focus = [
      evidence.transitPlanet || evidence.transit_planet,
      evidence.aspectType || evidence.aspect_type ? humanizeRawKey(evidence.aspectType || evidence.aspect_type) : null,
      evidence.natalPoint || evidence.natal_point
    ]
      .map((item) => {
        const rendered = formatScalarValue(item);
        return rendered ? humanizeRawKey(rendered) : null;
      })
      .filter(Boolean)
      .join(' ');

    return [
      fitCell(String(index + 1), 2),
      fitCell(normalizeRawTitle(fact.title) || '', 24),
      fitCell(formatRawDateWindow(evidence.startDatetime || evidence.start_datetime, evidence.endDatetime || evidence.end_datetime)
        || ((evidence.visibleStartDay || evidence.visibleEndDay || evidence.visible_start_day || evidence.visible_end_day)
          ? `${evidence.visibleStartDay || evidence.visible_start_day || '?'}→${evidence.visibleEndDay || evidence.visible_end_day || '?'}`
          : (fact.cacheMonth || fact.cache_month || '')), 23),
      fitCell(formatRawDate(evidence.peakDatetime || evidence.peak_datetime)
        || normalizeRawList(evidence.exactDatetimes || evidence.exact_datetimes, formatRawDate)[0]
        || normalizeRawList(evidence.exactHitsInMonth || evidence.exact_hits_in_month, formatScalarValue).join(', '), 16),
      fitCell(focus || normalizeRawList(evidence.houses, (value) => humanizeRawKey(formatScalarValue(value))).join(', '), 18)
    ].join(' ');
  });

  const note = options.includeFollowUp === false ? '' : `\n\n${escapeTelegramHtml(buildMonthlyTransitFollowUpPrompt(locale))}`;
  return `<pre>${escapeTelegramHtml([title, '', header, divider, ...body].join('\n'))}</pre>${note}`;
}

function collectRawToolSections(value, prefix = '', depth = 0) {
  if (depth > 2 || value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 5)
      .flatMap((item, index) => collectRawToolSections(item, prefix ? `${prefix} ${index + 1}` : `${index + 1}`, depth + 1));
  }

  if (typeof value !== 'object') {
    const rendered = formatScalarValue(value);
    return rendered && prefix ? [[prefix, rendered]] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const label = prefix ? `${prefix} • ${sentenceCase(String(key).replace(/_/g, ' ')).replace(/[.!?]$/, '')}` : sentenceCase(String(key).replace(/_/g, ' ')).replace(/[.!?]$/, '');
    if (child === null || child === undefined || child === '') {
      return [];
    }

    if (typeof child !== 'object') {
      const rendered = formatScalarValue(child);
      return rendered ? [[label, rendered]] : [];
    }

    if (Array.isArray(child) && child.every((item) => typeof item !== 'object')) {
      const rendered = child.map(formatScalarValue).filter(Boolean).join(', ');
      return rendered ? [[label, rendered]] : [];
    }

    return collectRawToolSections(child, label, depth + 1);
  });
}

function isTransitTimelineToolName(toolName) {
  const value = String(toolName || '');
  return value === 'get_cached_monthly_transits' || /western_transits_timeline/i.test(value);
}

function isTransitSearchToolName(toolName) {
  return /western_transits_search/i.test(String(toolName || ''));
}

function buildRawToolResultText(locale, toolName, result, options = {}) {
  const subjectProfile = options.subjectProfile || null;
  const userText = options.userText || '';
  const toolCallResult = options.toolCallResult || null;

  const structuredPayload = extractStructuredToolPayload(result);
  if (toolName === 'v1_western_astrocartography_recommendations' && structuredPayload) {
    return buildRelocationRawResponse(locale, structuredPayload, subjectProfile, userText);
  }
  if (toolName === 'v1_western_astrocartography_city_check' && structuredPayload) {
    return buildRelocationCityCheckRawResponse(locale, structuredPayload, subjectProfile, userText);
  }
  if (toolName === 'v1_western_progressions_secondary' && structuredPayload) {
    return buildSecondaryProgressionsRawResponse(locale, structuredPayload, subjectProfile);
  }
  if (toolName === 'v1_western_profections_annual' && structuredPayload) {
    return buildAnnualProfectionsRawResponse(locale, structuredPayload, subjectProfile);
  }
  if (toolName === 'v1_western_solar_calculate' && structuredPayload) {
    return buildSolarReturnRawResponse(locale, structuredPayload, subjectProfile);
  }
  if (toolName === 'v1_ephemeris' && structuredPayload) {
    return buildEphemerisRawResponse(locale, structuredPayload, subjectProfile);
  }
  if ((toolName === 'v1_horoscope_daily_personal' || toolName === 'v2_horoscope_daily_personal' || toolName === 'v1_horoscope_daily_sign') && structuredPayload) {
    return buildHoroscopeRawResponse(locale, structuredPayload, subjectProfile);
  }
  if ((toolName === 'v1_western_synastry_summary' || toolName === 'v1_western_synastry' || toolName === 'v1_western_synastry_horoscope')) {
    const synastryPayload = extractSynastryPayload({
      ...(toolCallResult || {}),
      args: toolCallResult?.args || options.args || null,
      result,
      userText
    });
    if (synastryPayload) {
      if (!synastryPayload.__personBName) {
        synastryPayload.__personBName = extractPartnerNameFromQuestion(userText);
      }
      return buildSynastryRawResponse(locale, synastryPayload, subjectProfile);
    }
  }

  if (toolName === 'get_cached_house_info' && result?.house) {
    const house = result.house;
    const lines = [
      `${formatRawLabel(locale, { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' })} ${formatScalarValue(house.house || house.name || '?')}`,
      `${formatRawLabel(locale, { en: 'Sign', fr: 'Signe', de: 'Zeichen', es: 'Signo' })}: ${humanizeRawKey(house.sign_id || house.sign || '')}`
    ];

    if (formatScalarValue(house.pos)) {
      lines.push(`${formatRawLabel(locale, { en: 'Degree', fr: 'Degré', de: 'Grad', es: 'Grado' })}: ${formatScalarValue(house.pos)}`);
    }

    return normalizeRawPresentationText(lines.join('\n'));
  }

  if (toolName === 'get_cached_major_aspects' && Array.isArray(result?.aspects)) {
    const lines = result.aspects
      .slice(0, 5)
      .map((aspect) => formatAspectLine(locale, aspect))
      .filter(Boolean);

    return normalizeRawPresentationText([
      localizeRawSectionTitle(locale, 'aspects'),
      ...(lines.length > 0 ? lines : [formatRawLabel(locale, {
        en: 'No cached major aspects are available.',
        fr: 'Aucun aspect majeur en cache n’est disponible.',
        de: 'Keine zwischengespeicherten Hauptaspekte verfügbar.',
        es: 'No hay aspectos mayores en caché disponibles.'
      })])
    ].join('\n'));
  }

  const timelinePayload = isTransitTimelineToolName(toolName)
    ? extractTransitTimelinePayload(result)
    : null;

  if (
    (toolName === 'get_cached_monthly_transits' && result?.available && Array.isArray(timelinePayload?.transits)) ||
    (isTransitTimelineToolName(toolName) && Array.isArray(timelinePayload?.transits))
  ) {
    const title = formatRawLabel(locale, {
      en: isTransitTimelineToolName(toolName) && toolName !== 'get_cached_monthly_transits' ? 'Monthly transits' : 'Monthly transit timeline',
      fr: isTransitTimelineToolName(toolName) && toolName !== 'get_cached_monthly_transits' ? 'Transits du mois' : 'Timeline des transits du mois',
      de: isTransitTimelineToolName(toolName) && toolName !== 'get_cached_monthly_transits' ? 'Monatliche Transite' : 'Monatliche Transit-Timeline',
      es: isTransitTimelineToolName(toolName) && toolName !== 'get_cached_monthly_transits' ? 'Tránsitos del mes' : 'Cronología mensual de tránsitos'
    });
    const month = formatScalarValue(result.cacheMonth || result?.structuredContent?.meta?.cache_month || result?.structuredContent?.meta?.month);
    const rows = timelinePayload.transits.slice(0, toolName === 'v1_western_transits_timeline' ? 10 : 5).map((transit) => {
      const lines = [normalizeRawTitle(transit.label) || 'Transit'];
      const windowText = formatRawDateWindow(transit.start_datetime, transit.end_datetime);
      const exactHits = normalizeRawList(transit.exact_datetimes, formatRawDate);
      const focus = [transit.transit_planet, transit.aspect_type ? humanizeRawKey(transit.aspect_type) : null, transit.natal_point]
        .map((item) => {
          const rendered = formatScalarValue(item);
          return rendered ? humanizeRawKey(rendered) : null;
        })
        .filter(Boolean)
        .join(' ');

      if (windowText) {
        lines.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${windowText}`);
      }

      if (exactHits.length > 0) {
        lines.push(`${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${exactHits.slice(0, 2).join(', ')}`);
      }

      if (focus) {
        lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${focus}`);
      }

      return lines.join('\n');
    });

    return normalizeRawPresentationText([
      month ? `${title} — ${month}` : title,
      ...rows,
      ...(toolName !== 'get_cached_monthly_transits' ? [buildMonthlyTransitFollowUpPrompt(locale)] : [])
    ].join('\n\n'));
  }

  const transitSearchPayload = isTransitSearchToolName(toolName)
    ? extractTransitSearchPayload(result)
    : null;
  if (transitSearchPayload) {
    return buildTransitSearchRawResponse(locale, transitSearchPayload, null);
  }

  const title = sentenceCase(toolName.replace(/^mcp_/, '').replace(/^v1_/, '').replace(/_/g, ' ')).replace(/[.!?]$/, '');
  const sections = collectRawToolSections(result).slice(0, 12);
  const lines = [title];

  if (sections.length === 0) {
    lines.push(formatRawLabel(locale, {
      en: 'No structured result fields were returned.',
      fr: 'Aucun champ structuré n’a été renvoyé.',
      de: 'Es wurden keine strukturierten Ergebnisfelder zurückgegeben.',
      es: 'No se devolvieron campos estructurados.'
    }));
  } else {
    sections.forEach(([label, value]) => {
      lines.push(`${label}: ${value}`);
    });
  }

  return lines.join('\n');
}

function buildRawToolLoopResponse(locale, subjectProfile, toolResults = [], options = {}) {
  const subjectLabel = subjectProfile?.profileName || 'Chart User';
  const intro = formatRawLabel(locale, {
    en: `Grounded results for ${getRawSubjectLabel(locale, subjectLabel)}`,
    fr: `Résultats factuels pour ${getRawSubjectLabel(locale, subjectLabel)}`,
    de: `Faktische Resultate für ${getRawSubjectLabel(locale, subjectLabel)}`,
    es: `Resultados factuales para ${getRawSubjectLabel(locale, subjectLabel)}`
  });

  const hasIndexedFacts = toolResults.some((tool) => (
    tool?.name === 'search_cached_profile_facts' &&
    Array.isArray(tool?.result?.facts) &&
    tool.result.facts.length > 0
  ));
  const hasMcpToolResults = toolResults.some((tool) => mcpService.isMcpTool(tool?.name));
  const hasTransitSearchResult = toolResults.some((tool) => isTransitSearchToolName(tool?.name));
  const hasTransitTimelineResult = toolResults.some((tool) => isTransitTimelineToolName(tool?.name));

  const sections = toolResults
    .filter((tool) => tool?.result && !tool.result?.error)
    .filter((tool) => !(tool.name === 'get_cached_monthly_transits' && tool.result?.available === false))
    .filter((tool) => !(hasIndexedFacts && tool.name === 'get_cached_monthly_transits'))
    .filter((tool) => !(hasMcpToolResults && (tool.name === 'get_profile_completeness' || tool.name === 'get_cached_natal_summary')))
    .filter((tool) => !((hasTransitSearchResult || hasTransitTimelineResult) && tool.name === 'get_cached_natal_summary'))
    .map((tool) => {
      if (tool.name === 'search_cached_profile_facts' && Array.isArray(tool.result?.facts)) {
        const broadNatalRaw = (
          subjectProfile?.rawNatalPayload &&
          tool.result.facts.some((fact) => (fact.source_kind || fact.sourceKind) === factIndex.NATAL_SOURCE_KIND) &&
          tool.result.facts.every((fact) => (fact.source_kind || fact.sourceKind) !== factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
        );

        if (broadNatalRaw) {
          if (options.channel === 'telegram') {
            const textParts = splitTelegramHtmlSections(buildTelegramRawNatalOverviewHtml(locale, subjectProfile, tool.result.facts, {
              subjectLabel,
              userText: options.userText || tool.result?.questionText || '',
              limit: 5
            }));
            return {
              kind: 'telegram_html',
              text: textParts[0] || '',
              textParts
            };
          }

          return {
            kind: 'plain',
            text: buildRawNatalOverview(locale, subjectProfile, tool.result.facts, {
              subjectLabel,
              userText: options.userText || tool.result?.questionText || '',
              limit: 5
            })
          };
        }

        return {
          kind: 'plain',
          text: buildRawFactCards(locale, tool.result.facts, {
            subjectLabel,
            userText: options.userText || tool.result?.questionText || '',
            subjectProfile,
            limit: 5
          })
        };
      }

      const rendered = buildRawToolResultText(locale, tool.name, tool.result, {
        subjectProfile,
        userText: options.userText || tool.result?.questionText || '',
        toolCallResult: tool,
        args: tool.args || null
      });
      if (rendered && typeof rendered === 'object') {
        return {
          kind: rendered.renderMode === 'telegram_html' ? 'telegram_html' : 'plain',
          text: rendered.text || '',
          textParts: Array.isArray(rendered.textParts) ? rendered.textParts : undefined
        };
      }
      return {
        kind: 'plain',
        text: rendered
      };
    })
    .filter(Boolean);

  if (sections.length === 0) {
    return {
      text: normalizeRawPresentationText([
      intro,
      formatRawLabel(locale, {
        en: 'No grounded raw result is available for this question.',
        fr: 'Aucun résultat brut fondé n’est disponible pour cette question.',
        de: 'Für diese Frage ist kein belastbares Rohresultat verfügbar.',
        es: 'No hay un resultado bruto fundamentado disponible para esta pregunta.'
      })
      ].join('\n\n')),
      renderMode: 'plain',
      textParts: undefined
    };
  }

  const telegramHtmlSection = sections.find((section) => section?.kind === 'telegram_html');
  if (telegramHtmlSection) {
    return {
      text: telegramHtmlSection.text,
      textParts: telegramHtmlSection.textParts,
      renderMode: 'telegram_html'
    };
  }

  const multipartSection = sections.find((section) => Array.isArray(section?.textParts) && section.textParts.length > 1);
  if (multipartSection) {
    return {
      text: multipartSection.text,
      textParts: multipartSection.textParts,
      renderMode: 'plain'
    };
  }

  return {
    text: normalizeRawPresentationText([intro, ...sections.map((section) => section.text)].join('\n\n')),
    renderMode: 'plain',
    textParts: undefined
  };
}

function buildRawToolLoopAnswer(locale, subjectProfile, toolResults = [], options = {}) {
  return buildRawToolLoopResponse(locale, subjectProfile, toolResults, options).text;
}

function buildRawRelocationNeedsText(locale, subjectProfile) {
  const subject = getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User');
  const title = formatRawLabel(locale, {
    en: `Relocation inputs needed for ${subject}`,
    fr: `Paramètres de relocalisation requis pour ${subject}`,
    de: `Benötigte Relokationsangaben für ${subject}`,
    es: `Datos de relocalización necesarios para ${subject}`
  });

  const linesByLocale = {
    en: [
      title,
      'To return grounded relocation results, I need:',
      '1. Your main goal: career, love, home, health, creativity, or spiritual growth.',
      '2. One target city, or up to 3 cities/countries to compare.',
      '3. Optional timeframe if the move is tied to a specific month or year.'
    ],
    fr: [
      title,
      'Pour renvoyer des résultats de relocalisation fondés, il me faut :',
      '1. Votre objectif principal : carrière, amour, foyer, bien-être, créativité ou croissance spirituelle.',
      '2. Une ville cible, ou jusqu’à 3 villes/pays à comparer.',
      '3. Optionnel : la période visée si le déménagement dépend d’un mois ou d’une année précise.'
    ],
    de: [
      title,
      'Für belastbare Relokationsresultate brauche ich:',
      '1. Dein Hauptziel: Karriere, Liebe, Zuhause, Wohlbefinden, Kreativität oder spirituelles Wachstum.',
      '2. Eine Zielstadt oder bis zu 3 Städte/Länder zum Vergleich.',
      '3. Optional einen Zeitraum, falls der Umzug an einen bestimmten Monat oder ein Jahr gebunden ist.'
    ],
    es: [
      title,
      'Para devolver resultados de relocalización fundamentados, necesito:',
      '1. Tu objetivo principal: carrera, amor, hogar, bienestar, creatividad o crecimiento espiritual.',
      '2. Una ciudad objetivo, o hasta 3 ciudades/países para comparar.',
      '3. Opcional: el periodo si la mudanza depende de un mes o año concreto.'
    ]
  };

  return normalizeRawPresentationText((linesByLocale[locale] || linesByLocale.en).join('\n'));
}

function needsRelocationInputs(userText) {
  const value = String(userText || '').toLowerCase();
  const hasGoal = /\bcareer\b|\bwork\b|\blove\b|\bhome\b|\bfamily\b|\bwellbeing\b|\bhealth\b|\bcreativity\b|\bspiritual\b|\bcarri[èe]re\b|\bamour\b|\bfoyer\b|\bfamille\b|\bsant[ée]\b|\bbien[- ]?[êe]tre\b|\bcr[ée]ativit[ée]\b|\bspirituel\b/i.test(value);
  const hasSpecificLocation = /\b(to|in|at|vers|à|a|en|au|aux)\s+[a-zà-ÿ' -]{2,}\b/i.test(value) && !/\b(world|monde|everywhere|partout)\b/i.test(value);
  const isOpenEndedWorldAsk = /\bwhere should i\b|\bo[uù]\b.*\bhabiter\b|\bo[uù]\b.*\bvivre\b|\bdans le monde\b|\bin the world\b/i.test(value);
  return isOpenEndedWorldAsk && !hasGoal && !hasSpecificLocation;
}

function summarizeFactTags(tags, limit = 5) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => !String(tag).startsWith('month:'))
    .filter((tag) => !['natal', 'monthly_transit', 'timing', 'theme'].includes(String(tag)))
    .slice(0, limit)
    .join(', ');
}

function buildDeterministicFactAnswer(userText, facts, intent, subjectProfile, answerStyle, options = {}) {
  if ((options.routeId || options.commonRouteId) === 'monthly_transits_for_planet') {
    const requestedPlanet = options.queryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(userText) || parsePlanetFromQuestion(userText);
    const requestedLimit = options.queryState?.parameters?.limit || getRequestedListingLimit(userText, 'monthly_transits_for_planet', 200);
    return buildMonthlyTransitOverviewFromFacts(options.locale || 'en', facts, subjectProfile, {
      userText,
      responseMode: 'interpreted',
      limit: requestedLimit,
      includeFollowUp: false,
      requestedPlanet,
      strictPlanetMatch: Boolean(requestedPlanet),
      timeframe: options.queryState?.parameters?.timeframe || null,
      timezone: subjectProfile?.timezone || 'UTC',
      title: requestedPlanet
        ? formatRawLabel(options.locale || 'en', {
            en: `${humanizeRawKey(requestedPlanet)} monthly transits for ${getRawSubjectLabel(options.locale || 'en', subjectProfile?.profileName || 'Chart User')}`,
            fr: `Transits mensuels liés à ${humanizeRawKey(requestedPlanet)} pour ${getRawSubjectLabel(options.locale || 'fr', subjectProfile?.profileName || 'Chart User')}`,
            de: `Monatstransite zu ${humanizeRawKey(requestedPlanet)} für ${getRawSubjectLabel(options.locale || 'de', subjectProfile?.profileName || 'Chart User')}`,
            es: `Tránsitos mensuales relacionados con ${humanizeRawKey(requestedPlanet)} para ${getRawSubjectLabel(options.locale || 'es', subjectProfile?.profileName || 'Chart User')}`
          })
        : null
    }) || '';
  }

  if (isTopMonthlyTransitRoute(options.commonRouteId || options.routeId)) {
    const requestedLimit = options.queryState?.parameters?.limit || getRequestedListingLimit(userText, 'month_ahead_transits', 10);
    return buildMonthlyTransitOverviewFromFacts(options.locale || 'en', facts, subjectProfile, {
      userText,
      responseMode: 'interpreted',
      limit: requestedLimit,
      requestedPlanet: options.queryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(userText),
      strictPlanetMatch: Boolean(options.queryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(userText)),
      timeframe: options.queryState?.parameters?.timeframe || null,
      timezone: subjectProfile?.timezone || 'UTC'
    }) || '';
  }

  const selectedFacts = Array.isArray(facts) ? facts.slice(0, 4) : [];
  if (selectedFacts.length === 0) {
    return '';
  }

  const label = subjectProfile?.profileName || 'your chart';
  const intro = answerStyle === 'current_sky'
    ? `For ${label}, the current sky is dominated by these active dynamics.`
    : intent.id === 'transits'
      ? `For ${label}, the current transit picture is led by these active themes.`
      : `For ${label}, the clearest answer comes from these chart factors.`;

  const body = selectedFacts
    .map((fact) => sentenceCase(fact.factText))
    .join(' ');

  const closing = intent.id === 'transits'
    ? 'This is the strongest current emphasis in the indexed monthly transit data.'
    : `That is the strongest pattern connected to your question: "${String(userText || '').trim()}".`;

  return normalizeAssistantText([intro, body, closing].join('\n\n'));
}

function buildFactRewritePrompt(userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective) {
  const factLines = facts.slice(0, 4).map((fact, index) => {
    const parts = [
      `${index + 1}. Title: ${fact.title || 'Untitled fact'}`,
      `Evidence: ${fact.factText}`
    ].filter(Boolean);

    return parts.join('\n');
  });

  return [
    `Profile: ${subjectProfile?.profileName || 'Chart User'}`,
    `Intent: ${intent.id}`,
    `Answer style: ${answerStyle}`,
    `Response perspective: ${responsePerspective}`,
    `Question: ${String(userText || '').trim()}`,
    '',
    'Grounded facts:',
    ...factLines,
    '',
    'Fallback draft:',
    draftAnswer
  ].join('\n');
}

async function maybeRewriteFactAnswer(locale, userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective) {
  if (!draftAnswer) {
    return draftAnswer;
  }

  const isTransitReading = (
    intent.id === 'transits' ||
    facts.some((fact) => fact.sourceKind === factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
  );

  const sharedInstructions = [
    'You are a top-quality professional astrologer.',
    'Write a short astrology answer from grounded facts only.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Use plain text only.',
    'Answer like a real astrologer speaking to a client, not like a database or analyst.',
    'Translate metadata and evidence into natural astrological language.',
    'Do not expose labels such as category, kind, subjects, tags, source, or metadata.',
    'Do not list raw taxonomy terms unless they are naturally readable astrology terms.',
    'Do not add any new facts, timings, placements, or interpretations.',
    'Answer the user question directly in the first sentence.',
    'Base the answer on the strongest 2 or 3 grounded factors, not an exhaustive list.',
    'Avoid repetitive phrasing and avoid sounding mechanical.',
    'Keep it to 2 or 3 short paragraphs.'
  ];

  if (responsePerspective === 'third_person') {
    sharedInstructions.push(
      `Refer to ${subjectProfile?.profileName || 'the person'} by name or as he/she/they, not as you/your.`,
      'Do not write as if you are speaking directly to the chart owner in second person.'
    );
  }

  const natalInstructions = [
    'Interpret this as a natal reading.',
    'Lead with the core relationship, personality, emotional, or life-pattern theme that best answers the question.',
    'Show how the strongest chart factors work together instead of listing them separately.',
    'Translate the chart into lived tendencies, emotional patterns, needs, fears, strengths, or behavior.',
    'When helpful, mention the tension or balance between two factors and how that plays out in real life.',
    'Keep the tone insightful, personal, and psychologically accurate.',
    'Do not make rare signatures the main angle unless the question explicitly asks about rare signatures or the grounded facts clearly make them dominant.'
  ];

  const transitInstructions = [
    'Interpret this as a transit or current-sky reading.',
    'Lead with the dominant atmosphere of the moment.',
    'Explain the 2 or 3 most important active influences and what they are emphasizing now.',
    'Describe what is building, peaking, shifting, or pressuring the period.',
    'Connect the sky to lived experience in the present tense.',
    'If both collective sky patterns and personal transits appear in the facts, start with the sky atmosphere and then narrow into the personal impact.',
    'Keep the tone timely, dynamic, and present-focused.'
  ];

  const styleInstructions = {
    natal_theme: [
      'Structure the answer around 2 or 3 major natal axes only.',
      'Open with the main defining theme, then add the strongest supporting pattern.'
    ],
    planet_focus: [
      'Focus first on the planet itself, then on its sign, house, and lived expression.',
      'Do not drift into a full chart summary.'
    ],
    house_focus: [
      'Structure the answer as: house topic, ruler or strongest house factor, then lived impact.',
      'Do not reduce the answer to a generic planet-in-house reading.'
    ],
    aspect_focus: [
      'Name the main aspect dynamic first, then explain how it affects personality or behavior.',
      'Keep the answer centered on one dominant aspect pattern.'
    ],
    life_area_theme: [
      'Prioritize the life area named in the question and rank the strongest 2 or 3 factors.',
      'Avoid cataloguing signatures without linking them to lived experience.'
    ],
    current_sky: [
      'Start with the dominant atmosphere of the sky today.',
      'Then narrow into the most relevant personal activation if one is clearly present.'
    ],
    personal_transits: [
      'Start with the dominant personal transit of the day or period.',
      'Add at most two secondary activations and one short practical takeaway.'
    ],
    synastry: [
      'Write as a comparison between two people, naming the dynamic clearly and directly.',
      'Do not answer as if only one chart existed.'
    ]
  };

  const systemInstruction = [
    ...sharedInstructions,
    ...(isTransitReading ? transitInstructions : natalInstructions),
    ...(styleInstructions[answerStyle] || [])
  ].join('\n');

  const rewritten = await generatePlainText({
    systemInstruction,
    userText: buildFactRewritePrompt(userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective),
    history: [],
    model: getFastPathModelName()
  });

  return normalizeAssistantText(rewritten || draftAnswer);
}

async function tryFactFastPath(identity, userText, intent, subjectProfile, factAvailability, locale, plannedRoute = null, options = {}) {
  if (!hasIndexedCoverage(factAvailability)) {
    return null;
  }

  const startedAt = performance.now();
  const rawMode = options.responseMode === 'raw';
  const transitBiased = isTransitBiasedQuestion(userText)
    || plannedRoute?.sourceKinds?.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND);
  let searchInput = plannedRoute && plannedRoute.target === 'indexed_facts'
    ? {
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null,
        sourceKinds: Array.isArray(plannedRoute.sourceKinds) && plannedRoute.sourceKinds.length > 0
          ? plannedRoute.sourceKinds
          : buildFactSearchInput(intent, userText, subjectProfile, factAvailability).sourceKinds,
        categories: Array.isArray(plannedRoute.categories) ? plannedRoute.categories : [],
        tags: Array.isArray(plannedRoute.tags) ? plannedRoute.tags : [],
        cacheMonth: plannedRoute.sourceKinds?.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
          ? (plannedRoute.cacheMonth || factAvailability?.indexedTransitCacheMonth || null)
          : null,
        limit: plannedRoute.limit || 4
      }
    : buildFactSearchInput(intent, userText, subjectProfile, factAvailability);
  let facts = await factIndex.searchFacts(identity, searchInput);

  if (facts.length < 2 && searchInput.tags.length > 0) {
    facts = await factIndex.searchFacts(identity, {
      ...searchInput,
      tags: [],
      limit: intent.id === 'transits' ? 5 : 4
    });
  }

  const needsPlannedSearch = !plannedRoute && (facts.length < 2 || intent.id === 'fallback');
  if (needsPlannedSearch) {
    try {
      const plannedSearchInput = await planFactSearchQuery(locale, userText, intent, subjectProfile, factAvailability);
      if (plannedSearchInput) {
        const normalizedPlannedInput = {
          ...plannedSearchInput,
          cacheMonth: plannedSearchInput.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
            ? (plannedSearchInput.cacheMonth || factAvailability?.indexedTransitCacheMonth || null)
            : null
        };
        let selectedPlannedInput = normalizedPlannedInput;
        let plannedFacts = await factIndex.searchFacts(identity, normalizedPlannedInput);

        if (plannedFacts.length < 2) {
          const relaxedPlannedInput = {
            ...normalizedPlannedInput,
            categories: [],
            tags: normalizedPlannedInput.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
              ? ['current']
              : [],
            limit: normalizedPlannedInput.limit
          };
          const relaxedFacts = await factIndex.searchFacts(identity, relaxedPlannedInput);
          if (relaxedFacts.length > plannedFacts.length) {
            plannedFacts = relaxedFacts;
            selectedPlannedInput = relaxedPlannedInput;
          }
        }

        if (plannedFacts.length >= Math.max(2, facts.length)) {
          searchInput = selectedPlannedInput;
          facts = plannedFacts;
        }
      }
    } catch (error) {
      info('conversation fact search planner failed', {
        stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
        intent: intent.id,
        error: error.message || 'unknown'
      });
    }
  }

  if (facts.length < 2 && transitBiased && factAvailability?.indexedTransitCacheMonth) {
    const broadTransitInput = {
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: factAvailability.indexedTransitCacheMonth,
      limit: 5
    };
    const broadTransitFacts = await factIndex.searchFacts(identity, broadTransitInput);
    if (broadTransitFacts.length > facts.length) {
      searchInput = broadTransitInput;
      facts = broadTransitFacts;
    }
  }

  const requestedMonthlyPlanet = options.queryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(userText);
  if (requestedMonthlyPlanet && searchInput.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)) {
    const filterFactsByRequestedPlanet = (candidateFacts) => candidateFacts.filter((fact) => {
      const { evidence } = getRawFactCore(fact);
      return matchesTransitPlanetFilter({
        transit_planet: evidence.transitPlanet || evidence.transit_planet,
        natal_point: evidence.natalPoint || evidence.natal_point,
        label: normalizeRawTitle(fact.title) || ''
      }, requestedMonthlyPlanet);
    });
    const filteredFacts = filterFactsByRequestedPlanet(facts);

    if (filteredFacts.length > 0) {
      facts = filteredFacts;
    } else {
      const targetedSearchInputs = [
        {
          ...searchInput,
          tags: [`planet:${requestedMonthlyPlanet}`],
          limit: 30
        },
        {
          ...searchInput,
          tags: [`point:${requestedMonthlyPlanet}`],
          limit: 30
        },
        {
          ...searchInput,
          tags: [requestedMonthlyPlanet],
          limit: 30
        }
      ];
      const targetedFacts = [];
      const seenFactKeys = new Set();

      for (const targetedInput of targetedSearchInputs) {
        const candidateFacts = await factIndex.searchFacts(identity, targetedInput);
        for (const fact of candidateFacts) {
          if (seenFactKeys.has(fact.factKey)) {
            continue;
          }
          seenFactKeys.add(fact.factKey);
          targetedFacts.push(fact);
        }
      }

      const targetedFilteredFacts = filterFactsByRequestedPlanet(targetedFacts);
      if (targetedFilteredFacts.length > 0) {
        searchInput = {
          ...searchInput,
          tags: []
        };
        facts = targetedFilteredFacts;
      }
    }
  }

  if (
    rawMode &&
    searchInput.sourceKinds.includes(factIndex.NATAL_SOURCE_KIND) &&
    isBroadRawNatalQuestion(userText, plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText)) &&
    (
      countConcreteRawNatalFacts(facts) < 5 ||
      countUsableRawCards(locale, facts, {
        userText,
        answerStyle: plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText),
        limit: 5
      }) < 5
    )
  ) {
    const broadNatalInput = {
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.NATAL_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: null,
      limit: 12
    };
    const broadNatalFacts = await factIndex.searchFacts(identity, broadNatalInput);
    const currentConcreteCount = countConcreteRawNatalFacts(facts);
    const broadConcreteCount = countConcreteRawNatalFacts(broadNatalFacts);
    const currentUsableCount = countUsableRawCards(locale, facts, {
      userText,
      answerStyle: plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText),
      limit: 5
    });
    const broadUsableCount = countUsableRawCards(locale, broadNatalFacts, {
      userText,
      answerStyle: plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText),
      limit: 5
    });
    if (
      broadConcreteCount > currentConcreteCount ||
      broadUsableCount > currentUsableCount
    ) {
      searchInput = broadNatalInput;
      facts = broadNatalFacts;
    }
  }

  if (facts.length < 2) {
    return null;
  }

  const answerStyle = plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText);
  const topMonthlyTransitOverview = isMonthlyTransitListingRoute(plannedRoute);
  const transitTimeframe = options.queryState?.parameters?.timeframe
    || (/\b(today|aujourd'hui|aujourdhui|du jour|heute|hoy)\b/i.test(String(userText || '')) ? 'current_day' : null)
    || (/\b(this week|current week|for the week|de la semaine|cette semaine|semaine en cours|diese woche|esta semana)\b/i.test(String(userText || '')) ? 'current_week' : null);
  const requestedListingLimit = topMonthlyTransitOverview
    ? getRequestedListingLimit(userText, requestedMonthlyPlanet ? 'monthly_transits_for_planet' : 'month_ahead_transits', requestedMonthlyPlanet ? 200 : 10)
    : null;
  const structureFocusedRawNatal = (
    rawMode &&
    subjectProfile?.rawNatalPayload &&
    searchInput.sourceKinds.includes(factIndex.NATAL_SOURCE_KIND) &&
    isStructureFocusedRawNatalQuestion(userText)
  );
  const aspectFacts = (
    rawMode &&
    subjectProfile?.rawNatalPayload &&
    searchInput.sourceKinds.includes(factIndex.NATAL_SOURCE_KIND) &&
    isBroadRawNatalQuestion(userText, answerStyle) &&
    !structureFocusedRawNatal
  )
    ? await factIndex.searchFacts(identity, {
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null,
        sourceKinds: [factIndex.NATAL_SOURCE_KIND],
        categories: [],
        tags: ['kind:aspect'],
        cacheMonth: null,
        limit: 5
      })
    : [];
  const draftAnswer = rawMode
    ? (
        topMonthlyTransitOverview
          ? buildMonthlyTransitOverviewFromFacts(locale, facts, subjectProfile, {
              userText,
              answerStyle,
              responseMode: 'raw',
              limit: requestedListingLimit,
              includeFollowUp: !requestedMonthlyPlanet,
              requestedPlanet: requestedMonthlyPlanet,
              strictPlanetMatch: Boolean(requestedMonthlyPlanet),
              timeframe: transitTimeframe,
              timezone: subjectProfile?.timezone || 'UTC',
              title: requestedMonthlyPlanet
                ? formatRawLabel(locale, {
                    en: `${humanizeRawKey(requestedMonthlyPlanet)} monthly transits for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${factAvailability?.indexedTransitCacheMonth ? ` — ${factAvailability.indexedTransitCacheMonth}` : ''}`,
                    fr: `Transits mensuels liés à ${humanizeRawKey(requestedMonthlyPlanet)} pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${factAvailability?.indexedTransitCacheMonth ? ` — ${factAvailability.indexedTransitCacheMonth}` : ''}`,
                    de: `Monatstransite zu ${humanizeRawKey(requestedMonthlyPlanet)} für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${factAvailability?.indexedTransitCacheMonth ? ` — ${factAvailability.indexedTransitCacheMonth}` : ''}`,
                    es: `Tránsitos mensuales relacionados con ${humanizeRawKey(requestedMonthlyPlanet)} para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}${factAvailability?.indexedTransitCacheMonth ? ` — ${factAvailability.indexedTransitCacheMonth}` : ''}`
                  })
                : null
            })
          : (
              rawMode &&
              subjectProfile?.rawNatalPayload &&
              searchInput.sourceKinds.includes(factIndex.NATAL_SOURCE_KIND) &&
              (
                structureFocusedRawNatal
                  ? buildRawNatalStructuresOverview(locale, subjectProfile, facts, {
                      subjectLabel: subjectProfile?.profileName || 'Chart User',
                      userText,
                      answerStyle,
                      limit: 5
                    })
                  : isBroadRawNatalQuestion(userText, answerStyle)
                    ? buildRawNatalOverview(locale, subjectProfile, facts, {
                        subjectLabel: subjectProfile?.profileName || 'Chart User',
                        userText,
                        aspectFacts,
                        answerStyle,
                        limit: 5
                      })
                    : buildRawFactCards(locale, facts, {
                        subjectLabel: subjectProfile?.profileName || 'Chart User',
                        userText,
                        subjectProfile,
                        answerStyle,
                        limit: 5
                      })
              )
            )
      )
    : buildDeterministicFactAnswer(userText, facts, intent, subjectProfile, answerStyle, {
        locale,
        commonRouteId: plannedRoute?.commonRouteId || null,
        routeId: requestedMonthlyPlanet ? 'monthly_transits_for_planet' : null,
        queryState: options.queryState || null
      });
  if (!draftAnswer) {
    return null;
  }

  const telegramRawNatalHtmlSections = (
    rawMode &&
    identity?.channel === 'telegram' &&
    subjectProfile?.rawNatalPayload &&
    searchInput.sourceKinds.includes(factIndex.NATAL_SOURCE_KIND) &&
    (isBroadRawNatalQuestion(userText, answerStyle) || structureFocusedRawNatal)
  )
    ? (
        structureFocusedRawNatal
          ? buildTelegramRawNatalStructuresHtml(locale, subjectProfile, facts, {
              subjectLabel: subjectProfile?.profileName || 'Chart User',
              userText,
              answerStyle,
              limit: 5
            })
          : buildTelegramRawNatalOverviewHtml(locale, subjectProfile, facts, {
              subjectLabel: subjectProfile?.profileName || 'Chart User',
              userText,
              aspectFacts,
              answerStyle,
              limit: 5
            })
      )
    : null;
  const telegramRawNatalHtmlParts = telegramRawNatalHtmlSections
    ? splitTelegramHtmlSections(telegramRawNatalHtmlSections)
    : null;
  const telegramRawTransitTable = (
    rawMode &&
    topMonthlyTransitOverview &&
    identity?.channel === 'telegram'
  )
    ? buildRawTransitTable(locale, facts, subjectProfile, {
        limit: requestedListingLimit,
        includeFollowUp: !requestedMonthlyPlanet,
        userText,
        answerStyle,
        requestedPlanet: requestedMonthlyPlanet,
        strictPlanetMatch: Boolean(requestedMonthlyPlanet),
        timeframe: transitTimeframe,
        timezone: subjectProfile?.timezone || 'UTC'
      })
    : null;

  let rewrittenAnswer = draftAnswer;
  let rewriteDurationMs = 0;

  if (!rawMode && !topMonthlyTransitOverview) {
    try {
      const rewriteStartedAt = performance.now();
      rewrittenAnswer = await maybeRewriteFactAnswer(
        locale,
        userText,
        facts,
        intent,
        subjectProfile,
        draftAnswer,
        answerStyle,
        options.responsePerspective || 'second_person'
      );
      rewriteDurationMs = Math.round(performance.now() - rewriteStartedAt);
    } catch (error) {
      info('conversation fact fast-path rewrite failed', {
        stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
        intent: intent.id,
        error: error.message || 'unknown'
      });
    }
  }

  return {
    text: telegramRawTransitTable || telegramRawNatalHtmlParts?.[0] || rewrittenAnswer,
    textParts: telegramRawTransitTable ? undefined : (telegramRawNatalHtmlParts || undefined),
    renderMode: telegramRawTransitTable
      ? 'telegram_pre'
      : telegramRawNatalHtmlParts
      ? 'telegram_html'
      : (rawMode && intent.id === 'transits' ? 'telegram_pre' : 'plain'),
    usedTools: [{
      name: 'search_cached_profile_facts',
      args: searchInput,
      result: {
        available: true,
        facts: facts.map((fact) => ({
          category: fact.category,
          title: fact.title,
          tags: fact.tags,
          fact_text: fact.factText,
          fact_payload: fact.factPayload,
          source_kind: fact.sourceKind,
          cache_month: fact.cacheMonth
        }))
      }
    }],
    durationMs: Math.round(performance.now() - startedAt),
    rewriteDurationMs
  };
}

async function rewriteGroundedToolAnswer(locale, userText, draftText, toolResults, subjectProfile, options = {}) {
  const grounding = buildRawToolLoopAnswer(locale, subjectProfile, toolResults, {
    userText,
    channel: options.channel || null
  });

  if (!String(grounding || '').trim()) {
    return draftText;
  }

  const systemInstruction = [
    options.responseMode === 'raw'
      ? 'You filter and rewrite grounded astrology tool output into a factual user-facing answer.'
      : 'You rewrite grounded astrology tool output into a concise user-facing answer.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Use only the grounded tool data provided below.',
    'Do not invent any dates, placements, aspects, timings, cities, or meanings.',
    `Response perspective: ${options.responsePerspective || 'second_person'}.`,
    `Execution family: ${options.executionFamily || 'unknown'}.`,
    `Response mode: ${options.responseMode || 'interpreted'}.`,
    `Structured refinements: ${JSON.stringify(options.queryState?.parameters || {})}.`,
    'First apply the user-requested filters and scope to the grounded data.',
    'You may omit grounded items that do not match the user request.',
    'Do not introduce a planet, aspect type, city, timeframe, ranking, or filter that is not present in the user question or in the structured refinements.',
    'If the user asks a broad question, keep the answer broad. Do not narrow it to one planet or one subtype just because the first grounded rows happen to mention it.',
    options.responseMode === 'raw'
      ? 'Stay strictly factual. Do not interpret meaning. Prefer short titled sections or numbered factual lines.'
      : 'Keep the answer readable and concise.'
  ].join('\n');

  const prompt = [
    `User question: ${String(userText || '').trim()}`,
    '',
    'Grounded raw result:',
    String(grounding || '').slice(0, 12000),
    '',
    'Existing draft answer:',
    String(draftText || '').slice(0, 4000),
    '',
    'Rewrite the final user-facing answer now.'
  ].join('\n');

  try {
    return await generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: getFastPathModelName()
    });
  } catch (error) {
    info('grounded answer rewrite failed', {
      family: options.executionFamily || null,
      error: error?.message || String(error)
    });
    return draftText;
  }
}

function hasSemanticQueryRefinement(queryState = null) {
  const parameters = queryState?.parameters;
  if (!parameters || typeof parameters !== 'object') {
    return false;
  }

  return Boolean(
    parameters.planet ||
    parameters.transitPlanet ||
    parameters.natalPoint ||
    parameters.aspectClass ||
    parameters.focus ||
    parameters.body ||
    parameters.sign ||
    parameters.timeframe ||
    parameters.rangeStart ||
    parameters.rangeEnd ||
    parameters.month ||
    parameters.city ||
    parameters.limit ||
    parameters.fullListing ||
    (Array.isArray(parameters.aspectTypes) && parameters.aspectTypes.length > 0)
  );
}

function shouldUseAiGroundedFiltering(responseMode, executionIntent, queryState = null, toolResults = [], route = null) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) {
    return false;
  }

  const family = executionIntent?.family || null;
  const hasMcpResults = toolResults.some((tool) => mcpService.isMcpTool(tool?.name));
  const complexIndexedTransitFamily = family === 'indexed_monthly_transits';
  const exactTransitRoute = queryState?.canonicalRouteId === 'transit_search_exact' || route?.id === 'transit_search_exact';

  if (responseMode === 'raw') {
    return hasMcpResults || complexIndexedTransitFamily || exactTransitRoute || hasSemanticQueryRefinement(queryState);
  }

  return hasMcpResults || complexIndexedTransitFamily || exactTransitRoute;
}

async function maybeApplyAiGroundedFilter(locale, userText, draftText, toolResults, subjectProfile, options = {}) {
  if (!shouldUseAiGroundedFiltering(
    options.responseMode || 'interpreted',
    options.executionIntent || null,
    options.queryState || null,
    toolResults,
    options.route || null
  )) {
    return {
      text: draftText,
      usedAiFilter: false
    };
  }

  const rewritten = await rewriteGroundedToolAnswer(
    locale,
    userText,
    draftText,
    toolResults,
    subjectProfile,
    options
  );

  const normalized = String(rewritten || '').trim();
  if (!normalized) {
    return {
      text: draftText,
      usedAiFilter: false
    };
  }

  return {
    text: normalized,
    usedAiFilter: normalized !== String(draftText || '').trim()
  };
}

async function tryFullRawListing(identity, userText, subjectProfile, factAvailability, locale, requestKind, monthlyTransitCache = null, responseMode = 'raw', queryState = null) {
  if (requestKind === 'all_aspects') {
    const requestedPlanet = queryState?.parameters?.planet || parsePlanetFromQuestion(userText);
    const minorOnly = (queryState?.parameters?.aspectClass === 'minor') || wantsMinorAspects(userText);
    const requestedLimit = queryState?.parameters?.limit || null;
    const aspectFacts = await factIndex.searchFacts(identity, {
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.NATAL_SOURCE_KIND],
      categories: [],
      tags: ['kind:aspect'],
      cacheMonth: null,
      limit: 120
    });

    const filteredAspectFacts = requestedPlanet
      ? aspectFacts.filter((fact) => matchesNatalAspectPlanetFilter(fact, requestedPlanet))
      : aspectFacts;
    const indexedLines = filteredAspectFacts
      .map((fact) => formatAspectFactLine(locale, fact))
      .filter(Boolean);

    const normalizedProfile = normalizeNatalProfile(
      subjectProfile.rawNatalPayload,
      subjectProfile.cityLabel,
      { birthCountry: subjectProfile.birthCountry }
    );
    const fallbackAspectList = minorOnly
      ? buildNormalizedNatalAspects(subjectProfile.rawNatalPayload, false)
      : asArray(normalizedProfile.majorAspects);
    const fallbackLines = fallbackAspectList
      .filter((aspect) => matchesNatalAspectPlanetFilter(aspect, requestedPlanet))
      .map((aspect) => formatAspectLine(locale, aspect))
      .filter(Boolean);
    const lines = (!minorOnly && indexedLines.length > 0 ? indexedLines : fallbackLines)
      .slice(0, requestedLimit || undefined);

    if (lines.length === 0) {
      return {
        textParts: [normalizeRawPresentationText(formatRawLabel(locale, {
          en: `No ${minorOnly ? 'minor' : 'major'} aspects are available for ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`,
          fr: `Aucun aspect ${minorOnly ? 'mineur' : 'majeur'} n’est disponible pour ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`,
          de: `Keine ${minorOnly ? 'Neben' : 'Haupt'}aspekte für ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} verfügbar.`,
          es: `No hay aspectos ${minorOnly ? 'menores' : 'mayores'} disponibles para ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`
        }))],
        usedTools: !minorOnly && indexedLines.length > 0
          ? [{
              name: 'search_cached_profile_facts',
              args: {
                primaryProfileId: subjectProfile.profileId,
                secondaryProfileId: null,
                sourceKinds: [factIndex.NATAL_SOURCE_KIND],
                categories: [],
                tags: ['kind:aspect'],
                cacheMonth: null,
                limit: 120
              },
              result: {
                available: false,
                facts: []
              }
            }]
          : [{
              name: minorOnly ? 'get_cached_minor_aspects' : 'get_cached_major_aspects',
              args: { limit: 120 },
              result: { aspects: [] }
            }],
        renderMode: 'plain'
      };
    }

    const title = requestedPlanet
      ? formatRawLabel(locale, {
          en: `${minorOnly ? 'Minor' : 'Major'} aspects involving ${humanizeRawKey(requestedPlanet)} for ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          fr: `Aspects ${minorOnly ? 'mineurs' : 'majeurs'} impliquant ${humanizeRawKey(requestedPlanet)} pour ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          de: `${minorOnly ? 'Neben' : 'Haupt'}aspekte mit ${humanizeRawKey(requestedPlanet)} für ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          es: `Aspectos ${minorOnly ? 'menores' : 'mayores'} con ${humanizeRawKey(requestedPlanet)} para ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`
        })
      : formatRawLabel(locale, {
          en: `${minorOnly ? 'All minor aspects' : 'All major aspects'} for ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          fr: `${minorOnly ? 'Tous les aspects mineurs' : 'Tous les aspects majeurs'} pour ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          de: `${minorOnly ? 'Alle Nebenaspekte' : 'Alle Hauptaspekte'} für ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`,
          es: `${minorOnly ? 'Todos los aspectos menores' : 'Todos los aspectos mayores'} para ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} — ${lines.length}`
        });

    return {
      textParts: buildRawListingParts(
        locale,
        title,
        lines,
        { itemType: 'line', chunkSize: 18 }
      ),
      usedTools: !minorOnly && indexedLines.length > 0
        ? [{
            name: 'search_cached_profile_facts',
            args: {
              primaryProfileId: subjectProfile.profileId,
              secondaryProfileId: null,
              sourceKinds: [factIndex.NATAL_SOURCE_KIND],
              categories: [],
              tags: ['kind:aspect'],
              cacheMonth: null,
              limit: 120
            },
            result: {
              available: true,
              facts: aspectFacts.map((fact) => ({
                category: fact.category,
                title: fact.title,
                tags: fact.tags,
                fact_text: fact.factText,
                fact_payload: fact.factPayload,
                source_kind: fact.sourceKind,
                cache_month: fact.cacheMonth
              }))
            }
          }]
        : [{
            name: minorOnly ? 'get_cached_minor_aspects' : 'get_cached_major_aspects',
            args: { limit: 120 },
            result: { aspects: fallbackAspectList || [] }
          }],
      renderMode: 'plain'
    };
  }

  let ensuredTransitCache = monthlyTransitCache;
  if (!ensuredTransitCache) {
    const ensuredTimeline = await toolCache.ensureMonthlyTransitTimeline(identity, subjectProfile, { source: 'runtime' });
    ensuredTransitCache = ensuredTimeline?.cacheEntry || await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);
  }

  const indexedFacts = await factIndex.searchFacts(identity, {
    primaryProfileId: subjectProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: [],
    tags: [],
    cacheMonth: factAvailability?.indexedTransitCacheMonth || ensuredTransitCache?.cacheMonth || null,
    limit: 200
  });

  const indexedBlocks = indexedFacts
    .map((fact) => buildTransitFactLines(locale, fact))
    .filter((lines) => Array.isArray(lines) && lines.length > 0)
    .map((lines) => lines.join('\n'));

  const timelinePayload = extractTransitTimelinePayload(ensuredTransitCache?.response || ensuredTransitCache);
  const timelineBlocks = Array.isArray(timelinePayload?.transits)
    ? timelinePayload.transits.map((transit) => buildTransitTimelineEntryLines(locale, transit)).filter(Boolean)
    : [];

  const useIndexedFacts = (
    indexedBlocks.length > 0 &&
    (
      timelineBlocks.length === 0 ||
      indexedBlocks.length >= timelineBlocks.length
    )
  );
  const requestedLimit = queryState?.parameters?.limit || null;
  const selectedBlocks = (useIndexedFacts ? indexedBlocks : timelineBlocks)
    .slice(0, requestedLimit || undefined);
  const cacheMonth = factAvailability?.indexedTransitCacheMonth || ensuredTransitCache?.cacheMonth || null;

  if (selectedBlocks.length === 0) {
    return {
      textParts: [normalizeRawPresentationText(formatRawLabel(locale, {
        en: `No monthly transit listing is available for ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`,
        fr: `Aucune liste de transits du mois n’est disponible pour ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`,
        de: `Keine Monatstransitliste für ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')} verfügbar.`,
        es: `No hay lista de tránsitos del mes disponible para ${getRawSubjectLabel(locale, subjectProfile.profileName || 'Chart User')}.`
      }))],
      usedTools: [],
      renderMode: 'plain'
    };
  }

  return {
    textParts: buildRawListingParts(
      locale,
      buildRawListingTitle(locale, 'all_monthly_transits', subjectProfile.profileName, cacheMonth || String(selectedBlocks.length), responseMode),
      selectedBlocks,
      { itemType: 'block', chunkSize: 6 }
    ),
    usedTools: useIndexedFacts
      ? [{
          name: 'search_cached_profile_facts',
          args: {
            primaryProfileId: subjectProfile.profileId,
            secondaryProfileId: null,
            sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
            categories: [],
            tags: [],
            cacheMonth: cacheMonth || null,
            limit: 200
          },
          result: {
            available: true,
            facts: indexedFacts.map((fact) => ({
              category: fact.category,
              title: fact.title,
              tags: fact.tags,
              fact_text: fact.factText,
              fact_payload: fact.factPayload,
              source_kind: fact.sourceKind,
              cache_month: fact.cacheMonth
            }))
          }
        }]
      : [{
          name: 'get_cached_monthly_transits',
          args: {},
          result: {
            available: Boolean(ensuredTransitCache),
            cacheMonth: ensuredTransitCache?.cacheMonth || null,
            tool: ensuredTransitCache?.toolName || null,
            timeline: ensuredTransitCache?.response || null
          }
        }],
    renderMode: 'plain'
  };
}

function getCanonicalFullListingKind(canonicalRoute) {
  if (!canonicalRoute) {
    return null;
  }

  if (canonicalRoute.id === 'all_natal_aspects') {
    return 'all_aspects';
  }

  if (canonicalRoute.id === 'all_monthly_transits') {
    return 'all_monthly_transits';
  }

  return null;
}

async function tryCanonicalFullListing(identity, canonicalRoute, userText, subjectProfile, factAvailability, locale, responseMode, monthlyTransitCache = null, queryState = null) {
  const requestKind = getCanonicalFullListingKind(canonicalRoute);
  if (!requestKind) {
    return null;
  }

  return tryFullRawListing(
    identity,
    userText || canonicalRoute.intentSample || canonicalRoute.id,
    subjectProfile,
    factAvailability,
    locale,
    requestKind,
    monthlyTransitCache,
    responseMode,
    queryState
  );
}

function localToolResultHasData(toolResult) {
  const result = toolResult?.result;

  if (!result || typeof result !== 'object' || result.error) {
    return false;
  }

  if (result.available === true) {
    return true;
  }

  if (Array.isArray(result.facts) && result.facts.length > 0) {
    return true;
  }

  if (Array.isArray(result.aspects) && result.aspects.length > 0) {
    return true;
  }

  if (result.summary || result.planet || result.house || result.angle || result.timeline) {
    return true;
  }

  return false;
}

function localResultLooksSufficient(loopResult, intent) {
  const toolResults = Array.isArray(loopResult?.toolResults) ? loopResult.toolResults : [];

  if (toolResults.some(localToolResultHasData)) {
    return true;
  }

  const text = String(loopResult?.text || '').trim();
  if (!text) {
    return false;
  }

  if (intent?.id === 'transits') {
    return false;
  }

  return !/could not generate|tool-calling limit|missing|need your birth details/i.test(text);
}

async function createLocalToolExecutor(identity, subjectProfile, factAvailability = {}) {
  const chatStateProfile = getChatState(identity).natalProfile;
  const profile = subjectProfile?.profileId && subjectProfile.profileId !== getChatState(identity).activeProfileId
    ? normalizeNatalProfile(subjectProfile.rawNatalPayload, subjectProfile.cityLabel, { birthCountry: subjectProfile.birthCountry })
    : chatStateProfile;

  return async (name, args) => {
    switch (name) {
      case 'search_cached_profile_facts': {
        const categories = Array.isArray(args.categories) ? args.categories : [];
        const tags = Array.isArray(args.tags) ? args.tags : [];
        const sourceKinds = Array.isArray(args.sourceKinds) ? args.sourceKinds : [];
        const wantsTransitFacts = (
          sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND) ||
          categories.some((category) => ['transit_event', 'transit_theme', 'timing_window'].includes(String(category))) ||
          tags.some((tag) => String(tag).toLowerCase().includes('transit')) ||
          Boolean(args.cacheMonth)
        );

        if (!factAvailability.hasNatalFacts) {
          await toolCache.ensureNatalInsights(identity, subjectProfile, { source: 'runtime' });
        }

        if (wantsTransitFacts) {
          const requestedCacheMonth = args.cacheMonth || toolCache.getCurrentMonthWindow(subjectProfile.timezone || 'UTC')?.cacheMonth || null;
          if (!requestedCacheMonth || factAvailability.indexedTransitCacheMonth !== requestedCacheMonth) {
            await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
          }
        }

        const facts = await factIndex.searchFacts(identity, {
          primaryProfileId: subjectProfile.profileId,
          secondaryProfileId: args.secondaryProfileId || null,
          categories,
          tags,
          sourceKinds,
          cacheMonth: args.cacheMonth || null,
          limit: args.limit || 12
        });

        return {
          available: facts.length > 0,
          facts: facts.map((fact) => ({
            category: fact.category,
            tags: fact.tags,
            title: fact.title,
            fact_text: fact.factText,
            fact_payload: fact.factPayload,
            source_kind: fact.sourceKind,
            cache_month: fact.cacheMonth
          }))
        };
      }
      case 'get_cached_natal_summary':
        return {
          available: Boolean(profile),
          summary: profile?.summaryText || null,
          birthDatetime: profile?.birthDatetime || null,
          birthLocation: profile?.birthLocation || null,
          stelliums: profile?.stelliums || null,
          confidence: profile?.confidence || null
        };
      case 'get_cached_planet_placement': {
        const planet = findPlanet(profile, args.planet);

        if (!planet) {
          return { error: `Planet "${args.planet}" is not available in the cached natal profile.` };
        }

        const signKey = `planet.${String(planet.id).toLowerCase()}.sign.${String(planet.sign_id || '').toLowerCase()}`;
        const houseKey = planet.house ? `planet.${String(planet.id).toLowerCase()}.house.${planet.house}` : null;

        return {
          planet,
          signInterpretation: profile.interpretationMap.get(signKey) || null,
          houseInterpretation: houseKey ? profile.interpretationMap.get(houseKey) || null : null
        };
      }
      case 'get_cached_major_aspects':
        return {
          aspects: profile?.majorAspects?.slice(0, Math.max(1, Math.min(Number(args.limit || 5), 10))) || []
        };
      case 'get_cached_house_info': {
        const house = findHouse(profile, args.house);
        return house
          ? { house }
          : { error: `House ${args.house} is not available in the cached natal profile.` };
      }
      case 'get_cached_angle_info': {
        const angle = findAngle(profile, args.angle);
        return angle
          ? { angle }
          : { error: `Angle "${args.angle}" is not available in the cached natal profile.` };
      }
      case 'get_cached_monthly_transits':
        {
          let monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);

          if (!monthlyTransitCache) {
            const ensuredTimeline = await toolCache.ensureMonthlyTransitTimeline(identity, subjectProfile, { source: 'runtime' });
            monthlyTransitCache = ensuredTimeline?.cacheEntry || await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);
          }

          if (monthlyTransitCache) {
            await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
          }
        return {
          available: Boolean(monthlyTransitCache),
          cacheMonth: monthlyTransitCache?.cacheMonth || null,
          tool: monthlyTransitCache?.toolName || null,
          timeline: monthlyTransitCache?.response || null
        };
        }
      case 'get_profile_completeness':
        return {
          hasNatalProfile: Boolean(profile),
          hasBirthTime: Boolean(profile?.timeKnown),
          hasAngles: Boolean(profile?.angles && Object.keys(profile.angles).length > 0),
          hasHouses: Array.isArray(profile?.houses) && profile.houses.length > 0,
          confidence: profile?.confidence || null
        };
      default:
        throw new Error(`Unknown local tool: ${name}`);
    }
  };
}

function buildResolvedToolArgs(originalToolName, args, context) {
  const nextArgs = { ...(args || {}) };

  if (originalToolName === toolCache.TRANSIT_TOOL && !nextArgs.natal && context.activeProfile?.natalRequestPayload) {
    const monthWindow = toolCache.getCurrentMonthWindow(context.activeProfile.timezone || 'UTC');
    nextArgs.natal = context.activeProfile.natalRequestPayload;

    if (monthWindow && !nextArgs.range_start && !nextArgs.range_end) {
      nextArgs.range_start = monthWindow.rangeStart;
      nextArgs.range_end = monthWindow.rangeEnd;
      nextArgs.mode = nextArgs.mode || 'month';
    }
  }

  if (SYNSTRY_TOOL_NAMES.has(originalToolName) && context.synastryContext?.secondaryProfile) {
    if (!nextArgs.person_a) {
      nextArgs.person_a = profiles.buildSynastryPersonPayload(context.activeProfile);
    }

    if (!nextArgs.person_b) {
      nextArgs.person_b = profiles.buildSynastryPersonPayload(context.synastryContext.secondaryProfile);
    }
  }

  return nextArgs;
}

async function detectSynastryContext(identity, userText, intent, activeProfile) {
  if (intent.id !== 'synastry' || !activeProfile) {
    return { secondaryProfile: null, needsUserChoice: false, candidates: [] };
  }

  const matches = await profiles.findMentionedProfiles(identity, userText, {
    excludeProfileId: activeProfile.profileId
  });

  if (matches.length === 1) {
    return {
      secondaryProfile: matches[0],
      needsUserChoice: false,
      candidates: matches
    };
  }

  const allCandidates = (await profiles.listProfiles(identity))
    .filter((profile) => profile.profileId !== activeProfile.profileId);

  return {
    secondaryProfile: null,
    needsUserChoice: true,
    candidates: matches.length > 1 ? matches : allCandidates
  };
}

function buildProfileResolutionResponse(locale, route) {
  if (route.kind === 'astrology_synastry') {
    return locale === 'fr'
      ? 'Je peux comparer deux profils seulement si le second profil est sauvegardé et identifié clairement. Donnez-moi le nom exact du profil à comparer.'
      : 'I can compare two profiles only if the second saved profile is clearly identified. Tell me the exact profile name to compare.';
  }

  return locale === 'fr'
    ? 'Je vois plusieurs profils possibles ou aucun profil clairement visé. Précisez le nom du profil concerné.'
    : 'I see multiple possible profiles, or no clearly targeted profile. Tell me the exact profile name you want me to use.';
}

function looksLikeSystemReply(text) {
  return /\b(saved profile|saved profiles|profil sauvegard[ée]s?|profil actif|active profile)\b/i.test(String(text || ''));
}

function validateFinalAnswer(text, route, locale) {
  const structuredItemCount = (String(text || '').match(/(?:^|\n\n)\d+\.\s/g) || []).length;
  const normalized = structuredItemCount >= 2
    ? normalizeStructuredAssistantText(text)
    : normalizeAssistantText(text);

  if ((route.kind === 'astrology_natal' || route.kind === 'astrology_transits' || route.kind === 'astrology_synastry') && looksLikeSystemReply(normalized)) {
    return locale === 'fr'
      ? 'Je ne peux pas répondre proprement tant que la bonne cible de profil n’est pas confirmée.'
      : 'I cannot answer cleanly until the correct profile target is confirmed.';
  }

  return normalized;
}

function validateRawAnswer(text, locale) {
  const normalized = normalizeRawPresentationText(text);

  if (RAW_INTERPRETIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return formatRawLabel(locale, {
      en: 'Raw mode blocked an interpretive reply.',
      fr: 'Le mode brut a bloqué une réponse interprétative.',
      de: 'Der Rohmodus hat eine interpretierende Antwort blockiert.',
      es: 'El modo bruto bloqueó una respuesta interpretativa.'
    });
  }

  return normalized;
}

function updateConversationState(identity, route, subjectProfile, secondaryProfile = null, resolvedQuestion = null, queryState = null, executionIntent = null) {
  setConversationContext(identity, {
    lastReferencedProfileId: subjectProfile?.profileId || null,
    lastComparedProfileId: secondaryProfile?.profileId || null,
    lastResponseProfileId: subjectProfile?.profileId || null,
    lastResponseRoute: route?.kind || null,
    lastIntentId: route?.intent?.id || null,
    lastExecutionTarget: executionIntent?.target || null,
    lastResultFamily: executionIntent?.family || null,
    lastAnswerStyle: route?.answerStyle || null,
    lastResolvedQuestion: resolvedQuestion || null,
    lastCommonRouteId: route?.commonRouteId || null,
    lastQueryState: queryState || null,
    lastAnswerArtifact: executionIntent?.artifact || null
  }, { notify: false });
}

function persistConversationAnswerState(
  identity,
  route,
  subjectProfile,
  secondaryProfile = null,
  resolvedQuestion = null,
  queryState = null,
  executionIntent = null,
  finalText = '',
  toolResults = []
) {
  const nextExecutionIntent = executionIntent
    ? {
        ...executionIntent,
        artifact: buildConversationAnswerArtifact(route, executionIntent, queryState, finalText, toolResults)
      }
    : {
        artifact: buildConversationAnswerArtifact(route, null, queryState, finalText, toolResults)
      };

  updateConversationState(
    identity,
    route,
    subjectProfile,
    secondaryProfile,
    resolvedQuestion,
    queryState,
    nextExecutionIntent
  );
}

function summarizeIdentityForLogs(identity) {
  return {
    stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
    channel: identity?.channel || null,
    userId: identity?.userId || null,
    chatId: identity?.chatId || null
  };
}

async function answerConversation(identity, userText) {
  const chatState = getChatState(identity);
  const locale = getLocale(chatState);
  const responseMode = 'interpreted';
  const conversationContext = getConversationContext(identity);
  const shouldBypassFollowUpInheritance = isBroadRelocationRecommendationQuestion(userText) || looksLikeStandaloneAstrologyQuery(userText);
  let explicitFollowUp = shouldBypassFollowUpInheritance
    ? null
    : detectExplicitFollowUp(userText, conversationContext, chatState.history);
  if (!explicitFollowUp && !shouldBypassFollowUpInheritance) {
    explicitFollowUp = detectArtifactFollowUpLocally(userText, conversationContext, chatState.history);
  }
  if (!explicitFollowUp && !shouldBypassFollowUpInheritance) {
    explicitFollowUp = await resolveArtifactFollowUpWithAi(locale, userText, conversationContext, chatState.history, null);
  }
  if (!explicitFollowUp && !shouldBypassFollowUpInheritance) {
    explicitFollowUp = await resolveFollowUpWithAi(locale, userText, conversationContext, null);
  }
  const routeSeedText = explicitFollowUp?.rewrittenQuestion || userText;
  const detectedRoute = detectConversationRoute(routeSeedText, chatState.history);
  const inheritedRoute = inheritRouteFromConversation(detectedRoute, conversationContext, userText);
  let route = inheritedRoute;
  let commonRoute = null;
  let canonicalRoute = null;
  let executionIntent = null;
  let plannerQuestionText = explicitFollowUp?.rewrittenQuestion || resolveQuestionForPlanner(route, userText, chatState.history);
  const stateKey = chatState.stateKey || `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`;

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Conversational mode is disabled.');
  }

  await profiles.ensureHydrated(identity);
  const activeProfile = await profiles.getActiveProfile(identity);

  const intent = route.intent;

  if (route.kind === 'system_meta') {
    const text = buildSystemMetaResponse(locale, getChatState(identity), activeProfile);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (route.kind === 'profile_management') {
    const text = buildProfileManagementResponse(locale);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (route.kind === 'clarification') {
    const referencedProfile = conversationContext.lastResponseProfileId
      ? await profiles.getProfileById(identity, conversationContext.lastResponseProfileId)
      : activeProfile;
    const text = buildClarificationResponse(locale, activeProfile, referencedProfile, conversationContext);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  const targetContext = await resolveConversationTargets(identity, userText, route, activeProfile);
  const subjectProfile = targetContext.subjectProfile || activeProfile;
  const secondaryProfile = targetContext.secondaryProfile || null;
  const effectiveUserQuestion = buildEffectiveUserQuestion(route, userText, plannerQuestionText, subjectProfile);
  let currentQueryState = buildStructuredQueryState({
    route,
    canonicalRoute,
    commonRoute,
    userText,
    plannerQuestionText: effectiveUserQuestion,
    conversationContext,
    subjectProfile,
    explicitFollowUp,
    timezone: subjectProfile?.timezone || subjectProfile?.birthTimezone || subjectProfile?.rawNatalPayload?.subject?.location?.timezone || 'UTC'
  });
  const responsePerspective = shouldUseThirdPersonVoice(userText, subjectProfile, activeProfile)
    ? 'third_person'
    : 'second_person';
  const electionalContextRouteId = explicitFollowUp?.canonicalRouteId
    || conversationContext?.lastCommonRouteId
    || currentQueryState?.canonicalRouteId
    || null;
  const cachedElectionalResult = (
    conversationContext?.lastResultFamily === 'mcp_electional' &&
    ELECTIONAL_ROUTE_IDS.has(electionalContextRouteId || '')
  )
    ? getLatestElectionalToolResult(chatState.lastToolResults || [])
    : null;

  if (targetContext.needsClarification) {
    const text = buildProfileResolutionResponse(locale, route);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, text, []);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (targetContext.needsWeddingProfileSelection) {
    return {
      text: '',
      usedTools: [],
      intent: route.kind,
      requiresWeddingProfileSelection: true,
      candidates: targetContext.candidates || []
    };
  }

  if (targetContext.needsProfileCreation) {
    const text = buildMissingExternalProfileResponse(locale, targetContext.requestedProfileName || null);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, text, []);
    return {
      text,
      usedTools: [],
      intent: route.kind,
      needsProfileCreation: true,
      requestedProfileName: targetContext.requestedProfileName || null
    };
  }

  if (!subjectProfile?.rawNatalPayload) {
    return {
      text: {
        en: 'I need your birth details before I can answer personal astrology questions from your chart.',
        fr: 'J’ai besoin de vos données de naissance avant de pouvoir répondre à des questions astrologiques personnelles à partir de votre thème.',
        de: 'Ich brauche deine Geburtsdaten, bevor ich persönliche astrologische Fragen aus deinem Horoskop beantworten kann.',
        es: 'Necesito tus datos de nacimiento antes de poder responder preguntas astrológicas personales a partir de tu carta.'
      }[locale] || 'I need your birth details before I can answer personal astrology questions from your chart.',
      usedTools: [],
      intent: route.kind
    };
  }

  if (
    cachedElectionalResult &&
    (
      isElectionalResultExplanationFollowUp(userText)
      || isElectionalResultExplanationFollowUp(explicitFollowUp?.rewrittenQuestion || '')
    )
  ) {
    const text = buildElectionalResultExplanationResponse(locale, cachedElectionalResult);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, chatState.lastToolResults || []);
    persistConversationAnswerState(
      identity,
      route,
      subjectProfile,
      secondaryProfile,
      explicitFollowUp?.rewrittenQuestion || plannerQuestionText,
      currentQueryState,
      { target: 'mcp', family: 'mcp_electional' },
      text,
      chatState.lastToolResults || []
    );
    return {
      text,
      usedTools: chatState.lastToolResults || [],
      intent: route.kind
    };
  }

  const localDeclarations = createLocalFunctionDeclarations();
  await toolCache.ensureNatalInsights(identity, subjectProfile, { source: 'runtime' });
  if (route.kind === 'astrology_transits') {
    await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
  }
  const monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);
  const factAvailability = subjectProfile.profileId === getChatState(identity).activeProfileId
    ? await factIndex.syncActiveProfileFactAvailability(identity, subjectProfile, {
        cacheMonth: monthlyTransitCache?.cacheMonth || null,
        notify: false
      })
    : await factIndex.getProfileFactAvailability(identity, subjectProfile, {
        cacheMonth: monthlyTransitCache?.cacheMonth || null
      });

  if (route.kind !== 'system_meta' && route.kind !== 'profile_management' && route.kind !== 'clarification') {
    try {
      executionIntent = await routeConversationExecutionWithAi(
        locale,
        effectiveUserQuestion,
        route,
        subjectProfile,
        factAvailability,
        conversationContext,
        currentQueryState
      );
    } catch (error) {
      if (error?.code === 'EXECUTION_ROUTE_AI_UNAVAILABLE') {
        const text = buildExecutionRouterUnavailableResponse(locale);
        pushHistory(identity, 'user', userText);
        pushHistory(identity, 'model', text);
        setLastToolResults(identity, []);
        persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, null, text, []);
        return {
          text,
          usedTools: [],
          intent: route.kind
        };
      }
      throw error;
    }

    if (!executionIntent) {
      await appendUnmatchedCanonicalQuestion({
        stateKey,
        channel: identity?.channel || null,
        userId: identity?.userId || null,
        chatId: identity?.chatId || null,
        locale,
        responseMode,
        detectedRouteKind: route?.kind || null,
        rewrittenQuestion: plannerQuestionText || null,
        userText
      });
      const text = buildUnsupportedAstrologyQuestionResponse(locale, route);
      pushHistory(identity, 'user', userText);
      pushHistory(identity, 'model', text);
      setLastToolResults(identity, []);
      persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, null, text, []);
      return {
        text,
        usedTools: [],
        intent: route.kind
      };
    }
  }

  if (
    executionIntent?.target === 'indexed_facts' ||
    (
      executionIntent?.target === 'mcp' && (
        executionIntent.family === 'mcp_synastry' ||
        executionIntent.family === 'mcp_relocation' ||
        executionIntent.family === 'mcp_progressions' ||
        executionIntent.family === 'mcp_ephemeris' ||
        executionIntent.family === 'mcp_horoscope' ||
        executionIntent.family === 'mcp_electional'
      )
    )
  ) {
    if (route.kind === 'astrology_transits' && isExplicitDailyTransitQuestion(effectiveUserQuestion)) {
      canonicalRoute = getWesternCanonicalRouteById('today_transits_me');
    }

    const inferredDirectRoute = executionIntent?.target === 'mcp'
      ? inferDirectCanonicalRouteForExecutionFamily(executionIntent, plannerQuestionText, currentQueryState)
      : null;
    if (
      !canonicalRoute &&
      executionIntent?.family === 'mcp_electional' &&
      ELECTIONAL_ROUTE_IDS.has(inferredDirectRoute?.id)
    ) {
      canonicalRoute = inferredDirectRoute;
    }

    const canonicalHintRoute = buildCanonicalHintRouteForExecutionFamily(route, executionIntent?.family);
    if (!canonicalRoute) {
      try {
        canonicalRoute = await resolveCanonicalCommonRouteWithAi(locale, plannerQuestionText, canonicalHintRoute);
      } catch (error) {
        if (error?.code !== 'CANONICAL_ROUTE_AI_UNAVAILABLE') {
          throw error;
        }
      }
    }

    if (executionIntent?.target === 'mcp') {
      const shouldOverrideWithInferredRoute = inferredDirectRoute && (
        !canonicalRoute ||
        (
          executionIntent.family === 'mcp_relocation' &&
          inferredDirectRoute.id === 'relocation_city_check'
        ) ||
        (
          executionIntent.family === 'mcp_progressions' &&
          inferredDirectRoute.id === 'secondary_progressions_exact_aspects'
        ) ||
        (
          executionIntent.family === 'mcp_electional' &&
          ELECTIONAL_ROUTE_IDS.has(inferredDirectRoute.id)
        )
      );
      if (shouldOverrideWithInferredRoute) {
        canonicalRoute = inferredDirectRoute;
      }
    }

    if (canonicalRoute) {
      route = applyCanonicalRoute(route, canonicalRoute, plannerQuestionText);
      plannerQuestionText = canonicalRoute.responseShape === 'full_listing' || route.kind === 'astrology_relocation'
        ? plannerQuestionText
        : (canonicalRoute.intentSample || plannerQuestionText);
      commonRoute = canonicalRoute?.commonRouteId
        ? getCommonQuestionRouteById(canonicalRoute.commonRouteId)
        : null;
      currentQueryState = buildStructuredQueryState({
        route,
        canonicalRoute,
        commonRoute,
        userText,
        plannerQuestionText: effectiveUserQuestion,
        conversationContext,
        subjectProfile,
        explicitFollowUp,
        timezone: subjectProfile?.timezone || subjectProfile?.birthTimezone || subjectProfile?.rawNatalPayload?.subject?.location?.timezone || 'UTC'
      });
    }
  }

  info('conversation route resolved', {
    ...summarizeIdentityForLogs(identity),
    locale,
    userText,
    routeKind: route?.kind || null,
    commonRouteId: route?.commonRouteId || null,
    canonicalRouteId: canonicalRoute?.id || currentQueryState?.canonicalRouteId || null,
    executionTarget: executionIntent?.target || null,
    executionFamily: executionIntent?.family || null,
    subjectProfileId: subjectProfile?.profileId || null,
    subjectProfileName: subjectProfile?.profileName || null,
    secondaryProfileId: secondaryProfile?.profileId || null,
    explicitFollowUpType: explicitFollowUp?.followUpType || null,
    rewrittenQuestion: explicitFollowUp?.rewrittenQuestion || null,
    queryState: currentQueryState || null
  });

  if (
    explicitFollowUp?.followUpType === 'aspect_scope_refinement' &&
    conversationContext?.lastCommonRouteId === 'all_natal_aspects'
  ) {
    const requestedPlanet = currentQueryState?.parameters?.planet || null;
    const requestedLimit = currentQueryState?.parameters?.limit || null;
    const refinedAspects = filterNatalAspectsByPlanet(
      buildNormalizedNatalAspects(subjectProfile.rawNatalPayload, false),
      requestedPlanet
    ).slice(0, requestedLimit || undefined);
    info('aspect scope refinement resolved', {
      stateKey,
      requestedPlanet,
      requestedLimit,
      refinedCount: refinedAspects.length
    });
    const refinedListingResult = buildRawNatalAspectListing(locale, subjectProfile, refinedAspects, {
      requestedPlanet,
      minorOnly: true
    });

    if (refinedListingResult) {
      const textParts = Array.isArray(refinedListingResult.textParts)
        ? refinedListingResult.textParts
        : [refinedListingResult.text].filter(Boolean);
      pushHistory(identity, 'user', userText);
      pushHistory(identity, 'model', textParts.join('\n\n'));
      const usedTools = [{
        name: 'get_cached_minor_aspects',
        args: { requestedPlanet: requestedPlanet || null, limit: requestedLimit || null },
        result: { aspects: refinedAspects }
      }];
      setLastToolResults(identity, usedTools);
      persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, explicitFollowUp.rewrittenQuestion || plannerQuestionText, currentQueryState, executionIntent, textParts.join('\n\n'), usedTools);

      return {
        text: textParts[0] || '',
        textParts,
        renderMode: refinedListingResult.renderMode || 'plain',
        usedTools,
        intent: route.kind
      };
    }
  }

  currentQueryState = await maybeRefineStructuredQueryStateWithAi(
    locale,
    effectiveUserQuestion,
    subjectProfile,
    currentQueryState
  );

  if (canonicalRoute?.responseShape === 'full_listing') {
    const fullListingResult = await tryCanonicalFullListing(
      identity,
      canonicalRoute,
      plannerQuestionText,
      subjectProfile,
      factAvailability,
      locale,
      responseMode,
      monthlyTransitCache,
      currentQueryState
    );

    if (fullListingResult) {
      const textParts = Array.isArray(fullListingResult.textParts)
        ? fullListingResult.textParts
        : [fullListingResult.text].filter(Boolean);
      pushHistory(identity, 'user', userText);
      pushHistory(identity, 'model', textParts.join('\n\n'));
      setLastToolResults(identity, fullListingResult.usedTools || []);
      persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, textParts.join('\n\n'), fullListingResult.usedTools || []);

      return {
        text: textParts[0] || '',
        textParts,
        renderMode: fullListingResult.renderMode || 'plain',
        usedTools: fullListingResult.usedTools || [],
        intent: route.kind
      };
    }
  }

  const commonPlannedRoute = buildPlannedRouteFromCommonQuestion(commonRoute, subjectProfile, factAvailability);
  const canonicalPlannedRoute = buildCanonicalIndexedRoute(canonicalRoute, effectiveUserQuestion, subjectProfile, factAvailability);
  const executionPlannedRoute = buildPlannedRouteFromExecutionIntent(executionIntent, subjectProfile, factAvailability, currentQueryState);
  const plannedRoute = commonPlannedRoute || canonicalPlannedRoute || executionPlannedRoute;
  if (plannedRoute && !plannedRoute.answerStyle) {
    plannedRoute.answerStyle = route.answerStyle;
  }
  const shouldPreferIndexedFacts = plannedRoute?.target === 'indexed_facts';
  const effectiveIntent = intent;
  const synastryContext = {
    secondaryProfile,
    needsUserChoice: false,
    candidates: secondaryProfile ? [secondaryProfile] : []
  };

  const pendingComparisonText = consumePendingSynastryQuestion(identity);
  if (pendingComparisonText && secondaryProfile) {
    userText = pendingComparisonText;
  }
  const mcpStatus = 'enabled';
  const localExecutor = await createLocalToolExecutor(identity, subjectProfile, factAvailability);
  const mcpFamilyForLoop = executionIntent?.target === 'mcp'
    ? executionIntent.family
    : (executionIntent?.family === 'indexed_monthly_transits' ? 'mcp_transits' : null);
  const exactTransitSearchExecution = isExactTransitSearchExecution(executionIntent, currentQueryState);
  const mcpDeclarations = filterMcpDeclarationsByFamily(
    await mcpService.getFunctionDeclarations(),
    mcpFamilyForLoop
  );
  const toolCallCache = new Map();
  const toolFamilyCounts = new Map();
  const toolFamilyLimits = new Map([
    ['transit_search', 2],
    ['transit_timeline', 2],
    ['synastry', 2],
    ['relocation', 1],
    ['progressions', 1],
    ['ephemeris', 1],
    ['horoscope', 1],
    ['electional', 1]
  ]);

  const executeFunction = async (name, args) => {
    const cacheKey = buildToolCallCacheKey(name, args || {});
    if (toolCallCache.has(cacheKey)) {
      info('conversation tool call deduped', {
        stateKey,
        tool: name
      });
      const cached = cloneToolResult(toolCallCache.get(cacheKey));
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
        cached._toolCache = { deduped: true };
      }
      return cached;
    }

    if (name === 'search_cached_profile_facts' || name.startsWith('get_cached_') || name === 'get_profile_completeness') {
      const localResult = await localExecutor(name, args);
      toolCallCache.set(cacheKey, cloneToolResult(localResult));
      return localResult;
    }

    if (mcpService.isMcpTool(name)) {
      const family = classifyToolBudgetFamily(name);
      const limit = family ? toolFamilyLimits.get(family) : null;
      const currentCount = family ? (toolFamilyCounts.get(family) || 0) : 0;
      if (family && limit && currentCount >= limit) {
        info('conversation tool family budget reached', {
          stateKey,
          tool: name,
          family,
          limit
        });
        const blockedResult = {
          blocked: true,
          family,
          reason: `Tool family budget reached for ${family}. Reuse the previous grounded result instead of repeating the same search.`
        };
        toolCallCache.set(cacheKey, cloneToolResult(blockedResult));
        return blockedResult;
      }

      const mcpResult = await mcpService.callSanitizedTool(name, args);
      if (family) {
        toolFamilyCounts.set(family, currentCount + 1);
      }
      toolCallCache.set(cacheKey, cloneToolResult(mcpResult));
      return mcpResult;
    }

    throw new Error(`Unknown tool call: ${name}`);
  };

  const systemInstruction = buildSystemInstruction(chatState, mcpStatus, effectiveIntent, {
    activeProfileName: subjectProfile.profileName,
    factAvailability,
    monthlyTransitAvailable: Boolean(monthlyTransitCache),
    includeNatalSummary: !factAvailability?.hasNatalFacts,
    subjectProfileSummary: normalizeNatalProfile(subjectProfile.rawNatalPayload, subjectProfile.cityLabel, {
      birthCountry: subjectProfile.birthCountry
    }).summaryText,
    routeKind: route.kind,
    commonRouteId: route.commonRouteId || null,
    answerStyle: plannedRoute?.answerStyle || route.answerStyle,
    executionTarget: executionIntent?.target || 'auto',
    executionFamily: executionIntent?.family || 'auto',
    responseMode,
    responsePerspective,
    targetProfileLabel: subjectProfile.profileName,
    synastryContext: {
      activeProfile: subjectProfile,
      secondaryProfile
    }
  });
  const toolDisciplineLines = [];
  if (executionIntent?.family === 'mcp_transits' && currentQueryState?.parameters?.transitPlanet && currentQueryState?.parameters?.aspectTypes?.length > 0) {
    toolDisciplineLines.push('For an exact transit search, make one precise transit-search MCP call with the clearest parameter set. Do not repeat near-identical transit-search calls after you already have a valid result.');
  }
  const transitSearchHint = exactTransitSearchExecution
    ? buildTransitSearchExecutionHint(currentQueryState, subjectProfile, effectiveUserQuestion)
    : null;
  const localDeclarationsForLoop = exactTransitSearchExecution
    ? []
    : localDeclarations;

  const fastPathResult = shouldPreferIndexedFacts
    ? await tryFactFastPath(identity, effectiveUserQuestion, effectiveIntent, subjectProfile, factAvailability, locale, plannedRoute, {
        responsePerspective,
        responseMode,
        queryState: currentQueryState
      })
    : null;
  if (fastPathResult) {
    info('conversation fact fast-path complete', {
      stateKey,
      intent: effectiveIntent.id,
      routeTarget: plannedRoute?.target || null,
      routeReason: plannedRoute?.reason || null,
      durationMs: fastPathResult.durationMs,
      rewriteDurationMs: fastPathResult.rewriteDurationMs,
      factCount: fastPathResult.usedTools[0]?.result?.facts?.length || 0
    });

    pushHistory(identity, 'user', userText);
    const rawTransitTable = (
      responseMode === 'raw' &&
      route.kind === 'astrology_transits' &&
      identity?.channel === 'telegram'
    )
      ? buildRawTransitTable(locale, fastPathResult.usedTools?.[0]?.result?.facts || [], subjectProfile, {
          limit: isMonthlyTransitListingRoute(plannedRoute?.commonRouteId || canonicalRoute?.id)
            ? (currentQueryState?.parameters?.limit || getRequestedListingLimit(
                effectiveUserQuestion,
                (plannedRoute?.commonRouteId || canonicalRoute?.id) === 'monthly_transits_for_planet'
                  ? 'monthly_transits_for_planet'
                  : 'month_ahead_transits',
                (plannedRoute?.commonRouteId || canonicalRoute?.id) === 'monthly_transits_for_planet' ? 200 : 10
              ))
            : 5,
          requestedPlanet: currentQueryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(effectiveUserQuestion),
          strictPlanetMatch: Boolean(currentQueryState?.parameters?.planet || parseRequestedMonthlyTransitPlanet(effectiveUserQuestion)),
          includeFollowUp: isTopMonthlyTransitRoute(plannedRoute?.commonRouteId || canonicalRoute?.id)
        })
      : null;
    const rawDraftText = rawTransitTable || validateRawAnswer(fastPathResult.text, locale);
    const aiFilteredFastPath = responseMode === 'raw'
      ? await maybeApplyAiGroundedFilter(
          locale,
          effectiveUserQuestion,
          rawDraftText,
          fastPathResult.usedTools,
          subjectProfile,
          {
            channel: identity?.channel || null,
            responsePerspective,
            responseMode,
            executionFamily: executionIntent?.family || null,
            executionIntent,
            queryState: currentQueryState,
            route
          }
        )
      : null;
    const finalText = responseMode === 'raw'
      ? validateRawAnswer(aiFilteredFastPath?.text || rawDraftText, locale)
      : validateFinalAnswer(fastPathResult.text, route, locale);
    pushHistory(identity, 'model', finalText);
    setLastToolResults(identity, fastPathResult.usedTools);
    persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, finalText, fastPathResult.usedTools);

    return {
      text: finalText,
      textParts: (responseMode === 'raw' && aiFilteredFastPath?.usedAiFilter)
        ? undefined
        : (rawTransitTable ? undefined : fastPathResult.textParts),
      renderMode: (responseMode === 'raw' && aiFilteredFastPath?.usedAiFilter)
        ? 'plain'
        : (rawTransitTable ? 'telegram_pre' : (fastPathResult.renderMode || 'plain')),
      usedTools: fastPathResult.usedTools,
      intent: route.kind
    };
  }

  if (executionIntent?.target === 'mcp' && currentQueryState?.canonicalRouteId === 'transit_search_exact') {
    const exactTransitRoute = getWesternCanonicalRouteById('transit_search_exact');
    if (exactTransitRoute) {
      const exactTransitResult = await executeCanonicalToolRoute(
        identity,
        exactTransitRoute,
        effectiveUserQuestion,
        subjectProfile,
        secondaryProfile,
        locale,
        responseMode,
        currentQueryState
      );

      if (exactTransitResult) {
        pushHistory(identity, 'user', userText);
        const aiFilteredExactTransit = responseMode === 'raw' && !currentQueryState?.parameters?.fullListing
          ? await maybeApplyAiGroundedFilter(
              locale,
              effectiveUserQuestion,
              exactTransitResult.text,
              exactTransitResult.usedTools || [],
              subjectProfile,
              {
                channel: identity?.channel || null,
                responsePerspective,
                responseMode,
                executionFamily: executionIntent?.family || null,
                executionIntent,
                queryState: currentQueryState,
                route
              }
            )
          : null;
        const finalText = responseMode === 'raw'
          ? validateRawAnswer(aiFilteredExactTransit?.text || exactTransitResult.text, locale)
          : validateFinalAnswer(exactTransitResult.text, route, locale);
        pushHistory(identity, 'model', finalText);
        setLastToolResults(identity, exactTransitResult.usedTools || []);
        persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, finalText, exactTransitResult.usedTools || []);

        return {
          text: finalText,
          textParts: (responseMode === 'raw' && aiFilteredExactTransit?.usedAiFilter)
            ? undefined
            : exactTransitResult.textParts,
          renderMode: (responseMode === 'raw' && aiFilteredExactTransit?.usedAiFilter)
            ? 'plain'
            : (exactTransitResult.renderMode || 'plain'),
          usedTools: exactTransitResult.usedTools || [],
          intent: route.kind
        };
      }
    }
  }

  if (shouldUseDirectCanonicalMcpExecution(executionIntent, canonicalRoute)) {
    const canonicalExecutionQuestion = explicitFollowUp?.rewrittenQuestion || effectiveUserQuestion;
    info('conversation canonical execution starting', {
      ...summarizeIdentityForLogs(identity),
      userText,
      canonicalRouteId: canonicalRoute?.id || null,
      canonicalExecutionQuestion,
      executionFamily: executionIntent?.family || null,
      queryState: currentQueryState || null
    });
    const directCanonicalResult = await executeCanonicalToolRoute(
      identity,
      canonicalRoute,
      canonicalExecutionQuestion,
      subjectProfile,
      secondaryProfile,
      locale,
      responseMode,
      currentQueryState
    );

    if (directCanonicalResult) {
      if (directCanonicalResult.requiresCitySelection) {
        info('conversation canonical execution requires city selection', {
          ...summarizeIdentityForLogs(identity),
          userText,
          canonicalRouteId: canonicalRoute?.id || null,
          executionFamily: executionIntent?.family || null,
          replayQuestion: directCanonicalResult.replayQuestion || null,
          candidateCount: Array.isArray(directCanonicalResult.candidates) ? directCanonicalResult.candidates.length : 0
        });
        pushHistory(identity, 'user', userText);
        pushHistory(identity, 'model', directCanonicalResult.text);
        setLastToolResults(identity, directCanonicalResult.usedTools || []);
        persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, directCanonicalResult.text, directCanonicalResult.usedTools || []);
        return {
          text: directCanonicalResult.text,
          textParts: directCanonicalResult.textParts,
          renderMode: directCanonicalResult.renderMode || 'plain',
          usedTools: directCanonicalResult.usedTools || [],
          intent: route.kind,
          requiresCitySelection: true,
          candidates: directCanonicalResult.candidates || [],
          replayQuestion: directCanonicalResult.replayQuestion || null
        };
      }
      info('conversation canonical execution complete', {
        ...summarizeIdentityForLogs(identity),
        userText,
        canonicalRouteId: canonicalRoute?.id || null,
        executionFamily: executionIntent?.family || null,
        toolName: directCanonicalResult.usedTools?.[0]?.name || null,
        toolArgs: directCanonicalResult.usedTools?.[0]?.args || null
      });
      pushHistory(identity, 'user', userText);
      const aiFilteredDirectCanonical = responseMode === 'raw'
        ? await maybeApplyAiGroundedFilter(
            locale,
            effectiveUserQuestion,
            directCanonicalResult.text,
            directCanonicalResult.usedTools || [],
            subjectProfile,
            {
              channel: identity?.channel || null,
              responsePerspective,
              responseMode,
              executionFamily: executionIntent?.family || null,
              executionIntent,
              queryState: currentQueryState,
              route: canonicalRoute || route
            }
          )
        : null;
      const finalText = responseMode === 'raw'
        ? validateRawAnswer(aiFilteredDirectCanonical?.text || directCanonicalResult.text, locale)
        : validateFinalAnswer(directCanonicalResult.text, route, locale);
      pushHistory(identity, 'model', finalText);
      setLastToolResults(identity, directCanonicalResult.usedTools || []);
      persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, finalText, directCanonicalResult.usedTools || []);

      return {
        text: finalText,
        textParts: (responseMode === 'raw' && aiFilteredDirectCanonical?.usedAiFilter)
          ? undefined
          : directCanonicalResult.textParts,
        renderMode: (responseMode === 'raw' && aiFilteredDirectCanonical?.usedAiFilter)
          ? 'plain'
          : (directCanonicalResult.renderMode || 'plain'),
        usedTools: directCanonicalResult.usedTools || [],
        intent: route.kind
      };
    }
  }

  const toolLoopInstruction = [
    systemInstruction,
    '',
    executionIntent?.target === 'indexed_facts'
      ? 'Prefer indexed facts and cached local tools first. If the result is weak, incomplete, or too rigid, continue with the relevant FreeAstro MCP tools.'
      : 'Prefer the relevant FreeAstro MCP tools first. Use indexed facts and cached local tools only when they clearly strengthen the grounded answer.',
    executionIntent?.family
      ? `Preferred tool family: ${executionIntent.family}.`
      : 'Preferred tool family: auto.',
    'Never stop after a weak local-only answer if an MCP tool can answer better.',
    'Only produce a final answer after grounding it in tool results.',
    ...(transitSearchHint ? [
      'This question is an exact transit-search request.',
      `Preferred MCP call: ${JSON.stringify(transitSearchHint)}.`,
      'Do not answer that the data is missing if the transit-search tool already returned cycles, passes, or exact hits.'
    ] : []),
    ...toolDisciplineLines
  ].join('\n');
  const toolPassStartedAt = performance.now();
  let result = await runFunctionCallingLoop({
    systemInstruction: toolLoopInstruction,
    history: chatState.history,
    userText: effectiveUserQuestion,
    functionDeclarations: [...localDeclarationsForLoop, ...mcpDeclarations],
    executeFunction
  });

  info('conversation tool pass complete', {
    stateKey,
    intent: route.kind,
    executionTarget: executionIntent?.target || null,
    executionFamily: executionIntent?.family || null,
    durationMs: Math.round(performance.now() - toolPassStartedAt),
    toolCalls: Array.isArray(result.toolResults) ? result.toolResults.length : 0,
    sufficient: localResultLooksSufficient(result, effectiveIntent)
  });

  if (responseMode === 'raw') {
    const rawToolLoopResponse = (
      route.kind === 'astrology_relocation' &&
      (!Array.isArray(result.toolResults) || result.toolResults.length === 0)
    )
      ? {
          text: buildRawRelocationNeedsText(locale, subjectProfile),
          renderMode: 'plain',
          textParts: undefined
        }
      : buildRawToolLoopResponse(locale, subjectProfile, result.toolResults, {
          channel: identity?.channel || null,
          userText
        });

    result = {
      ...result,
      text: rawToolLoopResponse.text,
      textParts: rawToolLoopResponse.textParts,
      renderMode: rawToolLoopResponse.renderMode || result.renderMode || 'plain'
    };

    const aiFilteredRawResult = await maybeApplyAiGroundedFilter(
      locale,
      effectiveUserQuestion,
      result.text,
      result.toolResults,
      subjectProfile,
      {
        channel: identity?.channel || null,
        responsePerspective,
        responseMode,
        executionFamily: executionIntent?.family || null,
        executionIntent,
        queryState: currentQueryState,
        route
      }
    );

    if (aiFilteredRawResult?.usedAiFilter) {
      result = {
        ...result,
        text: aiFilteredRawResult.text,
        textParts: undefined,
        renderMode: 'plain'
      };
    }
  } else if (Array.isArray(result.toolResults) && result.toolResults.length > 0) {
    const bestTransitSearchPayload = executionIntent?.family === 'mcp_transits'
      ? extractBestTransitSearchPayload(result.toolResults)
      : null;
    result = {
      ...result,
      text: bestTransitSearchPayload
        ? buildTransitSearchInterpretiveResponse(locale, bestTransitSearchPayload, subjectProfile)
        : await rewriteGroundedToolAnswer(
            locale,
            effectiveUserQuestion,
            result.text,
            result.toolResults,
            subjectProfile,
            {
              channel: identity?.channel || null,
              responsePerspective,
              executionFamily: executionIntent?.family || null
            }
          )
    };
  }

  pushHistory(identity, 'user', userText);
  const finalText = responseMode === 'raw'
    ? validateRawAnswer(result.text, locale)
    : validateFinalAnswer(result.text, route, locale);
  pushHistory(identity, 'model', finalText);
  setLastToolResults(identity, result.toolResults);
  persistConversationAnswerState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText, currentQueryState, executionIntent, finalText, result.toolResults);

  return {
    text: finalText,
    textParts: result.textParts,
    renderMode: result.renderMode || 'plain',
    usedTools: result.toolResults,
    intent: route.kind
  };
}

module.exports = {
  answerConversation,
  __test: {
    buildElectionalResultExplanationResponse,
    formatElectionalEventTimeLabel,
    localizeElectionalFactor,
    buildConversationAnswerArtifact,
    buildSecondaryProgressionsRawResponse,
    buildSolarReturnRawResponse,
    buildTransitSearchInterpretiveResponse,
    buildHoroscopeRawResponse,
    buildSynastryRawResponse,
    buildAnnualProfectionsRawResponse,
    buildRelocationRawResponse,
    buildEphemerisRawResponse,
    buildTransitSearchRawResponse,
    isElectionalResultExplanationFollowUp,
    detectArtifactFollowUpLocally,
    inferElectionalRouteConfigFromQuestion,
    extractRequestedExternalProfileName,
    parseExplicitSingleDateFromQuestion
  }
};
