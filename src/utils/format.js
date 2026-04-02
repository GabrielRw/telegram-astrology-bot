const SIGN_LABELS = {
  aries: 'Aries',
  taurus: 'Taurus',
  gemini: 'Gemini',
  cancer: 'Cancer',
  leo: 'Leo',
  virgo: 'Virgo',
  libra: 'Libra',
  scorpio: 'Scorpio',
  sagittarius: 'Sagittarius',
  capricorn: 'Capricorn',
  aquarius: 'Aquarius',
  pisces: 'Pisces'
};

const SIGN_EMOJIS = {
  aries: '♈',
  taurus: '♉',
  gemini: '♊',
  cancer: '♋',
  leo: '♌',
  virgo: '♍',
  libra: '♎',
  scorpio: '♏',
  sagittarius: '♐',
  capricorn: '♑',
  aquarius: '♒',
  pisces: '♓'
};

const SIGN_ABBREVIATIONS = {
  Ari: 'Aries',
  Tau: 'Taurus',
  Gem: 'Gemini',
  Can: 'Cancer',
  Leo: 'Leo',
  Vir: 'Virgo',
  Lib: 'Libra',
  Sco: 'Scorpio',
  Sag: 'Sagittarius',
  Cap: 'Capricorn',
  Aqu: 'Aquarius',
  Pis: 'Pisces'
};

function normalizeSign(input) {
  const sign = String(input || '').trim().toLowerCase();
  return SIGN_LABELS[sign] ? sign : null;
}

function getSignLabel(sign) {
  return SIGN_LABELS[sign] || sign;
}

function getSignEmoji(sign) {
  return SIGN_EMOJIS[sign] || '✨';
}

function titleCase(value) {
  const text = String(value || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}

function humanizeIdentifier(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => titleCase(part))
    .join(' ');
}

function resolveSignLabel(sign, signId) {
  const normalizedId = normalizeSign(signId);
  if (normalizedId) {
    return getSignLabel(normalizedId);
  }

  if (SIGN_ABBREVIATIONS[sign]) {
    return SIGN_ABBREVIATIONS[sign];
  }

  return sign || 'Unknown';
}

function formatStartMessage() {
  return [
    'FreeAstro Telegram Bot Starter Kit',
    '',
    'Try one of these commands:',
    '/daily leo',
    '/natal',
    '',
    'Note: /daily is a sign-based forecast, not a personal birth-chart reading.'
  ].join('\n');
}

function formatDailyMessage(payload) {
  const sign = payload?.data?.sign;
  const normalizedSign = normalizeSign(sign);
  const label = getSignLabel(normalizedSign || sign || 'Daily');
  const emoji = getSignEmoji(normalizedSign);
  const date = payload?.data?.date;
  const theme = payload?.data?.content?.theme;
  const summary = payload?.data?.content?.text || 'No horoscope text returned.';
  const scores = payload?.data?.scores;
  const astro = payload?.data?.astro;
  const lucky = payload?.data?.lucky;
  const keywords = Array.isArray(payload?.data?.content?.keywords)
    ? payload.data.content.keywords.slice(0, 3)
    : [];

  return [
    `${emoji} ${label} Daily Sign Forecast`,
    '',
    [
      date,
      theme ? `Theme: ${theme}` : null
    ].filter(Boolean).join(' • '),
    scores
      ? `Overall ${scores.overall} | Love ${scores.love} | Career ${scores.career} | Money ${scores.money} | Health ${scores.health}`
      : null,
    astro?.moon_sign?.label && astro?.moon_phase?.label
      ? `Moon: ${astro.moon_sign.label} • Phase: ${astro.moon_phase.label}`
      : null,
    lucky?.color?.label || lucky?.number || lucky?.time_window?.display
      ? `Lucky: ${[lucky?.color?.label, lucky?.number, lucky?.time_window?.display].filter(Boolean).join(' • ')}`
      : null,
    '',
    summary
      ? summary
      : null,
    keywords.length > 0 ? '' : null,
    keywords.length > 0 ? `Focus: ${keywords.join(', ')}` : null
  ].join('\n');
}

function formatAngleSign(angle) {
  if (!angle) {
    return 'Unknown';
  }

  return resolveSignLabel(angle.sign, angle.sign_id);
}

function pickPlanet(planets, id) {
  return Array.isArray(planets)
    ? planets.find((planet) => planet.id === id)
    : null;
}

function getInterpretationItems(payload) {
  const sections = payload?.interpretation?.sections;

  if (!sections || typeof sections !== 'object') {
    return [];
  }

  return Object.values(sections)
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);
}

function formatStellium(stelliums) {
  const signStellium = stelliums?.signs?.[0];

  if (!signStellium) {
    return null;
  }

  return `Stellium: ${getSignLabel(signStellium.sign_id)} (${signStellium.bodies.map(humanizeIdentifier).join(', ')})`;
}

function formatPlanetPlacement(planet) {
  if (!planet) {
    return 'Unknown';
  }

  const sign = resolveSignLabel(planet.sign, planet.sign_id);
  const degree = typeof planet.pos === 'number' ? `${planet.pos.toFixed(1)}°` : null;
  const house = planet.house ? `H${planet.house}` : null;
  const retrograde = planet.retrograde ? 'Rx' : null;

  return [sign, degree, house, retrograde].filter(Boolean).join(' • ');
}

function normalizeAspectType(type) {
  return titleCase(type);
}

function pickTightestAspects(aspects, limit = 2) {
  if (!Array.isArray(aspects)) {
    return [];
  }

  return [...aspects]
    .filter((aspect) => aspect && typeof aspect.orb === 'number')
    .sort((left, right) => {
      if (Boolean(right.is_major) !== Boolean(left.is_major)) {
        return Number(Boolean(right.is_major)) - Number(Boolean(left.is_major));
      }

      return left.orb - right.orb;
    })
    .slice(0, limit);
}

function formatNatalAspectLine(aspect) {
  return `• ${humanizeIdentifier(aspect.p1)} ${normalizeAspectType(aspect.type)} ${humanizeIdentifier(aspect.p2)} (${aspect.orb.toFixed(2)}°)`;
}

function getMajorAspects(payload) {
  if (!Array.isArray(payload?.aspects)) {
    return [];
  }

  return payload.aspects
    .filter((aspect) => aspect && aspect.is_major)
    .sort((left, right) => {
      const leftOrb = typeof left.orb === 'number' ? left.orb : 999;
      const rightOrb = typeof right.orb === 'number' ? right.orb : 999;
      return leftOrb - rightOrb;
    })
    .slice(0, 5);
}

function buildAspectInterpretationMap(payload) {
  const items = getInterpretationItems(payload).filter((item) => item?.category === 'aspect');

  return new Map(
    items
      .filter((item) => item && item.key && item.body)
      .map((item) => [
        String(item.key).toLowerCase(),
        {
          title: item.title || 'Aspect',
          text: String(item.body).replace(/\s+/g, ' ').trim()
        }
      ])
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

function getMajorAspectButtonsData(payload) {
  const interpretationMap = buildAspectInterpretationMap(payload);

  return getMajorAspects(payload).map((aspect) => {
    const interpretation = getAspectInterpretationKeys(aspect)
      .map((key) => interpretationMap.get(key))
      .find(Boolean) || null;

    return {
      label: `${humanizeIdentifier(aspect.p1)} ${normalizeAspectType(aspect.type)} ${humanizeIdentifier(aspect.p2)}`,
      summary: formatNatalAspectLine(aspect),
      interpretationTitle: interpretation?.title || `${humanizeIdentifier(aspect.p1)} ${normalizeAspectType(aspect.type)} ${humanizeIdentifier(aspect.p2)}`,
      interpretationText: interpretation?.text || 'No interpretation block was returned for this aspect.'
    };
  });
}

function buildPlanetInterpretationMap(payload) {
  const items = getInterpretationItems(payload).filter(
    (item) => item?.category === 'planet_sign' || item?.category === 'planet_house'
  );

  return new Map(
    items
      .filter((item) => item?.key && item?.body)
      .map((item) => [
        String(item.key).toLowerCase(),
        {
          title: item.title || 'Placement',
          text: String(item.body).replace(/\s+/g, ' ').trim()
        }
      ])
  );
}

function getPlanetPlacementButtonsData(payload) {
  const planets = Array.isArray(payload?.planets) ? payload.planets : [];
  const timed = payload?.subject?.settings?.time_known !== false;
  const interpretationMap = buildPlanetInterpretationMap(payload);

  return planets.map((planet) => {
    const signKey = `planet.${String(planet.id).toLowerCase()}.sign.${String(planet.sign_id || '').toLowerCase()}`;
    const houseKey = planet.house ? `planet.${String(planet.id).toLowerCase()}.house.${planet.house}` : null;
    const signInterpretation = interpretationMap.get(signKey);
    const houseInterpretation = houseKey ? interpretationMap.get(houseKey) : null;
    const parts = [
      signInterpretation ? `${signInterpretation.title}: ${signInterpretation.text}` : null,
      timed && houseInterpretation ? `${houseInterpretation.title}: ${houseInterpretation.text}` : null
    ].filter(Boolean);

    return {
      label: `${humanizeIdentifier(planet.name || planet.id)} placement`,
      summary: `• ${humanizeIdentifier(planet.name || planet.id)}: ${formatPlanetPlacement(planet)}`,
      interpretationTitle: `${humanizeIdentifier(planet.name || planet.id)} Placement`,
      interpretationText: parts.length > 0
        ? parts.join('\n\n')
        : 'No interpretation block was returned for this placement.'
    };
  });
}

function formatNatalMessage(payload, city) {
  const planets = payload?.planets || [];
  const sun = pickPlanet(planets, 'sun');
  const moon = pickPlanet(planets, 'moon');
  const rising = payload?.angles_details?.asc;
  const mc = payload?.angles_details?.mc;
  const topAspects = pickTightestAspects(payload?.aspects, 2);
  const confidence = payload?.confidence?.overall;
  const timed = payload?.subject?.settings?.time_known !== false;
  const subjectName = payload?.subject?.name || 'Telegram User';
  const houseSystem = payload?.subject?.settings?.house_system;
  const zodiacType = payload?.subject?.settings?.zodiac_type;
  const stellium = formatStellium(payload?.stelliums);

  return [
    '🌙 Natal Snapshot',
    '',
    `Name: ${subjectName}`,
    `City: ${city}`,
    [houseSystem ? `House system: ${titleCase(houseSystem)}` : null, zodiacType].filter(Boolean).join(' • '),
    `Sun: ${formatPlanetPlacement(sun)}`,
    `Moon: ${formatPlanetPlacement(moon)}`,
    timed
      ? `Rising: ${formatAngleSign(rising)}${typeof rising?.pos === 'number' ? ` ${rising.pos.toFixed(1)}°` : ''}`
      : 'Rising: unavailable without birth time',
    timed && mc
      ? `MC: ${formatAngleSign(mc)}${typeof mc?.pos === 'number' ? ` ${mc.pos.toFixed(1)}°` : ''}`
      : null,
    confidence ? `Confidence: ${titleCase(confidence)}` : null,
    stellium,
    topAspects.length > 0 ? '' : null,
    topAspects.length > 0 ? 'Strongest natal aspects:' : null,
    ...topAspects.map(formatNatalAspectLine)
  ].join('\n');
}

function formatAspectInterpretationMessage(aspectData) {
  return [
    `📘 ${aspectData.interpretationTitle}`,
    '',
    aspectData.interpretationText
  ].join('\n');
}

function splitMessage(text, maxLength = 3500) {
  const lines = String(text || '').split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = line;
      continue;
    }

    let remaining = line;
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    current = remaining;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

function formatUsage(command, example) {
  return [`Usage: ${command}`, `Example: ${example}`].join('\n');
}

function formatUserError(error) {
  const message = error && error.message ? error.message : 'Something went wrong.';
  return `Could not fetch the stars right now.\n${message}`;
}

module.exports = {
  formatAspectInterpretationMessage,
  formatDailyMessage,
  formatNatalMessage,
  formatStartMessage,
  formatUsage,
  formatUserError,
  getMajorAspectButtonsData,
  getPlanetPlacementButtonsData,
  getSignEmoji,
  normalizeSign,
  splitMessage
};
