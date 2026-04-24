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

function testFrenchTravelHourFollowUpRoute() {
  const text = "Dans la journée du 13 août quel elle l'a meilleure heure pour partir et pourquoi?";
  const config = __test.inferElectionalRouteConfigFromQuestion(text);
  const requestedName = __test.extractRequestedExternalProfileName(
    text,
    { kind: 'astrology_natal' },
    { profileName: 'Chart User' },
    [{ profileName: 'Chart User' }, { profileName: 'Elie' }]
  );
  const singleDate = __test.parseExplicitSingleDateFromQuestion(text, 'Europe/Paris');

  assert.equal(config?.id, 'starting_journey_election_search');
  assert.equal(requestedName, null);
  assert.deepEqual(singleDate, { start: '2026-08-13', end: '2026-08-13' });
}

testFrenchTravelElectionalRoute();
testTravelPhraseIsNotAProfileName();
testEnglishTravelElectionalRoute();
testFrenchTravelHourFollowUpRoute();

console.log('ok');
