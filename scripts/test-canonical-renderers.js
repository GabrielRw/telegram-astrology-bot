const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

function testSecondaryProgressions() {
  const payload = {
    meta: {
      target_datetime: '2026-04-18T12:30:00'
    },
    progressed_chart: {
      points: {
        sun: { id: 'sun', sign_id: 'virgo', house: 7, longitude_text: '12 Virgo 10' },
        moon: { id: 'moon', sign_id: 'libra', house: 8, longitude_text: '03 Libra 20' }
      },
      angles: {
        ascendant: { sign_id: 'scorpio', pos: '10' },
        midheaven: { sign_id: 'leo', pos: '18' }
      }
    }
  };

  const fr = __test.buildSecondaryProgressionsRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /18 avril 2026 à 12h30/i);
  assert.match(fr, /Maison 7/i);
  assert.match(fr, /12 Vierge 10/i);
  assert.match(fr, /Milieu du Ciel/i);
  assert.doesNotMatch(fr, /\bHouse 7\b/);
  assert.doesNotMatch(fr, /\bVirgo\b/);

  const de = __test.buildSecondaryProgressionsRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /18\. April 2026 um 12:30 Uhr/i);
  assert.match(de, /Haus 7/i);
  assert.match(de, /12 Jungfrau 10/i);
  assert.match(de, /Medium Coeli/i);
  assert.doesNotMatch(de, /\bHouse 7\b/);
  assert.doesNotMatch(de, /\bVirgo\b/);

  const es = __test.buildSecondaryProgressionsRawResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /18 de abril de 2026 a las 12:30/i);
  assert.match(es, /Casa 7/i);
  assert.match(es, /12 Virgo 10/i);
  assert.match(es, /Medio Cielo/i);
  assert.doesNotMatch(es, /\bHouse 7\b/);
}

function testSolarReturn() {
  const payload = {
    meta: {
      solar_return: {
        target_year: 2026,
        exact_moment_local: '2026-09-05T06:14:00'
      }
    },
    planets: [
      { id: 'venus', name: 'Venus', sign_id: 'virgo', pos: '14', house: 7 },
      { id: 'mars', name: 'Mars', sign_id: 'libra', pos: '8', house: 8 }
    ],
    angles_details: {
      asc: { sign_id: 'scorpio', pos: '12' },
      mc: { sign_id: 'leo', pos: '3' }
    },
    aspects: [
      { p1_id: 'venus', type: 'trine', p2_id: 'jupiter', orb: '1.2', is_major: true }
    ]
  };

  const fr = __test.buildSolarReturnRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /5 septembre 2026 à 06h14 \(heure locale\)/i);
  assert.match(fr, /Vénus: Vierge 14 • Maison 7/i);
  assert.match(fr, /Vénus trigone Jupiter/i);
  assert.doesNotMatch(fr, /\bHouse 7\b/);

  const de = __test.buildSolarReturnRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /5\. September 2026 um 06:14 Uhr \(Ortszeit\)/i);
  assert.match(de, /Venus: Jungfrau 14 • Haus 7/i);
  assert.match(de, /Venus Trigon Jupiter/i);

  const es = __test.buildSolarReturnRawResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /5 de septiembre de 2026 a las 06:14 \(hora local\)/i);
  assert.match(es, /Venus: Virgo 14 • Casa 7/i);
  assert.match(es, /Venus trígono Júpiter|Venus trígono Jupiter/i);
}

function testTransitSearchInterpretive() {
  const payload = {
    input: {
      transit_planet: 'jupiter',
      natal_point: 'venus',
      aspect_types: ['trine']
    },
    meta: {
      range_start: '2026-04-01T00:00:00',
      range_end: '2026-04-30T23:59:00'
    },
    search_summary: {
      hit_count: 1
    },
    cycles: [
      {
        cycle_start_datetime: '2026-04-10T00:00:00',
        cycle_end_datetime: '2026-04-22T23:59:00',
        passes: [
          { exact_datetimes: ['2026-04-18T12:30:00'] }
        ]
      }
    ]
  };

  const fr = __test.buildTransitSearchInterpretiveResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /Jupiter a formé un trigone/i);
  assert.match(fr, /18 avril 2026 à 12h30/i);
  assert.doesNotMatch(fr, /\bUTC\b/);

  const de = __test.buildTransitSearchInterpretiveResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /Jupiter einen Trigon/i);
  assert.match(de, /18\. April 2026 um 12:30 Uhr/i);
  assert.doesNotMatch(de, /\bUTC\b/);

  const es = __test.buildTransitSearchInterpretiveResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /Júpiter formó un trígono|Jupiter formó un trígono/i);
  assert.match(es, /18 de abril de 2026 a las 12:30/i);
  assert.doesNotMatch(es, /\bUTC\b/);
}

function testHoroscopeRenderer() {
  const payload = {
    data: {
      date: '2026-04-23',
      scores: {
        overall: 82,
        love: 70,
        career: 88,
        money: 76,
        health: 80
      },
      content: {
        theme: 'Clarity and timing',
        text: 'A focused day.'
      }
    }
  };

  const fr = __test.buildHoroscopeRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /Global 82/i);
  assert.match(fr, /Amour 70/i);
  assert.match(fr, /Carrière 88/i);
  assert.doesNotMatch(fr, /\bOverall 82\b/);

  const de = __test.buildHoroscopeRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /Gesamt 82/i);
  assert.match(de, /Liebe 70/i);
  assert.match(de, /Beruf 88/i);
  assert.doesNotMatch(de, /\bOverall 82\b/);

  const es = __test.buildHoroscopeRawResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /General 82/i);
  assert.match(es, /Amor 70/i);
  assert.match(es, /Carrera 88/i);
  assert.doesNotMatch(es, /\bOverall 82\b/);
}

function testSynastryRenderer() {
  const payload = {
    summary: {
      scores: {
        overall: 81,
        romance: 78,
        communication: 84,
        stability: 69,
        intimacy: 75,
        growth: 83,
        tension: 41
      }
    },
    __personAName: 'Alice',
    __personBName: 'Bob'
  };

  const fr = __test.buildSynastryRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /Global 81/i);
  assert.match(fr, /Communication 84/i);
  assert.match(fr, /Stabilité 69/i);
  assert.doesNotMatch(fr, /\bOverall 81\b/);

  const de = __test.buildSynastryRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /Gesamt 81/i);
  assert.match(de, /Kommunikation 84/i);
  assert.match(de, /Stabilität 69/i);
  assert.doesNotMatch(de, /\bOverall 81\b/);

  const es = __test.buildSynastryRawResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /General 81/i);
  assert.match(es, /Comunicación 84/i);
  assert.match(es, /Estabilidad 69/i);
  assert.doesNotMatch(es, /\bOverall 81\b/);
}

function testAnnualProfectionsRenderer() {
  const payload = {
    meta: {
      annual_profection: {
        target_year: 2026,
        period: {
          start: '2026-09-05',
          end: '2027-09-04'
        }
      }
    },
    profection: {
      annual: {
        activated_house: 7,
        activated_sign_id: 'virgo',
        time_lord_id: 'venus',
        period: {
          start: '2026-09-05',
          end: '2027-09-04'
        }
      }
    }
  };

  const fr = __test.buildAnnualProfectionsRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /Maison activée: 7 • Vierge/i);
  assert.match(fr, /Maître du temps: Vénus/i);
  assert.match(fr, /5 septembre 2026 → 4 septembre 2027/i);

  const de = __test.buildAnnualProfectionsRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /Aktiviertes Haus: 7 • Jungfrau/i);
  assert.match(de, /Zeitlord: Venus/i);
  assert.match(de, /5\. September 2026 → 4\. September 2027/i);

  const es = __test.buildAnnualProfectionsRawResponse('es', payload, { profileName: 'Chart User' });
  assert.match(es, /Casa activada: 7 • Virgo/i);
  assert.match(es, /Señor del tiempo: Venus/i);
  assert.match(es, /5 de septiembre de 2026 → 4 de septiembre de 2027/i);
}

function testRelocationRenderer() {
  const payload = {
    meta: {
      focus: 'health'
    },
    results: [
      {
        city: { name: 'Lisbon', country: 'PT' },
        score: 88,
        nearest_favorable_line: { body: 'venus', angle: 'asc', distance_km: 44 },
        nearest_challenging_line: { body: 'saturn', angle: 'mc', distance_km: 122 }
      }
    ]
  };

  const fr = __test.buildRelocationRawResponse('fr', payload, { profileName: 'Chart User' }, 'best city for health');
  assert.match(fr, /Santé/i);
  assert.match(fr, /Vénus ASC/i);
  assert.match(fr, /Saturne MC/i);

  const de = __test.buildRelocationRawResponse('de', payload, { profileName: 'Chart User' }, 'best city for health');
  assert.match(de, /Gesundheit/i);
  assert.match(de, /Venus ASC/i);
  assert.match(de, /Saturn MC/i);

  const es = __test.buildRelocationRawResponse('es', payload, { profileName: 'Chart User' }, 'best city for health');
  assert.match(es, /Salud/i);
  assert.match(es, /Venus ASC/i);
  assert.match(es, /Saturno MC/i);
}

function testEphemerisRenderer() {
  const payload = {
    meta: {
      start: '2026-04-01',
      end: '2026-04-02',
      step: '1d',
      rows: 1
    },
    data: [
      {
        local_timestamp: '2026-04-01T08:30:00',
        bodies: {
          Sun: { position_text: '12 Virgo 10' },
          Moon: { position_text: '03 Libra 20' }
        },
        astrology: {
          retrograde_bodies: ['mercury']
        }
      }
    ]
  };

  const fr = __test.buildEphemerisRawResponse('fr', payload, { profileName: 'Chart User' }).text;
  assert.match(fr, /1 avril 2026 à 08h30/i);
  assert.match(fr, /le Soleil 12 Vierge 10/i);
  assert.match(fr, /la Lune 03 Balance 20/i);
  assert.match(fr, /Rétrograde: Mercure/i);

  const de = __test.buildEphemerisRawResponse('de', payload, { profileName: 'Chart User' }).text;
  assert.match(de, /1\. April 2026 um 08:30 Uhr/i);
  assert.match(de, /die Sonne 12 Jungfrau 10/i);
  assert.match(de, /der Mond 03 Waage 20/i);
  assert.match(de, /Rückläufig: Merkur/i);
}

function testTransitSearchRawRenderer() {
  const payload = {
    input: {
      transit_planet: 'jupiter',
      natal_point: 'venus',
      aspect_types: ['trine']
    },
    meta: {
      range_start: '2026-04-01T00:00:00',
      range_end: '2026-04-30T23:59:00'
    },
    search_summary: {
      cycle_count: 1,
      hit_count: 1
    },
    cycles: [
      {
        label: 'main window',
        cycle_start_datetime: '2026-04-10T00:00:00',
        cycle_end_datetime: '2026-04-22T23:59:00',
        hit_count: 1,
        passes: [{ exact_datetimes: ['2026-04-18T12:30:00'] }]
      }
    ]
  };

  const fr = __test.buildTransitSearchRawResponse('fr', payload, { profileName: 'Chart User' });
  assert.match(fr, /Jupiter trigone au Vénus natal/i);
  assert.match(fr, /10 avril 2026 à 00h00 → 22 avril 2026 à 23h59/i);
  assert.match(fr, /18 avril 2026 à 12h30/i);
  assert.doesNotMatch(fr, /\bUTC\b/);

  const de = __test.buildTransitSearchRawResponse('de', payload, { profileName: 'Chart User' });
  assert.match(de, /Jupiter Trigon zum Radix-Venus/i);
  assert.match(de, /10\. April 2026 um 00:00 Uhr → 22\. April 2026 um 23:59 Uhr/i);
  assert.doesNotMatch(de, /\bUTC\b/);
}

testSecondaryProgressions();
testSolarReturn();
testTransitSearchInterpretive();
testHoroscopeRenderer();
testSynastryRenderer();
testAnnualProfectionsRenderer();
testRelocationRenderer();
testEphemerisRenderer();
testTransitSearchRawRenderer();

console.log('ok');
