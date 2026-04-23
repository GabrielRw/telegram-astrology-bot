const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

const payload = {
  topResult: {
    event_time_local: '2026-04-18T12:30:00',
    quality_band: 'mixed',
    strict_traditional_verdict: 'sound',
    best_available_in_window: true,
    supporting_factors: [
      { title: 'Jupiter dignified' },
      { title: 'Venus dignified' },
      { title: '2nd ruler dignified' },
      { title: '11th ruler dignified' }
    ],
    caution_factors: [
      { title: 'Saturn debilitated' },
      { title: 'Saturn under hard malefic pressure' },
      { title: '8th ruler under hard malefic pressure' }
    ]
  }
};

function testFrench() {
  const text = __test.buildElectionalResultExplanationResponse('fr', payload);
  assert.match(text, /18 avril 2026 à 12h30 \(heure locale\)/i);
  assert.match(text, /Jupiter est en bonne dignité/i);
  assert.match(text, /Vénus est en bonne dignité/i);
  assert.match(text, /maître de la maison 2 est en bonne dignité/i);
  assert.match(text, /qualité globale est mitigée/i);
  assert.match(text, /verdict traditionnel reste favorable/i);
  assert.match(text, /Saturne est affaibli/i);
  assert.doesNotMatch(text, /\bUTC\b/);
  assert.doesNotMatch(text, /\bJupiter dignified\b/i);
  assert.doesNotMatch(text, /\b2nd ruler dignified\b/i);
}

function testEnglish() {
  const text = __test.buildElectionalResultExplanationResponse('en', payload);
  assert.match(text, /April 18, 2026 at 12:30 \(local time\)/i);
  assert.match(text, /Jupiter is dignified/i);
  assert.match(text, /Venus is dignified/i);
  assert.match(text, /the ruler of the 2 house is dignified|the ruler of the 2nd house is dignified/i);
  assert.match(text, /overall quality is mixed/i);
  assert.match(text, /traditional verdict stays sound/i);
  assert.match(text, /Saturn is debilitated/i);
  assert.doesNotMatch(text, /\bJupiter Dignified\b/);
  assert.doesNotMatch(text, /\b2nd Ruler Dignified\b/);
}

function testGerman() {
  const text = __test.buildElectionalResultExplanationResponse('de', payload);
  assert.match(text, /18\. April 2026 um 12:30 Uhr \(Ortszeit\)/i);
  assert.match(text, /Jupiter steht in guter Würde/i);
  assert.match(text, /Venus steht in guter Würde/i);
  assert.match(text, /Herrscher des 2\. Hauses steht in guter Würde/i);
  assert.match(text, /Gesamtqualität ist gemischt/i);
  assert.match(text, /traditionelle Urteil bleibt tragfähig/i);
  assert.match(text, /Saturn ist geschwächt/i);
  assert.doesNotMatch(text, /\bThe selected window is\b/i);
  assert.doesNotMatch(text, /\bJupiter Dignified\b/i);
}

function testSpanish() {
  const text = __test.buildElectionalResultExplanationResponse('es', payload);
  assert.match(text, /18 de abril de 2026 a las 12:30 \(hora local\)/i);
  assert.match(text, /Júpiter está bien dignificado/i);
  assert.match(text, /Venus está bien dignificado/i);
  assert.match(text, /regente de la casa 2 está bien dignificado/i);
  assert.match(text, /calidad general es mixta/i);
  assert.match(text, /veredicto tradicional sigue siendo favorable/i);
  assert.match(text, /Saturno está debilitado/i);
  assert.doesNotMatch(text, /\bThe selected window is\b/i);
  assert.doesNotMatch(text, /\bJupiter Dignified\b/i);
}

testFrench();
testEnglish();
testGerman();
testSpanish();

console.log('ok');
