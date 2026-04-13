const INTENTS = [
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

function detectConversationIntent(text) {
  const value = String(text || '');

  return INTENTS.find((intent) => intent.matchers.some((matcher) => matcher.test(value))) || INTENTS[INTENTS.length - 1];
}

module.exports = {
  detectConversationIntent
};
