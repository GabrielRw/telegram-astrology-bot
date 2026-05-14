const sharp = require('sharp');

const DEFAULT_BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Chiron', 'Lilith', 'Mean_Lilith'];
const BODY_SYMBOLS = {
  Sun: 'Sun',
  Moon: 'Moon',
  Mercury: 'Mercury',
  Venus: 'Venus',
  Mars: 'Mars',
  Jupiter: 'Jupiter',
  Saturn: 'Saturn',
  Uranus: 'Uranus',
  Neptune: 'Neptune',
  Pluto: 'Pluto',
  Chiron: 'Chiron',
  Lilith: 'Lilith',
  Mean_Lilith: 'Mean Lilith'
};
const SIGN_ABBR = {
  Aries: 'Ari',
  Taurus: 'Tau',
  Gemini: 'Gem',
  Cancer: 'Can',
  Leo: 'Leo',
  Virgo: 'Vir',
  Libra: 'Lib',
  Scorpio: 'Sco',
  Sagittarius: 'Sag',
  Capricorn: 'Cap',
  Aquarius: 'Aqu',
  Pisces: 'Pis'
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPayload(resultOrPayload) {
  return resultOrPayload?.structuredContent || resultOrPayload?.payload || resultOrPayload?.data?.meta
    ? resultOrPayload.data
    : resultOrPayload?.result?.structuredContent || resultOrPayload?.result || resultOrPayload;
}

function getRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return payload?.data && typeof payload.data === 'object' ? [payload.data] : [];
}

function getBodies(payload) {
  const configured = Array.isArray(payload?.meta?.bodies) && payload.meta.bodies.length > 0
    ? payload.meta.bodies
    : DEFAULT_BODIES;
  return configured.filter((body) => DEFAULT_BODIES.includes(body));
}

function formatDate(row) {
  const source = String(row?.local_timestamp || row?.timestamp || '').slice(0, 10);
  return source || '';
}

function formatPosition(body) {
  if (!body) {
    return '';
  }
  const sign = body.sign || body.sign_name || '';
  const pos = Number(body.pos);
  if (!Number.isFinite(pos)) {
    return sign || '';
  }
  const degrees = Math.floor(Math.abs(pos));
  const minutes = Math.floor((Math.abs(pos) - degrees) * 60);
  const rx = body.retrograde ? 'R' : '';
  return `${degrees}${String.fromCharCode(176)}${String(minutes).padStart(2, '0')} ${SIGN_ABBR[sign] || sign.slice(0, 3)}${rx}`;
}

function summarizeEphemeris(payload) {
  const rows = getRows(payload);
  const bodies = getBodies(payload);
  const meta = payload?.meta || {};
  const ingresses = [];
  const stations = [];
  const moonPhases = [];

  for (let index = 1; index < rows.length; index += 1) {
    const previousBodies = rows[index - 1]?.bodies || {};
    const currentBodies = rows[index]?.bodies || {};
    const date = formatDate(rows[index]);

    for (const bodyName of bodies) {
      const previous = previousBodies[bodyName] || previousBodies[bodyName.toLowerCase()];
      const current = currentBodies[bodyName] || currentBodies[bodyName.toLowerCase()];
      if (!previous || !current) {
        continue;
      }
      if (previous.sign && current.sign && previous.sign !== current.sign) {
        ingresses.push(`${date}: ${bodyName} enters ${current.sign}`);
      }
      if (previous.retrograde !== current.retrograde) {
        stations.push(`${date}: ${bodyName} stations ${current.retrograde ? 'retrograde' : 'direct'}`);
      }
    }
  }

  for (const row of rows) {
    const label = row?.astrology?.moon_phase?.label;
    if (label && !moonPhases.some((item) => item.includes(label))) {
      moonPhases.push(`${formatDate(row)}: ${label}`);
    }
  }

  return {
    title: `Ephemeris for ${meta.start || '?'} to ${meta.end || '?'}`,
    basis: `${meta.zodiac_type || 'tropical'} zodiac, ${meta.timezone || 'GMT/UTC'} daily positions, ${meta.step || '1d'} step`,
    rows: rows.length,
    ingresses,
    stations,
    moonPhases
  };
}

function buildEphemerisSummaryText(payload) {
  const summary = summarizeEphemeris(payload);
  const lines = [
    summary.title,
    '',
    `Basis: ${summary.basis}. Rows: ${summary.rows}.`,
    '',
    'Sign changes:',
    ...(summary.ingresses.length ? summary.ingresses.slice(0, 12) : ['None detected in the returned month data.']),
    '',
    'Stations / retrograde changes:',
    ...(summary.stations.length ? summary.stations.slice(0, 12) : ['None detected in the returned month data.']),
    '',
    'Moon phase markers:',
    ...(summary.moonPhases.length ? summary.moonPhases.slice(0, 8) : ['No moon phase markers returned.']),
    '',
    'I attached the full daily month table as an image.'
  ];
  return lines.join('\n');
}

function buildEphemerisWebAppUrl(payload) {
  const start = String(payload?.meta?.start || '').slice(0, 7);
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}$/.test(start)) {
    params.set('month', start);
  }
  params.set('zodiac', String(payload?.meta?.zodiac_type || 'tropical').toLowerCase());
  const bodies = getBodies(payload).map((body) => body.toLowerCase()).join(',');
  if (bodies) {
    params.set('bodies', bodies);
  }
  const query = params.toString();
  return `https://www.freeastroapi.com/tools/western/ephemeris-table${query ? `?${query}` : ''}`;
}

async function renderEphemerisMonthPng(payload) {
  const rows = getRows(payload);
  const bodies = getBodies(payload);
  const meta = payload?.meta || {};
  const isSingleDay = rows.length <= 1 || (meta.start && meta.end && meta.start === meta.end);
  const cellW = 140;
  const rowH = 34;
  const leftW = 122;
  const topH = 112;
  const width = leftW + bodies.length * cellW + 48;
  const height = topH + (rows.length + 1) * rowH + 56;
  const tableRows = rows.map((row, rowIndex) => {
    const rowY = topH + rowIndex * rowH;
    const textY = rowY + 22;
    const fill = rowIndex % 2 === 0 ? '#ffffff' : '#f5f8f6';
    const bodyCells = bodies.map((bodyName, bodyIndex) => {
      const body = row?.bodies?.[bodyName] || row?.bodies?.[bodyName.toLowerCase()];
      const x = leftW + bodyIndex * cellW;
      return `<text x="${x + 10}" y="${textY}" class="cell">${escapeXml(formatPosition(body))}</text>`;
    }).join('');
    return `<rect x="24" y="${rowY}" width="${width - 48}" height="${rowH}" fill="${fill}"/>
      <text x="34" y="${textY}" class="date">${escapeXml(formatDate(row))}</text>${bodyCells}`;
  }).join('');
  const headerCells = bodies.map((bodyName, index) => {
    const x = leftW + index * cellW;
    return `<text x="${x + 10}" y="${topH - 12}" class="head">${escapeXml(BODY_SYMBOLS[bodyName] || bodyName)}</text>`;
  }).join('');
  const tableBottomY = topH + rows.length * rowH;
  const gridLines = bodies.map((_, index) => {
    const x = leftW + index * cellW;
    return `<line x1="${x}" y1="${topH - rowH}" x2="${x}" y2="${tableBottomY}" class="grid"/>`;
  }).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title{font:700 30px Arial, sans-serif;fill:#173f35}
    .sub{font:18px Arial, sans-serif;fill:#5b6b66}
    .head{font:700 18px Arial, sans-serif;fill:#173f35}
    .date{font:700 16px Arial, sans-serif;fill:#24332f}
    .cell{font:16px Arial, sans-serif;fill:#18211f}
    .grid{stroke:#d7dfdc;stroke-width:1}
  </style>
  <rect width="100%" height="100%" fill="#fbfcfa"/>
  <text x="24" y="42" class="title">${isSingleDay ? 'Daily ephemeris' : 'Monthly ephemeris'}</text>
  <text x="24" y="72" class="sub">${escapeXml(`${meta.start || '?'} to ${meta.end || '?'} · ${meta.zodiac_type || 'tropical'} · ${meta.timezone || 'GMT/UTC'}`)}</text>
  <rect x="24" y="${topH - rowH}" width="${width - 48}" height="${rowH}" fill="#e7eee9"/>
  <text x="34" y="${topH - 12}" class="head">Date</text>
  ${headerCells}
  ${gridLines}
  ${tableRows}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  buildEphemerisSummaryText,
  buildEphemerisWebAppUrl,
  renderEphemerisMonthPng
};
