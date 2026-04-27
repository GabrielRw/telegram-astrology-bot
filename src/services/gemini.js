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

function getConversationFallbackModelNames() {
  const configured = splitModelList(process.env.GEMINI_CONVERSATION_FALLBACK_MODELS);
  if (configured.length > 0) {
    return configured;
  }

  return [getFastPathModelName(), ...getFastPathFallbackModelNames()];
}

function getConversationModelCandidates(model) {
  const primary = model || getModelName();
  return uniqueModels([primary, ...getConversationFallbackModelNames()]);
}

function getFastPathModelName() {
  return process.env.GEMINI_FAST_PATH_MODEL || 'gemini-2.5-flash-lite';
}

function splitModelList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueModels(models) {
  return [...new Set((Array.isArray(models) ? models : []).filter(Boolean))];
}

function getFastPathFallbackModelNames() {
  const configured = splitModelList(process.env.GEMINI_FAST_PATH_FALLBACK_MODELS);
  if (configured.length > 0) {
    return configured;
  }

  return ['gemini-2.0-flash-lite'];
}

function getFastPathModelCandidates(model) {
  const primary = model || getFastPathModelName();
  return uniqueModels([primary, ...getFastPathFallbackModelNames()]);
}

function getLocalizedGeminiMessage(locale, key, fallback) {
  const messages = {
    invalidKey: {
      en: 'Gemini rejected GEMINI_API_KEY. Check or rotate the key.',
      fr: 'Gemini a rejeté GEMINI_API_KEY. Vérifiez la clé ou faites-la tourner.',
      de: 'Gemini hat GEMINI_API_KEY abgelehnt. Prüfe oder rotiere den Schlüssel.',
      es: 'Gemini rechazó GEMINI_API_KEY. Revisa o rota la clave.'
    },
    modelUnavailable: {
      en: `Gemini model "${getModelName()}" is unavailable. Set GEMINI_MODEL to a valid model ID.`,
      fr: `Le modèle Gemini "${getModelName()}" est indisponible. Définissez GEMINI_MODEL avec un identifiant valide.`,
      de: `Das Gemini-Modell "${getModelName()}" ist nicht verfügbar. Setze GEMINI_MODEL auf eine gültige Modell-ID.`,
      es: `El modelo Gemini "${getModelName()}" no está disponible. Define GEMINI_MODEL con un identificador válido.`
    },
    quota: {
      en: 'Gemini quota is exhausted right now. Try again later.',
      fr: 'Le quota Gemini est épuisé pour le moment. Réessayez plus tard.',
      de: 'Das Gemini-Kontingent ist gerade aufgebraucht. Versuche es später erneut.',
      es: 'La cuota de Gemini está agotada ahora mismo. Inténtalo más tarde.'
    },
    internal: {
      en: 'Gemini had a temporary internal error. Try the question again.',
      fr: 'Gemini a rencontré une erreur interne temporaire. Réessayez la question.',
      de: 'Gemini hatte einen vorübergehenden internen Fehler. Versuche die Frage erneut.',
      es: 'Gemini tuvo un error interno temporal. Intenta la pregunta de nuevo.'
    }
  };

  return messages[key]?.[locale] || fallback;
}

function getGeminiErrorMessage(error, locale = 'en') {
  const message = String(error?.message || '');

  if (message.includes('API key not valid')) {
    return getLocalizedGeminiMessage(locale, 'invalidKey', 'Gemini rejected GEMINI_API_KEY. Check or rotate the key.');
  }

  if (message.includes('not found for API version') || message.includes('is not found')) {
    return getLocalizedGeminiMessage(locale, 'modelUnavailable', `Gemini model "${getModelName()}" is unavailable. Set GEMINI_MODEL to a valid model ID.`);
  }

  if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
    return getLocalizedGeminiMessage(locale, 'quota', 'Gemini quota is exhausted right now. Try again later.');
  }

  if (message.includes('"status":"INTERNAL"') || message.includes('Internal error encountered')) {
    return getLocalizedGeminiMessage(locale, 'internal', 'Gemini had a temporary internal error. Try the question again.');
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

function extractFunctionCallParts(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  return parts
    .filter((part) => part?.functionCall)
    .map((part) => ({
      rawPart: part,
      call: part.functionCall
    }));
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

function isFallbackableGeminiError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('429') ||
    message.includes('not found for API version') ||
    message.includes('is not found') ||
    message.includes('NOT_FOUND') ||
    isRetryableGeminiError(error)
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
  executeFunction,
  model,
  toolConfigMode
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

  const allToolResults = [];
  const modelCandidates = getConversationModelCandidates(model);
  let currentModelIndex = 0;

  for (let step = 0; step < 4; step += 1) {
    let response;
    let lastError = null;

    for (let index = currentModelIndex; index < modelCandidates.length; index += 1) {
      const modelName = modelCandidates[index];

      try {
        response = await generateContentWithRetry(ai, {
          model: modelName,
          contents,
          config: {
            systemInstruction,
            tools: functionDeclarations.length > 0
              ? [{ functionDeclarations }]
              : undefined,
            toolConfig: functionDeclarations.length > 0
              ? {
                  functionCallingConfig: {
                    mode: toolConfigMode || FunctionCallingConfigMode.AUTO
                  }
                }
              : undefined
          }
        });
        currentModelIndex = index;
        break;
      } catch (error) {
        lastError = error;

        if (!isFallbackableGeminiError(error) || index === modelCandidates.length - 1) {
          throw error;
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Gemini request failed.');
    }

    const functionCallParts = extractFunctionCallParts(response);
    const functionCalls = functionCallParts.length > 0
      ? functionCallParts.map((entry) => entry.call)
      : (response.functionCalls || []);

    if (functionCalls.length === 0) {
      return {
        text: response.text || 'I could not generate a grounded astrology answer.',
        toolResults: allToolResults
      };
    }

    const modelParts = functionCallParts.length > 0
      ? functionCallParts.map((entry) => entry.rawPart)
      : functionCalls.map((call) => createPartFromFunctionCall(call.name, call.args || {}));
    contents.push(createModelContent(modelParts));

    const responseParts = [];

    for (const call of functionCalls) {
      let result;

      try {
        result = await executeFunction(call.name, call.args || {});
      } catch (error) {
        result = { error: error.message || 'Tool execution failed.' };
      }

      allToolResults.push({
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
    toolResults: allToolResults
  };
}

async function generatePlainText({
  systemInstruction,
  userText,
  history = [],
  model
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

  const requestedModel = model || getModelName();
  const modelCandidates = requestedModel === getFastPathModelName()
    ? getFastPathModelCandidates(requestedModel)
    : [requestedModel];
  let lastError = null;

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const modelName = modelCandidates[index];

    try {
      const response = await generateContentWithRetry(ai, {
        model: modelName,
        contents,
        config: {
          systemInstruction
        }
      });

      return response.text || '';
    } catch (error) {
      lastError = error;

      if (!isFallbackableGeminiError(error) || index === modelCandidates.length - 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Gemini request failed.');
}

function createLocalFunctionDeclarations() {
  return [
    {
      name: 'search_cached_profile_facts',
      description: 'Search indexed natal and monthly transit facts for the active profile using exact categories and tags before calling MCP tools.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            },
            description: 'Optional exact insight categories such as identity, emotions, relationships, structure, transformation, growth, drive, life_path, chart_pattern, or mind.'
          },
          tags: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            },
            description: 'Optional exact tags such as planet:sun, house:10, kind:pressure_window, category:relationships, detector:signatures.question_oriented.v1, or 2027-07.'
          },
          sourceKinds: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            },
            description: 'Optional source kinds: natal or monthly_transit.'
          },
          cacheMonth: {
            type: Type.STRING,
            description: 'Optional month filter in YYYY-MM format, for example 2026-04.'
          },
          limit: {
            type: Type.INTEGER,
            description: 'Maximum number of facts to return.'
          },
          secondaryProfileId: {
            type: Type.STRING,
            description: 'Optional comparison profile id for pair-specific facts. Leave empty for single-profile facts.'
          }
        }
      }
    },
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
      name: 'get_cached_monthly_transits',
      description: 'Return the cached transit timeline for the active profile and current month when available.',
      parameters: {
        type: Type.OBJECT,
        properties: {}
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
  generatePlainText,
  getConversationModelCandidates,
  getFastPathModelName,
  getGeminiErrorMessage,
  runFunctionCallingLoop
};
