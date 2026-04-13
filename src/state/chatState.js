const MAX_HISTORY_ITEMS = 12;

const chats = new Map();

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

function createDefaultState(chatId) {
  return {
    chatId: String(chatId),
    natalProfile: null,
    rawNatalPayload: null,
    history: [],
    activeFlow: null,
    lastToolResults: [],
    pendingQuestion: null,
    uiCache: {
      aspects: [],
      planets: []
    }
  };
}

function getChatState(chatId) {
  const key = String(chatId);

  if (!chats.has(key)) {
    chats.set(key, createDefaultState(chatId));
  }

  return chats.get(key);
}

function setActiveFlow(chatId, activeFlow) {
  const state = getChatState(chatId);
  state.activeFlow = activeFlow;
  return state.activeFlow;
}

function clearActiveFlow(chatId) {
  const state = getChatState(chatId);
  state.activeFlow = null;
}

function setLastToolResults(chatId, results) {
  const state = getChatState(chatId);
  state.lastToolResults = Array.isArray(results) ? results.slice(-6) : [];
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
}

function setUiCache(chatId, cache) {
  const state = getChatState(chatId);
  state.uiCache = {
    aspects: Array.isArray(cache?.aspects) ? cache.aspects : [],
    planets: Array.isArray(cache?.planets) ? cache.planets : []
  };
}

function setPendingQuestion(chatId, question) {
  const state = getChatState(chatId);
  state.pendingQuestion = question ? String(question) : null;
}

function consumePendingQuestion(chatId) {
  const state = getChatState(chatId);
  const question = state.pendingQuestion;
  state.pendingQuestion = null;
  return question;
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

function normalizeNatalProfile(payload, cityLabel) {
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
    name: payload?.subject?.name || 'Telegram User',
    city: cityLabel,
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
      `Name: ${payload?.subject?.name || 'Telegram User'}`,
      payload?.subject?.datetime ? `Birth datetime: ${payload.subject.datetime}` : null,
      `City: ${cityLabel}`,
      payload?.subject?.location?.timezone ? `Timezone: ${payload.subject.location.timezone}` : null,
      sun ? `Sun: ${humanizeIdentifier(sun.sign_id || sun.sign)}${sun.house ? ` in house ${sun.house}` : ''}` : null,
      moon ? `Moon: ${humanizeIdentifier(moon.sign_id || moon.sign)}${moon.house ? ` in house ${moon.house}` : ''}` : null,
      timeKnown && rising ? `Rising: ${humanizeIdentifier(rising.sign_id || rising.sign)}` : 'Rising unavailable without birth time'
    ].filter(Boolean).join('\n')
  };
}

function setNatalProfile(chatId, rawNatalPayload, cityLabel) {
  const state = getChatState(chatId);
  state.rawNatalPayload = rawNatalPayload;
  state.natalProfile = normalizeNatalProfile(rawNatalPayload, cityLabel);
  return state.natalProfile;
}

module.exports = {
  clearActiveFlow,
  consumePendingQuestion,
  getChatState,
  pushHistory,
  setActiveFlow,
  setLastToolResults,
  setNatalProfile,
  setPendingQuestion,
  setUiCache
};
