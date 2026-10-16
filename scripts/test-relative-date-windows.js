const assert = require('node:assert/strict');

const { __test } = require('../src/services/conversation');

const TIMEZONE = 'UTC';

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function expectedNextWeek() {
  const base = today();
  const dayOfWeek = base.getUTCDay();
  const nextMonday = addDays(base, (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) + 7);
  return { start: toDateString(nextMonday), end: toDateString(addDays(nextMonday, 6)) };
}

function expectedNextMonth() {
  const base = today();
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0));
  return { start: toDateString(first), end: toDateString(last) };
}

function expectedTomorrow() {
  const date = toDateString(addDays(today(), 1));
  return { start: date, end: date };
}

function windowOf(text) {
  const result = __test.parseRelativeDateWindowFromQuestion(text, TIMEZONE);
  return result ? { start: result.start, end: result.end } : null;
}

function testNextWeekPhrases() {
  for (const text of [
    'Is next week a good time to sign a contract?',
    'Quand signer un contrat la semaine prochaine ?',
    'Nächste Woche einen Vertrag unterschreiben?',
    '¿Firmo el contrato la próxima semana?',
    '¿Y la semana que viene?'
  ]) {
    assert.deepEqual(windowOf(text), expectedNextWeek(), text);
  }
}

function testNextMonthPhrases() {
  for (const text of [
    'Best day next month to move house?',
    'Le mois prochain, quel jour pour déménager ?',
    'Nächsten Monat umziehen?',
    '¿Me mudo el próximo mes?'
  ]) {
    assert.deepEqual(windowOf(text), expectedNextMonth(), text);
  }
}

function testTomorrowPhrases() {
  for (const text of ['Can I sign tomorrow?', 'Je signe demain ?', 'Kann ich morgen unterschreiben?', '¿Firmo mañana?']) {
    assert.deepEqual(windowOf(text), expectedTomorrow(), text);
  }
}

function testNonRelativePhrasesAreIgnored() {
  for (const text of [
    'Is this week good to sign a contract?',
    'What transits this month?',
    '¿Firmo por la mañana?',
    'Guten Morgen, wann soll ich unterschreiben?',
    'What is my rising sign?'
  ]) {
    assert.equal(windowOf(text), null, text);
  }
}

function testElectionalSearchWindowUsesNextWeek() {
  const result = __test.buildElectionalSearchWindow('Is next week a good time to sign a contract?', null, TIMEZONE);

  assert.deepEqual(result.searchWindow, expectedNextWeek());
  assert.deepEqual(result.searchTuning, { mode: 'direct' });
}

function testElectionalSearchWindowUsesNextMonth() {
  const result = __test.buildElectionalSearchWindow('When should I sign a contract next month?', null, TIMEZONE);

  assert.deepEqual(result.searchWindow, expectedNextMonth());
}

function testExplicitDatesStillWinOverRelativePhrases() {
  const result = __test.buildElectionalSearchWindow('Next week, specifically 2030-01-07, is it good to sign?', null, TIMEZONE);

  assert.deepEqual(result.searchWindow, { start: '2030-01-07', end: '2030-01-07' });
}

function testElectionalStructuredParametersUseRelativeWindow() {
  const nextWeek = expectedNextWeek();
  const params = __test.inferStructuredQueryParameters(
    'making_contracts_election_search',
    'Is next week a good time to sign a contract?',
    null,
    TIMEZONE
  );

  assert.equal(params.timeframe, 'explicit_range');
  assert.equal(params.rangeStart, nextWeek.start);
  assert.equal(params.rangeEnd, nextWeek.end);
}

function testThisWeekStructuredParametersAreUnchanged() {
  const params = __test.inferStructuredQueryParameters(
    'making_contracts_election_search',
    'Is this week a good time to sign a contract?',
    null,
    TIMEZONE
  );

  assert.equal(params.timeframe, 'current_week');
  assert.equal(params.rangeStart, undefined);
}

function testElectionalFollowUpAcceptsNextWeek() {
  const baseQuestion = 'When is a good time to sign a contract?';
  const followUp = __test.detectExplicitFollowUp('What about next week?', {
    lastResponseRoute: 'astrology_transits',
    lastResolvedQuestion: baseQuestion,
    lastQueryState: {
      canonicalRouteId: 'making_contracts_election_search',
      routeKind: 'astrology_transits',
      baseQuestion,
      parameters: {}
    }
  }, []);
  const nextWeek = expectedNextWeek();

  assert.equal(followUp?.followUpType, 'electional_window_refinement');
  assert.equal(followUp?.canonicalRouteId, 'making_contracts_election_search');
  assert.deepEqual(followUp?.queryPatch, {
    timeframe: 'explicit_range',
    rangeStart: nextWeek.start,
    rangeEnd: nextWeek.end
  });
}

testNextWeekPhrases();
testNextMonthPhrases();
testTomorrowPhrases();
testNonRelativePhrasesAreIgnored();
testElectionalSearchWindowUsesNextWeek();
testElectionalSearchWindowUsesNextMonth();
testExplicitDatesStillWinOverRelativePhrases();
testElectionalStructuredParametersUseRelativeWindow();
testThisWeekStructuredParametersAreUnchanged();
testElectionalFollowUpAcceptsNextWeek();
console.log('ok relative date window tests');
