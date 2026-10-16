// Checks natal sign/house claims in answer text against the computed chart.
// Used by the answer eval; deliberately conservative (explicit "X in Y" phrasing only).

const SIGN_ALIASES = {
  aries: ['aries', 'belier', 'widder'],
  taurus: ['taurus', 'taureau', 'stier', 'tauro'],
  gemini: ['gemini', 'gemeaux', 'zwillinge', 'zwillingen', 'geminis'],
  cancer: ['cancer', 'krebs'],
  leo: ['leo', 'lion', 'lowe', 'loewe', 'lowen', 'loewen'],
  virgo: ['virgo', 'vierge', 'jungfrau'],
  libra: ['libra', 'balance', 'waage'],
  scorpio: ['scorpio', 'scorpion', 'skorpion', 'escorpio', 'escorpion'],
  sagittarius: ['sagittarius', 'sagittaire', 'schutze', 'schuetze', 'schutzen', 'schuetzen', 'sagitario'],
  capricorn: ['capricorn', 'capricorne', 'steinbock', 'capricornio'],
  aquarius: ['aquarius', 'verseau', 'wassermann', 'acuario'],
  pisces: ['pisces', 'poissons', 'fische', 'fischen', 'piscis']
};

const BODY_ALIASES = {
  sun: ['sun', 'soleil', 'sonne', 'sol'],
  moon: ['moon', 'lune', 'mond', 'luna'],
  mercury: ['mercury', 'mercure', 'merkur', 'mercurio'],
  venus: ['venus'],
  mars: ['mars', 'marte'],
  jupiter: ['jupiter'],
  saturn: ['saturn', 'saturne', 'saturno'],
  uranus: ['uranus', 'urano'],
  neptune: ['neptune', 'neptun', 'neptuno'],
  pluto: ['pluto', 'pluton'],
  ascendant: ['ascendant', 'rising', 'rising sign', 'aszendent', 'ascendente'],
  midheaven: ['midheaven', 'mc', 'milieu du ciel', 'medium coeli', 'medio cielo']
};

const ORDINAL_WORDS = {
  1: ['first', 'premiere', 'ersten', 'primera'],
  2: ['second', 'deuxieme', 'zweiten', 'segunda'],
  3: ['third', 'troisieme', 'dritten', 'tercera'],
  4: ['fourth', 'quatrieme', 'vierten', 'cuarta'],
  5: ['fifth', 'cinquieme', 'funften', 'fuenften', 'quinta'],
  6: ['sixth', 'sixieme', 'sechsten', 'sexta'],
  7: ['seventh', 'septieme', 'siebten', 'septima'],
  8: ['eighth', 'huitieme', 'achten', 'octava'],
  9: ['ninth', 'neuvieme', 'neunten', 'novena'],
  10: ['tenth', 'dixieme', 'zehnten', 'decima'],
  11: ['eleventh', 'onzieme', 'elften', 'undecima'],
  12: ['twelfth', 'douzieme', 'zwolften', 'zwoelften', 'duodecima']
};

const TRANSIT_CONTEXT = /\b(?:transit\w*|progress\w*|return|retour|ruckkehr|retorno|currently|actuellement|derzeit|actualmente|today|aujourd|heute|hoy|now|maintenant|jetzt|ahora)\b[^.!?]{0,25}$/;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(values) {
  return [...new Set(values)].sort((left, right) => right.length - left.length).map(escape).join('|');
}

const SIGN_PATTERN = alternation(Object.values(SIGN_ALIASES).flat());
const BODY_PATTERN = alternation(Object.values(BODY_ALIASES).flat());
const IN_PATTERN = '(?:is\\s+|est\\s+|ist\\s+|steht\\s+|esta\\s+|se\\s+encuentra\\s+)?(?:placed\\s+|located\\s+)?(?:in|en|im|dans)';
const ARTICLE_PATTERN = '(?:the\\s+|your\\s+|le\\s+|la\\s+|el\\s+|der\\s+|dem\\s+|den\\s+|sign\\s+of\\s+|signe\\s+du\\s+|signo\\s+de\\s+)?';
const HOUSE_WORD = '(?:house|maison|haus|casa)';
const HOUSE_NUMBER_PATTERN = `(?:(\\d{1,2})(?:st|nd|rd|th|e|eme|\\.|a|o)?\\s+${HOUSE_WORD}|${HOUSE_WORD}\\s+(\\d{1,2})\\b|(${alternation(Object.values(ORDINAL_WORDS).flat())})\\s+${HOUSE_WORD})`;

const SIGN_CLAIM_REGEXES = [
  new RegExp(`\\b(${BODY_PATTERN})\\s+${IN_PATTERN}\\s+${ARTICLE_PATTERN}(${SIGN_PATTERN})\\b`, 'g'),
  new RegExp(`\\b(${BODY_PATTERN})(?:\\s+sign)?\\s+(?:is|est|ist|es)\\s+(?:in\\s+|en\\s+)?(${SIGN_PATTERN})\\b`, 'g')
];
const SIGN_BEFORE_BODY_REGEX = new RegExp(`\\b(${SIGN_PATTERN})\\s+(sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|rising|ascendant|midheaven)\\b`, 'g');
const HOUSE_CLAIM_REGEX = new RegExp(
  `\\b(${BODY_PATTERN})\\s+${IN_PATTERN}\\s+(?:${ARTICLE_PATTERN}(?:${SIGN_PATTERN})\\s*,?\\s+(?:in|en|im|dans)\\s+)?${ARTICLE_PATTERN}${HOUSE_NUMBER_PATTERN}`,
  'g'
);

function resolveAlias(map, value) {
  const normalized = normalize(value).trim();
  return Object.keys(map).find((key) => map[key].includes(normalized)) || null;
}

function ordinalToNumber(word) {
  const normalized = normalize(word);
  const entry = Object.entries(ORDINAL_WORDS).find(([, words]) => words.includes(normalized));
  return entry ? Number(entry[0]) : null;
}

function buildChartTruth(natalProfile) {
  const bodies = {};
  const planets = natalProfile?.planetsById || {};

  for (const body of Object.keys(BODY_ALIASES)) {
    const planet = planets[body];
    if (planet?.sign_id) {
      bodies[body] = { sign: planet.sign_id, house: planet.house || null, retrograde: Boolean(planet.retrograde) };
    }
  }

  const asc = natalProfile?.angles?.asc;
  if (asc?.sign_id) {
    bodies.ascendant = { sign: asc.sign_id, house: 1, retrograde: false };
  }
  const mc = natalProfile?.angles?.mc;
  if (mc?.sign_id) {
    bodies.midheaven = { sign: mc.sign_id, house: 10, retrograde: false };
  }

  const majorAspects = Array.isArray(natalProfile?.majorAspects) ? natalProfile.majorAspects : [];
  const tightest = majorAspects
    .filter((aspect) => BODY_ALIASES[aspect.p1] && BODY_ALIASES[aspect.p2])
    .sort((left, right) => Math.abs(left.orb) - Math.abs(right.orb))[0] || null;

  return {
    bodies,
    tightestMajorAspect: tightest ? { p1: tightest.p1, p2: tightest.p2, type: tightest.type, orb: tightest.orb } : null
  };
}

function isTransitContext(text, index) {
  return TRANSIT_CONTEXT.test(text.slice(Math.max(0, index - 60), index));
}

function excerptAt(text, index, length) {
  return text.slice(Math.max(0, index - 10), Math.min(text.length, index + length + 10)).trim();
}

function findNatalClaimContradictions(answerText, truth) {
  const text = normalize(answerText);
  const contradictions = [];
  const seen = new Set();
  const push = (entry) => {
    const key = `${entry.body}:${entry.field}:${entry.claimed}`;
    if (!seen.has(key)) {
      seen.add(key);
      contradictions.push(entry);
    }
  };

  const checkSign = (bodyText, signText, index, length) => {
    const body = resolveAlias(BODY_ALIASES, bodyText);
    const sign = resolveAlias(SIGN_ALIASES, signText);
    const actual = truth?.bodies?.[body]?.sign;
    if (body && sign && actual && sign !== actual && !isTransitContext(text, index)) {
      push({ body, field: 'sign', claimed: sign, actual, excerpt: excerptAt(text, index, length) });
    }
  };

  for (const regex of SIGN_CLAIM_REGEXES) {
    for (const match of text.matchAll(regex)) {
      checkSign(match[1], match[2], match.index, match[0].length);
    }
  }

  for (const match of text.matchAll(SIGN_BEFORE_BODY_REGEX)) {
    checkSign(match[2], match[1], match.index, match[0].length);
  }

  for (const match of text.matchAll(HOUSE_CLAIM_REGEX)) {
    const body = resolveAlias(BODY_ALIASES, match[1]);
    const claimed = Number(match[2] || match[3]) || ordinalToNumber(match[4] || '');
    const actual = truth?.bodies?.[body]?.house;
    if (body && claimed && actual && claimed !== actual && !isTransitContext(text, match.index)) {
      push({ body, field: 'house', claimed, actual, excerpt: excerptAt(text, match.index, match[0].length) });
    }
  }

  return contradictions;
}

function mentionsSign(text, sign) {
  return SIGN_ALIASES[sign].some((alias) => new RegExp(`\\b${escape(alias)}\\b`).test(text));
}

function mentionsBody(text, body) {
  return BODY_ALIASES[body].some((alias) => new RegExp(`\\b${escape(alias)}\\b`).test(text));
}

function mentionsHouse(text, house) {
  const words = ORDINAL_WORDS[house].map(escape).join('|');
  return new RegExp(
    `\\b${house}(?:st|nd|rd|th|e|eme|\\.|a|o)?\\s+${HOUSE_WORD}\\b|\\b${HOUSE_WORD}\\s+${house}\\b|\\b(?:${words})\\s+${HOUSE_WORD}\\b`
  ).test(text);
}

// mentionKeys: "<body>.sign", "<body>.house", or "strongest_aspect".
function findMissingMentions(answerText, truth, mentionKeys = []) {
  const text = normalize(answerText);
  const missing = [];

  for (const key of mentionKeys) {
    if (key === 'strongest_aspect') {
      const aspect = truth?.tightestMajorAspect;
      if (!aspect || !mentionsBody(text, aspect.p1) || !mentionsBody(text, aspect.p2)) {
        missing.push({ key, expected: aspect ? `${aspect.p1} ${aspect.type} ${aspect.p2}` : null });
      }
      continue;
    }

    const [body, field] = key.split('.');
    const fact = truth?.bodies?.[body];
    if (!fact || !fact[field]) {
      missing.push({ key, expected: null });
      continue;
    }

    const present = field === 'sign' ? mentionsSign(text, fact.sign) : mentionsHouse(text, fact.house);
    if (!present) {
      missing.push({ key, expected: fact[field] });
    }
  }

  return missing;
}

module.exports = {
  buildChartTruth,
  findMissingMentions,
  findNatalClaimContradictions
};
