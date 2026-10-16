const assert = require('node:assert/strict');

const { buildChartTruth, findMissingMentions, findNatalClaimContradictions } = require('../src/domain/natalClaimCheck');

const NATAL_PROFILE = {
  planetsById: {
    sun: { sign_id: 'taurus', house: 9, retrograde: false },
    moon: { sign_id: 'capricorn', house: 5, retrograde: false },
    venus: { sign_id: 'aries', house: 8, retrograde: false },
    jupiter: { sign_id: 'cancer', house: 10, retrograde: false },
    uranus: { sign_id: 'capricorn', house: 4, retrograde: true },
    chiron: { sign_id: 'cancer', house: 11 }
  },
  angles: {
    asc: { sign_id: 'virgo' },
    mc: { sign_id: 'gemini' }
  },
  majorAspects: [
    { p1: 'chiron', p2: 'venus', type: 'square', orb: 0.2 },
    { p1: 'jupiter', p2: 'uranus', type: 'opposition', orb: 0.36 },
    { p1: 'moon', p2: 'sun', type: 'trine', orb: 3 }
  ]
};

const truth = buildChartTruth(NATAL_PROFILE);

function claims(text) {
  return findNatalClaimContradictions(text, truth).map(({ body, field, claimed }) => `${body}.${field}=${claimed}`);
}

function testTruthIsBuiltFromProfile() {
  assert.deepEqual(truth.bodies.sun, { sign: 'taurus', house: 9, retrograde: false });
  assert.deepEqual(truth.bodies.ascendant, { sign: 'virgo', house: 1, retrograde: false });
  assert.equal(truth.bodies.midheaven.sign, 'gemini');
  // Chiron is not a checked body, so the tightest checkable aspect wins.
  assert.deepEqual(truth.tightestMajorAspect, { p1: 'jupiter', p2: 'uranus', type: 'opposition', orb: 0.36 });
}

function testCorrectClaimsPass() {
  for (const text of [
    'Your Sun is in Taurus in the 9th house, and your Moon is in Capricorn.',
    'Votre Soleil en Taureau se trouve dans la 9e maison.',
    'Deine Sonne steht im Stier, im 9. Haus.',
    'Tu Sol está en Tauro, en la casa 9.',
    'With a Virgo rising and a Taurus Sun, you are practical.',
    'Your rising sign is Virgo.'
  ]) {
    assert.deepEqual(claims(text), [], text);
  }
}

function testWrongSignsAreCaughtInEveryLanguage() {
  assert.deepEqual(claims('Your Venus is in Taurus.'), ['venus.sign=taurus']);
  assert.deepEqual(claims('Votre Lune en Cancer vous rend sensible.'), ['moon.sign=cancer']);
  assert.deepEqual(claims('Dein Aszendent im Löwen wirkt stark.'), ['ascendant.sign=leo']);
  assert.deepEqual(claims('Tu Sol en Géminis te hace curioso.'), ['sun.sign=gemini']);
  assert.deepEqual(claims('As a Leo Sun you shine.'), ['sun.sign=leo']);
}

function testWrongHousesAreCaught() {
  assert.deepEqual(claims('Your Sun in Taurus in the 10th house drives ambition.'), ['sun.house=10']);
  assert.deepEqual(claims('Your Moon is in the fourth house.'), ['moon.house=4']);
  assert.deepEqual(claims('Votre Lune dans la maison 2 cherche la sécurité.'), ['moon.house=2']);
}

function testTransitClaimsAreIgnored() {
  assert.deepEqual(claims('This month, transiting Venus in Taurus trines your Moon.'), []);
  assert.deepEqual(claims('Today the Moon is in Leo.'), []);
}

function testMentionsAreResolvedAgainstTheChart() {
  const keys = ['sun.sign', 'sun.house', 'ascendant.sign', 'strongest_aspect'];

  assert.deepEqual(
    findMissingMentions('Sun in Taurus, 9th house, Virgo rising, Jupiter opposite Uranus.', truth, keys),
    []
  );
  assert.deepEqual(
    findMissingMentions('Soleil en Taureau, maison 9, ascendant Vierge, Jupiter opposé à Uranus.', truth, keys),
    []
  );
  assert.deepEqual(
    findMissingMentions('Your Sun is in Gemini.', truth, ['sun.sign', 'strongest_aspect']).map((entry) => entry.key),
    ['sun.sign', 'strongest_aspect']
  );
  assert.deepEqual(findMissingMentions('Mercury things.', truth, ['mercury.sign']), [{ key: 'mercury.sign', expected: null }]);
}

testTruthIsBuiltFromProfile();
testCorrectClaimsPass();
testWrongSignsAreCaughtInEveryLanguage();
testWrongHousesAreCaught();
testTransitClaimsAreIgnored();
testMentionsAreResolvedAgainstTheChart();
console.log('ok natal claim check tests');
