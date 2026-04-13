const { setActiveFlow, clearActiveFlow } = require('../state/chatState');

const sessions = new Map();

function getSession(chatId) {
  return sessions.get(String(chatId));
}

function setSession(chatId, session) {
  sessions.set(String(chatId), session);
  setActiveFlow(chatId, {
    name: 'natal',
    step: session.step
  });
}

function clearSession(chatId) {
  sessions.delete(String(chatId));
  clearActiveFlow(chatId);
}

function startNatalFlow(chatId, source = 'command') {
  const session = {
    step: 'name',
    source,
    pendingQuestion: null,
    cityCandidates: []
  };
  setSession(chatId, session);
  return session;
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
    name: session.name || 'Telegram User',
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
    name: session.name || 'Telegram User',
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
  createNatalChartPayload,
  createNatalPayload,
  getSession,
  parseDateInput,
  parseTimeInput,
  setSession,
  startNatalFlow
};
