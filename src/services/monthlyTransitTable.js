const sharp = require('sharp');

const DEFAULT_COLUMNS = [
  { key: 'title', label: 'Transit', width: 520 },
  { key: 'window', label: 'Window', width: 390 },
  { key: 'peak', label: 'Peak / exact', width: 340 },
  { key: 'houses', label: 'Houses / notes', width: 360 }
];

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function wrapText(value, maxChars) {
  const words = normalizeText(value).split(/\s+/).filter(Boolean);
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

function truncateCaption(value) {
  const text = normalizeText(value);
  return text.length > 900 ? `${text.slice(0, 897)}...` : text;
}

function chunkRows(rows, pageSize) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += pageSize) {
    chunks.push(rows.slice(index, index + pageSize));
  }
  return chunks;
}

function buildCellLines(row, column) {
  const maxChars = Math.max(12, Math.floor(column.width / 9));
  return wrapText(row[column.key], maxChars).slice(0, 5);
}

async function renderMonthlyTransitPage(payload, rows, pageIndex, pageCount) {
  const columns = Array.isArray(payload?.columns) && payload.columns.length > 0
    ? payload.columns.map((column, index) => ({
        ...DEFAULT_COLUMNS[index],
        ...column,
        width: Number(column.width || DEFAULT_COLUMNS[index]?.width || 260)
      }))
    : DEFAULT_COLUMNS;
  const title = normalizeText(payload?.title) || 'Monthly transits';
  const subtitleParts = [
    normalizeText(payload?.month),
    `${payload?.totalRows || rows.length} transits`,
    pageCount > 1 ? `page ${pageIndex + 1} of ${pageCount}` : null
  ].filter(Boolean);
  const subtitle = subtitleParts.join(' / ');
  const marginX = 28;
  const topH = 112;
  const headerH = 44;
  const rowGap = 0;
  const lineH = 22;
  const totalColumnWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const width = totalColumnWidth + marginX * 2;
  const rowModels = rows.map((row, rowIndex) => {
    const cells = columns.map((column) => ({
      column,
      lines: buildCellLines(row, column)
    }));
    const maxLines = Math.max(...cells.map((cell) => cell.lines.length));
    return {
      index: rowIndex,
      cells,
      height: Math.max(56, 20 + maxLines * lineH)
    };
  });
  const tableH = headerH + rowModels.reduce((sum, row) => sum + row.height + rowGap, 0);
  const height = Math.max(220, topH + tableH + 34);
  let x = marginX;
  const headerCells = columns.map((column) => {
    const cell = `<text x="${x + 10}" y="${topH + 28}" class="head">${escapeXml(column.label)}</text>`;
    x += column.width;
    return cell;
  }).join('\n');

  let y = topH + headerH;
  const bodyRows = rowModels.map((row) => {
    const rowY = y;
    y += row.height + rowGap;
    let cellX = marginX;
    const fill = row.index % 2 === 0 ? '#ffffff' : '#f5f8f6';
    const cells = row.cells.map((cell) => {
      const text = cell.lines.map((line, lineIndex) => (
        `<text x="${cellX + 10}" y="${rowY + 25 + lineIndex * lineH}" class="${cell.column.key === 'title' ? 'strong cell' : 'cell'}">${escapeXml(line)}</text>`
      )).join('\n');
      const borderX = cellX;
      cellX += cell.column.width;
      return `${text}<line x1="${borderX}" y1="${rowY}" x2="${borderX}" y2="${rowY + row.height}" class="grid"/>`;
    }).join('\n');
    return [
      `<rect x="${marginX}" y="${rowY}" width="${totalColumnWidth}" height="${row.height}" fill="${fill}"/>`,
      cells,
      `<line x1="${marginX}" y1="${rowY + row.height}" x2="${marginX + totalColumnWidth}" y2="${rowY + row.height}" class="grid"/>`
    ].join('\n');
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title{font:700 30px Arial, sans-serif;fill:#173f35}
    .sub{font:18px Arial, sans-serif;fill:#5b6b66}
    .head{font:700 17px Arial, sans-serif;fill:#173f35}
    .cell{font:16px Arial, sans-serif;fill:#18211f}
    .strong{font-weight:700}
    .grid{stroke:#d7dfdc;stroke-width:1}
  </style>
  <rect width="100%" height="100%" fill="#fbfcfa"/>
  <text x="${marginX}" y="42" class="title">${escapeXml(title)}</text>
  <text x="${marginX}" y="72" class="sub">${escapeXml(subtitle)}</text>
  <rect x="${marginX}" y="${topH}" width="${totalColumnWidth}" height="${headerH}" fill="#e7eee9"/>
  ${headerCells}
  ${bodyRows}
  <line x1="${marginX + totalColumnWidth}" y1="${topH}" x2="${marginX + totalColumnWidth}" y2="${topH + tableH}" class="grid"/>
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const suffix = pageCount > 1 ? `-${pageIndex + 1}` : '';
  return {
    buffer,
    filename: `monthly-transits${suffix}.png`,
    caption: truncateCaption(pageCount > 1 ? `${title} (${pageIndex + 1}/${pageCount})` : title)
  };
}

async function renderMonthlyTransitsPng(payload, options = {}) {
  const rows = Array.isArray(payload?.rows)
    ? payload.rows.map((row) => ({
        title: normalizeText(row.title || row.transit || row.focus),
        window: normalizeText(row.window),
        peak: normalizeText(row.peak || row.exact),
        houses: normalizeText([row.houses, row.notes].filter(Boolean).join(' / '))
      })).filter((row) => row.title || row.window || row.peak || row.houses)
    : [];

  if (rows.length === 0) {
    return [];
  }

  const pageSize = Math.max(8, Math.min(Number(options.pageSize || 30), 45));
  const pages = chunkRows(rows, pageSize);
  const normalizedPayload = {
    ...payload,
    totalRows: rows.length
  };

  return Promise.all(
    pages.map((pageRows, pageIndex) => renderMonthlyTransitPage(normalizedPayload, pageRows, pageIndex, pages.length))
  );
}

module.exports = {
  renderMonthlyTransitsPng
};
