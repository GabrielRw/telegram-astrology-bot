const sharp = require('sharp');

function unwrapPayload(payload) {
  if (payload?.structuredContent && typeof payload.structuredContent === 'object') {
    return payload.structuredContent;
  }
  if (payload?.result && typeof payload.result === 'object') {
    return payload.result;
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function extractMoonVisual(payload) {
  const data = unwrapPayload(payload);
  const visual = data.moon_visual || data.moonVisual || null;

  if (!visual || typeof visual !== 'object') {
    return null;
  }

  const svg = typeof visual.svg === 'string' ? visual.svg.trim() : '';
  if (!svg || !/^<svg[\s>]/i.test(svg)) {
    return null;
  }

  return {
    ...visual,
    svg
  };
}

function extractMoonPhaseName(payload) {
  const data = unwrapPayload(payload);
  return data?.moon_phase?.phaseName
    || data?.moon_phase?.phase_name
    || data?.phase?.name
    || data?.phase?.label
    || null;
}

async function renderMoonPhaseVisualPng(payload, options = {}) {
  const visual = extractMoonVisual(payload);
  if (!visual) {
    return null;
  }

  const size = Math.max(96, Math.min(Number(options.size || 320), 1024));
  const buffer = await sharp(Buffer.from(visual.svg))
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
  const phaseName = extractMoonPhaseName(payload);

  return {
    buffer,
    filename: 'current-moon-phase.png',
    caption: phaseName ? `Current Moon: ${phaseName}` : 'Current Moon phase'
  };
}

module.exports = {
  extractMoonVisual,
  renderMoonPhaseVisualPng
};
