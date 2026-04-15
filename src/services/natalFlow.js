const { randomUUID } = require('node:crypto');
const { setActiveFlow, clearActiveFlow } = require('../state/chatState');

const sessions = new Map();
let persistenceHook = null;
const MAX_PROFILE_NAME_LENGTH = 60;

function resolveIdentity(identity) {
  if (identity && typeof identity === 'object') {
    return {
      channel: String(identity.channel || 'telegram'),
      chatId: String(identity.chatId || identity.userId || 'unknown')
    };
  }

  return {
    channel: 'telegram',
    chatId: String(identity)
  };
}

function resolveSessionKey(identity) {
  const normalized = resolveIdentity(identity);
  return `${normalized.channel}:${normalized.chatId}`;
}

function getSession(chatId) {
  return sessions.get(resolveSessionKey(chatId));
}

function setSession(chatId, session) {
  const key = resolveSessionKey(chatId);
  const previous = sessions.get(key);
  const flowId = session.flowId || previous?.flowId || randomUUID();
  const revision = previous?.flowId === flowId ? (previous?.revision || 0) + 1 : 1;
  const nextSession = {
    ...session,
    flowId,
    revision,
    locked: Boolean(session.locked)
  };

  sessions.set(key, nextSession);
  setActiveFlow(chatId, {
    name: 'natal',
    step: nextSession.step
  });
  notifyPersistence(chatId);
  return nextSession;
}

function clearSession(chatId) {
  sessions.delete(resolveSessionKey(chatId));
  clearActiveFlow(chatId);
  notifyPersistence(chatId);
}

function startNatalFlow(chatId, source = 'command', options = {}) {
  const session = {
    step: options.mode === 'add_secondary' ? 'name' : 'date',
    source,
    mode: options.mode || 'create_primary',
    targetProfileId: options.targetProfileId || null,
    profileName: options.profileName || null,
    pendingQuestion: null,
    cityCandidates: [],
    locked: false
  };
  return setSession(chatId, session);
}

function parseProfileNameInput(input) {
  const value = String(input || '').trim().replace(/\s+/g, ' ');

  if (!value) {
    return null;
  }

  return value.slice(0, MAX_PROFILE_NAME_LENGTH);
}

function createSessionCheckpoint(session) {
  if (!session) {
    return null;
  }

  return {
    flowId: session.flowId,
    revision: session.revision,
    step: session.step
  };
}

function isSessionCurrent(chatId, checkpoint, expectedStep) {
  const current = getSession(chatId);

  if (!current || !checkpoint) {
    return false;
  }

  if (current.flowId !== checkpoint.flowId || current.revision !== checkpoint.revision) {
    return false;
  }

  return expectedStep ? current.step === expectedStep : true;
}

function lockSession(chatId, flowId) {
  const current = getSession(chatId);

  if (!current || current.flowId !== flowId || current.locked) {
    return null;
  }

  return setSession(chatId, {
    ...current,
    locked: true
  });
}

function unlockSession(chatId, flowId) {
  const current = getSession(chatId);

  if (!current || current.flowId !== flowId) {
    return null;
  }

  return setSession(chatId, {
    ...current,
    locked: false
  });
}

function getSessionSnapshot(identity) {
  const session = getSession(identity);
  return session ? JSON.parse(JSON.stringify(session)) : null;
}

function replaceSession(identity, snapshot) {
  const key = resolveSessionKey(identity);

  if (!snapshot) {
    sessions.delete(key);
    clearActiveFlow(identity);
    return;
  }

  sessions.set(key, JSON.parse(JSON.stringify(snapshot)));
  setActiveFlow(identity, {
    name: 'natal',
    step: snapshot.step
  });
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

function parseDateInput(input) {
  const value = String(input || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsedDate = new Date(`${value}T00:00:00`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, month, day, raw: value };
}

function parseTimeInput(input) {
  const value = String(input || '').trim();

  if (!/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute, raw: value };
}

function createNatalPayload(session, cityMatch) {
  return {
    name: session.profileName || session.name || 'Chart User',
    year: session.birthDate.year,
    month: session.birthDate.month,
    day: session.birthDate.day,
    time_known: session.timeKnown,
    hour: session.timeKnown ? session.birthTime.hour : undefined,
    minute: session.timeKnown ? session.birthTime.minute : undefined,
    city: cityMatch.name,
    lat: cityMatch.lat,
    lng: cityMatch.lng,
    tz_str: cityMatch.timezone || 'AUTO',
    house_system: 'placidus',
    zodiac_type: 'tropical',
    include_speed: true,
    include_dignity: true,
    include_minor_aspects: true,
    include_stelliums: true,
    include_features: ['chiron', 'lilith', 'true_node'],
    interpretation: {
      enable: true,
      style: 'improved'
    }
  };
}

function createNatalChartPayload(session, cityMatch) {
  return {
    name: session.profileName || session.name || 'Chart User',
    year: session.birthDate.year,
    month: session.birthDate.month,
    day: session.birthDate.day,
    time_known: session.timeKnown,
    hour: session.timeKnown ? session.birthTime.hour : 12,
    minute: session.timeKnown ? session.birthTime.minute : 0,
    city: cityMatch.name,
    lat: cityMatch.lat,
    lng: cityMatch.lng,
    tz_str: cityMatch.timezone || 'AUTO',
    house_system: 'placidus',
    zodiac_type: 'tropical',
    format: 'png',
    size: 900,
    png_quality_scale: 2,
    theme_type: 'light',
    show_metadata: true,
    display_settings: {
      chiron: true,
      lilith: true,
      mc: session.timeKnown,
      dsc: session.timeKnown,
      ic: session.timeKnown
    },
    chart_config: {
      sign_line_width: 1.6,
      house_line_width: 0.9,
      asc_line_width: 2.4,
      dsc_line_width: 2.4,
      mc_line_width: 2.4,
      ic_line_width: 2.4,
      sign_ring_inner_width: 1.2,
      sign_ring_outer_width: 1.6,
      house_ring_inner_width: 0.8,
      house_ring_outer_width: 0.9,
      sign_tick_width: 0.45,
      aspect_conjunction_width: 2.2,
      aspect_opposition_width: 2.2,
      aspect_trine_width: 1.8,
      aspect_square_width: 2,
      aspect_sextile_width: 1.5,
      aspect_quincunx_width: 1.3
    }
  };
}

module.exports = {
  clearSession,
  createSessionCheckpoint,
  createNatalChartPayload,
  createNatalPayload,
  getSession,
  getSessionSnapshot,
  isSessionCurrent,
  lockSession,
  parseDateInput,
  parseProfileNameInput,
  parseTimeInput,
  replaceSession,
  setSession,
  setPersistenceHook,
  startNatalFlow,
  unlockSession
};
