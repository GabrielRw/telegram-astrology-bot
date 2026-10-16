const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

const { looksLikeContextDependentFollowUp } = __test;

function testCompleteQuestionsAreNotTreatedAsFollowUps() {
  for (const text of [
    // time demonstratives
    'What are my main transits this week?',
    'How is my love life looking this month?',
    'What is my annual profection this year?',
    'What does my solar return say about this year?',
    'Quelles sont mes transits ce mois-ci ?',
    'Comment Saturne m’influence en ce moment ?',
    'Was bringt mir diese Woche astrologisch?',
    '¿Qué tránsitos tengo esta semana?',
    // expletive it/this
    'Is this a good month for my career?',
    'Is it a good time to sign a contract next week?',
    // full "why" questions
    'Why am I so emotionally guarded?',
    'Why do I feel so mentally scattered lately?',
    'Pourquoi suis-je si exigeante avec moi-même ?',
    // pronoun with a named subject in the same message
    'Do I have a stellium? What does it mean?',
    'What is my chart ruler and what does it mean?',
    'Was sagt das Horoskop über meine Karriere?',
    'Which transits that affect my career are strongest?',
    // no pronoun at all
    'What is my rising sign?',
    'Which one is the most important?'
  ]) {
    assert.equal(looksLikeContextDependentFollowUp(text), false, text);
  }
}

function testGenuineFollowUpsAreStillDetected() {
  for (const text of [
    'Why?',
    'Why is that?',
    'Explain',
    'ok and then',
    'What does that mean for love?',
    'Tell me more about it',
    'Is that true?',
    "Qu'est-ce que ça dit de ma personnalité ?",
    'Was bedeutet das für mich?',
    '¿Qué significa eso para mí?',
    'And what about them?'
  ]) {
    assert.equal(looksLikeContextDependentFollowUp(text), true, text);
  }
}

function testEmptyAndLongInputsAreNotFollowUps() {
  assert.equal(looksLikeContextDependentFollowUp(''), false);
  assert.equal(looksLikeContextDependentFollowUp(`Why ${'this '.repeat(60)}`), false);
}

testCompleteQuestionsAreNotTreatedAsFollowUps();
testGenuineFollowUpsAreStillDetected();
testEmptyAndLongInputsAreNotFollowUps();
console.log('ok follow-up guard tests');
