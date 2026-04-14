const sharp = require('sharp');
const worldAtlas = require('world-atlas/countries-110m.json');
const { t } = require('./locale');

let geoModulesPromise = null;

function loadGeoModules() {
  if (!geoModulesPromise) {
    geoModulesPromise = Promise.all([
      import('d3-geo'),
      import('topojson-client')
    ]).then(([d3Geo, topojson]) => ({
      d3Geo,
      topojson
    }));
  }

  return geoModulesPromise;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toCoordinates(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const lat = [candidate.lat, candidate.latitude, candidate.y]
    .map(Number)
    .find((value) => Number.isFinite(value));
  const lng = [candidate.lng, candidate.lon, candidate.longitude, candidate.x]
    .map(Number)
    .find((value) => Number.isFinite(value));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

function inferLabel(candidate) {
  const label = [
    candidate.label,
    candidate.city,
    candidate.name,
    candidate.title,
    candidate.place,
    candidate.location_name
  ].find((value) => typeof value === 'string' && value.trim());

  return label ? String(label).trim() : null;
}

function inferScore(candidate) {
  const score = [candidate.score, candidate.total_score, candidate.value]
    .map(Number)
    .find((value) => Number.isFinite(value));

  return Number.isFinite(score) ? score : null;
}

function detectGeoJsonLine(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (candidate.type === 'LineString' && Array.isArray(candidate.coordinates)) {
    const coordinates = candidate.coordinates
      .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
      .filter((point) => point && isFiniteNumber(point[0]) && isFiniteNumber(point[1]));

    if (coordinates.length >= 2) {
      return {
        label: inferLabel(candidate) || 'Line',
        coordinates
      };
    }
  }

  if (candidate.type === 'Feature' && candidate.geometry) {
    const line = detectGeoJsonLine(candidate.geometry);

    if (line) {
      line.label = inferLabel(candidate.properties || candidate) || line.label;
      return line;
    }
  }

  return null;
}

function detectCoordinateArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length < 2) {
    return null;
  }

  const coordinates = candidate
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const lng = Number(point[0]);
        const lat = Number(point[1]);
        return isFiniteNumber(lat) && isFiniteNumber(lng) ? [lng, lat] : null;
      }

      const normalized = toCoordinates(point);
      return normalized ? [normalized.lng, normalized.lat] : null;
    })
    .filter(Boolean);

  return coordinates.length >= 2 ? coordinates : null;
}

function walk(value, visit, depth = 0, seen = new Set()) {
  if (depth > 8 || !value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit, depth + 1, seen);
    }
    return;
  }

  for (const nested of Object.values(value)) {
    walk(nested, visit, depth + 1, seen);
  }
}

function dedupeMarkers(markers) {
  const seen = new Set();
  return markers.filter((marker) => {
    const key = `${marker.label || 'unknown'}:${marker.lat.toFixed(3)}:${marker.lng.toFixed(3)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = line.coordinates
      .slice(0, 4)
      .map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`)
      .join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractMapData(toolResults, userText) {
  const markers = [];
  const lines = [];

  for (const toolResult of Array.isArray(toolResults) ? toolResults : []) {
    const payloads = [toolResult?.result?.structuredContent, toolResult?.result];

    for (const payload of payloads) {
      walk(payload, (candidate) => {
        const point = toCoordinates(candidate);
        if (point) {
          markers.push({
            ...point,
            label: inferLabel(candidate),
            score: inferScore(candidate),
            source: toolResult?.name || toolResult?.result?.tool || 'tool'
          });
        }

        const line = detectGeoJsonLine(candidate);
        if (line) {
          lines.push(line);
          return;
        }

        const coordinateArray = detectCoordinateArray(candidate.coordinates || candidate.points || candidate.path || candidate.line);
        if (coordinateArray) {
          lines.push({
            label: inferLabel(candidate) || 'Line',
            coordinates: coordinateArray
          });
        }
      });
    }
  }

  const normalizedMarkers = dedupeMarkers(markers)
    .sort((left, right) => {
      const leftScore = Number.isFinite(left.score) ? left.score : -Infinity;
      const rightScore = Number.isFinite(right.score) ? right.score : -Infinity;
      return rightScore - leftScore;
    })
    .slice(0, 12);
  const normalizedLines = dedupeLines(lines).slice(0, 8);

  if (normalizedMarkers.length === 0 && normalizedLines.length === 0) {
    return null;
  }

  return {
    markers: normalizedMarkers,
    lines: normalizedLines,
    focusFrance: /\bfrance\b|\bparis\b|\blyon\b|\bmarseille\b|\bbordeaux\b|\blille\b|\btoulouse\b|\bnice\b/i.test(String(userText || ''))
  };
}

function buildBoundsGeometry(data) {
  if (data.lines.length > 0) {
    return {
      type: 'FeatureCollection',
      features: data.lines.map((line) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: line.coordinates
        }
      }))
    };
  }

  const features = data.markers.map((marker) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [marker.lng, marker.lat]
    }
  }));

  if (features.length === 1) {
    const marker = data.markers[0];
    const lonRadius = data.focusFrance ? 6 : 20;
    const latRadius = data.focusFrance ? 4 : 12;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [marker.lng - lonRadius, marker.lat - latRadius],
          [marker.lng + lonRadius, marker.lat - latRadius],
          [marker.lng + lonRadius, marker.lat + latRadius],
          [marker.lng - lonRadius, marker.lat + latRadius],
          [marker.lng - lonRadius, marker.lat - latRadius]
        ]]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function scoreLabel(marker) {
  return Number.isFinite(marker.score) ? ` (${marker.score.toFixed(2)})` : '';
}

async function renderAstrocartographyMap({ locale = 'en', toolResults, userText }) {
  const data = extractMapData(toolResults, userText);

  if (!data) {
    return null;
  }

  const { d3Geo, topojson } = await loadGeoModules();
  const countries = topojson.feature(worldAtlas, worldAtlas.objects.countries);
  const width = 1200;
  const height = 720;
  const projection = d3Geo.geoMercator();
  const focus = buildBoundsGeometry(data);
  const padding = data.focusFrance ? 72 : 52;

  projection.fitExtent(
    [[padding, padding], [width - padding, height - padding]],
    focus.features.length > 0 ? focus : { type: 'Sphere' }
  );

  const path = d3Geo.geoPath(projection);
  const graticule = d3Geo.geoGraticule10();

  const lineColors = ['#d1495b', '#edae49', '#00798c', '#30638e', '#7a5195', '#ef476f', '#3a86ff', '#00b894'];

  const markerElements = data.markers.slice(0, 8).map((marker, index) => {
    const [x, y] = projection([marker.lng, marker.lat]);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return '';
    }

    const label = `${marker.label || `Point ${index + 1}`}${scoreLabel(marker)}`;
    const anchor = x > width - 220 ? 'end' : 'start';
    const dx = anchor === 'end' ? -14 : 14;
    const textX = x + dx;
    const textY = y - 10;

    return [
      `<circle cx="${x}" cy="${y}" r="6.5" fill="#0b132b" stroke="#ffffff" stroke-width="2.5" />`,
      `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="rgba(11,19,43,0.18)" stroke-width="2" />`,
      `<text x="${textX}" y="${textY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#102a43">${escapeXml(label)}</text>`
    ].join('');
  }).join('');

  const lineElements = data.lines.map((line, index) => {
    const feature = {
      type: 'LineString',
      coordinates: line.coordinates
    };
    const stroke = lineColors[index % lineColors.length];
    return `<path d="${path(feature)}" fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.86" />`;
  }).join('');

  const legend = data.lines.slice(0, 5).map((line, index) => {
    const y = 88 + index * 30;
    const stroke = lineColors[index % lineColors.length];
    return [
      `<line x1="58" y1="${y}" x2="98" y2="${y}" stroke="${stroke}" stroke-width="4" stroke-linecap="round" />`,
      `<text x="110" y="${y + 7}" font-family="Arial, sans-serif" font-size="20" fill="#243b53">${escapeXml(line.label || `Line ${index + 1}`)}</text>`
    ].join('');
  }).join('');

  const title = data.focusFrance
    ? t(locale, 'maps.franceTitle')
    : t(locale, 'maps.worldTitle');
  const subtitle = t(locale, 'maps.subtitle');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="24" fill="#ffffff" stroke="#d9e2ec" stroke-width="2" />
  <path d="${path({ type: 'Sphere' })}" fill="#eef6ff" />
  <path d="${path(graticule)}" fill="none" stroke="#d9e2ec" stroke-width="1" opacity="0.8" />
  <g fill="#dbe7f3" stroke="#b7c6d9" stroke-width="0.9">
    ${countries.features.map((feature) => `<path d="${path(feature)}" />`).join('')}
  </g>
  <g>${lineElements}</g>
  <g>${markerElements}</g>
  <text x="58" y="64" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#102a43">${escapeXml(title)}</text>
  <text x="58" y="94" font-family="Arial, sans-serif" font-size="20" fill="#486581">${escapeXml(subtitle)}</text>
  <g>${legend}</g>
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return {
    buffer,
    filename: 'astrocartography-map.png'
  };
}

module.exports = {
  renderAstrocartographyMap
};
