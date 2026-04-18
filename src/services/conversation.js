const { performance } = require('node:perf_hooks');
const { detectConversationIntent } = require('../config/conversationIntents');
const { matchCommonQuestionRoute } = require('../config/commonQuestionRoutes');
const factIndex = require('./factIndex');
const mcpService = require('./freeastroMcp');
const profiles = require('./profiles');
const toolCache = require('./toolCache');
const { createLocalFunctionDeclarations, generatePlainText, getFastPathModelName, runFunctionCallingLoop } = require('./gemini');
const { info } = require('./logger');
const {
  consumePendingSynastryQuestion,
  getConversationContext,
  getChatState,
  normalizeNatalProfile,
  pushHistory,
  setConversationContext,
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

const ANSWER_STYLES = new Set([
  'natal_theme',
  'planet_focus',
  'house_focus',
  'aspect_focus',
  'life_area_theme',
  'current_sky',
  'personal_transits',
  'synastry',
  'system_answer'
]);

const RAW_INTERPRETIVE_PATTERNS = [
  /\bthis means\b/i,
  /\bthis suggests\b/i,
  /\byou tend to\b/i,
  /\byou are likely to\b/i,
  /\btu as tendance à\b/i,
  /\bcela signifie\b/i,
  /\bcela sugg[èe]re\b/i,
  /\bdas bedeutet\b/i,
  /\bdas deutet darauf hin\b/i,
  /\besto significa\b/i,
  /\besto sugiere\b/i
];

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
  const profileSummary = options.subjectProfileSummary || chatState.natalProfile?.summaryText || 'No natal profile available.';
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
    'Never answer a system or clarification question with an astrology reading.',
    `Response mode: ${options.responseMode || 'interpreted'}.`,
    ...relocationRules,
    `Conversation route: ${options.routeKind || 'astrology_natal'}.`,
    `Common route match: ${options.commonRouteId || 'none'}.`,
    `Required answer style: ${options.answerStyle || 'natal_theme'}.`,
    `Response perspective: ${options.responsePerspective || 'second_person'}.`,
    `Target profile label: ${options.targetProfileLabel || options.activeProfileName || 'Chart User'}.`,
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
      profileSummary
    );
  }

  lines.push(
    '',
    'Synastry context:',
    describeSynastryContext(options.synastryContext)
  );

  if (options.responseMode === 'raw') {
    lines.push(
      '',
      'Raw mode is active.',
      'Never interpret, infer meaning, or produce an astrologer-style reading.',
      'Only organize and present literal grounded results, values, dates, titles, and tool outputs in a clean readable structure.'
    );
  }

  return lines.join('\n');
}

function shouldUseThirdPersonVoice(userText, subjectProfile, activeProfile) {
  if (!subjectProfile?.profileId) {
    return false;
  }

  if (!activeProfile?.profileId) {
    return detectThirdPartyPronoun(userText);
  }

  if (subjectProfile.profileId !== activeProfile.profileId) {
    return true;
  }

  return detectThirdPartyPronoun(userText);
}

function getLastResolvedQuestion(conversationContext, history = [], userText = '') {
  if (conversationContext?.lastResolvedQuestion) {
    return String(conversationContext.lastResolvedQuestion);
  }

  const previousUserQuestion = (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'user' && String(item.text || '').trim() !== String(userText || '').trim());

  return previousUserQuestion?.text || null;
}

function buildTopicFollowUpQuestion(topic, lastRouteKind) {
  const normalizedTopic = String(topic || '').toLowerCase();
  const transitMode = lastRouteKind === 'astrology_transits';

  switch (normalizedTopic) {
    case 'love':
    case 'relationship':
    case 'relationships':
      return transitMode ? 'What is happening in love for me right now?' : 'What are my relationship patterns?';
    case 'money':
      return transitMode ? 'What is happening with money for me right now?' : 'What is my relationship with money?';
    case 'career':
    case 'work':
      return transitMode ? 'What is happening in my career right now?' : 'What is my career signature?';
    case 'family':
    case 'home':
      return transitMode ? 'What is happening with home and family for me right now?' : 'What is my family pattern in the chart?';
    case 'spiritual':
      return transitMode ? 'What is happening spiritually for me right now?' : 'What is my spiritual path?';
    case 'mind':
    case 'mental':
      return transitMode ? 'What is happening mentally for me right now?' : 'What does Mercury say about my mind?';
    case 'emotion':
    case 'emotions':
      return transitMode ? 'What is happening emotionally for me right now?' : 'What does the Moon say about my emotions?';
    default:
      return null;
  }
}

function detectExplicitFollowUp(userText, conversationContext, history = []) {
  const value = String(userText || '').trim();
  const normalized = value.toLowerCase();
  const lastRouteKind = conversationContext?.lastResponseRoute || null;

  if (!lastRouteKind || ['system_meta', 'clarification', 'profile_management'].includes(lastRouteKind)) {
    return null;
  }

  const lastResolvedQuestion = getLastResolvedQuestion(conversationContext, history, userText);

  const topicSwitch = normalized.match(/^(?:and|et|und|y|also|what about|quid de|et pour|und was ist mit|que hay de)\s+(love|relationship|relationships|money|career|work|family|home|spiritual|mind|mental|emotion|emotions)\??$/i);
  if (topicSwitch) {
    const rewrittenQuestion = buildTopicFollowUpQuestion(topicSwitch[1], lastRouteKind);
    if (rewrittenQuestion) {
      return {
        followUpType: 'topic_switch',
        rewrittenQuestion,
        routeKind: lastRouteKind
      };
    }
  }

  if (/^(?:why|why is that|go deeper|explain more|more detail|more details|develop|développe|detaille|détaille|mehr details|explica mas)\??$/i.test(normalized) && lastResolvedQuestion) {
    return {
      followUpType: 'drill_down',
      rewrittenQuestion: `${lastResolvedQuestion}\n\nExplain this in more detail.`,
      routeKind: lastRouteKind
    };
  }

  if (/^(?:today specifically|right now specifically|and today|and now|aujourdhui precisement|maintenant precisement|heute genau|ahora mismo precisamente)\??$/i.test(normalized) && lastResolvedQuestion && lastRouteKind === 'astrology_transits') {
    return {
      followUpType: 'timing_refinement',
      rewrittenQuestion: `${lastResolvedQuestion}\n\nFocus on today specifically.`,
      routeKind: lastRouteKind
    };
  }

  return null;
}

function detectConversationRoute(text, history = []) {
  const value = String(text || '').trim();
  const normalized = value.toLowerCase();
  const intent = detectConversationIntent(value, history);
  const repeatsPreviousQuestion = /\b(same question|same thing|same request|same for|for him too|for her too|for elie too|for gabriel too)\b/i.test(value)
    || /\b(r[ée]ponds? [àa] la m[êe]me question|la m[êe]me question|pareil pour|m[êe]me chose pour)\b/i.test(value);

  if (/\b(how many|combien|list|liste|which|quel|quelle)\b.*\b(profile|profiles|profil|profils)\b/i.test(value) ||
      /\bactive profile\b/i.test(value) ||
      /\bprofil actif\b/i.test(value)) {
    return { kind: 'system_meta', intent, answerStyle: 'system_answer' };
  }

  if (/^(tu parles de moi|tu parle de moi|are you talking about me|do you mean me|tu parles de lui|tu parles d'elle|are you talking about him|are you talking about her)\??$/i.test(normalized)) {
    return { kind: 'clarification', intent, answerStyle: 'system_answer' };
  }

  if (/\b(add|switch|change|use|select|set)\b.*\b(profile|profil)\b/i.test(value) ||
      /\b(ajoute|ajouter|change|changer|utilise|utiliser|sélectionne|selectionne)\b.*\b(profil|profile)\b/i.test(value)) {
    return { kind: 'profile_management', intent, answerStyle: 'system_answer' };
  }

  if (intent.id === 'relocation') {
    return { kind: 'astrology_relocation', intent, answerStyle: 'system_answer' };
  }

  if (repeatsPreviousQuestion) {
    return {
      kind: 'astrology_natal',
      intent,
      answerStyle: 'natal_theme',
      inheritsPreviousQuestion: true
    };
  }

  if (intent.id === 'synastry' || /\b(compare|comparison|compatib|synastry|between\b.+\band\b|compare\b.+\b(et|and)\b)\b/i.test(value)) {
    return { kind: 'astrology_synastry', intent, answerStyle: 'synastry' };
  }

  if (intent.id === 'transits' || /\b(current sky|sky right now|today|aujourd'hui|right now|ce mois|this month|current energies|du jour)\b/i.test(value)) {
    return {
      kind: 'astrology_transits',
      intent: { ...intent, id: 'transits' },
      answerStyle: /\b(current sky|sky|ciel du jour|ciel actuel)\b/i.test(value) ? 'current_sky' : 'personal_transits'
    };
  }

  return {
    kind: 'astrology_natal',
    intent,
    answerStyle: deriveDefaultAnswerStyle(intent, value)
  };
}

function deriveDefaultAnswerStyle(intent, userText) {
  const value = String(userText || '').toLowerCase();

  if (intent?.id === 'major_aspects') {
    return 'aspect_focus';
  }

  if (intent?.id === 'house_question') {
    return 'house_focus';
  }

  if (intent?.id === 'planet_placement' || intent?.id === 'rising_sign') {
    return 'planet_focus';
  }

  if (/\b(rare|rares|signature|signatures|career|work|love|money|purpose|relationship|patterns?|sch[ée]mas)\b/i.test(value)) {
    return 'life_area_theme';
  }

  return 'natal_theme';
}

function detectThirdPartyPronoun(text) {
  return /\b(son|sa|ses|lui|elle|leur|leurs|his|her|hers|him|their|them)\b/i.test(String(text || ''));
}

function buildSystemMetaResponse(locale, chatState, activeProfile) {
  const profiles = Array.isArray(chatState.profileDirectory) ? chatState.profileDirectory : [];
  const activeName = activeProfile?.profileName || profiles.find((profile) => profile.isActive)?.profileName || null;

  if (locale === 'fr') {
    if (profiles.length === 0) {
      return 'Aucun profil sauvegardé pour le moment.';
    }

    if (activeName) {
      return `${profiles.length} profil${profiles.length > 1 ? 's' : ''} sauvegardé${profiles.length > 1 ? 's' : ''}. Le profil actif est ${activeName}.`;
    }

    return `${profiles.length} profil${profiles.length > 1 ? 's' : ''} sauvegardé${profiles.length > 1 ? 's' : ''}.`;
  }

  if (profiles.length === 0) {
    return 'There are no saved profiles yet.';
  }

  if (activeName) {
    return `There ${profiles.length === 1 ? 'is' : 'are'} ${profiles.length} saved profile${profiles.length === 1 ? '' : 's'}. The active profile is ${activeName}.`;
  }

  return `There ${profiles.length === 1 ? 'is' : 'are'} ${profiles.length} saved profile${profiles.length === 1 ? '' : 's'}.`;
}

function buildProfileManagementResponse(locale) {
  return locale === 'fr'
    ? 'Je peux gérer les profils, mais il faut préciser l’action: ajouter un profil, changer le profil actif, ou afficher les profils sauvegardés.'
    : 'I can manage profiles, but I need the exact action: add a profile, switch the active profile, or list saved profiles.';
}

function buildClarificationResponse(locale, activeProfile, referencedProfile, conversationContext) {
  const lastResponseProfileId = conversationContext?.lastResponseProfileId || null;
  const talkingAboutActive = activeProfile?.profileId && lastResponseProfileId === activeProfile.profileId;
  const targetName = referencedProfile?.profileName || activeProfile?.profileName || 'this profile';

  if (locale === 'fr') {
    if (!lastResponseProfileId) {
      return 'Je n’avais pas de cible clairement établie dans ma réponse précédente.';
    }

    return talkingAboutActive
      ? `Oui, je parlais bien de vous, c’est-à-dire du profil actif ${targetName}.`
      : `Non, je parlais de ${targetName}, pas de vous.`;
  }

  if (!lastResponseProfileId) {
    return 'I did not have a clearly established subject in my previous answer.';
  }

  return talkingAboutActive
    ? `Yes, I was talking about you, meaning the active profile ${targetName}.`
    : `No, I was talking about ${targetName}, not you.`;
}

function inheritRouteFromConversation(route, conversationContext, userText) {
  if (!route?.inheritsPreviousQuestion) {
    return route;
  }

  const lastRouteKind = conversationContext?.lastResponseRoute || null;
  const lastIntentId = conversationContext?.lastIntentId || null;
  const lastAnswerStyle = conversationContext?.lastAnswerStyle || null;

  if (!lastRouteKind || lastRouteKind === 'system_meta' || lastRouteKind === 'clarification' || lastRouteKind === 'profile_management') {
    return route;
  }

  const nextIntentId = lastIntentId || (lastRouteKind === 'astrology_transits' ? 'transits' : route.intent?.id || 'fallback');

  return {
    ...route,
    kind: lastRouteKind,
    intent: {
      ...(route.intent || {}),
      id: nextIntentId
    },
    answerStyle: ANSWER_STYLES.has(lastAnswerStyle) ? lastAnswerStyle : route.answerStyle,
    inheritedFromPreviousQuestion: true,
    inheritedPrompt: String(userText || '').trim()
  };
}

function resolveQuestionForPlanner(route, userText, history = []) {
  if (!route?.inheritedFromPreviousQuestion) {
    return String(userText || '');
  }

  const previousUserQuestion = (Array.isArray(history) ? history : [])
    .slice()
    .reverse()
    .find((item) => item?.role === 'user' && String(item.text || '').trim() !== String(userText || '').trim());

  return previousUserQuestion?.text || String(userText || '');
}

function buildEffectiveUserQuestion(route, userText, plannerQuestionText, subjectProfile) {
  if (!route?.inheritedFromPreviousQuestion) {
    return String(userText || '');
  }

  const profileName = subjectProfile?.profileName || 'the referenced profile';
  return `${plannerQuestionText}\n\nAnswer this for ${profileName}.`;
}

function applyCommonQuestionRoute(route, userText) {
  if (!route || ['system_meta', 'clarification', 'profile_management', 'astrology_synastry', 'astrology_relocation'].includes(route.kind)) {
    return { route, commonRoute: null };
  }

  const commonRoute = matchCommonQuestionRoute(userText);
  if (!commonRoute) {
    return { route, commonRoute: null };
  }

  const mappedIntent = detectConversationIntent(commonRoute.intentSample || userText);
  return {
    route: {
      ...route,
      kind: commonRoute.routeKind,
      intent: mappedIntent,
      answerStyle: commonRoute.answerStyle,
      commonRouteId: commonRoute.id,
      commonRouteScore: commonRoute.score
    },
    commonRoute
  };
}

function buildPlannedRouteFromCommonQuestion(commonRoute, subjectProfile, factAvailability) {
  if (!commonRoute || !subjectProfile?.profileId) {
    return null;
  }

  const includesTransit = commonRoute.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND);

  return {
    target: 'indexed_facts',
    primaryProfileId: subjectProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: commonRoute.sourceKinds,
    categories: commonRoute.categories || [],
    tags: commonRoute.tags || [],
    cacheMonth: includesTransit ? (factAvailability?.indexedTransitCacheMonth || null) : null,
    limit: includesTransit ? 5 : 4,
    reason: `Matched common question route ${commonRoute.id}`,
    answerStyle: commonRoute.answerStyle
  };
}

async function resolveConversationTargets(identity, userText, route, activeProfile) {
  const conversationContext = getConversationContext(identity);
  const allProfiles = await profiles.listProfiles(identity);
  const active = activeProfile || allProfiles.find((profile) => profile.isActive) || allProfiles[0] || null;
  const mentionedProfiles = await profiles.findMentionedProfiles(identity, userText);
  const distinctMentionedProfiles = mentionedProfiles.filter((profile, index, entries) => (
    entries.findIndex((entry) => entry.profileId === profile.profileId) === index
  ));
  const nonActiveProfiles = allProfiles.filter((profile) => profile.profileId !== active?.profileId);
  const pronounRefersToOther = detectThirdPartyPronoun(userText);

  if (route.kind === 'astrology_synastry') {
    const comparedProfiles = distinctMentionedProfiles.filter((profile) => profile.profileId !== active?.profileId);
    let secondaryProfile = null;

    if (comparedProfiles.length === 1) {
      secondaryProfile = comparedProfiles[0];
    } else if (comparedProfiles.length === 0 && conversationContext.lastComparedProfileId) {
      secondaryProfile = await profiles.getProfileById(identity, conversationContext.lastComparedProfileId);
    } else if (comparedProfiles.length === 0 && nonActiveProfiles.length === 1) {
      secondaryProfile = nonActiveProfiles[0];
    }

    if (!active || !secondaryProfile || active.profileId === secondaryProfile.profileId) {
      return {
        activeProfile: active,
        subjectProfile: active,
        secondaryProfile: null,
        needsClarification: true
      };
    }

    return {
      activeProfile: active,
      subjectProfile: active,
      secondaryProfile,
      needsClarification: false
    };
  }

  if (!active) {
    return {
      activeProfile: null,
      subjectProfile: null,
      secondaryProfile: null,
      needsClarification: false
    };
  }

  if (distinctMentionedProfiles.length > 1) {
    return {
      activeProfile: active,
      subjectProfile: active,
      secondaryProfile: null,
      needsClarification: true
    };
  }

  if (distinctMentionedProfiles.length === 1) {
    return {
      activeProfile: active,
      subjectProfile: distinctMentionedProfiles[0],
      secondaryProfile: null,
      needsClarification: false
    };
  }

  if (pronounRefersToOther && conversationContext.lastReferencedProfileId && conversationContext.lastReferencedProfileId !== active.profileId) {
    const referencedProfile = await profiles.getProfileById(identity, conversationContext.lastReferencedProfileId);
    if (referencedProfile) {
      return {
        activeProfile: active,
        subjectProfile: referencedProfile,
        secondaryProfile: null,
        needsClarification: false
      };
    }
  }

  return {
    activeProfile: active,
    subjectProfile: active,
    secondaryProfile: null,
    needsClarification: false
  };
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

function hasIndexedCoverage(factAvailability) {
  return Boolean(factAvailability?.hasNatalFacts || factAvailability?.indexedTransitCacheMonth);
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
    ['current', ['timing', 'current']],
    ['sky', ['current', 'sky', 'transit']],
    ['now', ['current', 'timing', 'transit']],
    ['energy', ['current', 'transit']],
    ['energies', ['current', 'transit']]
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
  const value = String(userText || '').toLowerCase();
  const transitBiased = /\bcurrent sky\b|\bsky right now\b|\bright now\b|\bcurrent energies\b|\bwhat'?s happening now\b|\bwhat is happening now\b|\bsky\b/.test(value);
  const input = {
    primaryProfileId: activeProfile.profileId,
    secondaryProfileId: null,
    categories: [],
    tags,
    sourceKinds: [],
    cacheMonth: null,
    limit: 6
  };

  if (intent.id === 'transits' || transitBiased) {
    input.sourceKinds = [factIndex.MONTHLY_TRANSIT_SOURCE_KIND];
    input.cacheMonth = factAvailability?.indexedTransitCacheMonth || null;
    input.limit = 5;
  } else {
    input.sourceKinds = [factIndex.NATAL_SOURCE_KIND];
  }

  return input;
}

function isTransitBiasedQuestion(text) {
  return /\bcurrent sky\b|\bsky right now\b|\bright now\b|\bcurrent energies\b|\bwhat'?s happening now\b|\bwhat is happening now\b|\bsky\b|\btoday\b|\bthis month\b/.test(String(text || '').toLowerCase());
}

function normalizePlannerArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function extractJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      return null;
    }
  }
}

async function planFactSearchQuery(locale, userText, intent, activeProfile, factAvailability) {
  const systemInstruction = [
    'You route astrology user questions to either indexed facts or MCP tools and, when applicable, generate structured search parameters for the fact index.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}, but output JSON only.`,
    'Return one JSON object and nothing else.',
    'Allowed keys: target, sourceKinds, categories, tags, cacheMonth, limit, reason, answerStyle.',
    'target must be either indexed_facts or mcp.',
    'sourceKinds must be an array containing natal and/or monthly_transit.',
    'answerStyle must be one of natal_theme, planet_focus, house_focus, aspect_focus, life_area_theme, current_sky, personal_transits, synastry, system_answer.',
    'categories must be broad retrieval categories such as identity, emotions, relationships, structure, transformation, growth, drive, life_path, chart_pattern, mind, transit_event, transit_theme, timing_window.',
    'tags must be short exact-ish lookup terms like current, sky, relationship, love, career, work, planet:venus, planet:mars, angle:asc, angle:mc, house:7.',
    'If the question is about the current sky, now, today, current energies, or what is happening right now, prefer monthly_transit.',
    'If the question is about personality, natal chart, life pattern, relationship style, or birth chart themes, prefer natal.',
    'If the question is about synastry, compatibility, comparing two people, relocation, maps, astrocartography, or a capability not present in natal/monthly transit facts, use target mcp.',
    'If uncertain, use indexed_facts when natal or monthly transit facts could answer it.',
    'Include both natal and monthly_transit only when the question genuinely mixes both.',
    'For current month transit lookups, set cacheMonth to the provided active transit month.',
    'Keep limit between 3 and 6.'
  ].join('\n');

  const prompt = [
    `Question: ${String(userText || '').trim()}`,
    `Detected intent: ${intent.id}`,
    `Active profile: ${activeProfile.profileName || 'Chart User'}`,
    `Natal facts indexed: ${factAvailability?.hasNatalFacts ? 'yes' : 'no'}`,
    `Current indexed transit month: ${factAvailability?.indexedTransitCacheMonth || 'none'}`,
    '',
    'Return JSON now.'
  ].join('\n');

  const planned = extractJsonObject(await generatePlainText({
    systemInstruction,
    userText: prompt,
    history: [],
    model: getFastPathModelName()
  }));

  if (!planned || typeof planned !== 'object') {
    return null;
  }

  const target = planned.target === 'mcp' ? 'mcp' : 'indexed_facts';
  const sourceKinds = normalizePlannerArray(planned.sourceKinds)
    .filter((value) => [factIndex.NATAL_SOURCE_KIND, factIndex.MONTHLY_TRANSIT_SOURCE_KIND].includes(value));
  const categories = normalizePlannerArray(planned.categories);
  const tags = normalizePlannerArray(planned.tags);
  const requestedCacheMonth = planned.cacheMonth ? String(planned.cacheMonth).trim() : null;
  const limit = Math.max(3, Math.min(Number(planned.limit || 4), 6));
  const answerStyle = ANSWER_STYLES.has(String(planned.answerStyle || '').trim())
    ? String(planned.answerStyle).trim()
    : deriveDefaultAnswerStyle(intent, userText);

  return {
    target,
    primaryProfileId: activeProfile.profileId,
    secondaryProfileId: null,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : [factIndex.NATAL_SOURCE_KIND],
    categories,
    tags,
    cacheMonth: requestedCacheMonth || null,
    limit,
    reason: planned.reason ? String(planned.reason) : null,
    answerStyle
  };
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

function formatRawLabel(locale, labels) {
  return labels[locale] || labels.en;
}

function formatScalarValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function humanizeRawKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRawTitle(value) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  const cleaned = text
    .replace(/\s+Category:.*$/i, '')
    .replace(/\s+Kind:.*$/i, '')
    .replace(/\s+Subjects:.*$/i, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  const machineLike = /[.:]/.test(cleaned) || /\d{4}-\d{2}-\d{2}t/i.test(cleaned);
  if (machineLike) {
    return humanizeRawKey(
      cleaned
        .replace(/^transit_insight[.:]/i, '')
        .replace(/\.\d{4}-\d{2}-\d{2}t[\d:z-]+$/i, '')
    );
  }

  return cleaned;
}

function formatRawDate(value) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!match) {
    return text;
  }

  return match[2] ? `${match[1]} ${match[2]} UTC` : match[1];
}

function formatRawDateWindow(startValue, endValue) {
  const start = formatRawDate(startValue);
  const end = formatRawDate(endValue);

  if (start && end) {
    return `${start} → ${end}`;
  }

  return start || end || null;
}

function normalizeRawList(values, formatter = formatScalarValue) {
  return (Array.isArray(values) ? values : [])
    .map((value) => formatter(value))
    .filter(Boolean);
}

function getRawSubjectLabel(locale, subjectLabel) {
  if (subjectLabel && subjectLabel !== 'Chart User') {
    return subjectLabel;
  }

  return formatRawLabel(locale, {
    en: 'you',
    fr: 'vous',
    de: 'dich',
    es: 'ti'
  });
}

function buildRawFactsIntro(locale, subjectLabel, facts, fallbackIntro = null) {
  if (fallbackIntro) {
    return fallbackIntro;
  }

  const normalizedSubject = getRawSubjectLabel(locale, subjectLabel);
  const firstFact = Array.isArray(facts) ? facts.find(Boolean) : null;
  const cacheMonth = firstFact?.cacheMonth || firstFact?.cache_month || null;

  if (firstFact && isMonthlyTransitFact(firstFact)) {
    return formatRawLabel(locale, {
      en: cacheMonth
        ? `Monthly transits for ${normalizedSubject} — ${cacheMonth}`
        : `Monthly transits for ${normalizedSubject}`,
      fr: cacheMonth
        ? `Transits du mois pour ${normalizedSubject} — ${cacheMonth}`
        : `Transits du mois pour ${normalizedSubject}`,
      de: cacheMonth
        ? `Monatliche Transite für ${normalizedSubject} — ${cacheMonth}`
        : `Monatliche Transite für ${normalizedSubject}`,
      es: cacheMonth
        ? `Tránsitos del mes para ${normalizedSubject} — ${cacheMonth}`
        : `Tránsitos del mes para ${normalizedSubject}`
    });
  }

  return formatRawLabel(locale, {
    en: `Natal chart facts for ${normalizedSubject}`,
    fr: `Faits du thème natal pour ${normalizedSubject}`,
    de: `Radix-Fakten für ${normalizedSubject}`,
    es: `Hechos de la carta natal para ${normalizedSubject}`
  });
}

function sanitizeRawFactText(value, title) {
  const text = formatScalarValue(value);
  if (!text) {
    return null;
  }

  let cleaned = text
    .replace(/\bCategory:\s*[^.]+\.?/gi, '')
    .replace(/\bKind:\s*[^.]+\.?/gi, '')
    .replace(/\bFocus:\s*[^.]+\.?/gi, '')
    .replace(/\bSubjects:\s*[^.]+\.?/gi, '')
    .replace(/\bSource:\s*[^.]+\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedTitle = normalizeSentenceForCompare(title);
  const normalizedCleaned = normalizeSentenceForCompare(cleaned);
  if (normalizedTitle && normalizedCleaned && normalizedCleaned === normalizedTitle) {
    return null;
  }

  return cleaned || null;
}

function isMonthlyTransitFact(fact) {
  return (fact.sourceKind || fact.source_kind) === factIndex.MONTHLY_TRANSIT_SOURCE_KIND;
}

function buildTransitFactLines(locale, fact) {
  const payload = fact.factPayload || fact.fact_payload || {};
  const lines = [];
  const title = normalizeRawTitle(fact.title) || formatRawLabel(locale, {
    en: 'Transit',
    fr: 'Transit',
    de: 'Transit',
    es: 'Tránsito'
  });

  const type = payload.windowType
    || payload.passType
    || payload.category
    || ((Array.isArray(fact.tags) ? fact.tags : []).find((tag) => String(tag).startsWith('kind:')) || '').replace(/^kind:/, '');
  const windowText = formatRawDateWindow(payload.startDatetime, payload.endDatetime);
  const peak = formatRawDate(payload.peakDatetime);
  const exactHits = normalizeRawList(payload.exactHitsInMonth, (value) => formatScalarValue(value));
  const exactDatetimes = normalizeRawList(payload.exactDatetimes, formatRawDate);
  const visibleWindow = (
    payload.visibleStartDay || payload.visibleEndDay
      ? `${payload.visibleStartDay || '?'} → ${payload.visibleEndDay || '?'}`
      : null
  );
  const transitPlanet = formatScalarValue(payload.transitPlanet)
    ? humanizeRawKey(formatScalarValue(payload.transitPlanet))
    : null;
  const natalPoint = formatScalarValue(payload.natalPoint)
    ? humanizeRawKey(formatScalarValue(payload.natalPoint))
    : null;
  const aspectType = formatScalarValue(payload.aspectType);
  const houses = normalizeRawList(payload.houses, (value) => humanizeRawKey(formatScalarValue(value)));

  lines.push(title);

  if (type) {
    lines.push(`${formatRawLabel(locale, { en: 'Type', fr: 'Type', de: 'Typ', es: 'Tipo' })}: ${humanizeRawKey(type)}`);
  }

  if (windowText) {
    lines.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${windowText}`);
  } else if (visibleWindow && (fact.cacheMonth || fact.cache_month)) {
    lines.push(`${formatRawLabel(locale, { en: 'Days in month', fr: 'Jours dans le mois', de: 'Tage im Monat', es: 'Días del mes' })}: ${visibleWindow}`);
  }

  if (peak) {
    lines.push(`${formatRawLabel(locale, { en: 'Peak', fr: 'Pic', de: 'Höhepunkt', es: 'Pico' })}: ${peak}`);
  } else if (exactDatetimes.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact hits', fr: 'Exactitudes', de: 'Exakte Treffer', es: 'Exactitudes' })}: ${exactDatetimes.join(', ')}`);
  } else if (exactHits.length > 0 && (fact.cacheMonth || fact.cache_month)) {
    lines.push(`${formatRawLabel(locale, { en: 'Exact days', fr: 'Jours exacts', de: 'Exakte Tage', es: 'Días exactos' })}: ${exactHits.join(', ')}`);
  }

  if (transitPlanet || natalPoint || aspectType) {
    const focus = [transitPlanet, aspectType ? humanizeRawKey(aspectType) : null, natalPoint].filter(Boolean).join(' ');
    if (focus) {
      lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${focus}`);
    }
  }

  if (houses.length > 0) {
    lines.push(`${formatRawLabel(locale, { en: 'Houses', fr: 'Maisons', de: 'Häuser', es: 'Casas' })}: ${houses.join(', ')}`);
  }

  if (payload.continuesFromPreviousMonth) {
    lines.push(formatRawLabel(locale, {
      en: 'Carries over from the previous month',
      fr: 'Se prolonge depuis le mois précédent',
      de: 'Läuft aus dem Vormonat weiter',
      es: 'Se arrastra desde el mes anterior'
    }));
  }

  if (payload.continuesToNextMonth) {
    lines.push(formatRawLabel(locale, {
      en: 'Continues into the next month',
      fr: 'Se prolonge sur le mois suivant',
      de: 'Läuft in den nächsten Monat weiter',
      es: 'Continúa en el mes siguiente'
    }));
  }

  const fallbackFactText = sanitizeRawFactText(fact.factText || fact.fact_text, title);
  if (fallbackFactText && lines.length <= 2) {
    lines.push(fallbackFactText);
  }

  const filtered = lines.filter(Boolean);
  return filtered.length > 1 ? filtered : [];
}

function buildNatalFactLines(locale, fact) {
  const payload = fact.factPayload || fact.fact_payload || {};
  const title = normalizeRawTitle(fact.title);
  const lines = [];

  if (title) {
    lines.push(title);
  }

  const primaryFields = [
    ['planet', payload.planet || payload.transitPlanet],
    ['sign', payload.sign],
    ['house', payload.house],
    ['aspect', payload.aspectType],
    ['angle', payload.angle]
  ]
    .map(([key, value]) => {
      const rendered = formatScalarValue(value);
      return rendered ? `${formatRawLabel(locale, { en: humanizeRawKey(key), fr: humanizeRawKey(key), de: humanizeRawKey(key), es: humanizeRawKey(key) })}: ${humanizeRawKey(rendered)}` : null;
    })
    .filter(Boolean);

  lines.push(...primaryFields.slice(0, 3));

  const factText = sanitizeRawFactText(fact.factText || fact.fact_text, title);
  if (factText) {
    lines.push(factText);
  }

  const filtered = lines.filter(Boolean);
  if (filtered.length > 1) {
    return filtered;
  }

  const wordCount = String(title || '').split(/\s+/).filter(Boolean).length;
  return wordCount >= 3 ? filtered : [];
}

function buildRawFactCards(locale, facts, options = {}) {
  const subjectLabel = options.subjectLabel || 'Chart User';
  const intro = buildRawFactsIntro(locale, subjectLabel, facts, options.intro || null);
  const blocks = [intro];

  const usableFacts = [];
  facts.slice(0, options.limit || 5).forEach((fact) => {
    const lines = isMonthlyTransitFact(fact)
      ? buildTransitFactLines(locale, fact)
      : buildNatalFactLines(locale, fact);

    if (lines.length === 0) {
      return;
    }

    usableFacts.push(lines);
  });

  usableFacts.forEach((lines, index) => {
    blocks.push([`${index + 1}. ${lines[0]}`, ...lines.slice(1)].join('\n'));
  });

  if (blocks.length === 1) {
    blocks.push(formatRawLabel(locale, {
      en: 'No usable raw facts were found.',
      fr: 'Aucun fait brut exploitable n’a été trouvé.',
      de: 'Es wurden keine brauchbaren Rohfakten gefunden.',
      es: 'No se encontraron hechos brutos utilizables.'
    }));
  }

  return normalizeAssistantText(blocks.join('\n\n'));
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fitCell(value, width) {
  const text = formatScalarValue(value) || '';
  const shortened = text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;
  return shortened.padEnd(width, ' ');
}

function buildRawTransitTable(locale, facts, subjectProfile) {
  const rows = facts
    .filter((fact) => (fact.sourceKind || fact.source_kind) === factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const title = formatRawLabel(locale, {
    en: `Monthly transits for ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
    fr: `Transits du mois pour ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
    de: `Monatliche Transite für ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`,
    es: `Tránsitos del mes para ${getRawSubjectLabel(locale, subjectProfile?.profileName || 'Chart User')}`
  });

  const header = `${fitCell('#', 2)} ${fitCell('Transit', 24)} ${fitCell('Window', 23)} ${fitCell('Peak', 16)} ${fitCell('Focus', 18)}`;
  const divider = `${'-'.repeat(2)} ${'-'.repeat(24)} ${'-'.repeat(23)} ${'-'.repeat(16)} ${'-'.repeat(18)}`;
  const body = rows.map((fact, index) => {
    const payload = fact.factPayload || fact.fact_payload || {};
    const focus = [payload.transitPlanet, payload.aspectType ? humanizeRawKey(payload.aspectType) : null, payload.natalPoint]
      .map((item) => {
        const rendered = formatScalarValue(item);
        return rendered ? humanizeRawKey(rendered) : null;
      })
      .filter(Boolean)
      .join(' ');

    return [
      fitCell(String(index + 1), 2),
      fitCell(normalizeRawTitle(fact.title) || '', 24),
      fitCell(formatRawDateWindow(payload.startDatetime, payload.endDatetime)
        || ((payload.visibleStartDay || payload.visibleEndDay)
          ? `${payload.visibleStartDay || '?'}→${payload.visibleEndDay || '?'}`
          : (fact.cacheMonth || fact.cache_month || '')), 23),
      fitCell(formatRawDate(payload.peakDatetime)
        || normalizeRawList(payload.exactDatetimes, formatRawDate)[0]
        || normalizeRawList(payload.exactHitsInMonth, formatScalarValue).join(', '), 16),
      fitCell(focus || normalizeRawList(payload.houses, (value) => humanizeRawKey(formatScalarValue(value))).join(', '), 18)
    ].join(' ');
  });

  return `<pre>${escapeTelegramHtml([title, '', header, divider, ...body].join('\n'))}</pre>`;
}

function collectRawToolSections(value, prefix = '', depth = 0) {
  if (depth > 2 || value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 5)
      .flatMap((item, index) => collectRawToolSections(item, prefix ? `${prefix} ${index + 1}` : `${index + 1}`, depth + 1));
  }

  if (typeof value !== 'object') {
    const rendered = formatScalarValue(value);
    return rendered && prefix ? [[prefix, rendered]] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const label = prefix ? `${prefix} • ${sentenceCase(String(key).replace(/_/g, ' ')).replace(/[.!?]$/, '')}` : sentenceCase(String(key).replace(/_/g, ' ')).replace(/[.!?]$/, '');
    if (child === null || child === undefined || child === '') {
      return [];
    }

    if (typeof child !== 'object') {
      const rendered = formatScalarValue(child);
      return rendered ? [[label, rendered]] : [];
    }

    if (Array.isArray(child) && child.every((item) => typeof item !== 'object')) {
      const rendered = child.map(formatScalarValue).filter(Boolean).join(', ');
      return rendered ? [[label, rendered]] : [];
    }

    return collectRawToolSections(child, label, depth + 1);
  });
}

function buildRawToolResultText(locale, toolName, result) {
  if (toolName === 'get_cached_monthly_transits' && result?.available && Array.isArray(result?.timeline?.transits)) {
    const title = formatRawLabel(locale, {
      en: 'Monthly transit timeline',
      fr: 'Timeline des transits du mois',
      de: 'Monatliche Transit-Timeline',
      es: 'Cronología mensual de tránsitos'
    });
    const month = formatScalarValue(result.cacheMonth);
    const rows = result.timeline.transits.slice(0, 5).map((transit) => {
      const lines = [normalizeRawTitle(transit.label) || 'Transit'];
      const windowText = formatRawDateWindow(transit.start_datetime, transit.end_datetime);
      const exactHits = normalizeRawList(transit.exact_datetimes, formatRawDate);
      const focus = [transit.transit_planet, transit.aspect_type ? humanizeRawKey(transit.aspect_type) : null, transit.natal_point]
        .map((item) => {
          const rendered = formatScalarValue(item);
          return rendered ? humanizeRawKey(rendered) : null;
        })
        .filter(Boolean)
        .join(' ');

      if (windowText) {
        lines.push(`${formatRawLabel(locale, { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' })}: ${windowText}`);
      }

      if (exactHits.length > 0) {
        lines.push(`${formatRawLabel(locale, { en: 'Exact', fr: 'Exact', de: 'Exakt', es: 'Exacto' })}: ${exactHits.slice(0, 2).join(', ')}`);
      }

      if (focus) {
        lines.push(`${formatRawLabel(locale, { en: 'Focus', fr: 'Focus', de: 'Fokus', es: 'Foco' })}: ${focus}`);
      }

      return lines.join('\n');
    });

    return normalizeAssistantText([
      month ? `${title} — ${month}` : title,
      ...rows
    ].join('\n\n'));
  }

  const title = sentenceCase(toolName.replace(/^mcp_/, '').replace(/^v1_/, '').replace(/_/g, ' ')).replace(/[.!?]$/, '');
  const sections = collectRawToolSections(result).slice(0, 12);
  const lines = [title];

  if (sections.length === 0) {
    lines.push(formatRawLabel(locale, {
      en: 'No structured result fields were returned.',
      fr: 'Aucun champ structuré n’a été renvoyé.',
      de: 'Es wurden keine strukturierten Ergebnisfelder zurückgegeben.',
      es: 'No se devolvieron campos estructurados.'
    }));
  } else {
    sections.forEach(([label, value]) => {
      lines.push(`${label}: ${value}`);
    });
  }

  return lines.join('\n');
}

function buildRawToolLoopAnswer(locale, subjectProfile, toolResults = []) {
  const subjectLabel = subjectProfile?.profileName || 'Chart User';
  const intro = formatRawLabel(locale, {
    en: `Grounded results for ${getRawSubjectLabel(locale, subjectLabel)}`,
    fr: `Résultats factuels pour ${getRawSubjectLabel(locale, subjectLabel)}`,
    de: `Faktische Resultate für ${getRawSubjectLabel(locale, subjectLabel)}`,
    es: `Resultados factuales para ${getRawSubjectLabel(locale, subjectLabel)}`
  });

  const sections = toolResults
    .filter((tool) => tool?.result && !tool.result?.error)
    .filter((tool) => !(tool.name === 'get_cached_monthly_transits' && tool.result?.available === false))
    .map((tool) => {
      if (tool.name === 'search_cached_profile_facts' && Array.isArray(tool.result?.facts)) {
        return buildRawFactCards(locale, tool.result.facts, {
          subjectLabel,
          limit: 5
        });
      }

      return buildRawToolResultText(locale, tool.name, tool.result);
    })
    .filter(Boolean);

  if (sections.length === 0) {
    return normalizeAssistantText([
      intro,
      formatRawLabel(locale, {
        en: 'No grounded raw result is available for this question.',
        fr: 'Aucun résultat brut fondé n’est disponible pour cette question.',
        de: 'Für diese Frage ist kein belastbares Rohresultat verfügbar.',
        es: 'No hay un resultado bruto fundamentado disponible para esta pregunta.'
      })
    ].join('\n\n'));
  }

  return normalizeAssistantText([intro, ...sections].join('\n\n'));
}

function summarizeFactTags(tags, limit = 5) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => !String(tag).startsWith('month:'))
    .filter((tag) => !['natal', 'monthly_transit', 'timing', 'theme'].includes(String(tag)))
    .slice(0, limit)
    .join(', ');
}

function buildDeterministicFactAnswer(userText, facts, intent, subjectProfile, answerStyle) {
  const selectedFacts = Array.isArray(facts) ? facts.slice(0, 4) : [];
  if (selectedFacts.length === 0) {
    return '';
  }

  const label = subjectProfile?.profileName || 'your chart';
  const intro = answerStyle === 'current_sky'
    ? `For ${label}, the current sky is dominated by these active dynamics.`
    : intent.id === 'transits'
      ? `For ${label}, the current transit picture is led by these active themes.`
      : `For ${label}, the clearest answer comes from these chart factors.`;

  const body = selectedFacts
    .map((fact) => sentenceCase(fact.factText))
    .join(' ');

  const closing = intent.id === 'transits'
    ? 'This is the strongest current emphasis in the indexed monthly transit data.'
    : `That is the strongest pattern connected to your question: "${String(userText || '').trim()}".`;

  return normalizeAssistantText([intro, body, closing].join('\n\n'));
}

function buildFactRewritePrompt(userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective) {
  const factLines = facts.slice(0, 4).map((fact, index) => {
    const parts = [
      `${index + 1}. Title: ${fact.title || 'Untitled fact'}`,
      `Evidence: ${fact.factText}`
    ].filter(Boolean);

    return parts.join('\n');
  });

  return [
    `Profile: ${subjectProfile?.profileName || 'Chart User'}`,
    `Intent: ${intent.id}`,
    `Answer style: ${answerStyle}`,
    `Response perspective: ${responsePerspective}`,
    `Question: ${String(userText || '').trim()}`,
    '',
    'Grounded facts:',
    ...factLines,
    '',
    'Fallback draft:',
    draftAnswer
  ].join('\n');
}

async function maybeRewriteFactAnswer(locale, userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective) {
  if (!draftAnswer) {
    return draftAnswer;
  }

  const isTransitReading = (
    intent.id === 'transits' ||
    facts.some((fact) => fact.sourceKind === factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
  );

  const sharedInstructions = [
    'You are a top-quality professional astrologer.',
    'Write a short astrology answer from grounded facts only.',
    `Write in ${LOCALE_INSTRUCTION[locale] || 'English'}.`,
    'Use plain text only.',
    'Answer like a real astrologer speaking to a client, not like a database or analyst.',
    'Translate metadata and evidence into natural astrological language.',
    'Do not expose labels such as category, kind, subjects, tags, source, or metadata.',
    'Do not list raw taxonomy terms unless they are naturally readable astrology terms.',
    'Do not add any new facts, timings, placements, or interpretations.',
    'Answer the user question directly in the first sentence.',
    'Base the answer on the strongest 2 or 3 grounded factors, not an exhaustive list.',
    'Avoid repetitive phrasing and avoid sounding mechanical.',
    'Keep it to 2 or 3 short paragraphs.'
  ];

  if (responsePerspective === 'third_person') {
    sharedInstructions.push(
      `Refer to ${subjectProfile?.profileName || 'the person'} by name or as he/she/they, not as you/your.`,
      'Do not write as if you are speaking directly to the chart owner in second person.'
    );
  }

  const natalInstructions = [
    'Interpret this as a natal reading.',
    'Lead with the core relationship, personality, emotional, or life-pattern theme that best answers the question.',
    'Show how the strongest chart factors work together instead of listing them separately.',
    'Translate the chart into lived tendencies, emotional patterns, needs, fears, strengths, or behavior.',
    'When helpful, mention the tension or balance between two factors and how that plays out in real life.',
    'Keep the tone insightful, personal, and psychologically accurate.',
    'Do not make rare signatures the main angle unless the question explicitly asks about rare signatures or the grounded facts clearly make them dominant.'
  ];

  const transitInstructions = [
    'Interpret this as a transit or current-sky reading.',
    'Lead with the dominant atmosphere of the moment.',
    'Explain the 2 or 3 most important active influences and what they are emphasizing now.',
    'Describe what is building, peaking, shifting, or pressuring the period.',
    'Connect the sky to lived experience in the present tense.',
    'If both collective sky patterns and personal transits appear in the facts, start with the sky atmosphere and then narrow into the personal impact.',
    'Keep the tone timely, dynamic, and present-focused.'
  ];

  const styleInstructions = {
    natal_theme: [
      'Structure the answer around 2 or 3 major natal axes only.',
      'Open with the main defining theme, then add the strongest supporting pattern.'
    ],
    planet_focus: [
      'Focus first on the planet itself, then on its sign, house, and lived expression.',
      'Do not drift into a full chart summary.'
    ],
    house_focus: [
      'Structure the answer as: house topic, ruler or strongest house factor, then lived impact.',
      'Do not reduce the answer to a generic planet-in-house reading.'
    ],
    aspect_focus: [
      'Name the main aspect dynamic first, then explain how it affects personality or behavior.',
      'Keep the answer centered on one dominant aspect pattern.'
    ],
    life_area_theme: [
      'Prioritize the life area named in the question and rank the strongest 2 or 3 factors.',
      'Avoid cataloguing signatures without linking them to lived experience.'
    ],
    current_sky: [
      'Start with the dominant atmosphere of the sky today.',
      'Then narrow into the most relevant personal activation if one is clearly present.'
    ],
    personal_transits: [
      'Start with the dominant personal transit of the day or period.',
      'Add at most two secondary activations and one short practical takeaway.'
    ],
    synastry: [
      'Write as a comparison between two people, naming the dynamic clearly and directly.',
      'Do not answer as if only one chart existed.'
    ]
  };

  const systemInstruction = [
    ...sharedInstructions,
    ...(isTransitReading ? transitInstructions : natalInstructions),
    ...(styleInstructions[answerStyle] || [])
  ].join('\n');

  const rewritten = await generatePlainText({
    systemInstruction,
    userText: buildFactRewritePrompt(userText, facts, intent, subjectProfile, draftAnswer, answerStyle, responsePerspective),
    history: [],
    model: getFastPathModelName()
  });

  return normalizeAssistantText(rewritten || draftAnswer);
}

async function tryFactFastPath(identity, userText, intent, subjectProfile, factAvailability, locale, plannedRoute = null, options = {}) {
  if (!hasIndexedCoverage(factAvailability)) {
    return null;
  }

  const startedAt = performance.now();
  const transitBiased = isTransitBiasedQuestion(userText);
  let searchInput = plannedRoute && plannedRoute.target === 'indexed_facts'
    ? {
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: null,
        sourceKinds: Array.isArray(plannedRoute.sourceKinds) && plannedRoute.sourceKinds.length > 0
          ? plannedRoute.sourceKinds
          : buildFactSearchInput(intent, userText, subjectProfile, factAvailability).sourceKinds,
        categories: Array.isArray(plannedRoute.categories) ? plannedRoute.categories : [],
        tags: Array.isArray(plannedRoute.tags) ? plannedRoute.tags : [],
        cacheMonth: plannedRoute.sourceKinds?.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
          ? (plannedRoute.cacheMonth || factAvailability?.indexedTransitCacheMonth || null)
          : null,
        limit: plannedRoute.limit || 4
      }
    : buildFactSearchInput(intent, userText, subjectProfile, factAvailability);
  let facts = await factIndex.searchFacts(identity, searchInput);

  if (facts.length < 2 && searchInput.tags.length > 0) {
    facts = await factIndex.searchFacts(identity, {
      ...searchInput,
      tags: [],
      limit: intent.id === 'transits' ? 5 : 4
    });
  }

  const needsPlannedSearch = !plannedRoute && (facts.length < 2 || intent.id === 'fallback');
  if (needsPlannedSearch) {
    try {
      const plannedSearchInput = await planFactSearchQuery(locale, userText, intent, subjectProfile, factAvailability);
      if (plannedSearchInput) {
        const normalizedPlannedInput = {
          ...plannedSearchInput,
          cacheMonth: plannedSearchInput.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
            ? (plannedSearchInput.cacheMonth || factAvailability?.indexedTransitCacheMonth || null)
            : null
        };
        let selectedPlannedInput = normalizedPlannedInput;
        let plannedFacts = await factIndex.searchFacts(identity, normalizedPlannedInput);

        if (plannedFacts.length < 2) {
          const relaxedPlannedInput = {
            ...normalizedPlannedInput,
            categories: [],
            tags: normalizedPlannedInput.sourceKinds.includes(factIndex.MONTHLY_TRANSIT_SOURCE_KIND)
              ? ['current']
              : [],
            limit: normalizedPlannedInput.limit
          };
          const relaxedFacts = await factIndex.searchFacts(identity, relaxedPlannedInput);
          if (relaxedFacts.length > plannedFacts.length) {
            plannedFacts = relaxedFacts;
            selectedPlannedInput = relaxedPlannedInput;
          }
        }

        if (plannedFacts.length >= Math.max(2, facts.length)) {
          searchInput = selectedPlannedInput;
          facts = plannedFacts;
        }
      }
    } catch (error) {
      info('conversation fact search planner failed', {
        stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
        intent: intent.id,
        error: error.message || 'unknown'
      });
    }
  }

  if (facts.length < 2 && transitBiased && factAvailability?.indexedTransitCacheMonth) {
    const broadTransitInput = {
      primaryProfileId: subjectProfile.profileId,
      secondaryProfileId: null,
      sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
      categories: [],
      tags: [],
      cacheMonth: factAvailability.indexedTransitCacheMonth,
      limit: 5
    };
    const broadTransitFacts = await factIndex.searchFacts(identity, broadTransitInput);
    if (broadTransitFacts.length > facts.length) {
      searchInput = broadTransitInput;
      facts = broadTransitFacts;
    }
  }

  if (facts.length < 2) {
    return null;
  }

  const answerStyle = plannedRoute?.answerStyle || deriveDefaultAnswerStyle(intent, userText);
  const rawMode = options.responseMode === 'raw';
  const draftAnswer = rawMode
    ? buildRawFactCards(locale, facts, {
        subjectLabel: subjectProfile?.profileName || 'Chart User',
        intro: formatRawLabel(locale, {
          en: 'Indexed facts',
          fr: 'Faits indexés',
          de: 'Indexierte Fakten',
          es: 'Hechos indexados'
        }),
        limit: 5
      })
    : buildDeterministicFactAnswer(userText, facts, intent, subjectProfile, answerStyle);
  if (!draftAnswer) {
    return null;
  }

  let rewrittenAnswer = draftAnswer;
  let rewriteDurationMs = 0;

  if (!rawMode) {
    try {
      const rewriteStartedAt = performance.now();
      rewrittenAnswer = await maybeRewriteFactAnswer(
        locale,
        userText,
        facts,
        intent,
        subjectProfile,
        draftAnswer,
        answerStyle,
        options.responsePerspective || 'second_person'
      );
      rewriteDurationMs = Math.round(performance.now() - rewriteStartedAt);
    } catch (error) {
      info('conversation fact fast-path rewrite failed', {
        stateKey: `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`,
        intent: intent.id,
        error: error.message || 'unknown'
      });
    }
  }

  return {
    text: rewrittenAnswer,
    renderMode: rawMode && intent.id === 'transits' ? 'telegram_pre' : 'plain',
    usedTools: [{
      name: 'search_cached_profile_facts',
      args: searchInput,
      result: {
        available: true,
        facts: facts.map((fact) => ({
          category: fact.category,
          title: fact.title,
          tags: fact.tags,
          fact_text: fact.factText,
          fact_payload: fact.factPayload,
          source_kind: fact.sourceKind,
          cache_month: fact.cacheMonth
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

async function createLocalToolExecutor(identity, subjectProfile, factAvailability = {}) {
  const chatStateProfile = getChatState(identity).natalProfile;
  const profile = subjectProfile?.profileId && subjectProfile.profileId !== getChatState(identity).activeProfileId
    ? normalizeNatalProfile(subjectProfile.rawNatalPayload, subjectProfile.cityLabel, { birthCountry: subjectProfile.birthCountry })
    : chatStateProfile;

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
          await toolCache.ensureNatalInsights(identity, subjectProfile, { source: 'runtime' });
        }

        if (wantsTransitFacts) {
          const requestedCacheMonth = args.cacheMonth || toolCache.getCurrentMonthWindow(subjectProfile.timezone || 'UTC')?.cacheMonth || null;
          if (!requestedCacheMonth || factAvailability.indexedTransitCacheMonth !== requestedCacheMonth) {
            await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
          }
        }

        const facts = await factIndex.searchFacts(identity, {
          primaryProfileId: subjectProfile.profileId,
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
          const monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);
          if (monthlyTransitCache) {
            await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
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

function buildProfileResolutionResponse(locale, route) {
  if (route.kind === 'astrology_synastry') {
    return locale === 'fr'
      ? 'Je peux comparer deux profils seulement si le second profil est sauvegardé et identifié clairement. Donnez-moi le nom exact du profil à comparer.'
      : 'I can compare two profiles only if the second saved profile is clearly identified. Tell me the exact profile name to compare.';
  }

  return locale === 'fr'
    ? 'Je vois plusieurs profils possibles ou aucun profil clairement visé. Précisez le nom du profil concerné.'
    : 'I see multiple possible profiles, or no clearly targeted profile. Tell me the exact profile name you want me to use.';
}

function looksLikeSystemReply(text) {
  return /\b(saved profile|saved profiles|profil sauvegard[ée]s?|profil actif|active profile)\b/i.test(String(text || ''));
}

function validateFinalAnswer(text, route, locale) {
  const normalized = normalizeAssistantText(text);

  if ((route.kind === 'astrology_natal' || route.kind === 'astrology_transits' || route.kind === 'astrology_synastry') && looksLikeSystemReply(normalized)) {
    return locale === 'fr'
      ? 'Je ne peux pas répondre proprement tant que la bonne cible de profil n’est pas confirmée.'
      : 'I cannot answer cleanly until the correct profile target is confirmed.';
  }

  return normalized;
}

function validateRawAnswer(text, locale) {
  const normalized = normalizeAssistantText(text);

  if (RAW_INTERPRETIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return formatRawLabel(locale, {
      en: 'Raw mode blocked an interpretive reply.',
      fr: 'Le mode brut a bloqué une réponse interprétative.',
      de: 'Der Rohmodus hat eine interpretierende Antwort blockiert.',
      es: 'El modo bruto bloqueó una respuesta interpretativa.'
    });
  }

  return normalized;
}

function updateConversationState(identity, route, subjectProfile, secondaryProfile = null, resolvedQuestion = null) {
  setConversationContext(identity, {
    lastReferencedProfileId: subjectProfile?.profileId || null,
    lastComparedProfileId: secondaryProfile?.profileId || null,
    lastResponseProfileId: subjectProfile?.profileId || null,
    lastResponseRoute: route?.kind || null,
    lastIntentId: route?.intent?.id || null,
    lastAnswerStyle: route?.answerStyle || null,
    lastResolvedQuestion: resolvedQuestion || null,
    lastCommonRouteId: route?.commonRouteId || null
  }, { notify: false });
}

async function answerConversation(identity, userText) {
  const chatState = getChatState(identity);
  const locale = getLocale(chatState);
  const responseMode = chatState.responseMode === 'raw' ? 'raw' : 'interpreted';
  const conversationContext = getConversationContext(identity);
  const explicitFollowUp = detectExplicitFollowUp(userText, conversationContext, chatState.history);
  const routeSeedText = explicitFollowUp?.rewrittenQuestion || userText;
  const detectedRoute = detectConversationRoute(routeSeedText, chatState.history);
  const inheritedRoute = inheritRouteFromConversation(detectedRoute, conversationContext, userText);
  let { route, commonRoute } = applyCommonQuestionRoute(inheritedRoute, routeSeedText);
  const intent = route.intent;
  const plannerQuestionText = explicitFollowUp?.rewrittenQuestion || resolveQuestionForPlanner(route, userText, chatState.history);
  const stateKey = chatState.stateKey || `${identity?.channel || 'unknown'}:${identity?.chatId || identity?.userId || 'unknown'}`;

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Conversational mode is disabled.');
  }

  await profiles.ensureHydrated(identity);
  const activeProfile = await profiles.getActiveProfile(identity);

  if (route.kind === 'system_meta') {
    const text = buildSystemMetaResponse(locale, getChatState(identity), activeProfile);
    updateConversationState(identity, route, activeProfile, null, plannerQuestionText);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (route.kind === 'profile_management') {
    const text = buildProfileManagementResponse(locale);
    updateConversationState(identity, route, activeProfile, null, plannerQuestionText);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (route.kind === 'clarification') {
    const referencedProfile = conversationContext.lastResponseProfileId
      ? await profiles.getProfileById(identity, conversationContext.lastResponseProfileId)
      : activeProfile;
    const text = buildClarificationResponse(locale, activeProfile, referencedProfile, conversationContext);
    updateConversationState(identity, route, referencedProfile || activeProfile, null, plannerQuestionText);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  const targetContext = await resolveConversationTargets(identity, userText, route, activeProfile);
  const subjectProfile = targetContext.subjectProfile || activeProfile;
  const secondaryProfile = targetContext.secondaryProfile || null;
  const effectiveUserQuestion = buildEffectiveUserQuestion(route, userText, plannerQuestionText, subjectProfile);
  const responsePerspective = shouldUseThirdPersonVoice(userText, subjectProfile, activeProfile)
    ? 'third_person'
    : 'second_person';

  if (targetContext.needsClarification) {
    const text = buildProfileResolutionResponse(locale, route);
    pushHistory(identity, 'user', userText);
    pushHistory(identity, 'model', text);
    setLastToolResults(identity, []);
    return {
      text,
      usedTools: [],
      intent: route.kind
    };
  }

  if (!subjectProfile?.rawNatalPayload) {
    return {
      text: {
        en: 'I need your birth details before I can answer personal astrology questions from your chart.',
        fr: 'J’ai besoin de vos données de naissance avant de pouvoir répondre à des questions astrologiques personnelles à partir de votre thème.',
        de: 'Ich brauche deine Geburtsdaten, bevor ich persönliche astrologische Fragen aus deinem Horoskop beantworten kann.',
        es: 'Necesito tus datos de nacimiento antes de poder responder preguntas astrológicas personales a partir de tu carta.'
      }[locale] || 'I need your birth details before I can answer personal astrology questions from your chart.',
      usedTools: [],
      intent: route.kind
    };
  }

  const localDeclarations = createLocalFunctionDeclarations();
  await toolCache.ensureNatalInsights(identity, subjectProfile, { source: 'runtime' });
  if (route.kind === 'astrology_transits') {
    await toolCache.ensureMonthlyTransitInsights(identity, subjectProfile, { source: 'runtime' });
  }
  const monthlyTransitCache = await toolCache.getCurrentMonthTransitCache(identity, subjectProfile);
  const factAvailability = subjectProfile.profileId === getChatState(identity).activeProfileId
    ? await factIndex.syncActiveProfileFactAvailability(identity, subjectProfile, {
        cacheMonth: monthlyTransitCache?.cacheMonth || null,
        notify: false
      })
    : await factIndex.getProfileFactAvailability(identity, subjectProfile, {
        cacheMonth: monthlyTransitCache?.cacheMonth || null
      });
  const plannedRoute = buildPlannedRouteFromCommonQuestion(commonRoute, subjectProfile, factAvailability)
    || await planFactSearchQuery(locale, plannerQuestionText, intent, subjectProfile, factAvailability);
  if (plannedRoute && !plannedRoute.answerStyle) {
    plannedRoute.answerStyle = route.answerStyle;
  }
  const shouldPreferIndexedFacts = (
    route.kind !== 'astrology_synastry' &&
    route.kind !== 'astrology_relocation' &&
    plannedRoute?.target === 'indexed_facts'
  );
  const effectiveIntent = intent;
  const synastryContext = {
    secondaryProfile,
    needsUserChoice: false,
    candidates: secondaryProfile ? [secondaryProfile] : []
  };

  const pendingComparisonText = consumePendingSynastryQuestion(identity);
  if (pendingComparisonText && secondaryProfile) {
    userText = pendingComparisonText;
  }
  let mcpDeclarations = [];
  let mcpStatus = 'available';

  try {
    mcpDeclarations = await mcpService.getFunctionDeclarations();
  } catch (error) {
    mcpStatus = `unavailable (${error.message || 'connection failed'})`;
  }

  const allDeclarations = [...localDeclarations, ...mcpDeclarations];
  const localOnlyPreferred = shouldPreferIndexedFacts || isLocalOnlyPreferred(effectiveIntent, factAvailability);
  const localExecutor = await createLocalToolExecutor(identity, subjectProfile, factAvailability);
  const executionContext = {
    activeProfile: subjectProfile,
    synastryContext
  };

  const executeFunction = async (name, args) => {
    if (name === 'search_cached_profile_facts' || name.startsWith('get_cached_') || name === 'get_profile_completeness') {
      return localExecutor(name, args);
    }

    if (mcpService.isMcpTool(name)) {
      const originalToolName = mcpService.resolveOriginalToolName(name);
      const requestArgs = buildResolvedToolArgs(originalToolName, args, executionContext);
      const cacheMonth = toolCache.inferCacheMonth(originalToolName, requestArgs, subjectProfile.timezone || 'UTC');
      const result = await toolCache.resolveCachedToolCall(identity, {
        toolName: originalToolName,
        requestArgs,
        profile: subjectProfile,
        primaryProfileId: subjectProfile.profileId,
        secondaryProfileId: secondaryProfile?.profileId || null,
        questionText: effectiveUserQuestion,
        cacheMonth: route.kind === 'astrology_transits' ? cacheMonth : null,
        source: 'runtime',
        executor: (resolvedArgs) => mcpService.callToolByOriginalName(originalToolName, resolvedArgs)
      });

      return result.result;
    }

    throw new Error(`Unknown tool call: ${name}`);
  };

  const systemInstruction = buildSystemInstruction(chatState, mcpStatus, effectiveIntent, {
    activeProfileName: subjectProfile.profileName,
    factAvailability,
    monthlyTransitAvailable: Boolean(monthlyTransitCache),
    includeNatalSummary: !factAvailability?.hasNatalFacts,
    subjectProfileSummary: normalizeNatalProfile(subjectProfile.rawNatalPayload, subjectProfile.cityLabel, {
      birthCountry: subjectProfile.birthCountry
    }).summaryText,
    routeKind: route.kind,
    commonRouteId: route.commonRouteId || null,
    answerStyle: plannedRoute?.answerStyle || route.answerStyle,
    responseMode,
    responsePerspective,
    targetProfileLabel: subjectProfile.profileName,
    synastryContext: {
      activeProfile: subjectProfile,
      secondaryProfile
    }
  });

  const fastPathResult = shouldPreferIndexedFacts
    ? await tryFactFastPath(identity, effectiveUserQuestion, effectiveIntent, subjectProfile, factAvailability, locale, plannedRoute, {
        responsePerspective,
        responseMode
      })
    : null;
  if (fastPathResult) {
    info('conversation fact fast-path complete', {
      stateKey,
      intent: effectiveIntent.id,
      routeTarget: plannedRoute?.target || null,
      routeReason: plannedRoute?.reason || null,
      durationMs: fastPathResult.durationMs,
      rewriteDurationMs: fastPathResult.rewriteDurationMs,
      factCount: fastPathResult.usedTools[0]?.result?.facts?.length || 0
    });

    pushHistory(identity, 'user', userText);
    const rawTransitTable = (
      responseMode === 'raw' &&
      route.kind === 'astrology_transits' &&
      identity?.channel === 'telegram'
    )
      ? buildRawTransitTable(locale, fastPathResult.usedTools?.[0]?.result?.facts || [], subjectProfile)
      : null;
    const finalText = responseMode === 'raw'
      ? (rawTransitTable || validateRawAnswer(fastPathResult.text, locale))
      : validateFinalAnswer(fastPathResult.text, route, locale);
    pushHistory(identity, 'model', finalText);
    setLastToolResults(identity, fastPathResult.usedTools);
    updateConversationState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText);

    return {
      text: finalText,
      renderMode: rawTransitTable ? 'telegram_pre' : (fastPathResult.renderMode || 'plain'),
      usedTools: fastPathResult.usedTools,
      intent: route.kind
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
      userText: effectiveUserQuestion,
      functionDeclarations: localDeclarations,
      executeFunction
    });
    const localOnlySufficient = localResultLooksSufficient(localOnlyResult, effectiveIntent);

    info('conversation local-only pass complete', {
      stateKey,
      intent: route.kind,
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
        userText: effectiveUserQuestion,
        functionDeclarations: allDeclarations,
        executeFunction
      });

      info('conversation mcp fallback pass complete', {
        stateKey,
        intent: route.kind,
        durationMs: Math.round(performance.now() - fallbackStartedAt),
        toolCalls: Array.isArray(result.toolResults) ? result.toolResults.length : 0
      });
    }
  } else {
    const fallbackStartedAt = performance.now();
    result = await runFunctionCallingLoop({
      systemInstruction,
      history: chatState.history,
      userText: effectiveUserQuestion,
      functionDeclarations: allDeclarations,
      executeFunction
    });

    info('conversation mcp fallback pass complete', {
      stateKey,
      intent: route.kind,
      durationMs: Math.round(performance.now() - fallbackStartedAt),
      toolCalls: Array.isArray(result.toolResults) ? result.toolResults.length : 0
    });
  }

  if (responseMode === 'raw') {
    result = {
      ...result,
      text: buildRawToolLoopAnswer(locale, subjectProfile, result.toolResults)
    };
  }

  pushHistory(identity, 'user', userText);
  const finalText = responseMode === 'raw'
    ? validateRawAnswer(result.text, locale)
    : validateFinalAnswer(result.text, route, locale);
  pushHistory(identity, 'model', finalText);
  setLastToolResults(identity, result.toolResults);
  updateConversationState(identity, route, subjectProfile, secondaryProfile, plannerQuestionText);

  return {
    text: finalText,
    renderMode: result.renderMode || 'plain',
    usedTools: result.toolResults,
    intent: route.kind
  };
}

module.exports = {
  answerConversation
};
