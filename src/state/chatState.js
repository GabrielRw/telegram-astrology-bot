const MAX_HISTORY_ITEMS = 12;

const chats = new Map();
let persistenceHook = null;

function resolveIdentity(identity) {
  if (identity && typeof identity === 'object') {
    return {
      channel: String(identity.channel || 'telegram'),
      userId: identity.userId ? String(identity.userId) : null,
      chatId: identity.chatId ? String(identity.chatId) : null
    };
  }

  return {
    channel: 'telegram',
    userId: null,
    chatId: String(identity)
  };
}

function resolveStateKey(identity) {
  const normalized = resolveIdentity(identity);
  return `${normalized.channel}:${normalized.chatId || normalized.userId || 'unknown'}`;
}

function normalizeAngleKey(angle) {
  return String(angle || '').trim().toLowerCase();
}

function humanizeIdentifier(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createDefaultState(identity) {
  const normalized = resolveIdentity(identity);
  return {
    channel: normalized.channel,
    userId: normalized.userId,
    chatId: normalized.chatId,
    locale: 'en',
    localeSource: 'default',
    platformLocaleHint: null,
    activeProfileId: null,
    responseMode: 'interpreted',
    profileDirectory: [],
    factAvailability: {
      hasNatalFacts: false,
      indexedTransitCacheMonth: null
    },
    natalProfile: null,
    rawNatalPayload: null,
    natalRequestPayload: null,
    chartRequestPayload: null,
    history: [],
    activeFlow: null,
    lastToolResults: [],
    pendingQuestion: null,
    pendingSynastryQuestion: null,
    conversationContext: {
      lastReferencedProfileId: null,
      lastComparedProfileId: null,
      lastResponseProfileId: null,
      lastResponseRoute: null,
      lastIntentId: null,
      lastExecutionTarget: null,
      lastResultFamily: null,
      lastAnswerStyle: null,
      lastResolvedQuestion: null,
      lastCommonRouteId: null,
      lastQueryState: null
    },
    choiceMap: {},
    uiCache: {
      aspects: [],
      planets: []
    }
  };
}

function clearNatalProfile(identity) {
  const state = getChatState(identity);
  state.activeProfileId = null;
  state.factAvailability = {
    hasNatalFacts: false,
    indexedTransitCacheMonth: null
  };
  state.natalProfile = null;
  state.rawNatalPayload = null;
  state.natalRequestPayload = null;
  state.chartRequestPayload = null;
  state.history = [];
  state.lastToolResults = [];
  state.pendingQuestion = null;
  state.pendingSynastryQuestion = null;
  state.conversationContext = {
    lastReferencedProfileId: null,
    lastComparedProfileId: null,
    lastResponseProfileId: null,
    lastResponseRoute: null,
    lastIntentId: null,
    lastExecutionTarget: null,
    lastResultFamily: null,
    lastAnswerStyle: null,
    lastResolvedQuestion: null,
    lastCommonRouteId: null,
    lastQueryState: null
  };
  state.choiceMap = {};
  state.uiCache = {
    aspects: [],
    planets: []
  };
  notifyPersistence(identity);
}

function getChatState(identity) {
  const key = resolveStateKey(identity);
  const normalized = resolveIdentity(identity);

  if (!chats.has(key)) {
    chats.set(key, createDefaultState(identity));
  }

  const state = chats.get(key);
  state.channel = normalized.channel;
  state.userId = normalized.userId;
  state.chatId = normalized.chatId;
  return state;
}

function setActiveFlow(chatId, activeFlow) {
  const state = getChatState(chatId);
  state.activeFlow = activeFlow;
  notifyPersistence(chatId);
  return state.activeFlow;
}

function clearActiveFlow(chatId) {
  const state = getChatState(chatId);
  state.activeFlow = null;
  notifyPersistence(chatId);
}

function setLastToolResults(chatId, results) {
  const state = getChatState(chatId);
  state.lastToolResults = Array.isArray(results) ? results.slice(-6) : [];
  notifyPersistence(chatId);
}

function pushHistory(chatId, role, text) {
  const value = String(text || '').trim();

  if (!value) {
    return;
  }

  const state = getChatState(chatId);
  state.history.push({
    role,
    text: value
  });

  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history.slice(-MAX_HISTORY_ITEMS);
  }

  notifyPersistence(chatId);
}

function setUiCache(chatId, cache) {
  const state = getChatState(chatId);
  state.uiCache = {
    aspects: Array.isArray(cache?.aspects) ? cache.aspects : [],
    planets: Array.isArray(cache?.planets) ? cache.planets : []
  };
  notifyPersistence(chatId);
}

function getUiCache(chatId) {
  return getChatState(chatId).uiCache;
}

function setPendingQuestion(chatId, question) {
  const state = getChatState(chatId);
  state.pendingQuestion = question ? String(question) : null;
  notifyPersistence(chatId);
}

function consumePendingQuestion(chatId) {
  const state = getChatState(chatId);
  const question = state.pendingQuestion;
  state.pendingQuestion = null;
  notifyPersistence(chatId);
  return question;
}

function setPendingSynastryQuestion(chatId, question) {
  const state = getChatState(chatId);
  state.pendingSynastryQuestion = question ? String(question) : null;
  notifyPersistence(chatId);
}

function consumePendingSynastryQuestion(chatId) {
  const state = getChatState(chatId);
  const question = state.pendingSynastryQuestion;
  state.pendingSynastryQuestion = null;
  notifyPersistence(chatId);
  return question;
}

function setChoiceMap(chatId, choiceMap) {
  const state = getChatState(chatId);
  state.choiceMap = choiceMap && typeof choiceMap === 'object' ? { ...choiceMap } : {};
  notifyPersistence(chatId);
}

function setConversationContext(chatId, context = {}, options = {}) {
  const state = getChatState(chatId);
  state.conversationContext = {
    ...(state.conversationContext || {}),
    lastReferencedProfileId: context.lastReferencedProfileId !== undefined
      ? (context.lastReferencedProfileId ? String(context.lastReferencedProfileId) : null)
      : (state.conversationContext?.lastReferencedProfileId || null),
    lastComparedProfileId: context.lastComparedProfileId !== undefined
      ? (context.lastComparedProfileId ? String(context.lastComparedProfileId) : null)
      : (state.conversationContext?.lastComparedProfileId || null),
    lastResponseProfileId: context.lastResponseProfileId !== undefined
      ? (context.lastResponseProfileId ? String(context.lastResponseProfileId) : null)
      : (state.conversationContext?.lastResponseProfileId || null),
    lastResponseRoute: context.lastResponseRoute !== undefined
      ? (context.lastResponseRoute ? String(context.lastResponseRoute) : null)
      : (state.conversationContext?.lastResponseRoute || null),
    lastIntentId: context.lastIntentId !== undefined
      ? (context.lastIntentId ? String(context.lastIntentId) : null)
      : (state.conversationContext?.lastIntentId || null),
    lastExecutionTarget: context.lastExecutionTarget !== undefined
      ? (context.lastExecutionTarget ? String(context.lastExecutionTarget) : null)
      : (state.conversationContext?.lastExecutionTarget || null),
    lastResultFamily: context.lastResultFamily !== undefined
      ? (context.lastResultFamily ? String(context.lastResultFamily) : null)
      : (state.conversationContext?.lastResultFamily || null),
    lastAnswerStyle: context.lastAnswerStyle !== undefined
      ? (context.lastAnswerStyle ? String(context.lastAnswerStyle) : null)
      : (state.conversationContext?.lastAnswerStyle || null),
    lastResolvedQuestion: context.lastResolvedQuestion !== undefined
      ? (context.lastResolvedQuestion ? String(context.lastResolvedQuestion) : null)
      : (state.conversationContext?.lastResolvedQuestion || null),
    lastCommonRouteId: context.lastCommonRouteId !== undefined
      ? (context.lastCommonRouteId ? String(context.lastCommonRouteId) : null)
      : (state.conversationContext?.lastCommonRouteId || null),
    lastQueryState: context.lastQueryState !== undefined
      ? (context.lastQueryState ? JSON.parse(JSON.stringify(context.lastQueryState)) : null)
      : (state.conversationContext?.lastQueryState || null)
  };

  if (options.notify !== false) {
    notifyPersistence(chatId);
  }

  return state.conversationContext;
}

function getConversationContext(chatId) {
  return getChatState(chatId).conversationContext || {
    lastReferencedProfileId: null,
    lastComparedProfileId: null,
    lastResponseProfileId: null,
    lastResponseRoute: null,
    lastIntentId: null,
    lastExecutionTarget: null,
    lastResultFamily: null,
    lastAnswerStyle: null,
    lastResolvedQuestion: null,
    lastCommonRouteId: null,
    lastQueryState: null
  };
}

function getChoiceMap(chatId) {
  return getChatState(chatId).choiceMap || {};
}

function getAllInterpretationItems(payload) {
  const sections = payload?.interpretation?.sections;

  if (!sections || typeof sections !== 'object') {
    return [];
  }

  return Object.values(sections)
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);
}

function buildInterpretationMap(payload) {
  return new Map(
    getAllInterpretationItems(payload)
      .filter((item) => item?.key && item?.body)
      .map((item) => [String(item.key).toLowerCase(), String(item.body).replace(/\s+/g, ' ').trim()])
  );
}

function buildAnglesMap(anglesDetails) {
  const entries = Object.entries(anglesDetails || {});
  return Object.fromEntries(entries.map(([key, value]) => [normalizeAngleKey(key), value]));
}

function buildHousesMap(houses) {
  return Object.fromEntries(
    (Array.isArray(houses) ? houses : [])
      .filter((house) => house?.house)
      .map((house) => [String(house.house), house])
  );
}

function buildPlanetsMap(planets) {
  const entries = Array.isArray(planets) ? planets : [];
  return Object.fromEntries(
    entries.flatMap((planet) => {
      const keys = [String(planet.id || '').toLowerCase()];

      if (planet.name) {
        keys.push(String(planet.name).toLowerCase());
      }

      return keys.filter(Boolean).map((key) => [key, planet]);
    })
  );
}

function getAspectInterpretationKeys(aspect) {
  const p1 = String(aspect?.p1 || '').toLowerCase();
  const p2 = String(aspect?.p2 || '').toLowerCase();
  const type = String(aspect?.type || '').toLowerCase().replace(/\s+/g, '_');

  return [
    `aspect.${p1}.${type}.${p2}`,
    `aspect.${p2}.${type}.${p1}`
  ];
}

function normalizeNatalProfile(payload, cityLabel, options = {}) {
  const interpretationMap = buildInterpretationMap(payload);
  const planets = Array.isArray(payload?.planets) ? payload.planets : [];
  const majorAspects = (Array.isArray(payload?.aspects) ? payload.aspects : [])
    .filter((aspect) => aspect?.is_major)
    .sort((left, right) => (left.orb || 999) - (right.orb || 999))
    .map((aspect) => {
      const interpretation = getAspectInterpretationKeys(aspect)
        .map((key) => interpretationMap.get(key))
        .find(Boolean);

      return {
        ...aspect,
        interpretation: interpretation || null
      };
    });

  const planetsById = buildPlanetsMap(planets);
  const housesById = buildHousesMap(payload?.houses);
  const anglesById = buildAnglesMap(payload?.angles_details);
  const timeKnown = payload?.subject?.settings?.time_known !== false;

  const sun = planetsById.sun || null;
  const moon = planetsById.moon || null;
  const rising = anglesById.asc || null;

  return {
    name: payload?.subject?.name || 'Chart User',
    city: cityLabel,
    country: options.birthCountry || payload?.subject?.location?.country || null,
    birthDatetime: payload?.subject?.datetime || null,
    birthLocation: payload?.subject?.location || null,
    timeKnown,
    confidence: payload?.confidence?.overall || 'unknown',
    subject: payload?.subject || null,
    sun: sun ? { sign: sun.sign_id || sun.sign, house: sun.house || null, degree: sun.pos } : null,
    moon: moon ? { sign: moon.sign_id || moon.sign, house: moon.house || null, degree: moon.pos } : null,
    rising: rising ? { sign: rising.sign_id || rising.sign, house: rising.house || null, degree: rising.pos } : null,
    planets,
    planetsById,
    majorAspects,
    houses: Array.isArray(payload?.houses) ? payload.houses : [],
    housesById,
    angles: anglesById,
    stelliums: payload?.stelliums || null,
    interpretationMap,
    summaryText: [
      `Name: ${payload?.subject?.name || 'Chart User'}`,
      payload?.subject?.datetime ? `Birth datetime: ${payload.subject.datetime}` : null,
      `City: ${cityLabel}`,
      payload?.subject?.location?.timezone ? `Timezone: ${payload.subject.location.timezone}` : null,
      sun ? `Sun: ${humanizeIdentifier(sun.sign_id || sun.sign)}${sun.house ? ` in house ${sun.house}` : ''}` : null,
      moon ? `Moon: ${humanizeIdentifier(moon.sign_id || moon.sign)}${moon.house ? ` in house ${moon.house}` : ''}` : null,
      timeKnown && rising ? `Rising: ${humanizeIdentifier(rising.sign_id || rising.sign)}` : 'Rising unavailable without birth time'
    ].filter(Boolean).join('\n')
  };
}

function setProfileDirectory(identity, directory, options = {}) {
  const state = getChatState(identity);
  state.profileDirectory = Array.isArray(directory) ? directory.map((item) => ({ ...item })) : [];

  if (options.notify !== false) {
    notifyPersistence(identity);
  }

  return state.profileDirectory;
}

function getProfileDirectory(identity) {
  return getChatState(identity).profileDirectory || [];
}

function setFactAvailability(identity, availability, options = {}) {
  const state = getChatState(identity);
  state.factAvailability = {
    hasNatalFacts: Boolean(availability?.hasNatalFacts),
    indexedTransitCacheMonth: availability?.indexedTransitCacheMonth
      ? String(availability.indexedTransitCacheMonth)
      : null
  };

  if (options.notify !== false) {
    notifyPersistence(identity);
  }

  return state.factAvailability;
}

function setNatalProfile(chatId, rawNatalPayload, cityLabel, options = {}) {
  const state = getChatState(chatId);
  state.activeProfileId = options.activeProfileId || state.activeProfileId || null;
  state.rawNatalPayload = rawNatalPayload;
  state.natalRequestPayload = options.natalRequestPayload || null;
  state.chartRequestPayload = options.chartRequestPayload || null;
  state.natalProfile = normalizeNatalProfile(rawNatalPayload, cityLabel, options);

  if (options.notify !== false) {
    notifyPersistence(chatId);
  }

  return state.natalProfile;
}

function hydrateActiveProfile(chatId, profileRecord, options = {}) {
  const state = getChatState(chatId);

  if (!profileRecord) {
    state.activeProfileId = null;
    state.factAvailability = {
      hasNatalFacts: false,
      indexedTransitCacheMonth: null
    };
    state.rawNatalPayload = null;
    state.natalRequestPayload = null;
    state.chartRequestPayload = null;
    state.natalProfile = null;

    if (options.notify !== false) {
      notifyPersistence(chatId);
    }

    return null;
  }

  return setNatalProfile(
    chatId,
    profileRecord.rawNatalPayload,
    profileRecord.cityLabel,
    {
      activeProfileId: profileRecord.profileId,
      natalRequestPayload: profileRecord.natalRequestPayload,
      chartRequestPayload: profileRecord.chartRequestPayload,
      birthCountry: profileRecord.birthCountry,
      notify: options.notify
    }
  );
}

function getChatStateSnapshot(identity) {
  const state = getChatState(identity);
  return JSON.parse(JSON.stringify({
    channel: state.channel,
    userId: state.userId,
    chatId: state.chatId,
    locale: state.locale,
    localeSource: state.localeSource,
    platformLocaleHint: state.platformLocaleHint,
    activeProfileId: state.activeProfileId,
    responseMode: state.responseMode,
    profileDirectory: state.profileDirectory,
    factAvailability: state.factAvailability,
    history: state.history,
    activeFlow: state.activeFlow,
    lastToolResults: state.lastToolResults,
    pendingQuestion: state.pendingQuestion,
    pendingSynastryQuestion: state.pendingSynastryQuestion,
    conversationContext: state.conversationContext,
    choiceMap: state.choiceMap,
    uiCache: state.uiCache
  }));
}

function replaceChatState(identity, snapshot) {
  const key = resolveStateKey(identity);
  const normalized = resolveIdentity(identity);
  chats.set(key, {
    ...createDefaultState(identity),
    ...(snapshot || {}),
    channel: normalized.channel,
    userId: normalized.userId,
    chatId: normalized.chatId
  });
}

function setResponseMode(identity, responseMode) {
  const state = getChatState(identity);
  state.responseMode = responseMode === 'raw' ? 'raw' : 'interpreted';
  notifyPersistence(identity);
  return state.responseMode;
}

function getResponseMode(identity) {
  return getChatState(identity).responseMode === 'raw' ? 'raw' : 'interpreted';
}

function setPersistenceHook(nextHook) {
  persistenceHook = typeof nextHook === 'function' ? nextHook : null;
}

function notifyPersistence(identity) {
  if (!persistenceHook) {
    return;
  }

  Promise.resolve()
    .then(() => persistenceHook(identity))
    .catch(() => {});
}

module.exports = {
  clearNatalProfile,
  clearActiveFlow,
  consumePendingSynastryQuestion,
  consumePendingQuestion,
  getChoiceMap,
  getChatState,
  getConversationContext,
  getChatStateSnapshot,
  getProfileDirectory,
  getResponseMode,
  getUiCache,
  hydrateActiveProfile,
  normalizeNatalProfile,
  pushHistory,
  replaceChatState,
  resolveIdentity,
  resolveStateKey,
  setActiveFlow,
  setChoiceMap,
  setConversationContext,
  setFactAvailability,
  setLastToolResults,
  setNatalProfile,
  notifyPersistence,
  setPendingSynastryQuestion,
  setPendingQuestion,
  setPersistenceHook,
  setProfileDirectory,
  setResponseMode,
  setUiCache
};
