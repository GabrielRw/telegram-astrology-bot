const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_RESPONSE_SHAPE_OVERRIDES_PATH = path.join(REPO_ROOT, 'data', 'routing', 'response-shape-overrides.json');

const DEFAULT_RESPONSE_SHAPE_DEFINITIONS = {
  synthesis: {
    description: 'A concise narrative answer that blends the most relevant facts into one readable interpretation.',
    instructions: [
      'Use this for most normal astrology answers.',
      'Prioritize clarity and interpretation over exhaustive lists.'
    ]
  },
  factual_cards: {
    description: 'A compact fact-first answer with distinct facts or sections.',
    instructions: [
      'Use this when exact placements, tools, or route outputs should stay visibly separated.',
      'Keep each section short and grounded in the available facts.'
    ]
  },
  full_listing: {
    description: 'An exhaustive listing response, usually for all matching transits or full result sets.',
    instructions: [
      'Use this only when the user asks for all matching items or a complete list.',
      'Do not collapse the result into a small curated subset.'
    ]
  },
  monthly_transit_overview: {
    description: 'A curated transit timeline answer for current sky, today, or month-ahead questions.',
    instructions: [
      'Start with the dominant current transit theme.',
      'Mention only the strongest active timeline items unless the user asks for all results.'
    ]
  },
  monthly_transit_planet_listing: {
    description: 'A transit timeline answer filtered to one requested planet.',
    instructions: [
      'Keep the answer focused on the requested transit planet.',
      'Include relevant timing windows when available.'
    ]
  },
  transit_search_result: {
    description: 'An exact transit-search answer for a planet, natal point, aspect type, and time window.',
    instructions: [
      'State the searched transit relationship clearly.',
      'Include exact dates or windows from the tool result when available.'
    ]
  },
  relocation_report: {
    description: 'A relocation recommendation answer with ranked places and astrocartography reasons.',
    instructions: [
      'Rank the strongest places first.',
      'Tie every recommendation to the provided relocation lines, crossings, or summaries.'
    ]
  },
  relocation_city_report: {
    description: 'A single-city relocation answer.',
    instructions: [
      'Give a clear verdict for the requested city.',
      'Explain the strongest supportive and challenging factors from the tool result.'
    ]
  },
  astrocartography_report: {
    description: 'An astrocartography lines/parans answer.',
    instructions: [
      'Group the most important lines or parans by life area.',
      'Do not invent locations or map lines not present in the tool result.'
    ]
  },
  progressions_report: {
    description: 'A secondary progressions answer.',
    instructions: [
      'Explain the progressed themes as developmental timing.',
      'Keep the answer grounded in the target date or year.'
    ]
  },
  progression_aspect_listing: {
    description: 'A listing-style answer for exact secondary progression aspects.',
    instructions: [
      'List exact progressed aspects in chronological or priority order.',
      'Include dates when the tool result provides them.'
    ]
  },
  profections_report: {
    description: 'An annual profection answer.',
    instructions: [
      'Name the profection year theme and lord when available.',
      'Connect the annual house focus to practical life areas.'
    ]
  },
  solar_return_report: {
    description: 'A solar return answer.',
    instructions: [
      'Frame the answer around the selected solar return year.',
      'Prioritize the solar return chart themes provided by the tool.'
    ]
  },
  planet_return_report: {
    description: 'A planet return answer.',
    instructions: [
      'Name the requested returning planet first.',
      'Explain the return timing and theme from the tool result.'
    ]
  },
  ephemeris_report: {
    description: 'An ephemeris answer for planetary positions and date ranges.',
    instructions: [
      'Keep the output factual and date-aware.',
      'Include retrograde or speed details only when present in the tool result.'
    ]
  },
  horoscope_report: {
    description: 'A daily horoscope answer.',
    instructions: [
      'Keep the answer timely and concise.',
      'Do not add natal details unless the tool result includes them.'
    ]
  },
  synastry_report: {
    description: 'A relationship compatibility or synastry answer.',
    instructions: [
      'Compare both people clearly.',
      'Balance strengths, tensions, and practical relationship patterns from the tool result.'
    ]
  },
  electional_results: {
    description: 'A ranked electional timing answer.',
    instructions: [
      'Present the best timing option first.',
      'Explain why the chosen windows are stronger than the alternatives.'
    ]
  }
};

function getResponseShapeOverridesPath() {
  return path.resolve(process.env.RESPONSE_SHAPE_OVERRIDES_PATH || DEFAULT_RESPONSE_SHAPE_OVERRIDES_PATH);
}

function normalizeShapeId(value) {
  const id = String(value || '').trim();
  if (!id) {
    throw new Error('Response shape id cannot be empty.');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Response shape id "${id}" must use lowercase letters, numbers, and underscores, and start with a letter.`);
  }
  return id;
}

function normalizeInstructions(value, shapeId) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Response shape "${shapeId}" instructions must be an array.`);
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function readResponseShapeOverrides(filePath = getResponseShapeOverridesPath()) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, shapes: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Response shape overrides must be a JSON object.');
  }
  return {
    version: Number(parsed.version || 1),
    shapes: parsed.shapes && typeof parsed.shapes === 'object' && !Array.isArray(parsed.shapes)
      ? parsed.shapes
      : parsed
  };
}

function normalizeResponseShapeOverrides(rawOverrides) {
  const source = rawOverrides?.shapes && typeof rawOverrides.shapes === 'object'
    ? rawOverrides.shapes
    : (rawOverrides || {});
  const normalized = {};

  for (const [shapeId, override] of Object.entries(source)) {
    const id = normalizeShapeId(shapeId);
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      throw new Error(`Response shape "${id}" override must be an object.`);
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

function loadResponseShapeOverrides(options = {}) {
  return normalizeResponseShapeOverrides(readResponseShapeOverrides(options.filePath || getResponseShapeOverridesPath()));
}

function getResponseShapeDefinitions(options = {}) {
  const overrides = options.overrides || loadResponseShapeOverrides({
    filePath: options.filePath || getResponseShapeOverridesPath()
  });
  const definitions = {};
  const shapeIds = new Set([
    ...Object.keys(DEFAULT_RESPONSE_SHAPE_DEFINITIONS),
    ...Object.keys(overrides)
  ]);
  for (const shapeId of shapeIds) {
    definitions[shapeId] = {
      id: shapeId,
      ...(DEFAULT_RESPONSE_SHAPE_DEFINITIONS[shapeId] || { description: '', instructions: [] }),
      ...(overrides[shapeId] || {})
    };
  }
  return definitions;
}

function getResponseShapeIds(options = {}) {
  return Object.keys(getResponseShapeDefinitions(options)).sort();
}

function getResponseShapeInstructions(shapeId) {
  const id = String(shapeId || '').trim();
  return getResponseShapeDefinitions()[id]?.instructions || [];
}

function writeResponseShapeOverrides(overrides, options = {}) {
  const filePath = options.filePath || getResponseShapeOverridesPath();
  const normalized = normalizeResponseShapeOverrides(overrides);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, shapes: normalized }, null, 2)}\n`);
  return normalized;
}

module.exports = {
  DEFAULT_RESPONSE_SHAPE_DEFINITIONS,
  DEFAULT_RESPONSE_SHAPE_OVERRIDES_PATH,
  getResponseShapeDefinitions,
  getResponseShapeIds,
  getResponseShapeInstructions,
  getResponseShapeOverridesPath,
  loadResponseShapeOverrides,
  normalizeResponseShapeOverrides,
  readResponseShapeOverrides,
  writeResponseShapeOverrides
};
