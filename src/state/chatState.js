const { normalizeNatalProfile } = require('../domain/natalProfile');

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
    pendingWeddingSelection: null,
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
      lastQueryState: null,
      lastAnswerArtifact: null
    },
    choiceMap: {},
    uiCache: {
      aspects: [],
      planets: [],
      citySelection: null
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
  state.pendingWeddingSelection = null;
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
    lastQueryState: null,
    lastAnswerArtifact: null
  };
  state.choiceMap = {};
  state.uiCache = {
    aspects: [],
    planets: [],
    citySelection: null
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
    planets: Array.isArray(cache?.planets) ? cache.planets : [],
    citySelection: cache?.citySelection && typeof cache.citySelection === 'object'
      ? JSON.parse(JSON.stringify(cache.citySelection))
      : null
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

function setPendingWeddingSelection(chatId, selection) {
  const state = getChatState(chatId);
  state.pendingWeddingSelection = selection && typeof selection === 'object'
    ? JSON.parse(JSON.stringify(selection))
    : null;
  notifyPersistence(chatId);
}

function getPendingWeddingSelection(chatId) {
  return getChatState(chatId).pendingWeddingSelection || null;
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
      : (state.conversationContext?.lastQueryState || null),
    lastAnswerArtifact: context.lastAnswerArtifact !== undefined
      ? (context.lastAnswerArtifact ? JSON.parse(JSON.stringify(context.lastAnswerArtifact)) : null)
      : (state.conversationContext?.lastAnswerArtifact || null)
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
    lastQueryState: null,
    lastAnswerArtifact: null
  };
}

function getChoiceMap(chatId) {
  return getChatState(chatId).choiceMap || {};
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
    pendingWeddingSelection: state.pendingWeddingSelection,
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
  state.responseMode = 'interpreted';
  notifyPersistence(identity);
  return state.responseMode;
}

function getResponseMode(identity) {
  return 'interpreted';
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
  getPendingWeddingSelection,
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
  setPendingWeddingSelection,
  setPendingQuestion,
  setPersistenceHook,
  setProfileDirectory,
  setResponseMode,
  setUiCache
};
