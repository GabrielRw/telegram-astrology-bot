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
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const nestedLocation = candidate.location && typeof candidate.location === 'object'
    ? inferLabel(candidate.location)
    : null;
  if (nestedLocation) {
    return nestedLocation;
  }

  const cityCountry = [
    candidate.city,
    candidate.country
  ].filter((value) => typeof value === 'string' && value.trim());
  if (cityCountry.length > 0) {
    return cityCountry.join(', ');
  }

  const label = [
    candidate.label,
    candidate.city,
    candidate.name,
    candidate.title,
    candidate.place,
    candidate.location_name,
    candidate.admin1,
    candidate.region,
    candidate.country
  ].find((value) => typeof value === 'string' && value.trim());

  return label ? String(label).trim() : null;
}

function isUsefulLabel(label) {
  if (!label) {
    return false;
  }

  return !/^(point|line|location)\s*\d*$/i.test(String(label).trim());
}

function inferScore(candidate) {
  const score = [candidate.score, candidate.total_score, candidate.value]
    .map(Number)
    .find((value) => Number.isFinite(value));

  return Number.isFinite(score) ? score : null;
}

function normalizeAstroTerm(value) {
  const normalized = String(value || '').trim().toLowerCase();

  const lookup = {
    asc: 'ASC',
    ascendant: 'ASC',
    rising: 'ASC',
    dsc: 'DSC',
    descendant: 'DSC',
    mc: 'MC',
    midheaven: 'MC',
    ic: 'IC',
    imum_coeli: 'IC',
    imumcoeli: 'IC',
    sun: 'Sun',
    moon: 'Moon',
    mercury: 'Mercury',
    venus: 'Venus',
    mars: 'Mars',
    jupiter: 'Jupiter',
    saturn: 'Saturn',
    uranus: 'Uranus',
    neptune: 'Neptune',
    pluto: 'Pluto',
    chiron: 'Chiron',
    node: 'Node',
    north_node: 'North Node',
    south_node: 'South Node'
  };

  return lookup[normalized] || null;
}

function inferLineLabel(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const direct = [
    candidate.name,
    candidate.label,
    candidate.title,
    candidate.line_name,
    candidate.line_label
  ].find((value) => typeof value === 'string' && value.trim());

  if (direct && !/^(line|location)\s*\d*$/i.test(String(direct).trim())) {
    return String(direct).trim();
  }

  const planet = normalizeAstroTerm(
    candidate.planet ||
    candidate.body ||
    candidate.p1 ||
    candidate.object ||
    candidate.line_planet ||
    candidate.line_body ||
    candidate.properties?.planet ||
    candidate.properties?.body
  );
  const angle = normalizeAstroTerm(
    candidate.angle ||
    candidate.axis ||
    candidate.line_type ||
    candidate.type ||
    candidate.position ||
    candidate.line_angle ||
    candidate.properties?.angle ||
    candidate.properties?.axis ||
    candidate.properties?.line_type ||
    candidate.properties?.type
  );

  if (planet && angle) {
    return `${planet} ${angle}`;
  }

  return null;
}

function getStructuredPayloads(toolResult) {
  return [
    toolResult?.structuredContent,
    toolResult?.result?.structuredContent,
    toolResult?.result
  ].filter((value) => value && typeof value === 'object');
}

function buildLineLabelFromParts(body, angle, fallback) {
  const normalizedBody = normalizeAstroTerm(body);
  const normalizedAngle = normalizeAstroTerm(angle);

  if (normalizedBody && normalizedAngle) {
    return `${normalizedBody} ${normalizedAngle}`;
  }

  return fallback || null;
}

function normalizeGeometryCoordinates(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return null;
  }

  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    const coordinates = geometry.coordinates
      .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
      .filter((point) => point && isFiniteNumber(point[0]) && isFiniteNumber(point[1]));

    return coordinates.length >= 2
      ? { type: 'LineString', coordinates }
      : null;
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    const segments = geometry.coordinates
      .map((segment) => Array.isArray(segment)
        ? segment
            .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
            .filter((point) => point && isFiniteNumber(point[0]) && isFiniteNumber(point[1]))
        : []
      )
      .filter((segment) => segment.length >= 2);

    return segments.length > 0
      ? { type: 'MultiLineString', coordinates: segments }
      : null;
  }

  return null;
}

function flattenGeometryCoordinates(geometry) {
  const normalized = normalizeGeometryCoordinates(geometry);
  if (!normalized) {
    return [];
  }

  return normalized.type === 'LineString'
    ? normalized.coordinates
    : normalized.coordinates.flat();
}

function parseApiLineEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const geometry = normalizeGeometryCoordinates(entry.geometry || entry);
  if (!geometry) {
    return null;
  }

  const flatCoordinates = flattenGeometryCoordinates(geometry);
  if (flatCoordinates.length < 2) {
    return null;
  }

  return {
    id: entry.id || null,
    label: buildLineLabelFromParts(entry.body, entry.angle, inferLineLabel(entry) || inferLabel(entry) || 'Line'),
    body: entry.body || null,
    angle: entry.angle || null,
    geometry,
    coordinates: flatCoordinates,
    quality: 'api'
  };
}

function parseNearestPoint(candidate) {
  const coordinates = candidate?.coordinates;
  if (candidate?.type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);

    if (isFiniteNumber(lat) && isFiniteNumber(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

function dedupeByLineId(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = item?.lineId || item?.line_id || item?.id;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeLineFactor(candidate, fallbackPolarity = null) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.line_id !== 'string') {
    return null;
  }

  return {
    lineId: candidate.line_id,
    body: candidate.body || null,
    angle: candidate.angle || null,
    polarity: candidate.polarity || fallbackPolarity || null,
    distanceKm: Number.isFinite(Number(candidate.distance_km)) ? Number(candidate.distance_km) : null,
    nearestPointOnLine: parseNearestPoint(candidate.nearest_point_on_line),
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
    weight: Number.isFinite(Number(candidate.weight)) ? Number(candidate.weight) : null
  };
}

function extractExplanatoryLines(result) {
  const factors = [
    ...(Array.isArray(result?.top_factors) ? result.top_factors.map((factor) => normalizeLineFactor(factor)) : []),
    normalizeLineFactor(result?.nearest_favorable_line, 'supportive'),
    normalizeLineFactor(result?.nearest_challenging_line, 'challenging')
  ].filter(Boolean);

  return dedupeByLineId(factors);
}

function extractMarkersFromResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((item) => {
      const city = item?.city;
      const point = toCoordinates(city);
      if (!point) {
        return null;
      }

      const label = [city?.name, city?.country].filter(Boolean).join(', ') || inferLabel(city);
      return {
        ...point,
        label,
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
        supportingLineId: typeof item.supporting_line_id === 'string' ? item.supporting_line_id : null,
        nearestPointOnLine: parseNearestPoint(item.nearest_point_on_line),
        distanceToLineKm: Number.isFinite(Number(item.distance_to_line_km)) ? Number(item.distance_to_line_km) : null,
        explanatoryLines: extractExplanatoryLines(item)
      };
    })
    .filter(Boolean);
}

function extractMarkerFromCityCheck(payload) {
  const point = toCoordinates(payload?.city);
  if (!point) {
    return null;
  }

  return {
    ...point,
    label: [payload.city?.name, payload.city?.country].filter(Boolean).join(', ') || inferLabel(payload.city),
    score: Number.isFinite(Number(payload.overall_score)) ? Number(payload.overall_score) : null,
    supportingLineId: null,
    nearestPointOnLine: null,
    distanceToLineKm: null,
    explanatoryLines: []
  };
}

function parseCrossingEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const point = parseNearestPoint(entry.point || entry.location || entry.geometry) || toCoordinates(entry);
  if (!point) {
    return null;
  }

  const lineIds = [
    entry.line_a_id,
    entry.line_b_id,
    entry.line1_id,
    entry.line2_id
  ].filter(Boolean);
  const label = [
    entry.label,
    entry.title,
    lineIds.join(' × ')
  ].find((value) => typeof value === 'string' && value.trim());

  return {
    ...point,
    label: label || 'Crossing',
    lineIds
  };
}

function lineLabelTerms(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function inferQuestionLineHints(userText) {
  const value = String(userText || '').toLowerCase();
  const hints = new Set();

  if (/\bcareer\b|\bwork\b|\bjob\b|\bprofession\b|\bprofessional\b|\bcarri[eè]re\b|\bvoie pro\b/i.test(value)) {
    ['sun', 'jupiter', 'saturn', 'mc'].forEach((term) => hints.add(term));
  }

  if (/\blove\b|\bromance\b|\brelationship\b|\bpartner\b|\bamour\b|\bromantique\b|\bcouple\b/i.test(value)) {
    ['venus', 'moon', 'dsc', 'descendant'].forEach((term) => hints.add(term));
  }

  if (/\bhome\b|\bfamily\b|\bfoyer\b|\bmaison\b|\bchez moi\b/i.test(value)) {
    ['moon', 'venus', 'ic'].forEach((term) => hints.add(term));
  }

  if (/\bspiritual\b|\bspirituel\b|\bâme\b|\bsoul\b|\bkarm/i.test(value)) {
    ['neptune', 'jupiter', 'ic', 'pluto'].forEach((term) => hints.add(term));
  }

  if (/\bhealth\b|\bsanté\b|\bwellbeing\b|\bbien[- ]?être\b/i.test(value)) {
    ['sun', 'moon', 'mars', 'asc', 'ascendant'].forEach((term) => hints.add(term));
  }

  if (/\basc\b|\bascendant\b|\brising\b|\bmc\b|\bic\b|\bdsc\b|\bdescendant\b/i.test(value)) {
    ['asc', 'ascendant', 'mc', 'ic', 'dsc', 'descendant'].forEach((term) => hints.add(term));
  }

  if (/\bvenus\b|\bmars\b|\bjupiter\b|\bsaturn\b|\bmoon\b|\bsun\b|\bmercury\b|\bneptune\b|\bpluto\b|\buranus\b/i.test(value)) {
    ['venus', 'mars', 'jupiter', 'saturn', 'moon', 'sun', 'mercury', 'neptune', 'pluto', 'uranus']
      .filter((term) => value.includes(term))
      .forEach((term) => hints.add(term));
  }

  return hints;
}

function lineSpan(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { lng: 0, lat: 0 };
  }

  const lngs = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);

  return {
    lng: Math.max(...lngs) - Math.min(...lngs),
    lat: Math.max(...lats) - Math.min(...lats)
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function haversineKm(a, b) {
  const earthRadiusKm = 6371;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const root = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(root)));
}

function interpolatePoint(a, b, t) {
  return {
    lng: a.lng + (b.lng - a.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t
  };
}

function geographicToCartesian(coordinate) {
  const lng = toRadians(coordinate[0]);
  const lat = toRadians(coordinate[1]);
  const cosLat = Math.cos(lat);

  return [
    cosLat * Math.cos(lng),
    cosLat * Math.sin(lng),
    Math.sin(lat)
  ];
}

function cartesianToGeographic(vector) {
  const [x, y, z] = vector;
  const lng = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);
  return [toDegrees(lng), toDegrees(lat)];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector) {
  const length = Math.sqrt(dot(vector, vector));
  if (!Number.isFinite(length) || length < 1e-9) {
    return null;
  }

  return vector.map((value) => value / length);
}

function buildGreatCircleSamples(coordinates, samples = 360) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return [];
  }

  const start = geographicToCartesian(coordinates[0]);
  const end = geographicToCartesian(coordinates[coordinates.length - 1]);
  const normal = normalize(cross(start, end));

  if (!normal) {
    return coordinates.slice(0, 2);
  }

  const basisU = normalize(start);
  const basisV = normalize(cross(normal, basisU));

  if (!basisU || !basisV) {
    return coordinates.slice(0, 2);
  }

  const samplePoints = [];

  for (let index = 0; index <= samples; index += 1) {
    const angle = -Math.PI + (2 * Math.PI * index) / samples;
    const vector = [
      basisU[0] * Math.cos(angle) + basisV[0] * Math.sin(angle),
      basisU[1] * Math.cos(angle) + basisV[1] * Math.sin(angle),
      basisU[2] * Math.cos(angle) + basisV[2] * Math.sin(angle)
    ];

    samplePoints.push(cartesianToGeographic(vector));
  }

  return samplePoints;
}

function distancePointToLineKm(marker, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return Infinity;
  }

  let minDistance = Infinity;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = { lng: coordinates[index][0], lat: coordinates[index][1] };
    const end = { lng: coordinates[index + 1][0], lat: coordinates[index + 1][1] };

    for (let step = 0; step <= 24; step += 1) {
      const sample = interpolatePoint(start, end, step / 24);
      minDistance = Math.min(minDistance, haversineKm(marker, sample));
    }
  }

  return minDistance;
}

function isLineLikeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  return Boolean(
    inferLineLabel(candidate) ||
    candidate.line_name ||
    candidate.line_label ||
    candidate.planet ||
    candidate.angle ||
    candidate.axis ||
    candidate.line_type ||
    candidate.line_planet ||
    candidate.line_body ||
    candidate.properties?.planet ||
    candidate.properties?.angle
  );
}

function detectGeoJsonLine(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (candidate.type === 'LineString' && Array.isArray(candidate.coordinates)) {
    return parseApiLineEntry(candidate);
  }

  if (candidate.type === 'Feature' && candidate.geometry) {
    const line = detectGeoJsonLine(candidate.geometry);

    if (line) {
      line.label = inferLineLabel(candidate.properties || candidate) || inferLabel(candidate.properties || candidate) || line.label;
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

function buildFallbackLine(candidate, coordinates) {
  if (!isLineLikeCandidate(candidate) || !Array.isArray(coordinates) || coordinates.length < 3) {
    return null;
  }

  const label = inferLineLabel(candidate);
  if (!label) {
    return null;
  }

  const span = lineSpan(coordinates);
  if (span.lng < 0.5 && span.lat < 0.5) {
    return null;
  }

  return {
    label,
    coordinates,
    quality: 'approx'
  };
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
    const key = line.id || line.coordinates
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

function scoreLineRelevance(line, hints) {
  if (!line || !line.label) {
    return 0;
  }

  const terms = new Set(lineLabelTerms(line.label));
  let score = line.quality === 'real' ? 5 : 2;

  for (const hint of hints) {
    if (terms.has(hint)) {
      score += 4;
    }
  }

  if (terms.has('mc') || terms.has('ic') || terms.has('asc') || terms.has('dsc')) {
    score += 1;
  }

  score += Math.min((line.coordinates?.length || 0) / 4, 3);
  return score;
}

function selectDisplayedLines(lines, userText) {
  const hints = inferQuestionLineHints(userText);
  const scored = lines
    .filter((line) => line && Array.isArray(line.coordinates) && line.coordinates.length >= 2 && isUsefulLabel(line.label))
    .map((line) => ({
      ...line,
      relevanceScore: scoreLineRelevance(line, hints)
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  if (scored.length === 0) {
    return [];
  }

  if (hints.size === 0) {
    return scored.slice(0, 4);
  }

  const relevant = scored.filter((line) => line.relevanceScore >= 6);
  return (relevant.length > 0 ? relevant : scored.slice(0, 2)).slice(0, 4);
}

function attachMarkerLineRelationships(markers, candidateLines) {
  if (!Array.isArray(markers) || markers.length === 0 || !Array.isArray(candidateLines) || candidateLines.length === 0) {
    return {
      markers: markers || [],
      lines: []
    };
  }

  const linkedLines = new Map();
  const linkedMarkers = [];

  for (const marker of markers) {
    let bestLine = null;
    let bestDistance = Infinity;

    for (const line of candidateLines) {
      const distanceKm = distancePointToLineKm(marker, line.coordinates);
      if (distanceKm < bestDistance) {
        bestDistance = distanceKm;
        bestLine = line;
      }
    }

    if (!bestLine) {
      continue;
    }

    const enrichedMarker = {
      ...marker,
      linkedLineLabel: bestLine.label,
      linkedLineDistanceKm: bestDistance,
      linkedLineId: bestLine.id || null
    };

    linkedMarkers.push(enrichedMarker);
    linkedLines.set(bestLine.label, bestLine);
  }

  return {
    markers: linkedMarkers,
    lines: Array.from(linkedLines.values())
  };
}

function buildDisplayedLineSet(markers, normalizedLines, fallbackLines) {
  const lineById = new Map(normalizedLines.map((line) => [line.id, line]));
  const displayed = [];
  const seen = new Set();

  const pushLine = (line, meta = {}) => {
    if (!line) {
      return;
    }
    const key = line.id || `${line.label}:${line.coordinates?.[0]?.join(',')}`;
    if (seen.has(key)) {
      const existing = displayed.find((item) => (item.id || `${item.label}:${item.coordinates?.[0]?.join(',')}`) === key);
      if (existing && meta.emphasis === 'primary') {
        existing.emphasis = 'primary';
      }
      return;
    }

    seen.add(key);
    displayed.push({
      ...line,
      emphasis: meta.emphasis || 'secondary',
      polarity: meta.polarity || null,
      sourceCity: meta.sourceCity || null
    });
  };

  for (const marker of markers) {
    const explanatory = Array.isArray(marker.explanatoryLines) ? marker.explanatoryLines : [];
    const primaryId = marker.supportingLineId || explanatory[0]?.lineId || null;

    if (primaryId && lineById.has(primaryId)) {
      pushLine(lineById.get(primaryId), {
        emphasis: 'primary',
        polarity: explanatory.find((item) => item.lineId === primaryId)?.polarity || null,
        sourceCity: marker.label || null
      });
    }

    for (const factor of explanatory.slice(0, 3)) {
      const line = lineById.get(factor.lineId);
      if (!line) {
        continue;
      }

      pushLine(line, {
        emphasis: factor.lineId === primaryId ? 'primary' : 'secondary',
        polarity: factor.polarity || null,
        sourceCity: marker.label || null
      });
    }
  }

  if (displayed.length === 0) {
    return fallbackLines.slice(0, 4);
  }

  const primary = displayed.filter((line) => line.emphasis === 'primary');
  const secondary = displayed.filter((line) => line.emphasis !== 'primary');
  return [...primary.slice(0, 3), ...secondary.slice(0, 2)];
}

function extractMapData(toolResults, userText) {
  const markers = [];
  const lines = [];
  const crossings = [];

  for (const toolResult of Array.isArray(toolResults) ? toolResults : []) {
    const payloads = getStructuredPayloads(toolResult);

    for (const payload of payloads) {
      const explicitLines = [
        ...(Array.isArray(payload?.map?.lines) ? payload.map.lines : []),
        ...(Array.isArray(payload?.lines) ? payload.lines : [])
      ]
        .map((line) => parseApiLineEntry(line))
        .filter(Boolean);
      lines.push(...explicitLines);
      crossings.push(...((Array.isArray(payload?.map?.crossings) ? payload.map.crossings : [])
        .map((crossing) => parseCrossingEntry(crossing))
        .filter(Boolean)));

      markers.push(...extractMarkersFromResults(payload?.results));

      const cityCheckMarker = extractMarkerFromCityCheck(payload);
      if (cityCheckMarker) {
        markers.push(cityCheckMarker);
      }

      const hasExplicitMarkers = Array.isArray(payload?.results) || Boolean(payload?.city);
      const shouldUseFallbackWalk = explicitLines.length === 0 && !hasExplicitMarkers;

      if (shouldUseFallbackWalk) {
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
            const fallbackLine = buildFallbackLine(candidate, coordinateArray);
            if (fallbackLine) {
              lines.push(fallbackLine);
            }
          }
        });
      }
    }
  }

  const normalizedMarkers = dedupeMarkers(markers)
    .sort((left, right) => {
      const leftScore = Number.isFinite(left.score) ? left.score : -Infinity;
      const rightScore = Number.isFinite(right.score) ? right.score : -Infinity;
      return rightScore - leftScore;
    })
    .slice(0, 12);
  const normalizedLines = dedupeLines(lines);
  const labeledMarkers = normalizedMarkers.filter((marker) => isUsefulLabel(marker.label));
  const candidateLines = selectDisplayedLines(normalizedLines, userText);
  const basisMarkers = (labeledMarkers.length > 0 ? labeledMarkers : normalizedMarkers).slice(0, 5);
  const markersWithSupportingLine = basisMarkers.map((marker) => {
    if (!marker.supportingLineId) {
      return marker;
    }

    const matchedLine = normalizedLines.find((line) => line.id === marker.supportingLineId);
    if (!matchedLine) {
      return marker;
    }

    return {
      ...marker,
      linkedLineLabel: matchedLine.label,
      linkedLineId: matchedLine.id || null,
      linkedLineDistanceKm: marker.distanceToLineKm
    };
  });
  const explicitLinkedLineIds = new Set(markersWithSupportingLine
    .map((marker) => marker.linkedLineId)
    .filter(Boolean));
  const linked = attachMarkerLineRelationships(
    markersWithSupportingLine.filter((marker) => !marker.linkedLineId),
    normalizedLines
  );
  const displayedMarkers = [
    ...markersWithSupportingLine.filter((marker) => marker.linkedLineId),
    ...linked.markers
  ].slice(0, 5);
  const displayedLines = buildDisplayedLineSet(displayedMarkers, normalizedLines, candidateLines);
  const displayedLineIds = new Set(displayedLines.map((line) => line.id).filter(Boolean));
  const displayedCrossings = crossings
    .filter((crossing) => crossing.lineIds.some((lineId) => displayedLineIds.has(lineId)))
    .slice(0, 3);

  if (normalizedMarkers.length === 0 && displayedLines.length === 0) {
    return null;
  }

  return {
    markers: normalizedMarkers,
    labeledMarkers,
    displayedMarkers,
    lines: displayedLines,
    crossings: displayedCrossings,
    focusFrance: /\bfrance\b|\bparis\b|\blyon\b|\bmarseille\b|\bbordeaux\b|\blille\b|\btoulouse\b|\bnice\b/i.test(String(userText || ''))
  };
}

function buildBoundsGeometry(data) {
  if (data.focusFrance) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-6.5, 41.0],
              [10.5, 41.0],
              [10.5, 51.8],
              [-6.5, 51.8],
              [-6.5, 41.0]
            ]]
          }
        }
      ]
    };
  }

  if (data.lines.length > 0) {
    return {
      type: 'FeatureCollection',
      features: data.lines.map((line) => ({
        type: 'Feature',
        geometry: line.geometry
      }))
    };
  }

  const basisMarkers = data.labeledMarkers.length > 0 ? data.labeledMarkers : data.markers;
  const lngs = basisMarkers.map((marker) => marker.lng);
  const lats = basisMarkers.map((marker) => marker.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLng = Math.max(maxLng - minLng, data.focusFrance ? 12 : 18);
  const spanLat = Math.max(maxLat - minLat, data.focusFrance ? 8 : 12);
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  const features = [{
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [centerLng - spanLng / 2, centerLat - spanLat / 2],
        [centerLng + spanLng / 2, centerLat - spanLat / 2],
        [centerLng + spanLng / 2, centerLat + spanLat / 2],
        [centerLng - spanLng / 2, centerLat + spanLat / 2],
        [centerLng - spanLng / 2, centerLat - spanLat / 2]
      ]]
    }
  }];

  if (features.length === 1) {
    const marker = basisMarkers[0];
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

function getViewportBounds(data) {
  if (data.focusFrance) {
    return {
      minLng: -6.5,
      maxLng: 10.5,
      minLat: 41.0,
      maxLat: 51.8
    };
  }

  if (data.lines.length > 0) {
    return {
      minLng: -180,
      maxLng: 180,
      minLat: -85,
      maxLat: 85
    };
  }

  const basisMarkers = (data.labeledMarkers.length > 0 ? data.labeledMarkers : data.markers);
  if (basisMarkers.length === 0) {
    return {
      minLng: -25,
      maxLng: 25,
      minLat: 30,
      maxLat: 65
    };
  }

  const lngs = basisMarkers.map((marker) => marker.lng);
  const lats = basisMarkers.map((marker) => marker.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLng = Math.max(maxLng - minLng, 18);
  const spanLat = Math.max(maxLat - minLat, 12);
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  return {
    minLng: centerLng - spanLng / 2,
    maxLng: centerLng + spanLng / 2,
    minLat: centerLat - spanLat / 2,
    maxLat: centerLat + spanLat / 2
  };
}

function mercatorY(lat) {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function configureProjection(projection, bounds, mapFrame, padding) {
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const deltaLng = ((bounds.maxLng - bounds.minLng) * Math.PI) / 180;
  const deltaY = Math.abs(mercatorY(bounds.maxLat) - mercatorY(bounds.minLat));
  const usableWidth = mapFrame.width - padding * 2;
  const usableHeight = mapFrame.height - padding * 2;
  const scaleX = usableWidth / Math.max(deltaLng, 0.001);
  const scaleY = usableHeight / Math.max(deltaY, 0.001);
  const scale = Math.min(scaleX, scaleY);

  projection
    .center([centerLng, centerLat])
    .scale(scale)
    .translate([mapFrame.x + mapFrame.width / 2, mapFrame.y + mapFrame.height / 2]);
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

function estimateTextWidth(text, fontSize = 18) {
  return Math.max(60, text.length * (fontSize * 0.58));
}

function renderGeometryPath(path, geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return '';
  }

  if (geometry.type === 'LineString') {
    return path({
      type: 'Feature',
      geometry
    }) || '';
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((segment) => path({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: segment
        }
      }) || '')
      .join(' ');
  }

  return '';
}

async function renderAstrocartographyMap({ locale = 'en', toolResults, userText }) {
  const data = extractMapData(toolResults, userText);

  if (!data) {
    return null;
  }

  const { d3Geo, topojson } = await loadGeoModules();
  const countries = topojson.feature(worldAtlas, worldAtlas.objects.countries);
  const width = 1400;
  const height = 880;
  const headerX = 36;
  const headerY = 36;
  const headerW = width - 72;
  const headerH = 96;
  const mapX = 36;
  const mapY = 150;
  const mapW = 920;
  const mapH = height - mapY - 36;
  const panelX = 980;
  const panelY = 150;
  const panelW = width - panelX - 36;
  const panelH = height - panelY - 36;
  const projection = d3Geo.geoMercator();
  const padding = data.focusFrance ? 56 : 42;
  configureProjection(projection, getViewportBounds(data), {
    x: mapX,
    y: mapY,
    width: mapW,
    height: mapH
  }, padding);

  const path = d3Geo.geoPath(projection);
  const graticule = d3Geo.geoGraticule10();

  const lineColors = ['#ff5a5f', '#f4a261', '#2a9d8f', '#3a86ff', '#8338ec', '#ef476f', '#118ab2', '#06d6a0'];
  const displayedMarkers = (Array.isArray(data.displayedMarkers) && data.displayedMarkers.length > 0
    ? data.displayedMarkers
    : (data.labeledMarkers.length > 0 ? data.labeledMarkers : data.markers).slice(0, 5))
    .sort((left, right) => right.lat - left.lat);
  const labelOffsets = [-30, 18, 46, -18, 34];

  const markerElements = displayedMarkers.map((marker, index) => {
    const [x, y] = projection([marker.lng, marker.lat]);
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < mapX || x > mapX + mapW || y < mapY || y > mapY + mapH) {
      return '';
    }

    const linkedLineSuffix = marker.linkedLineLabel ? ` · ${marker.linkedLineLabel}` : '';
    const label = `${isUsefulLabel(marker.label) ? marker.label : `${marker.lat.toFixed(2)}, ${marker.lng.toFixed(2)}`}${scoreLabel(marker)}${linkedLineSuffix}`;
    const anchor = x > mapX + mapW - 240 ? 'end' : 'start';
    const dx = anchor === 'end' ? -18 : 18;
    const textX = x + dx;
    const textY = y + (labelOffsets[index] || 0);
    const fontSize = 18;
    const textWidth = estimateTextWidth(label, fontSize);
    const rectX = anchor === 'end' ? textX - textWidth - 18 : textX - 10;

    return [
      `<line x1="${x}" y1="${y}" x2="${textX + (anchor === 'end' ? -8 : 8)}" y2="${textY - 6}" stroke="#486581" stroke-width="2" opacity="0.65" />`,
      `<circle cx="${x}" cy="${y}" r="8" fill="#0b132b" stroke="#ffffff" stroke-width="3" />`,
      `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="rgba(11,19,43,0.12)" stroke-width="3" />`,
      `<rect x="${rectX}" y="${textY - 24}" width="${textWidth + 20}" height="34" rx="10" fill="rgba(255,255,255,0.92)" stroke="#d9e2ec" stroke-width="1.5" />`,
      `<text x="${textX}" y="${textY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#102a43">${escapeXml(label)}</text>`
    ].join('');
  }).join('');

  const connectorElements = displayedMarkers.map((marker) => {
    if (!marker.nearestPointOnLine) {
      return '';
    }

    const from = projection([marker.lng, marker.lat]);
    const to = projection([marker.nearestPointOnLine.lng, marker.nearestPointOnLine.lat]);
    if (!Array.isArray(from) || !Array.isArray(to)) {
      return '';
    }

    return `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="#829ab1" stroke-width="1.8" stroke-dasharray="6 6" opacity="0.85" />`;
  }).join('');

  const lineElements = data.lines.map((line, index) => {
    const stroke = lineColors[index % lineColors.length];
    const d = renderGeometryPath(path, line.geometry);
    if (!d) {
      return '';
    }

    const strokeWidth = line.emphasis === 'primary' ? 4.25 : 2.4;
    const opacity = line.emphasis === 'primary' ? 0.92 : 0.55;
    const dash = line.emphasis === 'primary'
      ? ''
      : line.polarity === 'challenging'
        ? ' stroke-dasharray="10 8"'
        : ' stroke-dasharray="4 8"';

    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${dash} />`;
  }).join('');

  const crossingElements = (data.crossings || []).map((crossing) => {
    const point = projection([crossing.lng, crossing.lat]);
    if (!Array.isArray(point)) {
      return '';
    }

    const [x, y] = point;
    return [
      `<circle cx="${x}" cy="${y}" r="7" fill="#ffffff" stroke="#7c3aed" stroke-width="3" />`,
      `<line x1="${x - 8}" y1="${y - 8}" x2="${x + 8}" y2="${y + 8}" stroke="#7c3aed" stroke-width="2.5" />`,
      `<line x1="${x + 8}" y1="${y - 8}" x2="${x - 8}" y2="${y + 8}" stroke="#7c3aed" stroke-width="2.5" />`
    ].join('');
  }).join('');

  const legend = data.lines.slice(0, 5).map((line, index) => {
    const y = panelY + 88 + index * 32;
    const stroke = lineColors[index % lineColors.length];
    const dash = line.emphasis === 'primary'
      ? ''
      : line.polarity === 'challenging'
        ? ' stroke-dasharray="10 8"'
        : ' stroke-dasharray="4 8"';
    return [
      `<line x1="${panelX + 28}" y1="${y}" x2="${panelX + 68}" y2="${y}" stroke="${stroke}" stroke-width="${line.emphasis === 'primary' ? 4 : 3}" stroke-linecap="round"${dash} />`,
      `<text x="${panelX + 80}" y="${y + 7}" font-family="Arial, sans-serif" font-size="20" fill="#243b53">${escapeXml(line.label || `Line ${index + 1}`)}</text>`
    ].join('');
  }).join('');

  const placeList = displayedMarkers.map((marker, index) => {
    const crossingOffset = (data.crossings || []).length > 0 ? 84 : 0;
    const y = panelY + 88 + (data.lines.length > 0 ? 220 : 0) + crossingOffset + index * 36;
    const color = lineColors[index % lineColors.length];
    const linkedLineSuffix = marker.linkedLineLabel ? ` · ${marker.linkedLineLabel}` : '';
    const label = `${isUsefulLabel(marker.label) ? marker.label : t(locale, 'maps.unnamedLocation')}${scoreLabel(marker)}${linkedLineSuffix}`;
    return [
      `<circle cx="${panelX + 28}" cy="${y - 6}" r="7" fill="${color}" />`,
      `<text x="${panelX + 46}" y="${y}" font-family="Arial, sans-serif" font-size="19" fill="#243b53">${escapeXml(label)}</text>`
    ].join('');
  }).join('');

  const crossingList = (data.crossings || []).map((crossing, index) => {
    const y = panelY + 88 + (data.lines.length > 0 ? 220 : 0) + index * 28;
    return [
      `<circle cx="${panelX + 28}" cy="${y - 6}" r="6" fill="#ffffff" stroke="#7c3aed" stroke-width="2.5" />`,
      `<text x="${panelX + 46}" y="${y}" font-family="Arial, sans-serif" font-size="17" fill="#5b21b6">${escapeXml(crossing.label)}</text>`
    ].join('');
  }).join('');

  const title = data.focusFrance
    ? t(locale, 'maps.franceTitle')
    : t(locale, 'maps.worldTitle');
  const subtitle = t(locale, 'maps.subtitle');
  const legendTitle = t(locale, 'maps.lineLegend');
  const placesTitle = t(locale, 'maps.placesLegend');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f8fbff" />
      <stop offset="100%" stop-color="#eef4fb" />
    </linearGradient>
    <clipPath id="mapClip">
      <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" rx="24" />
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="#ffffff" stroke="#d9e2ec" stroke-width="2" />
  <rect x="${headerX}" y="${headerY}" width="${headerW}" height="${headerH}" rx="24" fill="rgba(255,255,255,0.96)" stroke="#d9e2ec" stroke-width="1.5" />
  <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" rx="24" fill="#f8fbff" stroke="#d9e2ec" stroke-width="1.5" />
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="24" fill="#ffffff" stroke="#d9e2ec" stroke-width="1.5" />
  <g clip-path="url(#mapClip)">
    <path d="${path({ type: 'Sphere' })}" fill="#edf4fb" />
    <path d="${path(graticule)}" fill="none" stroke="#d7e3f1" stroke-width="1" opacity="0.7" />
    <g fill="#d8e5f3" stroke="#b7c6d9" stroke-width="0.9">
      ${countries.features.map((feature) => `<path d="${path(feature)}" />`).join('')}
    </g>
    <g>${lineElements}</g>
    <g>${connectorElements}</g>
    <g>${crossingElements}</g>
    <g>${markerElements}</g>
  </g>
  <text x="60" y="82" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#102a43">${escapeXml(title)}</text>
  <text x="60" y="116" font-family="Arial, sans-serif" font-size="21" fill="#486581">${escapeXml(subtitle)}</text>
  ${data.lines.length > 0 ? `<text x="${panelX + 28}" y="${panelY + 46}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#102a43">${escapeXml(legendTitle)}</text>` : ''}
  <g>${legend}</g>
  ${(data.crossings || []).length > 0 ? `<text x="${panelX + 28}" y="${panelY + (data.lines.length > 0 ? 190 : 46)}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#5b21b6">${escapeXml(t(locale, 'maps.crossingsLegend'))}</text>` : ''}
  <g>${crossingList}</g>
  <text x="${panelX + 28}" y="${panelY + (data.lines.length > 0 ? 190 : 46) + ((data.crossings || []).length > 0 ? 84 : 0)}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#102a43">${escapeXml(placesTitle)}</text>
  <g>${placeList}</g>
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
