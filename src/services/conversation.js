const { detectConversationIntent } = require('../config/conversationIntents');
const mcpService = require('./freeastroMcp');
const { createLocalFunctionDeclarations, runFunctionCallingLoop } = require('./gemini');
const { getChatState, pushHistory, setLastToolResults } = require('../state/chatState');

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

function buildSystemInstruction(chatState, mcpStatus, intent) {
  const profile = chatState.natalProfile;

  return [
    'You are a concise professional astrologer answering natal-chart questions in Telegram chat.',
    'Write in plain text only. Do not use Markdown emphasis, especially **.',
    'Keep each response block short. Aim for multiple small blocks, with no block over 80 words.',
    'Ground every answer in the user natal chart or explicit tool results.',
    'Never invent placements, houses, angles, aspects, timings, or predictions.',
    'If information is missing, say so clearly and ask a narrow follow-up only when required.',
    'If the user asks for transits, ephemeris, or a month-specific forecast and the needed date window is missing, ask for that date or month before answering.',
    'Do not give medical, legal, or financial advice.',
    'Never answer personal astrology questions without natal data.',
    'Prefer cached natal tools first. Use FreeAstro MCP only when cached chart data is insufficient.',
    'When using tool data, interpret it like an astrologer, but stay specific to the chart and concise.',
    `Detected user intent: ${intent.id}.`,
    `Routing guidance: ${intent.guidance}`,
    `Preferred cached tools: ${intent.prefersCachedTools.join(', ') || 'none'}.`,
    `Preferred MCP tools: ${intent.prefersMcpTools.join(', ') || 'none'}.`,
    `MCP status: ${mcpStatus}.`,
    '',
    'Natal profile facts:',
    profile?.summaryText || 'No natal profile available.'
  ].join('\n');
}

function normalizeAssistantText(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .trim();
}

function createLocalToolExecutor(chatState) {
  const profile = chatState.natalProfile;

  return async (name, args) => {
    switch (name) {
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

async function answerConversation(chatId, userText) {
  const chatState = getChatState(chatId);
  const intent = detectConversationIntent(userText);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Conversational mode is disabled.');
  }

  if (!chatState.natalProfile) {
    return {
      text: 'I need your natal chart before I can answer personal astrology questions. Start with /natal.',
      usedTools: [],
      intent: intent.id
    };
  }

  const localDeclarations = createLocalFunctionDeclarations();
  const localExecutor = createLocalToolExecutor(chatState);
  let mcpDeclarations = [];
  let mcpStatus = 'available';

  try {
    mcpDeclarations = await mcpService.getFunctionDeclarations();
  } catch (error) {
    mcpStatus = `unavailable (${error.message || 'connection failed'})`;
  }

  const allDeclarations = [...localDeclarations, ...mcpDeclarations];

  const executeFunction = async (name, args) => {
    if (name.startsWith('get_cached_') || name === 'get_profile_completeness') {
      return localExecutor(name, args);
    }

    if (mcpService.isMcpTool(name)) {
      return mcpService.callSanitizedTool(name, args);
    }

    throw new Error(`Unknown tool call: ${name}`);
  };

  const result = await runFunctionCallingLoop({
    systemInstruction: buildSystemInstruction(chatState, mcpStatus, intent),
    history: chatState.history,
    userText,
    functionDeclarations: allDeclarations,
    executeFunction
  });

  pushHistory(chatId, 'user', userText);
  pushHistory(chatId, 'model', result.text);
  setLastToolResults(chatId, result.toolResults);

  return {
    text: normalizeAssistantText(result.text),
    usedTools: result.toolResults,
    intent: intent.id
  };
}

module.exports = {
  answerConversation
};
