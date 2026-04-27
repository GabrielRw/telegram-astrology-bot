const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

const profile = {
  profileName: 'Chart User',
  cityLabel: 'Paris, FR',
  birthCountry: 'FR',
  rawNatalPayload: {
    subject: {
      name: 'Chart User',
      datetime: '1995-09-05T20:00:00+02:00',
      location: {
        city: 'Paris',
        timezone: 'Europe/Paris'
      },
      settings: {
        time_known: true
      }
    },
    confidence: {
      overall: 'high'
    },
    planets: [
      {
        id: 'moon',
        name: 'Moon',
        sign: 'Cap',
        sign_id: 'capricorn',
        pos: 27.728,
        abs_pos: 297.728,
        house: 12
      },
      {
        id: 'sun',
        name: 'Sun',
        sign: 'Vir',
        sign_id: 'virgo',
        pos: 12.705,
        abs_pos: 162.705,
        house: 7
      },
      {
        id: 'jupiter',
        name: 'Jupiter',
        sign: 'Sag',
        sign_id: 'sagittarius',
        pos: 7.247,
        abs_pos: 247.247,
        house: 9
      },
      {
        id: 'mars',
        name: 'Mars',
        sign: 'Lib',
        sign_id: 'libra',
        pos: 3.45,
        abs_pos: 183.45,
        house: 8
      }
    ],
    angles_details: {
      asc: {
        name: 'Ascendant',
        sign: 'Can',
        sign_id: 'cancer',
        pos: 2.42,
        abs_pos: 92.42
      }
    }
  }
};

function testFrenchMoonPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'fr',
    profile,
    'En quel signe est ma lune et dans quelle maison?'
  );

  assert.match(text, /Lune se trouve en Capricorne, en maison 12/i);
  assert.match(text, /27\.728?°|27\.73°/i);
  assert.doesNotMatch(text, /Taureau/i);
  assert.doesNotMatch(text, /maison 7/i);
}

function testEnglishMoonPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'en',
    profile,
    'What sign and house is my moon in?'
  );

  assert.match(text, /Moon is in Capricorn, in house 12/i);
  assert.doesNotMatch(text, /Taurus/i);
  assert.doesNotMatch(text, /emotional needs/i);
}

function testEnglishMoonPlacementMeaning() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'en',
    profile,
    'What does my Moon sign say about me?'
  );

  assert.match(text, /Moon is in Capricorn, in house 12/i);
  assert.match(text, /emotional needs/i);
  assert.match(text, /Capricorn makes it/i);
  assert.match(text, /12th house/i);
  assert.doesNotMatch(text, /Taurus/i);
}

function testEnglishMoonMeaningFollowUp() {
  const first = __test.buildDeterministicNatalResponse(
    'en',
    profile,
    'What sign and house is my Moon in?'
  );
  const followUp = __test.buildDeterministicNatalResponse(
    'en',
    profile,
    'What does that mean emotionally?',
    {
      toolResults: first.usedTools,
      conversationContext: {
        lastCommonRouteId: first.routeId,
        lastQueryState: {
          canonicalRouteId: first.routeId
        }
      }
    }
  );

  assert.match(followUp.text, /Moon is in Capricorn, in house 12/i);
  assert.match(followUp.text, /emotional needs/i);
  assert.equal(followUp.routeId, 'moon_emotions');
}

function testEnglishRisingSign() {
  const text = __test.buildDeterministicNatalResponse(
    'en',
    profile,
    "What's my rising sign?"
  ).text;

  assert.match(text, /Ascendant is in Cancer/i);
  assert.match(text, /Exact position in the sign: 2\.42°/i);
  assert.doesNotMatch(text, /relationships and how you engage/i);
}

function testGermanMoonPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'de',
    profile,
    'In welchem Zeichen und Haus steht mein Mond?'
  );

  assert.match(text, /Mond.*Steinbock.*Haus 12/i);
  assert.doesNotMatch(text, /Stier/i);
}

function testSpanishMoonPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'es',
    profile,
    'En qué signo y casa está mi Luna?'
  );

  assert.match(text, /Luna.*Capricornio.*casa 12/i);
  assert.doesNotMatch(text, /Tauro/i);
}

function testPlacementIntegrityGuard() {
  assert.equal(
    __test.validateNatalPlacementIntegrity('Votre Lune se trouve en Taureau, en maison 7.', profile),
    false
  );
  assert.equal(
    __test.validateNatalPlacementIntegrity('Votre Lune se trouve en Capricorne, en maison 12.', profile),
    true
  );
  assert.equal(
    __test.validateNatalPlacementIntegrity('Der Mond steht in Stier, in Haus 7.', profile),
    false
  );
  assert.equal(
    __test.validateNatalPlacementIntegrity('La Luna está en Tauro, en la casa 7.', profile),
    false
  );
  assert.equal(
    __test.validateNatalPlacementIntegrity('Jupiter est en Cancer, en maison 8.', profile),
    false
  );
  assert.equal(
    __test.validateNatalPlacementIntegrity('Jupiter est en Sagittaire, en maison 9.', profile),
    true
  );
}

function testFrenchMultiPlanetPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'fr',
    profile,
    'verifie dans quel signe est ma lune et mon jupiter'
  );

  assert.match(text, /Lune: Capricorne, maison 12, 27\.73°/i);
  assert.match(text, /Jupiter: Sagittaire, maison 9, 7\.25°/i);
  assert.doesNotMatch(text, /Nœud Nord|Noeud Nord|karmique|Saturne/i);
}

function testMultiPlanetPlacementAcrossLocales() {
  const cases = [
    {
      locale: 'en',
      question: 'Check what sign and house my Moon and Jupiter are in',
      expectedMoon: /Moon: Capricorn, house 12, 27\.73°/i,
      expectedJupiter: /Jupiter: Sagittarius, house 9, 7\.25°/i,
      forbidden: /North Node|karmic|Saturn/i
    },
    {
      locale: 'de',
      question: 'Prüfe in welchem Zeichen und Haus mein Mond und Jupiter stehen',
      expectedMoon: /Mond: Steinbock, Haus 12, 27\.73°/i,
      expectedJupiter: /Jupiter: Schütze, Haus 9, 7\.25°/i,
      forbidden: /Karm|Saturn/i
    },
    {
      locale: 'es',
      question: 'Verifica en qué signo y casa están mi Luna y mi Júpiter',
      expectedMoon: /Luna: Capricornio, casa 12, 27\.73°/i,
      expectedJupiter: /J[úu]piter: Sagitario, casa 9, 7\.25°/i,
      forbidden: /Nodo Norte|kárm|Saturno/i
    }
  ];

  for (const item of cases) {
    const text = __test.buildDirectPlanetPlacementResponse(item.locale, profile, item.question);
    assert.match(text, item.expectedMoon);
    assert.match(text, item.expectedJupiter);
    assert.doesNotMatch(text, item.forbidden);
  }
}

function testFollowUpRewrittenMultiPlanetPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'fr',
    profile,
    'En quel signe est ma lune et mon jupiter ?\n\nFollow-up request: et Jupiter ?'
  );

  assert.match(text, /Jupiter se trouve en Sagittaire, en maison 9/i);
  assert.doesNotMatch(text, /Lune/i);
  assert.doesNotMatch(text, /karmique|Saturne/i);
}

function testPlanetOnlyFollowUpPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'fr',
    profile,
    'et Jupiter ?',
    { allowPlanetOnly: true }
  );

  assert.match(text, /Jupiter se trouve en Sagittaire, en maison 9/i);
  assert.doesNotMatch(text, /Nœud Nord|Noeud Nord|karmique|Saturne|Lune/i);
}

function testNoisyPlanetOnlyFollowUpPlacement() {
  const text = __test.buildDirectPlanetPlacementResponse(
    'fr',
    profile,
    '?? et mars alors',
    { allowPlanetOnly: true }
  );

  assert.match(text, /Mars se trouve en Balance, en maison 8/i);
  assert.doesNotMatch(text, /Soleil|Vénus|Nœud Nord|Noeud Nord|karmique/i);
}

testFrenchMoonPlacement();
testEnglishMoonPlacement();
testEnglishMoonPlacementMeaning();
testEnglishMoonMeaningFollowUp();
testEnglishRisingSign();
testGermanMoonPlacement();
testSpanishMoonPlacement();
testPlacementIntegrityGuard();
testFrenchMultiPlanetPlacement();
testMultiPlanetPlacementAcrossLocales();
testFollowUpRewrittenMultiPlanetPlacement();
testPlanetOnlyFollowUpPlacement();
testNoisyPlanetOnlyFollowUpPlacement();

console.log('ok');
