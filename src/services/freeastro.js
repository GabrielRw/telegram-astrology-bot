const API_BASE_URL = 'https://api.freeastroapi.com';
const { notifyApiCreditsExhausted } = require('./telegramAlerts');

class FreeAstroError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FreeAstroError';
    this.status = options.status;
    this.details = options.details;
  }
}

function getApiKey() {
  const apiKey = process.env.FREEASTRO_API_KEY;

  if (!apiKey) {
    throw new FreeAstroError('Missing FREEASTRO_API_KEY environment variable.');
  }

  return apiKey;
}

async function parseJson(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FreeAstroError('FreeAstro API returned invalid JSON.', {
      status: response.status,
      details: text
    });
  }
}

function getErrorMessage(status, data, response) {
  if (status === 401) {
    return 'FreeAstro rejected the API key. Check FREEASTRO_API_KEY.';
  }

  if (status === 403) {
    return 'FreeAstro access is not available for this API key.';
  }

  if (status === 404) {
    return 'FreeAstro endpoint was not found.';
  }

  if (status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    return retryAfter
      ? `FreeAstro rate limit reached. Try again in ${retryAfter}s.`
      : 'FreeAstro rate limit reached. Try again shortly.';
  }

  if (status >= 500) {
    return 'FreeAstro is temporarily unavailable. Try again shortly.';
  }

  if (data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }

    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error;
    }
  }

  return 'FreeAstro request failed.';
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'x-api-key': getApiKey(),
      ...(options.headers || {})
    }
  });

  await maybeNotifyCreditsExhausted(path, response);
  const data = await parseJson(response);

  if (!response.ok) {
    throw new FreeAstroError(getErrorMessage(response.status, data, response), {
      status: response.status,
      details: data
    });
  }

  return data;
}

async function requestBinary(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'x-api-key': getApiKey(),
      ...(options.headers || {})
    }
  });

  await maybeNotifyCreditsExhausted(path, response);
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    const fallbackText = buffer.toString('utf8');
    let details = null;

    try {
      details = fallbackText ? JSON.parse(fallbackText) : null;
    } catch (error) {
      details = fallbackText;
    }

    throw new FreeAstroError(getErrorMessage(response.status, details, response), {
      status: response.status,
      details
    });
  }

  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream'
  };
}

async function maybeNotifyCreditsExhausted(path, response) {
  const remainingHeader = response.headers.get('x-ratelimit-remaining');
  const resetHeader = response.headers.get('x-ratelimit-reset');
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  const isDepleted = response.status === 429 || (Number.isFinite(remaining) && remaining <= 0);

  if (!isDepleted) {
    return;
  }

  await notifyApiCreditsExhausted({
    endpoint: path,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: resetHeader,
    status: response.status
  });
}

function buildQuery(params) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  });

  return query.toString();
}

async function searchCities(query, limit = 3) {
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery) {
    throw new FreeAstroError('Please provide a city name.');
  }

  const qs = buildQuery({ q: normalizedQuery, limit });
  const data = await request(`/api/v1/geo/search?${qs}`);

  if (!data || !Array.isArray(data.results) || data.results.length === 0) {
    throw new FreeAstroError(`Could not find a city match for "${normalizedQuery}".`);
  }

  return data.results;
}

async function searchCity(query) {
  const results = await searchCities(query, 1);
  return results[0];
}

async function getNatal(data) {
  return request('/api/v1/natal/calculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

async function getNatalInsights(data) {
  return request('/api/v1/western/natal/insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

async function getTransitInsights(data) {
  return request('/api/v1/western/transits/insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

async function getDailyPersonalHoroscopeV3(data) {
  return request('/api/v3/horoscope/daily/personal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

async function getNatalChart(data) {
  return requestBinary('/api/v1/natal/chart/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

module.exports = {
  FreeAstroError,
  getNatalChart,
  getNatal,
  getNatalInsights,
  getDailyPersonalHoroscopeV3,
  getTransitInsights,
  searchCities,
  searchCity
};
