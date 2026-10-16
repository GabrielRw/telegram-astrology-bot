const assert = require('node:assert/strict');

const {
  buildAnglesMap,
  buildPlanetsMap,
  normalizeNatalProfile
} = require('../src/domain/natalProfile');

function testBuildPlanetsMapUsesIdAndName() {
  const sun = { id: 'sun', name: 'Sun', sign_id: 'taurus' };
  const planets = buildPlanetsMap([sun]);

  assert.equal(planets.sun, sun);
}

function testBuildAnglesMapNormalizesKeys() {
  const asc = { sign_id: 'leo' };
  assert.deepEqual(buildAnglesMap({ ASC: asc }), {
    asc
  });
}

function testNormalizeNatalProfile() {
  const payload = {
    subject: {
      name: 'Ari',
      datetime: '1990-05-10T09:15:00',
      settings: { time_known: true },
      location: {
        country: 'France',
        timezone: 'Europe/Paris'
      }
    },
    confidence: { overall: 'high' },
    planets: [
      { id: 'sun', name: 'Sun', sign_id: 'taurus', house: 9, pos: 19 },
      { id: 'moon', name: 'Moon', sign_id: 'aries', house: 8, pos: 2 }
    ],
    houses: [{ house: 9, sign_id: 'taurus' }],
    angles_details: {
      ASC: { sign_id: 'leo', pos: 12 }
    },
    aspects: [
      { p1: 'sun', p2: 'moon', type: 'trine', is_major: true, orb: 1.5 },
      { p1: 'sun', p2: 'mars', type: 'square', is_major: false, orb: 0.5 }
    ],
    interpretation: {
      sections: {
        aspects: [
          { key: 'aspect.sun.trine.moon', body: '  Strong harmony.  ' }
        ]
      }
    }
  };

  const profile = normalizeNatalProfile(payload, 'Paris, France');

  assert.equal(profile.name, 'Ari');
  assert.equal(profile.city, 'Paris, France');
  assert.equal(profile.country, 'France');
  assert.deepEqual(profile.sun, { sign: 'taurus', house: 9, degree: 19 });
  assert.deepEqual(profile.moon, { sign: 'aries', house: 8, degree: 2 });
  assert.deepEqual(profile.rising, { sign: 'leo', house: null, degree: 12 });
  assert.equal(profile.majorAspects.length, 1);
  assert.equal(profile.majorAspects[0].interpretation, 'Strong harmony.');
  assert.match(profile.summaryText, /Sun: Taurus in house 9/);
  assert.match(profile.summaryText, /Rising: Leo/);
}

testBuildPlanetsMapUsesIdAndName();
testBuildAnglesMapNormalizesKeys();
testNormalizeNatalProfile();

console.log('ok');
