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

module.exports = {
  buildAnglesMap,
  buildHousesMap,
  buildInterpretationMap,
  buildPlanetsMap,
  getAllInterpretationItems,
  getAspectInterpretationKeys,
  humanizeIdentifier,
  normalizeAngleKey,
  normalizeNatalProfile
};
