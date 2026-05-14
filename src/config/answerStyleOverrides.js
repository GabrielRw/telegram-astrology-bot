const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ANSWER_STYLE_OVERRIDES_PATH = path.join(REPO_ROOT, 'data', 'routing', 'answer-style-overrides.json');

const DEFAULT_ANSWER_STYLE_DEFINITIONS = {
  natal_theme: {
    description: 'Broad natal synthesis across the strongest chart themes.',
    instructions: [
      'Structure the answer around 2 or 3 major natal axes only.',
      'Open with the main defining theme, then add the strongest supporting pattern.'
    ]
  },
  planet_focus: {
    description: 'Focused answer about one planet, angle, sign, or placement.',
    instructions: [
      'Focus first on the planet itself, then on its sign, house, and lived expression.',
      'Do not drift into a full chart summary.'
    ]
  },
  house_focus: {
    description: 'Focused answer about a house, house ruler, or life area.',
    instructions: [
      'Structure the answer as: house topic, ruler or strongest house factor, then lived impact.',
      'Do not reduce the answer to a generic planet-in-house reading.'
    ]
  },
  aspect_focus: {
    description: 'Focused answer about one aspect or aspect pattern.',
    instructions: [
      'Name the main aspect dynamic first, then explain how it affects personality or behavior.',
      'Keep the answer centered on one dominant aspect pattern.'
    ]
  },
  life_area_theme: {
    description: 'Natal synthesis centered on one life area such as love, money, career, family, or purpose.',
    instructions: [
      'Prioritize the life area named in the question and rank the strongest 2 or 3 factors.',
      'Avoid cataloguing signatures without linking them to lived experience.'
    ]
  },
  current_sky: {
    description: 'Current sky atmosphere, with optional personal activation.',
    instructions: [
      'Start with the dominant atmosphere of the sky today.',
      'Then narrow into the most relevant personal activation if one is clearly present.'
    ]
  },
  personal_transits: {
    description: 'Personal current or forecast transit answer.',
    instructions: [
      'Start with the dominant personal transit of the day or period.',
      'Add at most two secondary activations and one short practical takeaway.'
    ]
  },
  synastry: {
    description: 'Two-person compatibility or relationship comparison answer.',
    instructions: [
      'Write as a comparison between two people, naming the dynamic clearly and directly.',
      'Do not answer as if only one chart existed.'
    ]
  },
  system_answer: {
    description: 'Structured/system-style answer for tool results, clarification, metadata, or operational responses.',
    instructions: [
      'Prioritize clarity and grounded tool output.',
      'Avoid unnecessary interpretation when the user needs structured facts or next steps.'
    ]
  }
};

const DEFAULT_ANSWER_STYLE_IDS = new Set(Object.keys(DEFAULT_ANSWER_STYLE_DEFINITIONS));

function getAnswerStyleOverridesPath() {
  return path.resolve(process.env.ANSWER_STYLE_OVERRIDES_PATH || DEFAULT_ANSWER_STYLE_OVERRIDES_PATH);
}

function normalizeAnswerStyleId(value) {
  const id = String(value || '').trim();
  if (!id) {
    throw new Error('Answer style id cannot be empty.');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Answer style id "${id}" must use lowercase letters, numbers, and underscores, and start with a letter.`);
  }
  return id;
}

function normalizeInstructions(value, styleId) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Answer style "${styleId}" instructions must be an array.`);
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function readAnswerStyleOverrides(filePath = getAnswerStyleOverridesPath()) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, styles: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Answer style overrides must be a JSON object.');
  }
  return {
    version: Number(parsed.version || 1),
    styles: parsed.styles && typeof parsed.styles === 'object' && !Array.isArray(parsed.styles)
      ? parsed.styles
      : parsed
  };
}

function normalizeAnswerStyleOverrides(rawOverrides) {
  const source = rawOverrides?.styles && typeof rawOverrides.styles === 'object'
    ? rawOverrides.styles
    : (rawOverrides || {});
  const normalized = {};

  for (const [styleId, override] of Object.entries(source)) {
    const id = normalizeAnswerStyleId(styleId);
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      throw new Error(`Answer style "${id}" override must be an object.`);
    }

    const next = {};
    if (override.description !== undefined) {
      next.description = String(override.description || '').trim();
    }
    const instructions = normalizeInstructions(override.instructions, id);
    if (instructions !== undefined) {
      next.instructions = instructions;
    }
    if (Object.keys(next).length > 0) {
      normalized[id] = next;
    }
  }

  return normalized;
}

function loadAnswerStyleOverrides(options = {}) {
  return normalizeAnswerStyleOverrides(readAnswerStyleOverrides(options.filePath || getAnswerStyleOverridesPath()));
}

function getAnswerStyleDefinitions(options = {}) {
  const overrides = options.overrides || loadAnswerStyleOverrides({
    filePath: options.filePath || getAnswerStyleOverridesPath()
  });
  const definitions = {};
  const styleIds = new Set([
    ...Object.keys(DEFAULT_ANSWER_STYLE_DEFINITIONS),
    ...Object.keys(overrides)
  ]);
  for (const styleId of styleIds) {
    definitions[styleId] = {
      id: styleId,
      ...(DEFAULT_ANSWER_STYLE_DEFINITIONS[styleId] || { description: '', instructions: [] }),
      ...(overrides[styleId] || {})
    };
  }
  return definitions;
}

function getAnswerStyleIds(options = {}) {
  return Object.keys(getAnswerStyleDefinitions(options)).sort();
}

function getAnswerStyleInstructions(styleId) {
  const id = String(styleId || '').trim();
  return getAnswerStyleDefinitions()[id]?.instructions || [];
}

function writeAnswerStyleOverrides(overrides, options = {}) {
  const filePath = options.filePath || getAnswerStyleOverridesPath();
  const normalized = normalizeAnswerStyleOverrides(overrides);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, styles: normalized }, null, 2)}\n`);
  return normalized;
}

module.exports = {
  DEFAULT_ANSWER_STYLE_IDS,
  DEFAULT_ANSWER_STYLE_DEFINITIONS,
  DEFAULT_ANSWER_STYLE_OVERRIDES_PATH,
  getAnswerStyleDefinitions,
  getAnswerStyleIds,
  getAnswerStyleInstructions,
  getAnswerStyleOverridesPath,
  loadAnswerStyleOverrides,
  normalizeAnswerStyleOverrides,
  readAnswerStyleOverrides,
  writeAnswerStyleOverrides
};
