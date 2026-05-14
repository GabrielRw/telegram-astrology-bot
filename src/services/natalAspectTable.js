const sharp = require('sharp');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(value, maxChars = 92) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

async function renderNatalAspectsPng({ title, lines }) {
  const items = Array.isArray(lines) ? lines.map((line) => String(line || '').trim()).filter(Boolean) : [];
  const rowGap = 8;
  const lineHeight = 24;
  const leftPad = 28;
  const topPad = 92;
  const width = 1280;
  const rows = items.map((line, index) => {
    const wrapped = wrapText(line);
    return {
      index,
      line,
      wrapped,
      height: Math.max(42, 18 + wrapped.length * lineHeight)
    };
  });
  const bodyHeight = rows.reduce((sum, row) => sum + row.height + rowGap, 0);
  const height = Math.max(220, topPad + bodyHeight + 34);
  let y = topPad;

  const rowSvg = rows.map((row) => {
    const rowY = y;
    y += row.height + rowGap;
    const fill = row.index % 2 === 0 ? '#ffffff' : '#f5f8f6';
    const textLines = row.wrapped.map((part, partIndex) => (
      `<text x="${leftPad + 58}" y="${rowY + 28 + partIndex * lineHeight}" class="cell">${escapeXml(part)}</text>`
    )).join('');
    return [
      `<rect x="24" y="${rowY}" width="${width - 48}" height="${row.height}" rx="8" fill="${fill}"/>`,
      `<text x="${leftPad}" y="${rowY + 28}" class="index">${row.index + 1}</text>`,
      textLines
    ].join('\n');
  }).join('\n');

  const subtitle = `${items.length} aspects`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title{font:700 32px Arial, sans-serif;fill:#173f35}
    .sub{font:18px Arial, sans-serif;fill:#5b6b66}
    .index{font:700 17px Arial, sans-serif;fill:#173f35}
    .cell{font:18px Arial, sans-serif;fill:#18211f}
  </style>
  <rect width="100%" height="100%" fill="#fbfcfa"/>
  <text x="24" y="42" class="title">${escapeXml(title || 'Natal aspects')}</text>
  <text x="24" y="72" class="sub">${escapeXml(subtitle)}</text>
  ${rowSvg}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  renderNatalAspectsPng
};
