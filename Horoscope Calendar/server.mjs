import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const API_URL = "https://api.freeastroapi.com/api/v1/western/transits/timeline";
const INSIGHTS_URL = "https://api.freeastroapi.com/api/v1/western/transits/insights";
const EPHEMERIS_URL = "https://api.freeastroapi.com/api/v1/ephemeris/calculate";
const NATAL_CHART_URL = "https://api.freeastroapi.com/api/v1/natal/chart/";
const GEO_SEARCH_URL = "https://api.freeastroapi.com/api/v1/geo/search";
const MOON_MONTH_URL = "https://api.freeastroapi.com/api/v1/moon/month";
const moonPhaseCache = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

async function readJsonIfExists(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function stripSecrets(config) {
  const nextConfig = structuredClone(config);
  delete nextConfig.apiKey;
  return nextConfig;
}

async function loadConfig() {
  const baseConfigPath = path.join(__dirname, "config", "chart.json");
  const localConfigPath = path.join(__dirname, "config.local.json");
  const [baseConfig, localConfig] = await Promise.all([
    readJsonIfExists(baseConfigPath),
    readJsonIfExists(localConfigPath)
  ]);

  if (!baseConfig) {
    throw new Error("Missing config/chart.json");
  }

  return {
    ...baseConfig,
    ...(localConfig || {}),
    natal: {
      ...(baseConfig.natal || {}),
      ...((localConfig && localConfig.natal) || {})
    },
    filters: {
      ...(baseConfig.filters || {}),
      ...((localConfig && localConfig.filters) || {})
    },
    theme: {
      ...(baseConfig.theme || {}),
      ...((localConfig && localConfig.theme) || {})
    }
  };
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleTimelineProxy(response, payload) {
  await handleUpstreamPost(response, API_URL, payload);
}

async function handleInsightsProxy(response, payload) {
  await handleUpstreamPost(response, INSIGHTS_URL, payload);
}

async function handleEphemerisProxy(response, payload) {
  await handleUpstreamPost(response, EPHEMERIS_URL, payload);
}

async function handleNatalChartProxy(response, payload) {
  await handleUpstreamPost(response, NATAL_CHART_URL, payload);
}

async function handleUpstreamPost(response, url, payload) {
  const config = await loadConfig();
  const apiKey = process.env.FREE_ASTRO_API_KEY || config.apiKey;

  if (!apiKey) {
    sendJson(response, 500, {
      error: "Missing API key.",
      details: "Set FREE_ASTRO_API_KEY or add apiKey to config.local.json."
    });
    return;
  }

  const upstreamResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify(payload)
  });

  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";

  response.writeHead(upstreamResponse.status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType
  });
  response.end(text);
}

async function handleGeoSearch(response, query, limit, country) {
  const config = await loadConfig();
  const apiKey = process.env.FREE_ASTRO_API_KEY || config.apiKey;

  if (!query) {
    sendJson(response, 400, {
      error: "Missing city query.",
      details: "Pass a q query string to /api/geo/search."
    });
    return;
  }

  const upstreamUrl = new URL(GEO_SEARCH_URL);
  upstreamUrl.searchParams.set("q", query);

  if (limit) {
    upstreamUrl.searchParams.set("limit", limit);
  }

  if (country) {
    upstreamUrl.searchParams.set("country", country);
  }

  const headers = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    headers
  });
  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";

  response.writeHead(upstreamResponse.status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType
  });
  response.end(text);
}

async function handleMoonPhases(response, month, lat, lon, moonColor, shadowColor) {
  const config = await loadConfig();
  const apiKey = process.env.FREE_ASTRO_API_KEY || config.apiKey;

  if (!apiKey) {
    sendJson(response, 500, {
      error: "Missing API key.",
      details: "Set FREE_ASTRO_API_KEY or add apiKey to config.local.json."
    });
    return;
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    sendJson(response, 400, {
      error: "Invalid month.",
      details: "Pass month as YYYY-MM to /api/moon/phases."
    });
    return;
  }

  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const cacheKey = JSON.stringify({
    month,
    lat: lat || "",
    lon: lon || "",
    moonColor: moonColor || "#d3bd8a",
    shadowColor: shadowColor || "#0a1220"
  });

  const cachedValue = moonPhaseCache.get(cacheKey);
  if (cachedValue) {
    sendJson(response, 200, cachedValue);
    return;
  }

  const upstreamUrl = new URL(MOON_MONTH_URL);
  upstreamUrl.searchParams.set("year", String(year));
  upstreamUrl.searchParams.set("month", String(monthNumber));
  upstreamUrl.searchParams.set("include_visuals", "true");
  upstreamUrl.searchParams.set("style_moon_color", moonColor || "#d3bd8a");
  upstreamUrl.searchParams.set("style_shadow_color", shadowColor || "#0a1220");
  upstreamUrl.searchParams.set("tz_str", "AUTO");

  if (lat) {
    upstreamUrl.searchParams.set("lat", lat);
  }

  if (lon) {
    upstreamUrl.searchParams.set("lon", lon);
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      "x-api-key": apiKey
    }
  });
  const data = await upstreamResponse.json();

  if (!upstreamResponse.ok) {
    sendJson(response, upstreamResponse.status, data);
    return;
  }

  const payload = {
    month,
    phases: (data.days || []).map((dayRow) => ({
      day: Number(String(dayRow.calendar_date || "").slice(8, 10)),
      phase: dayRow.phase || null,
      moon_visual: dayRow.moon_visual || null
    }))
  };
  moonPhaseCache.set(cacheKey, payload);
  sendJson(response, 200, payload);
}

async function serveStatic(response, requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(__dirname, normalizedPath);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(__dirname)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const content = await readFile(resolvedPath);
    const extension = path.extname(resolvedPath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/config") {
      const config = await loadConfig();
      sendJson(response, 200, stripSecrets(config));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/transits/timeline") {
      const payload = await readRequestBody(request);
      await handleTimelineProxy(response, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/transits/insights") {
      const payload = await readRequestBody(request);
      await handleInsightsProxy(response, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ephemeris") {
      const payload = await readRequestBody(request);
      await handleEphemerisProxy(response, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/natal/chart-svg") {
      const payload = await readRequestBody(request);
      await handleNatalChartProxy(response, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/geo/search") {
      await handleGeoSearch(
        response,
        url.searchParams.get("q"),
        url.searchParams.get("limit"),
        url.searchParams.get("country")
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/moon/phases") {
      await handleMoonPhases(
        response,
        url.searchParams.get("month"),
        url.searchParams.get("lat"),
        url.searchParams.get("lon"),
        url.searchParams.get("moonColor"),
        url.searchParams.get("shadowColor")
      );
      return;
    }

    if (request.method !== "GET") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    await serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "Server error",
      details: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Transit calendar preview running at http://${HOST}:${PORT}`);
});
