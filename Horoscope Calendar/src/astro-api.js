export async function fetchTransitTimeline(payload) {
  const response = await fetch("/api/transits/timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const details = data && data.details ? ` ${data.details}` : "";
    throw new Error(`Transit API request failed with ${response.status}.${details}`);
  }

  return data;
}

export async function fetchTransitInsights(payload) {
  const response = await fetch("/api/transits/insights", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const details = data && data.details ? ` ${data.details}` : "";
    throw new Error(`Transit insights request failed with ${response.status}.${details}`);
  }

  return data;
}

export async function fetchEphemeris(payload) {
  const response = await fetch("/api/ephemeris", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const details = data && data.details ? ` ${data.details}` : "";
    throw new Error(`Ephemeris API request failed with ${response.status}.${details}`);
  }

  return data;
}

export async function fetchNatalChartSvg(payload) {
  const response = await fetch("/api/natal/chart-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    let details = "";
    try {
      const data = JSON.parse(text);
      details = data && data.details ? ` ${data.details}` : "";
    } catch {
      details = text ? ` ${text}` : "";
    }
    throw new Error(`Natal chart SVG request failed with ${response.status}.${details}`);
  }

  return text;
}

export async function searchCities(query, { limit = 8, country = "" } = {}) {
  const searchParams = new URLSearchParams({
    q: query,
    limit: String(limit)
  });

  if (country) {
    searchParams.set("country", country);
  }

  const response = await fetch(`/api/geo/search?${searchParams.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    const details = data && data.details ? ` ${data.details}` : "";
    throw new Error(`City lookup failed with ${response.status}.${details}`);
  }

  return data.results || [];
}

export async function fetchMoonPhases({ month, lat, lon, moonColor, shadowColor }) {
  const searchParams = new URLSearchParams({
    month
  });

  if (lat !== undefined && lat !== null) {
    searchParams.set("lat", String(lat));
  }

  if (lon !== undefined && lon !== null) {
    searchParams.set("lon", String(lon));
  }

  if (moonColor) {
    searchParams.set("moonColor", String(moonColor));
  }

  if (shadowColor) {
    searchParams.set("shadowColor", String(shadowColor));
  }

  const response = await fetch(`/api/moon/phases?${searchParams.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    const details = data && data.details ? ` ${data.details}` : "";
    throw new Error(`Moon phases request failed with ${response.status}.${details}`);
  }

  return data.phases || [];
}
