const assert = require('node:assert/strict');

const {
  detectLanguage,
  parseRequestedParagraphCount,
  repairAnswerText,
  validateAnswerText
} = require('../src/domain/answerQuality');

function codes(result) {
  return result.issues.map((issue) => issue.code);
}

function testHeadingsAreFoldedIntoTheirBody() {
  const { text, repairs } = repairAnswerText('### Core Identity\nThe Sun is in Taurus.\n\n**Moon**\n\nYour Moon is in Capricorn.');

  assert.equal(text, 'Core Identity — The Sun is in Taurus.\n\nMoon — Your Moon is in Capricorn.');
  assert.deepEqual(repairs, ['folded_headings']);
}

function testPlainTitleLinesAreFolded() {
  const { text } = repairAnswerText('Core Identity\nYour chart ruler is Mercury.\n\nMoon and Emotional Pattern\nYour Moon is in Capricorn.');

  assert.equal(text, 'Core Identity — Your chart ruler is Mercury.\n\nMoon and Emotional Pattern — Your Moon is in Capricorn.');
}

function testSentencesAndListsAreNotTreatedAsTitles() {
  for (const input of [
    'Your Sun is in Taurus.\nYour Moon is in Capricorn.',
    '- Venus in Aries\n- Mars in Pisces',
    'Mercury, Venus\nand Mars are strong.'
  ]) {
    assert.deepEqual(repairAnswerText(input), { text: input, repairs: [] }, input);
  }
}

function testMetaSentencesAreDroppedInEveryLanguage() {
  const samples = [
    ['Your Sun is in Taurus. The tool does not list any exact hit today.', 'Your Sun is in Taurus.'],
    ["Votre Soleil est en Taureau. L'outil ne mentionne aucune occurrence d'hit exact.", 'Votre Soleil est en Taureau.'],
    ['Deine Sonne steht im Stier. Das Tool nennt keinen exakten Treffer.', 'Deine Sonne steht im Stier.'],
    ['Tu Sol está en Tauro. La herramienta no menciona ningún aspecto exacto.', 'Tu Sol está en Tauro.']
  ];

  for (const [input, expected] of samples) {
    const { text, repairs } = repairAnswerText(input);
    assert.equal(text, expected, input);
    assert.deepEqual(repairs, ['dropped_meta_sentence'], input);
  }
}

function testMetaLeadInIsStrippedButSentenceKept() {
  const { text, repairs } = repairAnswerText(
    'While specific aspect data is not provided, your placement suggests persistence. Based on the provided electional results for October 19–25, the best option is October 23.'
  );

  assert.equal(text, 'Your placement suggests persistence. The best option is October 23.');
  assert.deepEqual(repairs, ['stripped_meta_prefix']);
}

function testRepairNeverEmptiesAnAnswer() {
  const input = 'The tool returned no data.';
  const { text } = repairAnswerText(input);

  assert.equal(text, input);
}

function testCleanAnswerIsUntouched() {
  const input = 'Your Ascendant is in Virgo.\n\nThat makes first impressions careful and precise.';
  assert.deepEqual(repairAnswerText(input), { text: input, repairs: [] });
  assert.deepEqual(codes(validateAnswerText(input, { locale: 'en' })), []);
}

function testEmptyAndPlaceholderAnswersAreErrors() {
  assert.deepEqual(codes(validateAnswerText('', { locale: 'en' })), ['empty_answer']);
  assert.deepEqual(codes(validateAnswerText('Done.', { locale: 'en' })), ['empty_answer']);
  assert.deepEqual(codes(validateAnswerText('', { locale: 'en', hasMedia: true })), ['media_only_answer']);
}

function testLeaksIdentifiersAndRawValuesAreReported() {
  const result = validateAnswerText(
    'The making_contracts_election_search route found October 23. Score: undefined. Based on the provided data, it is fine.',
    { locale: 'en' }
  );

  assert.deepEqual(codes(result).sort(), ['internal_identifier', 'meta_leak', 'raw_value']);
}

function testMarkdownArtifactsAreWarnings() {
  const result = validateAnswerText('### Title\n**Bold** text with `code`.\n| a | b |', { locale: 'en' });

  assert.deepEqual(codes(result), ['markdown_heading', 'markdown_bold', 'markdown_code', 'markdown_table']);
  assert.equal(result.issues.every((issue) => issue.severity === 'warning'), true);
}

function testLanguageMismatchIsDetected() {
  const english = 'Your Sun is in Taurus and this gives you a steady approach to life, with a focus on the things that are reliable for you.';
  const french = 'Votre Soleil est en Taureau et cela vous donne une approche stable de la vie, avec un intérêt pour les choses qui sont fiables pour vous.';

  assert.equal(detectLanguage(english), 'en');
  assert.equal(detectLanguage(french), 'fr');
  assert.equal(detectLanguage('Sun Taurus'), null);
  assert.deepEqual(codes(validateAnswerText(english, { locale: 'fr' })), ['language_mismatch']);
  assert.deepEqual(codes(validateAnswerText(french, { locale: 'fr' })), []);
  // Short French answers share "la"/"en" with Spanish; they must not be read as Spanish.
  assert.equal(detectLanguage('La Lune se trouve en Capricorne, en maison 5. Position exacte dans le signe : 27.42°.'), 'fr');
  assert.equal(detectLanguage('Tu Luna está en Capricornio, en la casa 5. Es un signo muy serio.'), 'es');
}

function testLowercaseStartIsAWarning() {
  const result = validateAnswerText('la Lune se trouve en Capricorne.', { locale: 'fr' });

  assert.deepEqual(codes(result), ['lowercase_start']);
  assert.equal(result.issues[0].severity, 'warning');
}

function testRequestedParagraphCountIsEnforced() {
  assert.equal(parseRequestedParagraphCount('Summarize my chart in 3 paragraphs'), 3);
  assert.equal(parseRequestedParagraphCount('Résume mon thème en trois paragraphes'), 3);
  assert.equal(parseRequestedParagraphCount('Fasse mein Horoskop in zwei Absätzen zusammen'), 2);
  assert.equal(parseRequestedParagraphCount('Resume mi carta en 2 párrafos'), 2);
  assert.equal(parseRequestedParagraphCount('What is my rising sign?'), null);

  const sevenSections = Array.from({ length: 7 }, (_, index) => `Section ${index + 1} text.`).join('\n\n');
  assert.deepEqual(codes(validateAnswerText(sevenSections, { userText: 'Summarize my chart in 3 paragraphs' })), ['format_paragraph_count']);
  assert.deepEqual(codes(validateAnswerText('One.\n\nTwo.\n\nThree.', { userText: 'Summarize my chart in 3 paragraphs' })), []);
}

function testSingleSentenceRequestIsEnforced() {
  const userText = 'Describe my Moon in one sentence';

  assert.deepEqual(codes(validateAnswerText('Your Moon is in Capricorn. It is serious.', { userText })), ['format_sentence_count']);
  assert.deepEqual(codes(validateAnswerText('Your Moon is in Capricorn.', { userText })), []);
}

function testMaxWordsIsAWarning() {
  const result = validateAnswerText(`Word ${'word '.repeat(29)}`, { maxWords: 20 });

  assert.deepEqual(codes(result), ['too_long']);
  assert.equal(result.stats.wordCount, 30);
}

testHeadingsAreFoldedIntoTheirBody();
testPlainTitleLinesAreFolded();
testSentencesAndListsAreNotTreatedAsTitles();
testLowercaseStartIsAWarning();
testMetaSentencesAreDroppedInEveryLanguage();
testMetaLeadInIsStrippedButSentenceKept();
testRepairNeverEmptiesAnAnswer();
testCleanAnswerIsUntouched();
testEmptyAndPlaceholderAnswersAreErrors();
testLeaksIdentifiersAndRawValuesAreReported();
testMarkdownArtifactsAreWarnings();
testLanguageMismatchIsDetected();
testRequestedParagraphCountIsEnforced();
testSingleSentenceRequestIsEnforced();
testMaxWordsIsAWarning();
console.log('ok answer quality tests');
