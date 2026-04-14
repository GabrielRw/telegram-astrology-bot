const INTENTS = [
  {
    id: 'relocation',
    matchers: [
      /\brelocat/i,
      /\bmove\b/i,
      /\bmoving\b/i,
      /\blive\b.*\b(france|paris|lyon|marseille|bordeaux|lille|toulouse|nice)\b/i,
      /\bastrocart/i,
      /\bcity\b/i,
      /\bwhere should i\b/i
    ],
    prefersCachedTools: ['get_cached_natal_summary', 'get_profile_completeness'],
    prefersMcpTools: ['mcp'],
    guidance: 'Use astrocartography MCP tools for relocation questions. Ask only for the smallest missing parameter, such as the relocation goal or target city. When answering, separate raw returned values like distances and scores from your interpretation. Do not invent generic orb rules or score semantics unless the tool explicitly provides them.'
  },
  {
    id: 'rising_sign',
    matchers: [/rising sign/i, /\bascendant\b/i, /\basc\b/i],
    prefersCachedTools: ['get_cached_angle_info', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Answer from cached ascendant data first. If birth time is unknown, say Rising cannot be determined reliably.'
  },
  {
    id: 'planet_placement',
    matchers: [/\b(sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|chiron|lilith)\b/i],
    prefersCachedTools: ['get_cached_planet_placement', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Use cached placement and linked sign/house interpretation before any external tool.'
  },
  {
    id: 'major_aspects',
    matchers: [/\baspect/i, /\bstrongest\b/i, /\bmajor aspects?\b/i],
    prefersCachedTools: ['get_cached_major_aspects'],
    prefersMcpTools: [],
    guidance: 'Prefer cached major aspects sorted by orb.'
  },
  {
    id: 'house_question',
    matchers: [/\bhouse\b/i, /\b7th\b/i, /\b10th\b/i, /\b4th\b/i],
    prefersCachedTools: ['get_cached_house_info', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Use cached natal house data when the user asks about a house meaning.'
  },
  {
    id: 'chart_summary',
    matchers: [/\bsummarize\b/i, /\boverall\b/i, /\bmy chart\b/i, /\bbig picture\b/i],
    prefersCachedTools: ['get_cached_natal_summary', 'get_cached_major_aspects', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Synthesize from cached natal summary, major aspects, and stellium data.'
  },
  {
    id: 'fallback',
    matchers: [],
    prefersCachedTools: ['get_profile_completeness', 'get_cached_natal_summary'],
    prefersMcpTools: ['mcp'],
    guidance: 'Start with profile completeness and natal summary, then use MCP only if cached data is insufficient.'
  }
];

function looksLikeRelocationReply(value) {
  return /^(romance|love|career|work|health|spiritual|spirituality|home|family)$/i.test(value.trim());
}

function historyImpliesRelocation(history) {
  const recentText = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((item) => String(item?.text || ''))
    .join(' ');

  return /\brelocat|\bastrocart|\bwhere should i relocate|\bwhich city|\bmoving to france|\bprimary goal\b/i.test(recentText);
}

function detectConversationIntent(text, history = []) {
  const value = String(text || '');

  if (looksLikeRelocationReply(value) && historyImpliesRelocation(history)) {
    return INTENTS.find((intent) => intent.id === 'relocation');
  }

  return INTENTS.find((intent) => intent.matchers.some((matcher) => matcher.test(value))) || INTENTS[INTENTS.length - 1];
}

module.exports = {
  detectConversationIntent
};
