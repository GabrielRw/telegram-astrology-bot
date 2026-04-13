const {
  createModelContent,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  createUserContent,
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type
} = require('@google/genai');

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Conversational mode is disabled.');
  }

  return new GoogleGenAI({ apiKey });
}

function getModelName() {
  return process.env.GEMINI_MODEL || 'gemma-4-31b-it';
}

function getGeminiErrorMessage(error) {
  const message = String(error?.message || '');

  if (message.includes('API key not valid')) {
    return 'Gemini rejected GEMINI_API_KEY. Check or rotate the key.';
  }

  if (message.includes('not found for API version') || message.includes('is not found')) {
    return `Gemini model "${getModelName()}" is unavailable. Set GEMINI_MODEL to a valid model ID.`;
  }

  if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini quota is exhausted right now. Try again later.';
  }

  if (message.includes('"status":"INTERNAL"') || message.includes('Internal error encountered')) {
    return 'Gemini had a temporary internal error. Try the question again.';
  }

  return message || 'Gemini request failed.';
}

function truncateValue(value, maxLength = 8000) {
  const text = JSON.stringify(value);

  if (!text || text.length <= maxLength) {
    return value;
  }

  return {
    truncated: true,
    preview: text.slice(0, maxLength)
  };
}

function isRetryableGeminiError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('"status":"INTERNAL"') ||
    message.includes('Internal error encountered') ||
    message.includes('503') ||
    message.includes('UNAVAILABLE')
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function generateContentWithRetry(ai, request, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await ai.models.generateContent(request);
    } catch (error) {
      lastError = error;

      if (!isRetryableGeminiError(error) || attempt === attempts - 1) {
        throw error;
      }

      await sleep(400 * (attempt + 1));
    }
  }

  throw lastError || new Error('Gemini request failed.');
}

async function runFunctionCallingLoop({
  systemInstruction,
  history,
  userText,
  functionDeclarations,
  executeFunction
}) {
  const ai = getGeminiClient();
  const contents = [
    ...history.map((item) => (
      item.role === 'model'
        ? createModelContent(item.text)
        : createUserContent(item.text)
    )),
    createUserContent(userText)
  ];

  let toolResults = [];

  for (let step = 0; step < 4; step += 1) {
    const response = await generateContentWithRetry(ai, {
      model: getModelName(),
      contents,
      config: {
        systemInstruction,
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
        toolConfig: functionDeclarations.length > 0
          ? {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.AUTO
              }
            }
          : undefined
      }
    });

    const functionCalls = response.functionCalls || [];

    if (functionCalls.length === 0) {
      return {
        text: response.text || 'I could not generate a grounded astrology answer.',
        toolResults
      };
    }

    const modelParts = functionCalls.map((call) => createPartFromFunctionCall(call.name, call.args || {}));
    contents.push(createModelContent(modelParts));

    const responseParts = [];
    toolResults = [];

    for (const call of functionCalls) {
      let result;

      try {
        result = await executeFunction(call.name, call.args || {});
      } catch (error) {
        result = { error: error.message || 'Tool execution failed.' };
      }

      toolResults.push({
        name: call.name,
        args: call.args || {},
        result
      });

      responseParts.push(
        createPartFromFunctionResponse(
          call.id || call.name,
          call.name,
          truncateValue(result)
        )
      );
    }

    contents.push(createUserContent(responseParts));
  }

  return {
    text: 'I hit the tool-calling limit before I could finish the reading.',
    toolResults
  };
}

function createLocalFunctionDeclarations() {
  return [
    {
      name: 'get_cached_natal_summary',
      description: 'Return a grounded summary of the current chat natal profile.',
      parameters: {
        type: Type.OBJECT,
        properties: {}
      }
    },
    {
      name: 'get_cached_planet_placement',
      description: 'Return a cached planet placement and linked interpretation when available.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          planet: {
            type: Type.STRING,
            description: 'Planet id or planet name, for example sun, moon, venus, mercury.'
          }
        },
        required: ['planet']
      }
    },
    {
      name: 'get_cached_major_aspects',
      description: 'Return cached major aspects from the natal chart.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: {
            type: Type.INTEGER,
            description: 'Maximum number of aspects to return.'
          }
        }
      }
    },
    {
      name: 'get_cached_house_info',
      description: 'Return cached information about a natal house.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          house: {
            type: Type.INTEGER,
            description: 'House number from 1 to 12.'
          }
        },
        required: ['house']
      }
    },
    {
      name: 'get_cached_angle_info',
      description: 'Return cached information about a natal angle such as asc, mc, ic, or dc.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          angle: {
            type: Type.STRING,
            description: 'Angle key, for example asc, mc, ic, dc, or vertex.'
          }
        },
        required: ['angle']
      }
    },
    {
      name: 'get_profile_completeness',
      description: 'Return whether the natal profile is complete enough to answer a specific chart question.',
      parameters: {
        type: Type.OBJECT,
        properties: {}
      }
    }
  ];
}

module.exports = {
  createLocalFunctionDeclarations,
  getGeminiErrorMessage,
  runFunctionCallingLoop
};
