const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

function testFrenchTravelElectionalRoute() {
  const config = __test.inferElectionalRouteConfigFromQuestion(
    "Il n'y a aucun moment meilleur pour voyager cette année ?"
  );

  assert.equal(config?.id, 'starting_journey_election_search');
}

function testTravelPhraseIsNotAProfileName() {
  const requestedName = __test.extractRequestedExternalProfileName(
    "Il n'y a aucun moment meilleur pour voyager cette année ?",
    { kind: 'astrology_natal' },
    { profileName: 'Chart User' },
    [{ profileName: 'Chart User' }, { profileName: 'Elie' }]
  );

  assert.equal(requestedName, null);
}

function testEnglishTravelElectionalRoute() {
  const config = __test.inferElectionalRouteConfigFromQuestion(
    'Is there no better moment to travel this year?'
  );

  assert.equal(config?.id, 'starting_journey_election_search');
}

testFrenchTravelElectionalRoute();
testTravelPhraseIsNotAProfileName();
testEnglishTravelElectionalRoute();

console.log('ok');
