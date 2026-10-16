const assert = require('node:assert/strict');

const { looksLikeDateInput, parseDateInput } = require('../src/services/natalFlow');
const { localizeUserErrorDetail, t, translateUserError } = require('../src/services/locale');

function testValidDatesParse() {
  assert.deepEqual(parseDateInput('1990-05-15'), { year: 1990, month: 5, day: 15, raw: '1990-05-15' });
  assert.deepEqual(parseDateInput(' 2000-02-29 '), { year: 2000, month: 2, day: 29, raw: '2000-02-29' });
  assert.deepEqual(parseDateInput('1985-12-31'), { year: 1985, month: 12, day: 31, raw: '1985-12-31' });
}

function testImpossibleCalendarDatesAreRejected() {
  for (const value of ['1985-02-30', '1985-02-29', '1900-02-29', '1990-04-31', '1990-06-31', '1990-13-01', '1990-00-10', '1990-01-00']) {
    assert.equal(parseDateInput(value), null, value);
  }
}

function testOutOfRangeAndMalformedDatesAreRejected() {
  const nextYear = new Date().getUTCFullYear() + 1;
  for (const value of ['1899-12-31', `${nextYear}-01-01`, '15/03/1985', '1985-3-15', 'May 15 1990', '']) {
    assert.equal(parseDateInput(value), null, value);
  }
}

function testDateShapedInputIsDetected() {
  for (const value of ['1985-03-15', '1985-02-30', '15/03/1985', '15.03.1985', '3 15 1985']) {
    assert.equal(looksLikeDateInput(value), true, value);
  }

  for (const value of ['Paris', 'New York', 'Lyon 03', 'Saint-Étienne', '75001', '']) {
    assert.equal(looksLikeDateInput(value), false, value);
  }
}

function testCityLookupErrorsAreLocalized() {
  const error = new Error('Could not find a city match for "Lyonnn".');

  assert.equal(localizeUserErrorDetail('en', error), 'Could not find a city match for "Lyonnn".');
  assert.equal(localizeUserErrorDetail('fr', error), 'Aucune ville correspondante trouvée pour "Lyonnn".');
  assert.equal(localizeUserErrorDetail('de', error), 'Keine passende Stadt gefunden für "Lyonnn".');
  assert.equal(localizeUserErrorDetail('es', error), 'No se encontró una ciudad coincidente para "Lyonnn".');
}

function testGenericRequestFailureIsLocalized() {
  const error = new Error('FreeAstro request failed.');

  assert.equal(
    translateUserError('fr', error),
    `${t('fr', 'errors.starsUnavailable')}\nLa requête FreeAstro a échoué.`
  );
  assert.equal(
    translateUserError('en', error),
    `${t('en', 'errors.starsUnavailable')}\nFreeAstro request failed.`
  );
}

function testUnknownEnglishDetailIsHiddenFromOtherLocales() {
  const error = new Error('day is out of range for month');

  assert.equal(translateUserError('en', error), `${t('en', 'errors.starsUnavailable')}\nday is out of range for month`);
  for (const locale of ['fr', 'de', 'es']) {
    assert.equal(localizeUserErrorDetail(locale, error), null, locale);
    assert.equal(translateUserError(locale, error), t(locale, 'errors.starsUnavailable'), locale);
  }
}

function testLocalizedGenericErrorIsKept() {
  const error = new Error(t('fr', 'errors.genericUnexpected'));

  assert.equal(
    translateUserError('fr', error),
    `${t('fr', 'errors.starsUnavailable')}\n${t('fr', 'errors.genericUnexpected')}`
  );
}

function testNewOnboardingMessagesExistInEveryLocale() {
  for (const locale of ['en', 'fr', 'de', 'es']) {
    assert.notEqual(t(locale, 'errors.cityLooksLikeDate'), 'errors.cityLooksLikeDate', locale);
    assert.match(t(locale, 'prompts.birthDateUpdated', { date: '1985-03-15' }), /1985-03-15/, locale);
  }
}

testValidDatesParse();
testImpossibleCalendarDatesAreRejected();
testOutOfRangeAndMalformedDatesAreRejected();
testDateShapedInputIsDetected();
testCityLookupErrorsAreLocalized();
testGenericRequestFailureIsLocalized();
testUnknownEnglishDetailIsHiddenFromOtherLocales();
testLocalizedGenericErrorIsKept();
testNewOnboardingMessagesExistInEveryLocale();
console.log('ok natal date input tests');
