const { randomBytes } = require('node:crypto');
const { buildInteractiveAstroMapPayload } = require('./astroMap');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const payloadStore = new Map();

function getPublicBaseUrl() {
  return String(
    process.env.APP_BASE_URL ||
    process.env.WEBHOOK_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).trim().replace(/\/+$/, '');
}

function isInteractiveMapEnabled() {
  return Boolean(getPublicBaseUrl());
}

function getInteractiveMapPath(token) {
  return `/maps/astro/${token}`;
}

function getInteractiveMapUrl(token) {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl || !token) {
    return null;
  }

  return `${baseUrl}${getInteractiveMapPath(token)}`;
}

function getExpiryMs() {
  const configuredHours = Number(process.env.INTERACTIVE_MAP_TTL_HOURS || '');
  return Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours * 60 * 60 * 1000
    : DEFAULT_TTL_MS;
}

function pruneExpiredPayloads() {
  const now = Date.now();
  for (const [token, entry] of payloadStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      payloadStore.delete(token);
    }
  }
}

function registerInteractiveAstroMap({ locale, toolResults, userText }) {
  if (!isInteractiveMapEnabled()) {
    return null;
  }

  const payload = buildInteractiveAstroMapPayload({
    locale,
    toolResults,
    userText
  });

  if (!payload) {
    return null;
  }

  pruneExpiredPayloads();

  const token = randomBytes(18).toString('base64url');
  payloadStore.set(token, {
    payload,
    expiresAt: Date.now() + getExpiryMs()
  });

  return getInteractiveMapUrl(token);
}

function getInteractiveAstroMapPayload(token) {
  pruneExpiredPayloads();

  const entry = payloadStore.get(String(token || ''));
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    payloadStore.delete(String(token || ''));
    return null;
  }

  return entry.payload;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializePayload(payload) {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function renderListItems(items, kind) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const label = escapeHtml(item.label || `${kind} ${index + 1}`);
    const color = escapeHtml(item.color || '#334155');
    const score = typeof item.score === 'number' ? ` (${item.score.toFixed(2)})` : '';
    const distance = typeof item.linkedLineDistanceKm === 'number'
      ? ` · ${item.linkedLineDistanceKm.toFixed(1)} km`
      : '';
    const extra = item.linkedLineLabel ? ` · ${escapeHtml(item.linkedLineLabel)}${distance}` : '';

    if (kind === 'place') {
      return `<button class="list-item place-item" type="button" data-marker-id="${escapeHtml(item.id)}"><span class="swatch" style="background:${color}"></span><span>${label}${escapeHtml(score)}${extra}</span></button>`;
    }

    if (kind === 'line') {
      return `<div class="list-item"><span class="swatch line-swatch" style="background:${color}"></span><span>${label}</span></div>`;
    }

    return `<div class="list-item"><span class="swatch crossing-swatch"></span><span>${label}</span></div>`;
  }).join('');
}

function renderInteractiveAstroMapPage(payload) {
  if (!payload) {
    return null;
  }

  const linesMarkup = renderListItems(payload.lineItems, 'line');
  const placesMarkup = renderListItems(payload.markerItems, 'place');
  const crossingsMarkup = renderListItems(payload.crossingItems, 'crossing');
  const payloadJson = serializePayload(payload);

  return `<!doctype html>
<html lang="${escapeHtml(payload.locale || 'en')}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.title || 'Astrocartography map')}</title>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
    <style>
      :root {
        color-scheme: light;
        --bg: #eef4fb;
        --panel: rgba(255,255,255,0.96);
        --panel-border: #d9e2ec;
        --text: #102a43;
        --muted: #486581;
        --accent: #2563eb;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; background: linear-gradient(180deg, #f6fbff 0%, #eef4fb 100%); color: var(--text); }
      .page { min-height: 100vh; display: grid; grid-template-columns: 360px 1fr; gap: 20px; padding: 20px; }
      .sidebar, .map-shell { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 22px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); overflow: hidden; }
      .sidebar { padding: 22px 18px; display: flex; flex-direction: column; gap: 18px; }
      .map-shell { position: relative; min-height: calc(100vh - 40px); }
      #map { position: absolute; inset: 0; }
      h1 { margin: 0; font-size: 30px; }
      .subtitle { margin: 6px 0 0; color: var(--muted); line-height: 1.45; }
      .section { display: flex; flex-direction: column; gap: 10px; }
      .section h2 { margin: 0; font-size: 18px; }
      .items { display: flex; flex-direction: column; gap: 8px; }
      .list-item { display: flex; align-items: center; gap: 10px; border: 1px solid #e6edf6; border-radius: 14px; padding: 10px 12px; background: #fff; color: var(--text); font-size: 15px; text-align: left; }
      .place-item { cursor: pointer; }
      .place-item:hover { border-color: #bfd2ea; background: #f8fbff; }
      .swatch { width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; }
      .line-swatch { width: 28px; height: 3px; border-radius: 999px; }
      .crossing-swatch { background: #7c3aed; border: 2px solid #7c3aed; width: 10px; height: 10px; position: relative; }
      .crossing-swatch::before, .crossing-swatch::after { content: ""; position: absolute; inset: -3px 3px 3px -3px; border-top: 2px solid #7c3aed; transform: rotate(45deg); }
      .crossing-swatch::after { transform: rotate(-45deg); inset: -3px 3px 3px -3px; }
      .toolbar { position: absolute; top: 18px; right: 18px; z-index: 2; display: flex; gap: 10px; }
      .toolbar button { border: none; background: rgba(255,255,255,0.94); color: var(--text); border-radius: 999px; padding: 10px 14px; font-size: 14px; cursor: pointer; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
      .toolbar button:hover { background: #fff; }
      .map-note { position: absolute; left: 18px; bottom: 18px; z-index: 2; background: rgba(255,255,255,0.94); border-radius: 14px; padding: 10px 12px; color: var(--muted); font-size: 13px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
      @media (max-width: 980px) {
        .page { grid-template-columns: 1fr; }
        .map-shell { min-height: 68vh; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <aside class="sidebar">
        <div>
          <h1>${escapeHtml(payload.title || 'Astrocartography map')}</h1>
          <p class="subtitle">${escapeHtml(payload.subtitle || '')}</p>
        </div>
        <section class="section">
          <h2>${escapeHtml(payload.legends?.lines || 'Relevant lines')}</h2>
          <div class="items">${linesMarkup || ''}</div>
        </section>
        ${payload.crossingItems?.length ? `<section class="section"><h2>${escapeHtml(payload.legends?.crossings || 'Relevant crossings')}</h2><div class="items">${crossingsMarkup}</div></section>` : ''}
        <section class="section">
          <h2>${escapeHtml(payload.legends?.places || 'Relevant places')}</h2>
          <div class="items">${placesMarkup || ''}</div>
        </section>
      </aside>
      <section class="map-shell">
        <div class="toolbar">
          <button type="button" id="reset-view">${escapeHtml(payload.ui?.resetView || 'Reset view')}</button>
        </div>
        <div id="map"></div>
        <div class="map-note">${escapeHtml(payload.ui?.interactiveNote || 'Use the map controls to zoom, then click a city or line for details.')}</div>
      </section>
    </div>
    <script id="astro-map-payload" type="application/json">${payloadJson}</script>
    <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
    <script>
      const payload = JSON.parse(document.getElementById('astro-map-payload').textContent);
      const baseStyle = {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm' }
        ]
      };

      const map = new maplibregl.Map({
        container: 'map',
        style: baseStyle,
        center: [0, 20],
        zoom: 1.3
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

      const initialBounds = [
        [payload.bounds.minLng, payload.bounds.minLat],
        [payload.bounds.maxLng, payload.bounds.maxLat]
      ];

      function fitInitialBounds() {
        map.fitBounds(initialBounds, {
          padding: { top: 80, right: 50, bottom: 50, left: 50 },
          duration: 0,
          maxZoom: payload.focusFrance ? 5.8 : 2.4
        });
      }

      function addPopup(feature, lngLat, html) {
        new maplibregl.Popup({ closeButton: false, closeOnMove: true })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);
      }

      map.on('load', () => {
        map.addSource('astro-lines', { type: 'geojson', data: payload.lines });
        map.addSource('astro-markers', { type: 'geojson', data: payload.markers });
        map.addSource('astro-crossings', { type: 'geojson', data: payload.crossings });

        map.addLayer({
          id: 'astro-lines',
          type: 'line',
          source: 'astro-lines',
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
            'line-width': [
              'case',
              ['==', ['get', 'emphasis'], 'primary'], 4,
              ['==', ['get', 'visualWeight'], 'low'], 2,
              2.8
            ],
            'line-opacity': [
              'case',
              ['==', ['get', 'emphasis'], 'primary'], 0.95,
              ['==', ['get', 'visualWeight'], 'low'], 0.38,
              0.62
            ]
          }
        });

        map.addLayer({
          id: 'astro-crossings',
          type: 'circle',
          source: 'astro-crossings',
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#7c3aed'
          }
        });

        map.addLayer({
          id: 'astro-markers',
          type: 'circle',
          source: 'astro-markers',
          paint: {
            'circle-radius': 6.5,
            'circle-color': ['coalesce', ['get', 'color'], '#111827'],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        map.addLayer({
          id: 'astro-marker-labels',
          type: 'symbol',
          source: 'astro-markers',
          minzoom: 3.2,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Arial Unicode MS Regular'],
            'text-size': 13,
            'text-offset': [0, 1.1],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#102a43',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.2
          }
        });

        fitInitialBounds();

        map.on('click', 'astro-markers', (event) => {
          const feature = event.features && event.features[0];
          if (!feature) return;
          const props = feature.properties || {};
          const score = props.score ? '<br/>Score: ' + Number(props.score).toFixed(2) : '';
          const line = props.linkedLineLabel ? '<br/>Linked line: ' + props.linkedLineLabel : '';
          const distance = props.linkedLineDistanceKm ? '<br/>Distance: ' + Number(props.linkedLineDistanceKm).toFixed(1) + ' km' : '';
          addPopup(feature, event.lngLat, '<strong>' + props.label + '</strong>' + score + line + distance);
        });

        map.on('click', 'astro-lines', (event) => {
          const feature = event.features && event.features[0];
          if (!feature) return;
          const props = feature.properties || {};
          const emphasis = props.emphasis ? '<br/>Role: ' + props.emphasis : '';
          addPopup(feature, event.lngLat, '<strong>' + props.label + '</strong>' + emphasis);
        });

        map.on('click', 'astro-crossings', (event) => {
          const feature = event.features && event.features[0];
          if (!feature) return;
          const props = feature.properties || {};
          const distance = props.distanceKm ? '<br/>Distance: ' + Number(props.distanceKm).toFixed(1) + ' km' : '';
          addPopup(feature, event.lngLat, '<strong>' + props.label + '</strong>' + distance);
        });

        Array.from(document.querySelectorAll('[data-marker-id]')).forEach((button) => {
          button.addEventListener('click', () => {
            const markerId = button.getAttribute('data-marker-id');
            const feature = payload.markers.features.find((entry) => entry.properties && entry.properties.id === markerId);
            if (!feature) return;
            const [lng, lat] = feature.geometry.coordinates;
            map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), payload.focusFrance ? 6.2 : 4.8), essential: true });
          });
        });

        document.getElementById('reset-view').addEventListener('click', fitInitialBounds);
      });
    </script>
  </body>
</html>`;
}

function renderInteractiveAstroMapNotFoundPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Interactive map unavailable</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #eef4fb; color: #102a43; }
      main { max-width: 640px; margin: 12vh auto; padding: 32px 28px; background: rgba(255,255,255,0.96); border: 1px solid #d9e2ec; border-radius: 22px; }
      h1 { margin-top: 0; font-size: 32px; }
      p { color: #486581; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>Interactive map unavailable</h1>
      <p>This link is missing or expired. Generate a fresh map from the bot to open a new interactive view.</p>
    </main>
  </body>
</html>`;
}

module.exports = {
  getInteractiveAstroMapPayload,
  getInteractiveMapPath,
  getInteractiveMapUrl,
  isInteractiveMapEnabled,
  registerInteractiveAstroMap,
  renderInteractiveAstroMapNotFoundPage,
  renderInteractiveAstroMapPage
};
