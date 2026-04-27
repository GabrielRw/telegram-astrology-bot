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
      }
    ]
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
}

testFrenchMoonPlacement();
testEnglishMoonPlacement();
testGermanMoonPlacement();
testSpanishMoonPlacement();
testPlacementIntegrityGuard();

console.log('ok');
