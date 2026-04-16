const INTENTS = [
  {
    id: 'relocation',
    matchers: [
      /\brelocat/i,
      /\bmove\b/i,
      /\bmoving\b/i,
      /\bd[ée]m[ée]nag/i,
      /\bumzieh/i,
      /\bmudar/i,
      /\blive\b.*\b(france|paris|lyon|marseille|bordeaux|lille|toulouse|nice)\b/i,
      /\bastrocart/i,
      /\bcity\b/i,
      /\bville\b/i,
      /\bstadt\b/i,
      /\bciudad\b/i,
      /\bwhere should i\b/i,
      /\bo[uù] devrais-je\b/i,
      /\bwo sollte ich\b/i,
      /\bd[óo]nde deber[ií]a\b/i
    ],
    prefersCachedTools: ['get_cached_natal_summary', 'get_profile_completeness'],
    prefersMcpTools: ['mcp'],
    guidance: 'Use astrocartography MCP tools for relocation questions. Ask only for the smallest missing parameter, such as the relocation goal or target city. When answering, separate raw returned values like distances and scores from your interpretation. Do not invent generic orb rules or score semantics unless the tool explicitly provides them.'
  },
  {
    id: 'rising_sign',
    matchers: [/rising sign/i, /\bascendant\b/i, /\basc\b/i, /\bsigne ascendant\b/i, /\baszendent\b/i, /\bascendente\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_angle_info', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Answer from cached ascendant data first. If birth time is unknown, say Rising cannot be determined reliably.'
  },
  {
    id: 'planet_placement',
    matchers: [/\b(sun|moon|mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|chiron|lilith|soleil|lune|mercure|v[ée]nus|soleil|mond|merkur|sonne|venere|sol|luna)\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_planet_placement', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Use cached placement and linked sign/house interpretation before any external tool.'
  },
  {
    id: 'major_aspects',
    matchers: [/\baspect/i, /\bstrongest\b/i, /\bmajor aspects?\b/i, /\baspect le plus fort\b/i, /\bst[äa]rkster aspekt\b/i, /\baspecto m[áa]s fuerte\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_major_aspects'],
    prefersMcpTools: [],
    guidance: 'Prefer cached major aspects sorted by orb.'
  },
  {
    id: 'house_question',
    matchers: [/\bhouse\b/i, /\b7th\b/i, /\b10th\b/i, /\b4th\b/i, /\bmaison\b/i, /\bhaus\b/i, /\bcasa\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_house_info', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Use cached natal house data when the user asks about a house meaning.'
  },
  {
    id: 'chart_summary',
    matchers: [/\bsummarize\b/i, /\boverall\b/i, /\bmy chart\b/i, /\bbig picture\b/i, /\br[ée]sum/i, /\bzusammenfass/i, /\bresume?n\b/i, /\bth[èe]me\b/i, /\bhoroskop\b/i, /\bcarta\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_natal_summary', 'get_cached_major_aspects', 'get_profile_completeness'],
    prefersMcpTools: [],
    guidance: 'Synthesize from cached natal summary, major aspects, and stellium data.'
  },
  {
    id: 'transits',
    matchers: [/\btransits?\b/i, /\bforecast\b/i, /\bthis month\b/i, /\bnext 12 months?\b/i, /\bce mois\b/i, /\bdieser monat\b/i, /\beste mes\b/i],
    prefersCachedTools: ['search_cached_profile_facts', 'get_cached_monthly_transits', 'get_profile_completeness'],
    prefersMcpTools: ['mcp_v1_western_transits_timeline'],
    guidance: 'Use the cached monthly transit timeline first. Only call transit MCP tools if the cached month is missing or insufficient for the question.'
  },
  {
    id: 'synastry',
    matchers: [/\bsynastry\b/i, /\bcompatible\b/i, /\bcompatibility\b/i, /\bcompare\b/i, /\bwith\b.*\b(me|my chart)\b/i, /\brelationship\b/i],
    prefersCachedTools: ['get_profile_completeness'],
    prefersMcpTools: ['mcp_v1_western_synastry_summary', 'mcp_v1_western_synastry'],
    guidance: 'For relationship comparison questions, default to the synastry summary tool first and only escalate to the full synastry endpoint when the summary lacks the needed detail.'
  },
  {
    id: 'fallback',
    matchers: [],
    prefersCachedTools: ['search_cached_profile_facts', 'get_profile_completeness', 'get_cached_natal_summary'],
    prefersMcpTools: ['mcp'],
    guidance: 'Start with profile completeness and natal summary, then use MCP only if cached data is insufficient.'
  }
];

function looksLikeRelocationReply(value) {
  return /^(romance|love|career|work|health|spiritual|spirituality|home|family|amour|carri[èe]re|sant[ée]|spirituel|foyer|famille|liebe|karriere|gesundheit|spirituell|zuhause|familie|amor|carrera|salud|espiritual|hogar)$/i.test(value.trim());
}

function historyImpliesRelocation(history) {
  const recentText = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((item) => String(item?.text || ''))
    .join(' ');

  return /\brelocat|\bastrocart|\bwhere should i relocate|\bwhich city|\bmoving to france|\bprimary goal\b|\bo[uù] devrais-je|\bquelle ville\b|\bumzieh|\bwelche stadt\b|\bd[óo]nde deber[ií]a|\bqu[ée] ciudad\b/i.test(recentText);
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
