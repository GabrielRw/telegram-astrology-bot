const assert = require('node:assert/strict');

const { getMoonPhase } = require('../src/services/freeastro');
const { __test } = require('../src/services/conversation');
const moonPhaseVisual = require('../src/services/moonPhaseVisual');

const profile = {
  profileName: 'Chart User',
  timezone: 'Europe/Paris',
  lat: 48.8566,
  lng: 2.3522,
  natalRequestPayload: {
    lat: 48.8566,
    lng: 2.3522,
    tz_str: 'Europe/Paris'
  }
};

const moonPhasePayload = {
  timestamp: '2026-05-24T12:00:00Z',
  phase: {
    name: 'Waxing Gibbous',
    phase_angle_deg: 135.4,
    illumination: 0.785,
    age_days: 10.6,
    distance_km: 384400,
    is_waxing: true
  },
  moon_visual: {
    type: 'svg',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#111"/><path d="M 50 5 A 45 45 0 0 1 50 95 A 20 45 0 0 1 50 5 Z" fill="#eee"/></svg>',
    shadow_ratio: 0.215,
    waxing: true
  },
  next_phases: {
    new_moon: '2026-06-10T10:10:00Z',
    full_moon: '2026-05-31T20:20:00Z'
  },
  zodiac: {
    sign: 'Leo',
    sign_id: 'leo',
    degree: 15.42
  },
  special_moon: {
    is_supermoon: true,
    labels: ['Supermoon']
  },
  eclipse: {
    is_eclipse: true,
    is_blood_moon: true,
    type: 'total',
    date: '2026-05-24T11:33:00Z',
    visibility: 'Europe',
    visible_at_location: true
  },
  forecast: {
    days_until_full_moon: 7.2,
    days_until_new_moon: 17.3
  },
  traditional_moon: {
    name: 'Flower Moon',
    applies_to_full_moon_at: '2026-05-31T20:20:00Z',
    is_current_full_moon: true
  }
};

async function testFreeAstroMoonPhaseWrapper() {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.FREEASTRO_API_KEY;
  let captured = null;

  process.env.FREEASTRO_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null;
        }
      },
      async text() {
        return JSON.stringify(moonPhasePayload);
      }
    };
  };

  try {
    const result = await getMoonPhase({
      date: '2026-05-24T12:00:00',
      lat: 48.8566,
      lon: 2.3522,
      tz_str: 'Europe/Paris',
      include_zodiac: true,
      include_special: true,
      include_visuals: true
    });
    assert.equal(result.phase.name, 'Waxing Gibbous');

    const url = new URL(captured.url);
    assert.equal(url.origin, 'https://api.freeastroapi.com');
    assert.equal(url.pathname, '/api/v1/moon/phase');
    assert.equal(url.searchParams.get('date'), '2026-05-24T12:00:00');
    assert.equal(url.searchParams.get('lat'), '48.8566');
    assert.equal(url.searchParams.get('lon'), '2.3522');
    assert.equal(url.searchParams.get('tz_str'), 'Europe/Paris');
    assert.equal(url.searchParams.get('include_zodiac'), 'true');
    assert.equal(url.searchParams.get('include_special'), 'true');
    assert.equal(url.searchParams.get('include_visuals'), 'true');
    assert.equal(captured.options.headers['x-api-key'], 'test-key');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.FREEASTRO_API_KEY;
    } else {
      process.env.FREEASTRO_API_KEY = originalApiKey;
    }
  }
}

function testMoonPhaseRequestFromProfile() {
  const request = __test.buildCurrentMoonPhaseRequest(profile, {
    date: '2026-05-24T12:00:00',
    localDate: '2026-05-24'
  });

  assert.equal(request.timezone, 'Europe/Paris');
  assert.equal(request.localDate, '2026-05-24');
  assert.equal(request.params.date, '2026-05-24T12:00:00');
  assert.equal(request.params.lat, 48.8566);
  assert.equal(request.params.lon, 2.3522);
  assert.equal(request.params.tz_str, 'Europe/Paris');
  assert.equal(request.params.include_zodiac, true);
  assert.equal(request.params.include_special, true);
  assert.equal(request.params.include_eclipse, true);
  assert.equal(request.params.include_forecast, true);
  assert.equal(request.params.include_traditional_moon, true);
  assert.equal(request.params.include_visuals, true);
}

function testMoonPhaseFactConversion() {
  const details = __test.extractCurrentMoonPhaseDetails(moonPhasePayload);
  assert.equal(details.phaseName, 'Waxing Gibbous');
  assert.equal(details.illumination, '79%');
  assert.equal(details.ageDays, '10.6');
  assert.deepEqual(details.specialLabels, ['Supermoon']);
  assert.equal(details.zodiacLabel, 'Leo 15.4°');
  assert.match(details.eclipseLabel, /Blood Moon/i);

  const fact = __test.buildCurrentMoonPhaseFact(moonPhasePayload, profile, {
    timezone: 'Europe/Paris',
    localDate: '2026-05-24'
  });

  assert.equal(fact.title, 'Current Moon Phase: Waxing Gibbous (Supermoon)');
  assert.equal(fact.sourceKind, 'monthly_transit');
  assert.equal(fact.sourceToolName, 'rest_moon_phase');
  assert.match(fact.factText, /FreeAstro \/api\/v1\/moon\/phase/);
  assert.match(fact.factText, /79% illuminated/);
  assert.match(fact.factText, /10\.6 days old/);
  assert.match(fact.factText, /Leo 15\.4/);
  assert.match(fact.factText, /Special Moon marker returned: Supermoon/);
  assert.match(fact.factText, /Traditional Moon name returned: Flower Moon/);
  assert.match(fact.factText, /Next full Moon: 2026-05-31T20:20:00Z/);
  assert.equal(fact.factPayload.raw.evidence.phase_name, 'Waxing Gibbous');
}

async function testMoonPhaseVisualRenderer() {
  const visual = moonPhaseVisual.extractMoonVisual(moonPhasePayload);
  assert.equal(visual.type, 'svg');
  assert.match(visual.svg, /^<svg/);

  const rendered = await moonPhaseVisual.renderMoonPhaseVisualPng(moonPhasePayload);
  assert.equal(rendered.filename, 'current-moon-phase.png');
  assert.equal(rendered.caption, 'Current Moon: Waxing Gibbous');
  assert.equal(Buffer.isBuffer(rendered.buffer), true);
  assert.deepEqual([...rendered.buffer.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function testMoonTransitFactLabelsAreUserFacing() {
  const facts = __test.buildUserFacingCurrentMoonTransitFacts([{
    title: 'Pressure Window Moon',
    factText: 'Pressure Window Moon Category: Emotions. Kind: Pressure Window. Pressure window around Moon.',
    tags: ['planet:mercury', 'planet:uranus', 'planet:venus', 'planet:moon', 'aspect_type:square', 'house:11'],
    sourceKind: 'monthly_transit',
    factPayload: {
      raw: {
        kind: 'pressure_window',
        evidence: {
          start_datetime: '2026-02-04T01:32:06Z',
          end_datetime: '2026-09-10T19:32:06Z',
          peak_datetime: '2026-04-27T13:15:56Z',
          subjects: ['Mercury', 'Uranus', 'Venus', 'Moon'],
          houses: [11],
          aspect_types: ['Square']
        },
        entities: {
          planets: ['mercury', 'uranus', 'venus', 'moon'],
          aspect_types: ['square'],
          houses: [11]
        }
      }
    }
  }]);

  assert.equal(facts.length, 1);
  assert.match(facts[0].title, /Moon square Mercury, Uranus, and Venus in House 11/i);
  assert.doesNotMatch(facts[0].title, /Pressure Window Moon/i);
  assert.doesNotMatch(facts[0].factText, /Pressure Window Moon|pressure window/i);
  assert.doesNotMatch(facts[0].factText, /Bodies involved|Aspect evidence|House evidence/i);
  assert.match(facts[0].factText, /Timing: active 2026-02-04 .*→ 2026-09-10/i);
  assert.match(facts[0].factText, /peak 2026-04-27/i);
}

function testOtherTransitFactLabelsAreUserFacing() {
  const mercuryFacts = __test.buildUserFacingCurrentTransitFacts([{
    title: 'Pressure Window Mercury',
    factText: 'Pressure Window Mercury Category: Mind. Kind: Pressure Window. Pressure window around Mercury.',
    tags: ['planet:mercury', 'planet:chiron', 'planet:jupiter', 'planet:mars', 'planet:venus', 'aspect_type:square', 'aspect_type:quincunx', 'aspect_type:opposition', 'house:9'],
    sourceKind: 'monthly_transit',
    factPayload: {
      raw: {
        kind: 'pressure_window',
        evidence: {
          start_datetime: '2026-02-04T01:32:06Z',
          end_datetime: '2026-08-03T19:32:06Z',
          peak_datetime: '2026-03-31T13:15:56Z',
          subjects: ['Mercury', 'Chiron', 'Jupiter', 'Mars', 'Venus'],
          houses: [9],
          aspect_types: ['Square', 'Quincunx', 'Opposition']
        },
        entities: {
          planets: ['mercury', 'chiron', 'jupiter', 'mars', 'venus'],
          aspect_types: ['square', 'quincunx', 'opposition'],
          houses: [9]
        }
      }
    }
  }], { focusBody: 'Mercury' });

  assert.equal(mercuryFacts.length, 1);
  assert.match(mercuryFacts[0].title, /Mercury square, quincunx, and opposition contacts with Chiron, Jupiter, Mars, and Venus in House 9/i);
  assert.doesNotMatch(mercuryFacts[0].title, /Pressure Window Mercury/i);
  assert.doesNotMatch(mercuryFacts[0].factText, /Pressure Window Mercury|pressure window/i);
  assert.doesNotMatch(mercuryFacts[0].factText, /Bodies involved|Aspect evidence|House evidence/i);
  assert.match(mercuryFacts[0].factText, /Timing: active 2026-02-04 .*→ 2026-08-03/i);

  const saturnFacts = __test.buildUserFacingCurrentTransitFacts([{
    title: 'Support Window Midheaven',
    factText: 'Support Window Midheaven Category: Structure. Kind: Support Window.',
    tags: ['planet:saturn', 'planet:midheaven', 'aspect_type:trine', 'house:10'],
    sourceKind: 'monthly_transit',
    factPayload: {
      raw: {
        kind: 'support_window',
        evidence: {
          subjects: ['Saturn', 'Midheaven'],
          houses: [10],
          aspect_types: ['Trine']
        },
        entities: {
          planets: ['saturn', 'midheaven'],
          aspect_types: ['trine'],
          houses: [10]
        }
      }
    }
  }], { focusBody: 'Saturn' });

  assert.equal(saturnFacts.length, 1);
  assert.match(saturnFacts[0].title, /Supportive Saturn contacts through trine aspects with Midheaven in House 10/i);
  assert.doesNotMatch(saturnFacts[0].title, /Support Window Midheaven/i);
  assert.doesNotMatch(saturnFacts[0].factText, /Support Window/i);

  const angularFacts = __test.buildUserFacingCurrentTransitFacts([{
    title: 'Activation Cluster Ascendant',
    factText: 'Activation Cluster Ascendant Category: Identity. Kind: Activation Cluster.',
    tags: ['planet:mercury', 'planet:uranus', 'planet:venus', 'planet:ascendant', 'house:1'],
    sourceKind: 'monthly_transit',
    factPayload: {
      raw: {
        kind: 'activation_cluster',
        evidence: {
          start_datetime: '2026-02-04T03:04:13Z',
          end_datetime: '2026-09-10T18:04:13Z',
          peak_datetime: '2026-04-27T05:19:13Z',
          natal_points: ['ascendant'],
          transit_planets: ['uranus', 'venus', 'mercury'],
          source_series_keys: [
            'transit.conjunction.uranus.ascendant',
            'transit.conjunction.venus.ascendant',
            'transit.conjunction.mercury.ascendant'
          ],
          houses: [1]
        },
        entities: {
          planets: ['ascendant', 'mercury', 'uranus', 'venus'],
          houses: [1]
        }
      }
    }
  }], { focusBody: 'Mercury' });

  assert.equal(angularFacts.length, 1);
  assert.match(angularFacts[0].title, /Mercury conjunct Ascendant, alongside Uranus and Venus in House 1/i);
  assert.doesNotMatch(angularFacts[0].title, /activation involving/i);
  assert.doesNotMatch(angularFacts[0].factText, /Activation Cluster Ascendant/i);
}

function testCurrentMentalTransitTimingIsSelective() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1, peak 2026-04-27 05:19 UTC): Your mind is visible now. This transit is active from February 4, 2026, to September 10, 2026.',
    'What it brings up (Mercury trine natal Sun in House 8, active until 2026-05-19 14:17 UTC): Your thoughts align with identity, as this influence peaks around April 27, 2026.',
    'What helps mentally right now (Mercury square natal Moon in House 11, peak 2026-04-27 13:15 UTC): Balance feeling and logic, especially between 2026-02-04 01:32 UTC and 2026-09-10 19:32 UTC. The Mercury trine to your natal Moon until August 3, 2026, offers smoother expression.',
    'Watch point (Mercury square natal Mercury in House 9, peak 2026-03-31 02:29 UTC): Keep debates constructive.'
  ].join('\n\n');

  const limited = __test.limitCurrentMentalTransitTiming(answer);
  const sections = limited.split(/\n{2,}/);
  assert.equal(sections.length, 4);
  assert.match(sections[0], /2026-04-27|February 4, 2026/);
  assert.doesNotMatch(sections[1], /2026-|April 27, 2026|May 19, 2026/);
  assert.doesNotMatch(sections[2], /2026-|February 4, 2026|September 10, 2026|August 3, 2026/);
  assert.match(sections[3], /2026-03-31/);
}

function testCurrentMentalTransitSectionsAreNormalized() {
  const answer = [
    'Your current mental atmosphere is activated by a dynamic interplay of influences.',
    'Current mental weather (Mercury conjunct Ascendant in House 1): Your thoughts are visible.',
    'What it brings up (Mercury trine natal Sun in House 8): There is an easier flow of clarity.',
    'What it brings up (Mercury square natal Moon in House 11): Logic and feeling can clash.',
    'Watch point (Mercury square natal Mercury in House 9): Choose words carefully.'
  ].join('\n\n');

  const normalized = __test.normalizeCurrentMentalTransitSections(answer);
  const sections = normalized.split(/\n{2,}/);
  assert.equal(sections.length, 4);
  assert.match(sections[0], /^Current mental weather/);
  assert.match(sections[1], /^What it brings up/);
  assert.match(sections[2], /^What helps mentally right now/);
  assert.match(sections[3], /^Watch point/);
  assert.doesNotMatch(normalized, /dynamic interplay of influences/);
}

function testCurrentMentalTransitUnlabeledSectionsAreLabeled() {
  const answer = [
    'Your mind is energized. (Mercury conjunct Ascendant, alongside Uranus and Venus. Timing: active 2026-02-04 03:04 UTC → 2026-09-10 18:04 UTC; peak 2026-04-27 05:19 UTC) This opens new perspectives.',
    'There is a push and pull between logic and emotion. (Mercury square natal Moon in House 11.)',
    'A period of clarity is supported. (Mercury trine natal Mercury in House 9.)',
    'Watch your words in charged conversations. (Mercury square natal Mercury in House 9. Timing: active 2026-01-02 15:18 UTC → 2026-08-03 21:18 UTC; peak 2026-03-31 02:29 UTC)'
  ].join('\n\n');

  const normalized = __test.normalizeCurrentMentalTransitSections(answer);
  const sections = normalized.split(/\n{2,}/);
  assert.equal(sections.length, 4);
  assert.match(sections[0], /^Current mental weather \(Mercury conjunct Ascendant, alongside Uranus and Venus\):/);
  assert.match(sections[1], /^What it brings up \(Mercury square natal Moon in House 11\):/);
  assert.match(sections[2], /^What helps mentally right now \(Mercury trine natal Mercury in House 9\):/);
  assert.match(sections[3], /^Watch point \(Mercury square natal Mercury in House 9\):/);
  assert.match(sections[0], /This runs from 2026-02-04 03:04 UTC to 2026-09-10 18:04 UTC, peaking 2026-04-27 05:19 UTC\./);
  assert.doesNotMatch(normalized, /Timing:/);
}

function testCurrentMentalTransitEmptyTimingFragmentsAreRemoved() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1): This placement is visible. Timing: peak 2026-04-27 05:19 UTC.',
    'What it brings up (Mercury square natal Moon in House 11): is a logic-feeling clash. Timing:. This is particularly active. This.',
    'What helps mentally right now (Mercury trine natal Mercury in House 9): involves using the clearer flow, particularly',
    'Watch point (Mercury square natal Mercury in House 9): Choose words carefully.'
  ].join('\n\n');

  const limited = __test.limitCurrentMentalTransitTiming(answer);
  assert.doesNotMatch(limited, /Timing:\./);
  assert.doesNotMatch(limited, /Timing:/);
  assert.doesNotMatch(limited, /This is particularly active/);
  assert.doesNotMatch(limited, /\bThis\.\s*$/);
  assert.match(limited, /This transit is visible/);
  assert.match(limited, /This brings up a logic-feeling clash/);
  assert.match(limited, /Work with this by using the clearer flow\./);
}

function testCurrentMentalTransitMixedSectionsStayFourCards() {
  const answer = [
    'Your mind is energized. (Mercury conjunct Ascendant in House 1.)',
    'What it brings up (Mercury square natal Moon in House 11): Logic and feeling can clash.',
    'A period of clarity is supported. (Mercury trine natal Mercury in House 9.)',
    'Be careful with sharp words. (Mercury square natal Mercury in House 9. Timing: active 2026-01-02 15:18 UTC → 2026-08-03 21:18 UTC; peak 2026-03-31 02:29 UTC)'
  ].join('\n\n');

  const normalized = __test.normalizeCurrentMentalTransitSections(answer);
  const sections = normalized.split(/\n{2,}/);
  assert.equal(sections.length, 4);
  assert.match(sections[0], /^Current mental weather/);
  assert.match(sections[1], /^What it brings up/);
  assert.match(sections[2], /^What helps mentally right now/);
  assert.match(sections[3], /^Watch point/);
}

function testCurrentMentalTransitTimingMovesOutOfHeading() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1, peaking around April 27, 2026): Your thoughts are visible. .',
    'What it brings up (Mercury square natal Moon in House 11;): Logic and feeling can clash.',
    'What helps mentally right now (Mercury trine natal Mercury in House 9): Use the clearer flow.',
    'Watch point (Mercury square natal Mercury in House 9, active 2026-01-02 15:18 UTC → 2026-08-03 21:18 UTC; peak 2026-03-31 02:29 UTC): Choose words carefully.'
  ].join('\n\n');

  const normalized = __test.normalizeCurrentMentalTransitSections(answer);
  const sections = normalized.split(/\n{2,}/);
  assert.match(sections[0], /^Current mental weather \(Mercury conjunct Ascendant in House 1\):/);
  assert.doesNotMatch((sections[0].match(/\([^)]*\)/) || [''])[0], /active 2026/);
  assert.match(sections[0], /This peaks around April 27, 2026/);
  assert.doesNotMatch(normalized, /Timing:/);
  assert.doesNotMatch(sections[0], /\. \./);
  assert.match(sections[1], /^What it brings up \(Mercury square natal Moon in House 11\):/);
  assert.match(sections[3], /^Watch point \(Mercury square natal Mercury in House 9\):/);
}

function testCurrentMentalTransitAddsOneTimingWhenMissing() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1): Your thoughts are visible.',
    'What it brings up (Mercury square natal Moon in House 11): Logic and feeling can clash.',
    'What helps mentally right now (Mercury trine natal Mercury in House 9): Use the clearer flow.',
    'Watch point (Mercury square natal Mercury in House 9): Choose words carefully.'
  ].join('\n\n');

  const withTiming = __test.ensureCurrentMentalTransitHasTiming(answer, [{
    title: 'Mercury conjunct Ascendant in House 1',
    factText: 'Mercury conjunct Ascendant in House 1. Timing: active 2026-02-04 03:04 UTC → 2026-09-10 18:04 UTC; peak 2026-04-27 05:19 UTC.'
  }]);
  const sections = withTiming.split(/\n{2,}/);
  assert.equal(sections.length, 4);
  assert.match(sections[0], /This runs from 2026-02-04 03:04 UTC to 2026-09-10 18:04 UTC, peaking 2026-04-27 05:19 UTC\./);
  assert.doesNotMatch(sections.slice(1).join('\n'), /Timing:/);
}

function testCurrentMentalWeatherGetsTimingEvenIfWatchPointHasTiming() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1): Your thoughts are visible.',
    'What it brings up (Mercury square natal Moon in House 11): Logic and feeling can clash.',
    'What helps mentally right now (Mercury trine natal Mercury in House 9): Use the clearer flow.',
    'Watch point (Mercury square natal Mercury in House 9): Choose words carefully. This peaks on 2026-03-31 02:29 UTC.'
  ].join('\n\n');

  const withTiming = __test.ensureCurrentMentalWeatherHasTiming(answer, [{
    title: 'Mercury conjunct Ascendant in House 1',
    factText: 'Mercury conjunct Ascendant in House 1. Timing: active 2026-02-04 03:04 UTC → 2026-09-10 18:04 UTC; peak 2026-04-27 05:19 UTC.'
  }]);
  const sections = withTiming.split(/\n{2,}/);
  assert.match(sections[0], /This runs from 2026-02-04 03:04 UTC to 2026-09-10 18:04 UTC, peaking 2026-04-27 05:19 UTC\./);
  assert.match(sections[3], /2026-03-31/);
}

function testCurrentMentalSupportSectionPrefersSupportFact() {
  const answer = [
    'Current mental weather (Mercury conjunct Ascendant in House 1): Your thoughts are visible.',
    'What it brings up (Mercury square natal Moon in House 11): Logic and feeling can clash.',
    'What helps mentally right now (Mercury square natal Moon in House 11): Balance feeling and logic.',
    'Watch point (Mercury square natal Mercury in House 9): Choose words carefully.'
  ].join('\n\n');

  const corrected = __test.ensureCurrentMentalSupportSection(answer, [{
    title: 'Mercury trine natal Mercury, alongside Uranus in House 9',
    factText: 'Mercury trine natal Mercury, alongside Uranus in House 9. Timing: active 2026-02-04 01:53 UTC → 2026-06-29 22:25 UTC; peak 2026-05-15 10:42 UTC.'
  }]);
  const sections = corrected.split(/\n{2,}/);
  assert.match(sections[2], /^What helps mentally right now \(Mercury trine natal Mercury, alongside Uranus in House 9\):/);
  assert.doesNotMatch(sections[2], /Mercury square natal Moon/);
  assert.doesNotMatch(sections[2], /supportive Mercury evidence/i);
  assert.match(sections[2], /Use this supportive Mercury flow/);
}

function testCurrentMentalMissingEvidenceHeadingsAreFilled() {
  const answer = [
    'Current mental weather: Your thoughts are visible.',
    'What it brings up: Logic and feeling can clash.',
    'What helps mentally right now (Mercury trine natal Mercury in House 9): Use the clearer flow.',
    'Watch point: Choose words carefully around emotional reactions.'
  ].join('\n\n');

  const corrected = __test.ensureCurrentMentalSectionEvidence(answer, [
    {
      title: 'Mercury conjunct Ascendant in House 1',
      factText: 'Mercury conjunct Ascendant in House 1. Timing: active 2026-02-04 03:04 UTC → 2026-09-10 18:04 UTC; peak 2026-04-27 05:19 UTC.'
    },
    {
      title: 'Mercury square natal Moon, alongside Uranus and Venus in House 11',
      factText: 'Mercury square natal Moon, alongside Uranus and Venus in House 11.'
    }
  ]);
  const sections = corrected.split(/\n{2,}/);
  assert.match(sections[0], /^Current mental weather \(Mercury conjunct Ascendant in House 1\):/);
  assert.match(sections[1], /^What it brings up \(Mercury square natal Moon, alongside Uranus and Venus in House 11\):/);
  assert.match(sections[3], /^Watch point \(Mercury square natal Moon, alongside Uranus and Venus in House 11\):/);
}

async function main() {
  await testFreeAstroMoonPhaseWrapper();
  testMoonPhaseRequestFromProfile();
  testMoonPhaseFactConversion();
  await testMoonPhaseVisualRenderer();
  testMoonTransitFactLabelsAreUserFacing();
  testOtherTransitFactLabelsAreUserFacing();
  testCurrentMentalTransitTimingIsSelective();
  testCurrentMentalTransitSectionsAreNormalized();
  testCurrentMentalTransitUnlabeledSectionsAreLabeled();
  testCurrentMentalTransitEmptyTimingFragmentsAreRemoved();
  testCurrentMentalTransitMixedSectionsStayFourCards();
  testCurrentMentalTransitTimingMovesOutOfHeading();
  testCurrentMentalTransitAddsOneTimingWhenMissing();
  testCurrentMentalWeatherGetsTimingEvenIfWatchPointHasTiming();
  testCurrentMentalSupportSectionPrefersSupportFact();
  testCurrentMentalMissingEvidenceHeadingsAreFilled();
  console.log('ok');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
