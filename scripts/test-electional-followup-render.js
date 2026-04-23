const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

function run() {
  const text = __test.buildElectionalResultExplanationResponse('fr', {
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
  });

  assert.match(text, /18 avril 2026 à 12h30 \(heure locale\)/i);
  assert.match(text, /Jupiter est en bonne dignité/i);
  assert.match(text, /Vénus est en bonne dignité/i);
  assert.match(text, /maître de la maison 2 est en bonne dignité/i);
  assert.match(text, /qualité globale est mitigee|qualité globale est mitigée/i);
  assert.match(text, /verdict traditionnel reste favorable/i);
  assert.match(text, /Saturne est affaibli/i);
  assert.doesNotMatch(text, /\bUTC\b/);
  assert.doesNotMatch(text, /\bJupiter dignified\b/);
  assert.doesNotMatch(text, /\b2nd ruler dignified\b/);

  console.log('ok');
}

run();
