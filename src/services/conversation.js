const { performance } = require('node:perf_hooks');
const { detectConversationIntent } = require('../config/conversationIntents');
const factIndex = require('./factIndex');
const mcpService = require('./freeastroMcp');
const profiles = require('./profiles');
const toolCache = require('./toolCache');
const { createLocalFunctionDeclarations, generatePlainText, getFastPathModelName, runFunctionCallingLoop } = require('./gemini');
const { info } = require('./logger');
const {
  consumePendingSynastryQuestion,
  getChatState,
  pushHistory,
  setLastToolResults
} = require('../state/chatState');
const { getLocale } = require('./locale');

const LOCALE_INSTRUCTION = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish'
};

const SYNSTRY_TOOL_NAMES = new Set([
  'v1_western_synastry',
  'v1_western_synastry_summary',
  'v1_western_synastry_simplified',
  'v1_western_synastry_horoscope',
  'v1_western_synastrycards'
]);

function findPlanet(profile, planet) {
  const key = String(planet || '').trim().toLowerCase();
  return profile?.planetsById?.[key] || null;
}

function findHouse(profile, house) {
  return profile?.housesById?.[String(house)] || null;
}

function findAngle(profile, angle) {
  return profile?.angles?.[String(angle || '').trim().toLowerCase()] || null;
}

function describeSynastryContext(context) {
  if (!context?.secondaryProfile) {
    return 'No comparison profile selected.';
  }

  return [
    `Active profile: ${context.activeProfile.profileName}`,
    `Comparison profile: ${context.secondaryProfile.profileName}`,
    'For relationship questions, default to synastry summary first and use full synastry only if the summary is insufficient.'
  ].join('\n');
}

function buildSystemInstruction(chatState, mcpStatus, intent, options = {}) {
  const profile = chatState.natalProfile;
  const locale = getLocale(chatState);
  const relocationRules = intent.id === 'relocation'
    ? [
        'For relocation and astrocartography questions, prefer MCP astrocartography tools over generic natal interpretation.',
        'If you need one missing parameter such as the relocation goal or target city, ask only that one question.',
        'When you answer, state the raw returned evidence first, such as distances, scores, city names, or line types.',
        'Then interpret those values in plain language.',
        'If score meaning is not explicitly documented in the tool result, present your reading as an inference, not as endpoint fact.',
        'Do not invent generic distance-orb rules such as "300 to 500 km" unless the tool result explicitly provides that rule.',
        'Do not say that you cannot show images, maps, or visuals in chat.',
        'If the user asks for lines on the map, answer the question normally and assume the system may attach a relevant astrocartography map image after your text reply.'
      ]
    : [];

  const lines = [
    'You are a concise professional astrologer answering natal-chart questions in a messaging chat.',
    `Always answer in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Write in plain text only. Do not use Markdown emphasis, especially **.',
    'Keep each response block short. Aim for multiple small blocks, with no block over 80 words.',
    'Do not repeat the same point twice in one answer, even in different wording.',
    'Ground every answer in the user natal chart, cached tool results, or explicit tool results.',
    'Never invent placements, houses, angles, aspects, timings, or predictions.',
    'If information is missing, say so clearly and ask a narrow follow-up only when required.',
    'If the user asks for transits, ephemeris, or a month-specific forecast and the needed date window is missing, first prefer the cached monthly transit timeline.',
    'Do not give medical, legal, or financial advice.',
    'Never answer personal astrology questions without natal data.',
    'For natal and monthly transit questions, call search_cached_profile_facts first whenever possible, then use the older cached natal/monthly transit tools only if the fact index is insufficient.',
    'Use FreeAstro MCP only when indexed facts and cached data are insufficient.',
    'When using tool data, interpret it like an astrologer, but stay specific to the chart and concise.',
    ...relocationRules,
    `Detected user intent: ${intent.id}.`,
    `Routing guidance: ${intent.guidance}`,
    `Preferred cached tools: ${intent.prefersCachedTools.join(', ') || 'none'}.`,
    `Preferred MCP tools: ${intent.prefersMcpTools.join(', ') || 'none'}.`,
    `MCP status: ${mcpStatus}.`,
    `Active profile name: ${options.activeProfileName || 'Unknown'}.`,
    `Indexed natal facts: ${options.factAvailability?.hasNatalFacts ? 'available' : 'not indexed yet'}.`,
    `Indexed monthly transit facts: ${options.factAvailability?.indexedTransitCacheMonth || 'not indexed for the active month'}.`,
    `Cached monthly transit timeline: ${options.monthlyTransitAvailable ? 'available for the active month' : 'not cached yet'}.`
  ];

  if (options.includeNatalSummary !== false) {
    lines.push(
      '',
      'Natal profile facts:',
      profile?.summaryText || 'No natal profile available.'
    );
  }

  lines.push(
    '',
    'Synastry context:',
    describeSynastryContext(options.synastryContext)
  );

  return lines.join('\n');
}

function normalizeAssistantText(text) {
  const cleaned = String(text || '')
    .replace(/\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .trim();

  return dedupeRepeatedSentences(cleaned);
}

function normalizeSentenceForCompare(sentence) {
  return String(sentence || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWordSet(sentence) {
  return new Set(
    normalizeSentenceForCompare(sentence)
      .split(' ')
      .filter((word) => word.length > 2)
  );
}

function sentenceSimilarity(left, right) {
  const leftWords = getWordSet(left);
  const rightWords = getWordSet(right);

  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftWords.size, rightWords.size);
}

function dedupeRepeatedSentences(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const keptSentences = [];
  const keptParagraphs = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const uniqueSentences = [];

    for (const sentence of sentences) {
      const signature = normalizeSentenceForCompare(sentence);
      const isDuplicate = keptSentences.some((existing) => {
        if (existing.signature === signature) {
          return true;
        }

        const wordCount = signature.split(' ').filter(Boolean).length;
        if (wordCount < 6) {
          return false;
        }

        return sentenceSimilarity(existing.text, sentence) >= 0.8;
      });

      if (!isDuplicate) {
        keptSentences.push({ signature, text: sentence });
        uniqueSentences.push(sentence);
      }
    }

    if (uniqueSentences.length > 0) {
      keptParagraphs.push(uniqueSentences.join(' '));
    }
  }

  return keptParagraphs.join('\n\n').trim();
}

function isLocalOnlyPreferred(intent, factAvailability) {
  if (!intent || intent.id === 'relocation' || intent.id === 'synastry') {
    return false;
  }

  if (intent.id === 'transits') {
    return Boolean(factAvailability?.indexedTransitCacheMonth);
  }

  return Boolean(factAvailability?.hasNatalFacts);
}

function isFactFastPathEligible(intent, factAvailability) {
  if (!intent || intent.id === 'relocation' || intent.id === 'synastry') {
    return false;
  }

  if (intent.id === 'transits') {
    return Boolean(factAvailability?.indexedTransitCacheMonth);
  }

  return Boolean(factAvailability?.hasNatalFacts);
}

function extractQuestionTags(text) {
  const value = String(text || '').toLowerCase();
  const tags = new Set();

  const keywordMap = [
    ['career', ['life_path', 'structure', 'career', 'work', 'profession', 'public_life']],
    ['work', ['life_path', 'structure', 'career', 'work']],
    ['job', ['life_path', 'structure', 'career', 'work']],
    ['purpose', ['life_path', 'identity']],
    ['relationship', ['relationships', 'love', 'partnership']],
    ['love', ['relationships', 'love', 'partnership']],
    ['partner', ['relationships', 'partnership']],
    ['money', ['resources', 'money', 'security']],
    ['emotion', ['emotions', 'feelings']],
    ['feel', ['emotions', 'feelings']],
    ['mind', ['mind', 'thinking', 'communication']],
    ['communication', ['mind', 'communication']],
    ['family', ['roots', 'family', 'home']],
    ['home', ['roots', 'home', 'family']],
    ['identity', ['identity', 'self']],
    ['strength', ['identity', 'strength', 'talent']],
    ['challenge', ['challenge', 'growth', 'pressure']],
    ['transit', ['transit']],
    ['month', ['month']],
    ['forecast', ['forecast', 'month']],
    ['today', ['timing', 'current']],
    ['current', ['timing', 'current']]
  ];

  keywordMap.forEach(([needle, mappedTags]) => {
    if (value.includes(needle)) {
      mappedTags.forEach((tag) => tags.add(tag));
    }
  });

  const planets = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron'];
  planets.forEach((planet) => {
    if (new RegExp(`\\b${planet}\\b`, 'i').test(value)) {
      tags.add(`planet:${planet}`);
    }
  });

  for (let house = 1; house <= 12; house += 1) {
    if (new RegExp(`\\b${house}(st|nd|rd|th)?\\b`, 'i').test(value) || new RegExp(`\\bhouse\\s+${house}\\b`, 'i').test(value)) {
      tags.add(`house:${house}`);
    }
  }

  if (/\brising|ascendant|asc\b/i.test(value)) {
    tags.add('angle:asc');
  }

  if (/\bmidheaven|mc\b/i.test(value)) {
    tags.add('angle:mc');
  }

  return [...tags];
}

function buildFactSearchInput(intent, userText, activeProfile, factAvailability) {
  const tags = extractQuestionTags(userText);
  const input = {
    primaryProfileId: activeProfile.profileId,
    secondaryProfileId: null,
    categories: [],
    tags,
    sourceKinds: [],
    cacheMonth: null,
    limit: 6
  };

  if (intent.id === 'transits') {
    input.sourceKinds = [factIndex.MONTHLY_TRANSIT_SOURCE_KIND];
    input.cacheMonth = factAvailability?.indexedTransitCacheMonth || null;
    input.limit = 5;
  } else {
    input.sourceKinds = [factIndex.NATAL_SOURCE_KIND];
  }

  return input;
}

function sentenceCase(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return text.endsWith('.') || text.endsWith('!') || text.endsWith('?')
    ? text
    : `${text}.`;
}

function summarizeFactTags(tags, limit = 5) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => !String(tag).startsWith('month:'))
    .filter((tag) => !['natal', 'monthly_transit', 'timing', 'theme'].includes(String(tag)))
    .slice(0, limit)
    .join(', ');
}

function buildDeterministicFactAnswer(userText, facts, intent, activeProfile) {
  const selectedFacts = Array.isArray(facts) ? facts.slice(0, 4) : [];
  if (selectedFacts.length === 0) {
    return '';
  }

  const intro = intent.id === 'transits'
    ? `For ${activeProfile.profileName || 'your chart'}, the current transit picture is led by these active themes.`
    : `For ${activeProfile.profileName || 'your chart'}, the clearest answer comes from these chart factors.`;

  const body = selectedFacts
    .map((fact) => sentenceCase(fact.factText))
    .join(' ');

  const closing = intent.id === 'transits'
    ? 'This is the strongest current emphasis in the indexed monthly transit data.'
    : `That is the strongest pattern connected to your question: "${String(userText || '').trim()}".`;

  return normalizeAssistantText([intro, body, closing].join('\n\n'));
}

function buildFactRewritePrompt(userText, facts, intent, activeProfile, draftAnswer) {
  const factLines = facts.slice(0, 4).map((fact, index) => {
    const parts = [
      `${index + 1}. Title: ${fact.title || 'Untitled fact'}`,
      `Category: ${fact.category}`,
      fact.sourceKind ? `Source: ${fact.sourceKind}` : null,
      summarizeFactTags(fact.tags) ? `Tags: ${summarizeFactTags(fact.tags)}` : null,
      `Evidence: ${fact.factText}`
    ].filter(Boolean);

    return parts.join('\n');
  });

  return [
    `Profile: ${activeProfile.profileName || 'Chart User'}`,
    `Intent: ${intent.id}`,
    `Question: ${String(userText || '').trim()}`,
    '',
    'Grounded facts:',
    ...factLines,
    '',
    'Fallback draft:',
    draftAnswer
  ].join('\n');
}

async function maybeRewriteFactAnswer(locale, userText, facts, intent, activeProfile, draftAnswer) {
  if (!draftAnswer || process.env.FAST_PATH_GEMINI_REWRITE === 'false') {
    return draftAnswer;
  }

  const systemInstruction = [
    'Write a short astrology answer from grounded facts only.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Use plain text only.',
    'Translate metadata and evidence into natural astrological language.',
    'Do not expose labels such as category, kind, subjects, tags, source, or metadata.',
    'Do not list raw taxonomy terms unless they are naturally readable astrology terms.',
    'Do not add any new facts, timings, placements, or interpretations.',
    'Answer the user question directly first, then support it with 2 or 3 grounded chart factors.',
    'Keep it to 2 or 3 short paragraphs.'
  ].join('\n');

  const rewritten = await generatePlainText({
    systemInstruction,
    userText: buildFactRewritePrompt(userText, facts, intent, activeProfile, draftAnswer),
    history: [],
    model: getFastPathModelName()
  });

  return normalizeAssistantText(rewritten || draftAnswer);
}

async function tryFactFastPath(identity, userText, intent, activeProfile, factAvailability, locale) {
  if (!isFactFastPathEligible(intent, factAvailability)) {
    return null;
  }

  const startedAt = performance.now();
  const searchInput = buildFactSearchInput(intent, userText, activeProfile, factAvailability);
  let facts = await factIndex.searchFacts(identity, searchInput);

  if (facts.length < 2 && searchInput.tags.length > 0) {
    facts = await factIndex.searchFacts(identity, {
      ...searchInput,
      tags: [],
      limit: intent.id === 'transits' ? 5 : 4
    });
  }

  if (facts.length < 2) {
    return null;
  }

  const draftAnswer = buildDeterministicFactAnswer(userText, facts, intent, activeProfile);
  if (!draftAnswer) {
    return null;
  }

  let rewrittenAnswer = draftAnswer;
  let rewriteDurationMs = 0;

  try {
    const rewriteStartedAt = performance.now();
    rewrittenAnswer = await maybeRewriteFactAnswer(locale, userText, facts, intent, activeProfile, draftAnswer);
    rewriteDurationMs = Math.round(performance.now() - rewriteStartedAt);
  } catch (error) {
    info('conversation fact fast-path rewrite failed', {
      stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
      intent: intent.id,
      error: error.message || 'unknown'
    });
  }

  return {
    text: rewrittenAnswer,
    usedTools: [{
      name: 'search_cached_profile_facts',
      args: searchInput,
      result: {
        available: true,
        facts: facts.map((fact) => ({
          category: fact.category,
          title: fact.title,
          tags: fact.tags,
          fact_text: fact.factText
        }))
      }
    }],
    durationMs: Math.round(performance.now() - startedAt),
    rewriteDurationMs
  };
}

function localToolResultHasData(toolResult) {
  const result = toolResult?.result;

  if (!result || typeof result !== 'object' || result.error) {
    return false;
  }

  if (result.available === true) {
    return true;
  }

  if (Array.isArray(result.facts) && result.facts.length > 0) {
    return true;
  }

  if (Array.isArray(result.aspects) && result.aspects.length > 0) {
    return true;
  }

  if (result.summary || result.planet || result.house || result.angle || result.timeline) {
    return true;
  }

  return false;
}

function localResultLooksSufficient(loopResult, intent) {
  const toolResults = Array.isArray(loopResult?.toolResults) ? loopResult.toolResults : [];

  if (toolResults.some(localToolResultHasData)) {
    return true;
  }

  const text = String(loopResult?.text || '').trim();
  if (!text) {
    return false;
  }

  if (intent?.id === 'transits') {
    return false;
  }

  return !/could not generate|tool-calling limit|missing|need your birth details/i.test(text);
}

async function createLocalToolExecutor(identity, activeProfile, factAvailability = {}) {
  const profile = getChatState(identity).natalProfile;

  return async (name, args) => {
    switch (name) {
      case 'search_cached_profile_facts': {
        const categories = Array.isArray(args.categories) ? args.categories : [];
        const tags = Array.isArray(args.tags) ? args.tags : [];
        const sourceKinds = Array.isArray(args.sourceKinds) ? args.sourceKinds : [];
        const wantsTransitFacts = (
          sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND) ||
          categories.some((category) => ['transit_event', 'transit_theme', 'timing_window'].includes(String(category))) ||
          tags.some((tag) => String(tag).toLowerCase().includes('transit')) ||
          Boolean(args.cacheMonth)
        );

        if (!factAvailability.hasNatalFacts) {
          await toolCache.ensureNatalInsights(identity, activeProfile, { source: 'runtime' });
        }

        if (wantsTransitFacts) {
          const requestedCacheMonth = args.cacheMonth || toolCache.getCurrentMonthWindow(activeProfile.timezone || 'UTC')?.cacheMonth || null;
          if (!requestedCacheMonth || factAvailability.indexedTransitCacheMonth !== requestedCacheMonth) {
            await toolCache.ensureMonthlyTransitInsights(identity, activeProfile, { source: 'runtime' });
          }
        }

        const facts = await factIndex.searchFacts(identity, {
          primaryProfileId: activeProfile.profileId,
          secondaryProfileId: args.secondaryProfileId || null,
          categories,
          tags,
          sourceKinds,
          cacheMonth: args.cacheMonth || null,
          limit: args.limit || 12
        });

        return {
          available: facts.length > 0,
          facts: facts.map((fact) => ({
            category: fact.category,
            tags: fact.tags,
            title: fact.title,
            fact_text: fact.factText,
            fact_payload: fact.factPayload,
            source_kind: fact.sourceKind,
            cache_month: fact.cacheMonth
          }))
        };
      }
      case 'get_cached_natal_summary':
        return {
          available: Boolean(profile),
          summary: profile?.summaryText || null,
          birthDatetime: profile?.birthDatetime || null,
          birthLocation: profile?.birthLocation || null,
          stelliums: profile?.stelliums || null,
          confidence: profile?.confidence || null
        };
      case 'get_cached_planet_placement': {
        const planet = findPlanet(profile, args.planet);

        if (!planet) {
          return { error: `Planet "${args.planet}" is not available in the cached natal profile.` };
        }

        const signKey = `planet.${String(planet.id).toLowerCase()}.sign.${String(planet.sign_id || '').toLowerCase()}`;
        const houseKey = planet.house ? `planet.${String(planet.id).toLowerCase()}.house.${planet.house}` : null;

        return {
          planet,
          signInterpretation: profile.interpretationMap.get(signKey) || null,
          houseInterpretation: houseKey ? profile.interpretationMap.get(houseKey) || null : null
        };
      }
      case 'get_cached_major_aspects':
        return {
          aspects: profile?.majorAspects?.slice(0, Math.max(1, Math.min(Number(args.limit || 5), 10))) || []
        };
      case 'get_cached_house_info': {
        const house = findHouse(profile, args.house);
        return house
          ? { house }
          : { error: `House ${args.house} is not available in the cached natal profile.` };
      }
      case 'get_cached_angle_info': {
        const angle = findAngle(profile, args.angle);
        return angle
          ? { angle }
          : { error: `Angle "${args.angle}" is not available in the cached natal profile.` };
      }
      case 'get_cached_monthly_transits':
        {
          const monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, activeProfile);
          if (monthlyTransitCache) {
            await toolCache.ensureMonthlyTransitInsights(identity, activeProfile, { source: 'runtime' });
          }
        return {
          available: Boolean(monthlyTransitCache),
          cacheMonth: monthlyTransitCache?.cacheMonth || null,
          tool: monthlyTransitCache?.toolName || null,
          timeline: monthlyTransitCache?.response || null
        };
        }
      case 'get_profile_completeness':
        return {
          hasNatalProfile: Boolean(profile),
          hasBirthTime: Boolean(profile?.timeKnown),
          hasAngles: Boolean(profile?.angles && Object.keys(profile.angles).length > 0),
          hasHouses: Array.isArray(profile?.houses) && profile.houses.length > 0,
          confidence: profile?.confidence || null
        };
      default:
        throw new Error(`Unknown local tool: ${name}`);
    }
  };
}

function buildResolvedToolArgs(originalToolName, args, context) {
  const nextArgs = { ...(args || {}) };

  if (originalToolName === toolCache.TRANSIT_TOOL && !nextArgs.natal && context.activeProfile?.natalRequestPayload) {
    const monthWindow = toolCache.getCurrentMonthWindow(context.activeProfile.timezone || 'UTC');
    nextArgs.natal = context.activeProfile.natalRequestPayload;

    if (monthWindow && !nextArgs.range_start && !nextArgs.range_end) {
      nextArgs.range_start = monthWindow.rangeStart;
      nextArgs.range_end = monthWindow.rangeEnd;
      nextArgs.mode = nextArgs.mode || 'month';
    }
  }

  if (SYNSTRY_TOOL_NAMES.has(originalToolName) && context.synastryContext?.secondaryProfile) {
    if (!nextArgs.person_a) {
      nextArgs.person_a = profiles.buildSynastryPersonPayload(context.activeProfile);
    }

    if (!nextArgs.person_b) {
      nextArgs.person_b = profiles.buildSynastryPersonPayload(context.synastryContext.secondaryProfile);
    }
  }

  return nextArgs;
}

async function detectSynastryContext(identity, userText, intent, activeProfile) {
  if (intent.id !== 'synastry' || !activeProfile) {
    return { secondaryProfile: null, needsUserChoice: false, candidates: [] };
  }

  const matches = await profiles.findMentionedProfiles(identity, userText, {
    excludeProfileId: activeProfile.profileId
  });

  if (matches.length === 1) {
    return {
      secondaryProfile: matches[0],
      needsUserChoice: false,
      candidates: matches
    };
  }

  const allCandidates = (await profiles.listProfiles(identity))
    .filter((profile) => profile.profileId !== activeProfile.profileId);

  return {
    secondaryProfile: null,
    needsUserChoice: true,
    candidates: matches.length > 1 ? matches : allCandidates
  };
}

async function answerConversation(identity, userText) {
  const chatState = getChatState(identity);
  const intent = detectConversationIntent(userText, chatState.history);
  const locale = getLocale(chatState);
  const stateKey = chatState.stateKey || `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`;

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Conversational mode is disabled.');
  }

  const activeProfile = await profiles.getActiveProfile(identity);

  if (!activeProfile || !chatState.natalProfile) {
    return {
      text: {
        en: 'I need your birth details before I can answer personal astrology questions from your chart.',
        fr: 'J’ai besoin de vos données de naissance avant de pouvoir répondre à des questions astrologiques personnelles à partir de votre thème.',
        de: 'Ich brauche deine Geburtsdaten, bevor ich persönliche astrologische Fragen aus deinem Horoskop beantworten kann.',
        es: 'Necesito tus datos de nacimiento antes de poder responder preguntas astrológicas personales a partir de tu carta.'
      }[locale] || 'I need your birth details before I can answer personal astrology questions from your chart.',
      usedTools: [],
      intent: intent.id
    };
  }

  const synastryContext = await detectSynastryContext(identity, userText, intent, activeProfile);
  if (synastryContext.needsUserChoice) {
    return {
      intent: intent.id,
      requiresSynastryProfileSelection: true,
      candidates: synastryContext.candidates.map((profile) => ({
        profileId: profile.profileId,
        profileName: profile.profileName,
        cityLabel: profile.cityLabel
      }))
    };
  }

  const pendingComparisonText = consumePendingSynastryQuestion(identity);
  if (pendingComparisonText && synastryContext.secondaryProfile) {
    userText = pendingComparisonText;
  }

  const localDeclarations = createLocalFunctionDeclarations();
  await toolCache.ensureNatalInsights(identity, activeProfile, { source: 'runtime' });
  const monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, activeProfile);
  if (monthlyTransitCache) {
    await toolCache.ensureMonthlyTransitInsights(identity, activeProfile, { source: 'runtime' });
  }
  const factAvailability = await factIndex.syncActiveProfileFactAvailability(identity, activeProfile, {
    cacheMonth: monthlyTransitCache?.cacheMonth || null,
    notify: false
  });
  let mcpDeclarations = [];
  let mcpStatus = 'available';

  try {
    mcpDeclarations = await mcpService.getFunctionDeclarations();
  } catch (error) {
    mcpStatus = `unavailable (${error.message || 'connection failed'})`;
  }

  const allDeclarations = [...localDeclarations, ...mcpDeclarations];
  const localOnlyPreferred = isLocalOnlyPreferred(intent, factAvailability);
  const localExecutor = await createLocalToolExecutor(identity, activeProfile, factAvailability);
  const executionContext = {
    activeProfile,
    synastryContext
  };

  const executeFunction = async (name, args) => {
    if (name === 'search_cached_profile_facts' || name.startsWith('get_cached_') || name === 'get_profile_completeness') {
      return localExecutor(name, args);
    }

    if (mcpService.isMcpTool(name)) {
      const originalToolName = mcpService.resolveOriginalToolName(name);
      const requestArgs = buildResolvedToolArgs(originalToolName, args, executionContext);
      const cacheMonth = toolCache.inferCacheMonth(originalToolName, requestArgs, activeProfile.timezone || 'UTC');
      const result = await toolCache.resolveCachedToolCall(identity, {
        toolName: originalToolName,
        requestArgs,
        profile: activeProfile,
        primaryProfileId: activeProfile.profileId,
        secondaryProfileId: synastryContext.secondaryProfile?.profileId || null,
        questionText: userText,
        cacheMonth,
        source: 'runtime',
        executor: (resolvedArgs) => mcpService.callToolByOriginalName(originalToolName, resolvedArgs)
      });

      return result.result;
    }

    throw new Error(`Unknown tool call: ${name}`);
  };

  const systemInstruction = buildSystemInstruction(chatState, mcpStatus, intent, {
    activeProfileName: activeProfile.profileName,
    factAvailability,
    monthlyTransitAvailable: Boolean(monthlyTransitCache),
    includeNatalSummary: !factAvailability?.hasNatalFacts,
    synastryContext: {
      activeProfile,
      secondaryProfile: synastryContext.secondaryProfile
    }
  });

  const fastPathResult = await tryFactFastPath(identity, userText, intent, activeProfile, factAvailability, locale);
  if (fastPathResult) {
    info('conversation fact fast-path complete', {
      stateKey,
      intent: intent.id,
      durationMs: fastPathResult.durationMs,
      rewriteDurationMs: fastPathResult.rewriteDurationMs,
      factCount: fastPathResult.usedTools[0]?.result?.facts?.length || 0
    });

    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', fastPathResult.text);
    setLastToolResults(identity, fastPathResult.usedTools);

    return {
      text: normalizeAssistantText(fastPathResult.text),
      usedTools: fastPathResult.usedTools,
      intent: intent.id
    };
  }

  let result;

  if (localOnlyPreferred) {
    const localOnlyInstruction = [
      systemInstruction,
      '',
      'For this pass, do not call any FreeAstro MCP tools.',
      'Answer only from Supabase-backed indexed facts and cached local tools.',
      'Only if those local sources are insufficient will the runtime allow a second pass with MCP.'
    ].join('\n');

    const localOnlyStartedAt = performance.now();
    const localOnlyResult = await runFunctionCallingLoop({
      systemInstruction: localOnlyInstruction,
      history: chatState.history,
      userText,
      functionDeclarations: localDeclarations,
      executeFunction
    });
    const localOnlySufficient = localResultLooksSufficient(localOnlyResult, intent);

    info('conversation local-only pass complete', {
      stateKey,
      intent: intent.id,
      durationMs: Math.round(performance.now() - localOnlyStartedAt),
      toolCalls: Array.isArray(localOnlyResult.toolResults) ? localOnlyResult.toolResults.length : 0,
      sufficient: localOnlySufficient
    });

    if (localOnlySufficient) {
      result = localOnlyResult;
    } else {
      const fallbackStartedAt = performance.now();
      result = await runFunctionCallingLoop({
        systemInstruction,
        history: chatState.history,
        userText,
        functionDeclarations: allDeclarations,
        executeFunction
      });

      info('conversation mcp fallback pass complete', {
        stateKey,
        intent: intent.id,
        durationMs: Math.round(performance.now() - fallbackStartedAt),
        toolCalls: Array.isArray(result.toolResults) ? result.toolResults.length : 0
      });
    }
  } else {
    const fallbackStartedAt = performance.now();
    result = await runFunctionCallingLoop({
      systemInstruction,
      history: chatState.history,
      userText,
      functionDeclarations: allDeclarations,
      executeFunction
    });

    info('conversation mcp fallback pass complete', {
      stateKey,
      intent: intent.id,
      durationMs: Math.round(performance.now() - fallbackStartedAt),
      toolCalls: Array.isArray(result.toolResults) ? result.toolResults.length : 0
    });
  }

  pushHistory(identity, 'user', userText);
  pushHistory(identity, 'model', result.text);
  setLastToolResults(identity, result.toolResults);

  return {
    text: normalizeAssistantText(result.text),
    usedTools: result.toolResults,
    intent: intent.id
  };
}

module.exports = {
  answerConversation
};
