const { getLocale, t } = require('../services/locale');

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
  const normalizedId = String(signId || '').trim().toLowerCase();
  if (SIGN_LABELS[normalizedId]) {
    return SIGN_LABELS[normalizedId];
  }

  if (SIGN_LABELS[String(sign || '').trim().toLowerCase()]) {
    return SIGN_LABELS[String(sign || '').trim().toLowerCase()];
  }

  return sign || 'Unknown';
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

function formatNatalMessage(payload, city, locale = 'en') {
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
    `🌙 ${t(locale, 'natal.snapshotTitle')}`,
    '',
    `${t(locale, 'natal.name')}: ${subjectName}`,
    `${t(locale, 'natal.city')}: ${city}`,
    [houseSystem ? `${t(locale, 'natal.houseSystem')}: ${titleCase(houseSystem)}` : null, zodiacType].filter(Boolean).join(' • '),
    `${t(locale, 'natal.sun')}: ${formatPlanetPlacement(sun)}`,
    `${t(locale, 'natal.moon')}: ${formatPlanetPlacement(moon)}`,
    timed
      ? `${t(locale, 'natal.rising')}: ${formatAngleSign(rising)}${typeof rising?.pos === 'number' ? ` ${rising.pos.toFixed(1)}°` : ''}`
      : t(locale, 'natal.risingUnavailable'),
    timed && mc
      ? `${t(locale, 'natal.mc')}: ${formatAngleSign(mc)}${typeof mc?.pos === 'number' ? ` ${mc.pos.toFixed(1)}°` : ''}`
      : null,
    confidence ? `${t(locale, 'natal.confidence')}: ${titleCase(confidence)}` : null,
    stellium,
    topAspects.length > 0 ? '' : null,
    topAspects.length > 0 ? t(locale, 'natal.strongestAspects') : null,
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

function splitConversationReply(text, maxWords = 80, maxLength = 1200) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/\*/g, '')
    .replace(/`+/g, '')
    .trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    let current = '';

    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      const candidateWords = candidate.split(/\s+/).filter(Boolean).length;

      if (candidateWords <= maxWords && candidate.length <= maxLength) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = '';
      }

      const sentenceWords = sentence.split(/\s+/).filter(Boolean);

      if (sentenceWords.length <= maxWords && sentence.length <= maxLength) {
        current = sentence;
        continue;
      }

      let partial = [];

      for (const word of sentenceWords) {
        const candidatePartial = [...partial, word].join(' ');

        if (partial.length >= maxWords || candidatePartial.length > maxLength) {
          if (partial.length > 0) {
            chunks.push(partial.join(' '));
            partial = [word];
          } else {
            chunks.push(word.slice(0, maxLength));
            partial = [];
          }
        } else {
          partial.push(word);
        }
      }

      if (partial.length > 0) {
        current = partial.join(' ');
      }
    }

    if (current) {
      chunks.push(current);
    }
  }

  return chunks.filter(Boolean);
}

function formatUserError(error, identityOrLocale = 'en') {
  const locale = typeof identityOrLocale === 'string' ? identityOrLocale : getLocale(identityOrLocale);
  const message = error && error.message ? error.message : t(locale, 'errors.genericUnexpected');
  return `${t(locale, 'errors.starsUnavailable')}\n${message}`;
}

module.exports = {
  formatAspectInterpretationMessage,
  formatNatalMessage,
  formatUserError,
  getMajorAspectButtonsData,
  getPlanetPlacementButtonsData,
  splitConversationReply,
  splitMessage
};
