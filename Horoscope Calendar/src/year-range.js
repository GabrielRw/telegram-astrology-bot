const DAY_LENGTH_MS = 24 * 60 * 60 * 1000;

export function getYearWindow(yearValue) {
  const year = parseYearValue(yearValue);
  const startMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year + 1, 0, 1, 0, 0, 0, 0);

  return {
    year,
    totalDays: (endMs - startMs) / DAY_LENGTH_MS,
    rangeStart: `${String(year).padStart(4, "0")}-01-01`,
    rangeEnd: `${String(year).padStart(4, "0")}-12-31`,
    startMs,
    endMs
  };
}

export function clipUtcIntervalToWindow(startIso, endIso, window) {
  const rawStartMs = Date.parse(startIso);
  const rawEndMs = Date.parse(endIso);

  if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs) || rawEndMs <= rawStartMs) {
    return null;
  }

  const visibleStartMs = Math.max(rawStartMs, window.startMs);
  const visibleEndMs = Math.min(rawEndMs, window.endMs);
  if (visibleEndMs <= visibleStartMs) {
    return null;
  }

  return {
    rawStartMs,
    rawEndMs,
    visibleStartMs,
    visibleEndMs,
    startOffsetDays: (visibleStartMs - window.startMs) / DAY_LENGTH_MS,
    endOffsetDays: (visibleEndMs - window.startMs) / DAY_LENGTH_MS,
    continuesPrev: rawStartMs < window.startMs,
    continuesNext: rawEndMs > window.endMs,
    startsInWindow: rawStartMs >= window.startMs && rawStartMs < window.endMs,
    endsInWindow: rawEndMs > window.startMs && rawEndMs <= window.endMs
  };
}

export function filterIsoDatesToWindow(values, window) {
  return [...new Set((values || []).filter((value) => getUtcDayOffsetInWindow(value, window) !== null))]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

export function getUtcDayOffsetInWindow(isoDatetime, window) {
  const ms = Date.parse(isoDatetime);
  if (!Number.isFinite(ms) || ms < window.startMs || ms >= window.endMs) {
    return null;
  }

  return (ms - window.startMs) / DAY_LENGTH_MS;
}

function parseYearValue(yearValue) {
  const text = String(yearValue || "").trim();
  const match = /^(\d{4})(?:-\d{2})?$/.exec(text);

  if (!match) {
    throw new Error(`Invalid year value "${yearValue}". Expected YYYY or YYYY-MM.`);
  }

  return Number(match[1]);
}
