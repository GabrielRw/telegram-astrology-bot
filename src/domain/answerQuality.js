// Post-generation checks for user-facing answer text: repairs safe formatting/meta problems
// before delivery and reports everything else as issues for logging and evaluation.

const PLACEHOLDER_ANSWERS = new Set(['done', 'done.', 'ok', 'ok.', 'n/a', 'null', 'undefined']);

// Sentences that talk about the pipeline instead of the chart. They are dropped when repairing.
const META_SENTENCE_PATTERNS = [
  /\b(?:the|this) (?:tool|tool output|tool result|tool response|dataset|json|payload|api)\b/i,
  /\b(?:provided|supplied|available|given) (?:data|context|facts|evidence|results|tool results|information|electional results)\b/i,
  /\b(?:data|information|details) (?:is|are|was|were) not (?:provided|available|included|supplied)\b/i,
  /\bas an ai\b|\blanguage model\b/i,
  /\bl[’']outil\b|\bdonn[ée]es fournies\b|\bcontexte fourni\b|\br[ée]sultats fournis\b|\bn[’']est pas fourni/i,
  /\bdas tool\b|\bdes tools\b|\bbereitgestellten (?:daten|ergebnisse|informationen)\b|\bnicht (?:bereitgestellt|angegeben|enthalten)\b/i,
  /\bla herramienta\b|\b(?:datos|resultados|informaci[óo]n) proporcionad[oa]s?\b|\bno se proporciona/i
];

// Leading clauses that reference the pipeline; stripping them keeps the rest of the sentence.
const META_PREFIX_PATTERNS = [
  /^(?:based on|according to|from|per|using) (?:the )?(?:provided|supplied|available|given) [^,.]{0,80},\s*/i,
  /^(?:while|although|since|as) (?:specific )?[^,.]{0,40}(?:data|information|details) (?:is|are) not (?:provided|available|included)[^,.]{0,40},\s*/i,
  /^(?:d[’']apr[èe]s|selon|sur la base) (?:les |des )?(?:donn[ée]es|r[ée]sultats|informations) fourni[e]?s[^,.]{0,80},\s*/i,
  /^(?:basierend auf|laut|gem[äa]ß) (?:den )?bereitgestellten [^,.]{0,80},\s*/i,
  /^(?:seg[úu]n|con base en|basado en) (?:los |las )?(?:datos|resultados|informaci[óo]n) proporcionad[oa]s?[^,.]{0,80},\s*/i
];

const INTERNAL_IDENTIFIER_PATTERN = /\b(?:v[12]_[a-z0-9_]+|[a-z]+(?:_[a-z0-9]+){2,})\b/;
const RAW_VALUE_PATTERN = /\b(?:undefined|NaN)\b|\[object Object\]/;
const MARKDOWN_PATTERNS = [
  { code: 'markdown_heading', pattern: /^\s{0,3}#{1,6}\s+\S/m },
  { code: 'markdown_bold', pattern: /\*\*[^*\n]+\*\*/ },
  { code: 'markdown_code', pattern: /```|`[^`\n]+`/ },
  { code: 'markdown_table', pattern: /^\s*\|.*\|\s*$/m }
];

// Only words that are specific to one language: shared ones ("la", "en", "que", "se") make short
// French/Spanish answers ambiguous.
const LANGUAGE_STOPWORDS = {
  en: ['the', 'and', 'your', 'you', 'is', 'with', 'this', 'that', 'are', 'for', 'of', 'to', 'it', 'be', 'will', 'on', 'house', 'sign'],
  fr: ['le', 'les', 'et', 'votre', 'vous', 'est', 'avec', 'des', 'une', 'pour', 'dans', 'qui', 'sur', 'du', 'vos', 'au', 'aux', 'ce', 'cette', 'sont', 'mais', 'signe', 'maison', 'trouve'],
  de: ['der', 'die', 'das', 'und', 'dein', 'deine', 'du', 'ist', 'mit', 'ein', 'eine', 'für', 'nicht', 'auf', 'den', 'zu', 'im', 'sich', 'auch', 'von', 'dem', 'steht', 'zeichen', 'haus'],
  es: ['el', 'los', 'las', 'y', 'tu', 'tus', 'es', 'con', 'una', 'para', 'del', 'por', 'su', 'sus', 'está', 'son', 'muy', 'pero', 'como', 'lo', 'al', 'signo', 'casa']
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  ein: 1, einem: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5,
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6
};

function normalizeText(text) {
  return String(text || '').replace(/\r/g, '').trim();
}

function countWords(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

function splitParagraphs(text) {
  return normalizeText(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSentences(paragraph) {
  return String(paragraph || '').split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9¿¡"«“(])/);
}

function isMetaSentence(sentence) {
  return META_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
}

function capitalizeFirst(text) {
  return text.replace(/^(\s*["«“(]?)(\p{Ll})/u, (_match, lead, letter) => `${lead}${letter.toUpperCase()}`);
}

function stripMetaPrefix(sentence) {
  for (const pattern of META_PREFIX_PATTERNS) {
    if (pattern.test(sentence)) {
      return capitalizeFirst(sentence.replace(pattern, ''));
    }
  }
  return sentence;
}

function isHeadingLine(line, nextLine) {
  const value = line.trim();
  if (/^#{1,6}\s+\S/.test(value)) {
    return true;
  }
  if (/^\*\*[^*]{1,80}\*\*:?$/.test(value)) {
    return true;
  }
  // Plain title line ("Moon and Emotional Pattern") directly above its paragraph.
  return /^\s*[\p{Lu}\d"«“]/u.test(nextLine || '')
    && /^\p{Lu}/u.test(value)
    && !/[,;]/.test(value)
    && !/[.!?:)\]"»”]$/.test(value)
    && value.split(/\s+/).length <= 6
    && value.length <= 60;
}

function cleanHeading(line) {
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*|\*\*:?$/g, '').replace(/[:\s]+$/, '').trim();
}

// Chat channels have no headings, and the reply splitter collapses whitespace, so a heading line
// ends up glued to its body ("Core Identity The Sun is..."). Fold it into an explicit lead-in instead.
function foldHeadings(text) {
  const lines = text.split('\n');
  const output = [];
  let pendingHeading = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isHeadingLine(line, lines[index + 1])) {
      if (pendingHeading) {
        output.push(pendingHeading);
      }
      pendingHeading = cleanHeading(line);
      continue;
    }

    if (pendingHeading && !line.trim()) {
      continue;
    }

    if (pendingHeading) {
      output.push(`${pendingHeading} — ${line.trim()}`);
      pendingHeading = null;
      continue;
    }

    output.push(line);
  }

  if (pendingHeading) {
    output.push(pendingHeading);
  }

  return output.join('\n');
}

function repairLine(line, counters) {
  const sentences = splitSentences(line).map((sentence) => {
    const stripped = stripMetaPrefix(sentence);
    if (stripped !== sentence) {
      counters.strippedPrefixes += 1;
    }
    return stripped;
  });
  const kept = sentences.filter((sentence) => !isMetaSentence(sentence));
  counters.droppedSentences += sentences.length - kept.length;
  return kept.join(' ');
}

function repairAnswerText(text) {
  const original = normalizeText(text);
  const repairs = [];

  if (!original) {
    return { text: original, repairs };
  }

  const folded = foldHeadings(original);
  if (folded !== original) {
    repairs.push('folded_headings');
  }

  const counters = { strippedPrefixes: 0, droppedSentences: 0 };
  const repaired = folded
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .split('\n')
      .map((line) => (line.trim() ? repairLine(line, counters) : line))
      .filter((line) => line.trim())
      .join('\n')
      .trim())
    .filter(Boolean)
    .join('\n\n');

  // If everything was meta, keep the folded text rather than sending nothing.
  if (!repaired) {
    return { text: folded, repairs };
  }

  if (counters.strippedPrefixes > 0) {
    repairs.push('stripped_meta_prefix');
  }
  if (counters.droppedSentences > 0) {
    repairs.push('dropped_meta_sentence');
  }

  return { text: repaired, repairs };
}

function detectLanguage(text) {
  const words = normalizeText(text).toLowerCase().match(/[\p{L}’']+/gu) || [];
  if (words.length < 8) {
    return null;
  }

  const scores = Object.entries(LANGUAGE_STOPWORDS).map(([language, stopwords]) => {
    const set = new Set(stopwords);
    return [language, words.filter((word) => set.has(word)).length / words.length];
  }).sort((left, right) => right[1] - left[1]);

  const [best, runnerUp] = scores;
  if (best[1] < 0.06 || best[1] - runnerUp[1] < 0.02) {
    return null;
  }
  return best[0];
}

function parseRequestedParagraphCount(userText) {
  const value = String(userText || '').toLowerCase();
  const match = value.match(/\b(\d{1,2}|one|two|three|four|five|six|un|une|deux|trois|quatre|cinq|ein|einem|zwei|drei|vier|fünf|uno|dos|tres|cuatro|cinco|seis)\s+(?:short\s+|courts?\s+|kurzen?\s+|breves?\s+)?(paragraphs?|paragraphes?|absätzen?|absätze|abschnitten?|párrafos?|parrafos?)\b/u);
  if (!match) {
    return null;
  }
  const raw = match[1];
  const count = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return Number.isFinite(count) && count > 0 ? count : null;
}

function parseRequestedSentenceCount(userText) {
  const value = String(userText || '').toLowerCase();
  if (/\b(?:in )?(?:one|a single|1) sentence\b|\ben une (?:seule )?phrase\b|\bin einem satz\b|\ben una (?:sola )?frase\b/.test(value)) {
    return 1;
  }
  return null;
}

function countSentences(text) {
  return splitParagraphs(text)
    .flatMap((paragraph) => splitSentences(paragraph.replace(/\s+/g, ' ')))
    .filter((sentence) => sentence.trim()).length;
}

function validateAnswerText(text, context = {}) {
  const value = normalizeText(text);
  const issues = [];
  const add = (code, severity, detail = null) => issues.push({ code, severity, ...(detail ? { detail } : {}) });

  if (!value || PLACEHOLDER_ANSWERS.has(value.toLowerCase())) {
    if (context.hasMedia) {
      add('media_only_answer', 'warning');
    } else {
      add('empty_answer', 'error');
    }
    return { issues, stats: { wordCount: 0, paragraphCount: 0, detectedLanguage: null } };
  }

  const metaSentence = value.split(/\n+/).flatMap(splitSentences).find(isMetaSentence);
  if (metaSentence) {
    add('meta_leak', 'error', metaSentence.slice(0, 160));
  }

  const identifier = value.match(INTERNAL_IDENTIFIER_PATTERN);
  if (identifier) {
    add('internal_identifier', 'error', identifier[0]);
  }

  const rawValue = value.match(RAW_VALUE_PATTERN);
  if (rawValue) {
    add('raw_value', 'error', rawValue[0]);
  }

  for (const { code, pattern } of MARKDOWN_PATTERNS) {
    if (pattern.test(value)) {
      add(code, 'warning');
    }
  }

  const detectedLanguage = detectLanguage(value);
  const expectedLanguage = context.locale ? String(context.locale).slice(0, 2) : null;
  if (expectedLanguage && detectedLanguage && detectedLanguage !== expectedLanguage) {
    add('language_mismatch', 'error', `expected ${expectedLanguage}, got ${detectedLanguage}`);
  }

  const paragraphCount = splitParagraphs(value).length;
  const requestedParagraphs = parseRequestedParagraphCount(context.userText);
  if (requestedParagraphs && paragraphCount !== requestedParagraphs) {
    add('format_paragraph_count', 'error', `asked ${requestedParagraphs}, got ${paragraphCount}`);
  }

  const requestedSentences = parseRequestedSentenceCount(context.userText);
  const sentenceCount = countSentences(value);
  if (requestedSentences && sentenceCount > requestedSentences) {
    add('format_sentence_count', 'error', `asked ${requestedSentences}, got ${sentenceCount}`);
  }

  if (/^\p{Ll}/u.test(value)) {
    add('lowercase_start', 'warning', value.slice(0, 40));
  }

  const wordCount = countWords(value);
  if (context.maxWords && wordCount > context.maxWords) {
    add('too_long', 'warning', `${wordCount} words`);
  }

  return {
    issues,
    stats: {
      wordCount,
      paragraphCount,
      sentenceCount,
      detectedLanguage
    }
  };
}

module.exports = {
  detectLanguage,
  parseRequestedParagraphCount,
  repairAnswerText,
  validateAnswerText
};
