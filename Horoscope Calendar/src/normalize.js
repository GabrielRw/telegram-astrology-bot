import { clipUtcIntervalToWindow, filterIsoDatesToWindow, getYearWindow } from "./year-range.js";

const CATEGORY_RANK = {
  slow: 0,
  medium: 1,
  fast: 2
};

const PLANET_RANK = {
  sun: 0,
  moon: 1,
  mercury: 2,
  venus: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
  pluto: 9,
  north_node: 10,
  mean_node: 10,
  true_node: 10,
  chiron: 11,
  lilith: 12,
  mean_lilith: 12,
  true_lilith: 12
};

const ASPECT_RANK = {
  conjunction: 0,
  opposition: 1,
  square: 2,
  trine: 3,
  sextile: 4
};

const PLANET_LABELS = {
  ascendant: "Asc",
  chiron: "Chiron",
  descendant: "Desc",
  ic: "IC",
  jupiter: "Jupiter",
  mars: "Mars",
  lilith: "Lilith",
  mean_lilith: "Mean Lilith",
  mean_node: "Mean Node",
  mercury: "Mercury",
  midheaven: "MC",
  moon: "Moon",
  neptune: "Neptune",
  north_node: "North Node",
  pluto: "Pluto",
  saturn: "Saturn",
  sun: "Sun",
  true_lilith: "True Lilith",
  true_node: "True Node",
  uranus: "Uranus",
  venus: "Venus"
};

const PLANET_SYMBOLS = {
  ascendant: "Asc",
  chiron: "⚷",
  descendant: "Desc",
  ic: "IC",
  jupiter: "♃",
  mars: "♂",
  lilith: "⚸",
  mean_lilith: "⚸",
  mean_node: "☊",
  mercury: "☿",
  midheaven: "MC",
  moon: "☽",
  neptune: "♆",
  north_node: "☊",
  pluto: "♇",
  saturn: "♄",
  sun: "☉",
  true_lilith: "⚸",
  true_node: "☊",
  uranus: "♅",
  venus: "♀"
};
const SIGN_SYMBOLS = {
  aries: "♈",
  taurus: "♉",
  gemini: "♊",
  cancer: "♋",
  leo: "♌",
  virgo: "♍",
  libra: "♎",
  scorpio: "♏",
  sagittarius: "♐",
  capricorn: "♑",
  aquarius: "♒",
  pisces: "♓"
};

const ASPECT_LABELS = {
  conjunction: "conj.",
  opposition: "opp.",
  square: "square",
  trine: "trine",
  sextile: "sextile"
};

const ASPECT_DISPLAY_LABELS = {
  conjunction: "conjunct",
  opposition: "opposite",
  square: "square",
  trine: "trine",
  sextile: "sextile"
};

const ASPECT_SYMBOLS = {
  conjunction: "☌",
  opposition: "☍",
  square: "□",
  trine: "△",
  sextile: "✶"
};

const TRANSIT_PLANET_SCORE = {
  saturn: 18,
  pluto: 17,
  neptune: 16,
  uranus: 16,
  jupiter: 13,
  chiron: 11,
  mean_lilith: 10,
  north_node: 10,
  mean_node: 10,
  true_lilith: 10,
  true_node: 10,
  mars: 8,
  venus: 6,
  mercury: 6,
  sun: 4,
  moon: 3
};

const NATAL_POINT_SCORE = {
  ascendant: 14,
  midheaven: 14,
  sun: 13,
  moon: 13,
  descendant: 11,
  ic: 11,
  mercury: 8,
  venus: 8,
  mars: 8,
  jupiter: 6,
  saturn: 6,
  mean_lilith: 5,
  north_node: 5,
  mean_node: 5,
  true_lilith: 5,
  true_node: 5,
  chiron: 5,
  uranus: 4,
  neptune: 4,
  pluto: 4
};

const ASPECT_SCORE = {
  conjunction: 10,
  opposition: 9,
  square: 8,
  trine: 6,
  sextile: 4
};

const MAJOR_NATAL_POINTS = new Set(["ascendant", "midheaven", "sun", "moon", "descendant", "ic"]);
const PERSONAL_NATAL_POINTS = new Set(["mercury", "venus", "mars"]);
const MAJOR_TRANSIT_PLANETS = new Set(["saturn", "uranus", "neptune", "pluto", "chiron", "north_node", "mean_node", "true_node", "mean_lilith", "true_lilith"]);
const SOCIAL_TRANSIT_PLANETS = new Set(["jupiter", "mars"]);
const INSIGHT_CATEGORY_LABELS = {
  chart_pattern: "Chart Pattern",
  drive: "Drive",
  emotions: "Emotions",
  growth: "Growth",
  identity: "Identity",
  life_path: "Life Path",
  mind: "Mind",
  relationships: "Relationships",
  structure: "Structure",
  transformation: "Transformation"
};
const INSIGHT_KIND_SYMBOLS = {
  activation_cluster: "✳",
  angular_activation: "∠",
  background_theme_window: "◌",
  ingress: "↦",
  pressure_window: "□",
  retrograde_loop_phase: "℞",
  station: "S",
  stellium: "✦",
  support_window: "△"
};

export function normalizeTimeline(config, payload, apiResponse) {
  const sortedTransits = [...(apiResponse.transits || [])].sort(compareTransits);
  const dayCount = payload.daysInMonth;
  const monthDate = new Date(Date.UTC(payload.request.natal.year, 0, 1));
  void monthDate;

  const passRows = sortedTransits.map((transit, index) => {
    const startDay = clampDay(transit.visible_start_day, dayCount);
    const endDay = Math.max(startDay, clampDay(transit.visible_end_day, dayCount));
    const transitPlanetLabel = labelForKey(transit.transit_planet);
    const natalPointLabel = labelForKey(transit.natal_point);
    const transitPlanetSymbol = symbolForKey(transit.transit_planet);
    const natalPointSymbol = symbolForKey(transit.natal_point);
    const aspectLabel = ASPECT_LABELS[transit.aspect_type] || transit.aspect_type;
    const aspectDisplayLabel = ASPECT_DISPLAY_LABELS[transit.aspect_type] || aspectLabel;
    const aspectSymbol = ASPECT_SYMBOLS[transit.aspect_type] || aspectLabel;
    const shortText = `${transitPlanetLabel} ${aspectLabel} ${natalPointLabel}`;
    const exactHitsInMonth = transit.exact_hits_in_month || [];
    const startsThisMonth = !Boolean(transit.continues_from_previous_month);
    const endsThisMonth = !Boolean(transit.continues_to_next_month);
    const exactHitCount = exactHitsInMonth.length;

    return {
      id: transit.id,
      label: transit.label,
      shortLabel: shortText,
      entryLabel: `${transitPlanetLabel} ${aspectDisplayLabel} ${natalPointLabel}`,
      entrySymbols: `${transitPlanetSymbol} ${aspectSymbol} ${natalPointSymbol}`,
      transitPlanet: transit.transit_planet,
      transitPlanetLabel,
      transitPlanetSymbol,
      natalPoint: transit.natal_point,
      natalPointLabel,
      natalPointSymbol,
      groupLabel: transitPlanetLabel.toUpperCase(),
      groupSymbol: transitPlanetSymbol,
      aspectType: transit.aspect_type,
      category: transit.category,
      rowIndex: index,
      sourceRowIndex: index,
      startDay,
      endDay,
      continuesPrev: Boolean(transit.continues_from_previous_month),
      continuesNext: Boolean(transit.continues_to_next_month),
      exactHitCount,
      exactThisMonth: exactHitCount > 0,
      startsThisMonth,
      endsThisMonth,
      metadata: {
        exactDatetimes: transit.exact_datetimes,
        exactHitsInMonth,
        endDatetime: transit.end_datetime,
        houses: transit.houses || null,
        passType: transit.pass_type,
        startDatetime: transit.start_datetime
      }
    };
  });

  const rowsAll = mergeTransitPassRows(passRows).map((row, rowIndex) => {
    const houseDisplayLabel = config.filters?.includeHouseLabels ? getHouseDisplayLabel(row) : "";
    return {
      ...row,
      shortLabel: houseDisplayLabel ? `${row.shortLabel} · ${houseDisplayLabel}` : row.shortLabel,
      entryLabel: houseDisplayLabel ? `${row.entryLabel} · ${houseDisplayLabel}` : row.entryLabel,
      rowIndex,
      sourceRowIndex: rowIndex
    };
  });

  const scoredRows = rowsAll.map((row) => {
    const tier = getTransitTier(row);
    return {
      ...row,
      tier,
      score: scoreTransitRow(row, tier)
    };
  });
  const rows = selectDisplayRows(config, scoredRows);

  return {
    kind: "monthly",
    config,
    daysInMonth: dayCount,
    monthLabel: formatMonthLabel(config.month),
    requestLabel: buildRequestLabel(config),
    meta: apiResponse.meta,
    inputMode: apiResponse.input?.mode || "month",
    retrogrades: [],
    rowsAll: scoredRows,
    rows,
    groups: buildPlanetGroups(rows),
    legend: buildLegend(config)
  };
}

export function normalizeInsightsTimeline(config, payload, apiResponse) {
  const monthWindow = getInsightMonthWindow(config.month);
  const importanceByFactId = buildImportanceByFactId(apiResponse.importance || []);
  const ingressDisplayWindows = buildIngressDisplayWindows(apiResponse.facts || [], monthWindow);
  const rowsAll = reindexRows(orderInsightRows(
    [...(apiResponse.facts || [])]
      .map((fact, index) => normalizeInsightFactRow(
        fact,
        index,
        config,
        payload,
        monthWindow,
        importanceByFactId,
        ingressDisplayWindows.get(fact.id) || null
      ))
      .filter(Boolean)
      .map((row) => ({
        ...row,
        tier: 1,
        score: scoreInsightRow(row)
      }))
  ));
  const rows = reindexRows(orderInsightRows(selectInsightDisplayRows(config, rowsAll)));

  return {
    kind: "monthly_insights",
    config,
    daysInMonth: payload.daysInMonth,
    monthLabel: formatMonthLabel(config.month),
    requestLabel: buildRequestLabel(config),
    meta: apiResponse.meta,
    inputMode: apiResponse.meta?.mode || "month",
    retrogrades: [],
    rowsAll,
    rows,
    groups: buildPlanetGroups(rows),
    legend: buildLegend(config)
  };
}

export function normalizeYearlyTimeline(config, payload, apiResponse) {
  const sortedTransits = [...(apiResponse.transits || [])].sort(compareTransits);
  const yearWindow = getYearWindow(config.month);

  const passRows = sortedTransits.flatMap((transit, index) => {
    const clipped = clipUtcIntervalToWindow(transit.start_datetime, transit.end_datetime, yearWindow);
    if (!clipped) {
      return [];
    }

    const exactHitsInYear = filterIsoDatesToWindow(transit.exact_datetimes || [], yearWindow);
    const transitPlanetLabel = labelForKey(transit.transit_planet);
    const natalPointLabel = labelForKey(transit.natal_point);
    const transitPlanetSymbol = symbolForKey(transit.transit_planet);
    const natalPointSymbol = symbolForKey(transit.natal_point);
    const aspectLabel = ASPECT_LABELS[transit.aspect_type] || transit.aspect_type;
    const aspectDisplayLabel = ASPECT_DISPLAY_LABELS[transit.aspect_type] || aspectLabel;
    const aspectSymbol = ASPECT_SYMBOLS[transit.aspect_type] || aspectLabel;
    const shortText = `${transitPlanetLabel} ${aspectLabel} ${natalPointLabel}`;
    const startDay = Math.max(1, Math.floor(clipped.startOffsetDays) + 1);
    const endDay = Math.max(startDay, Math.ceil(clipped.endOffsetDays));

    return [{
      id: transit.id,
      label: transit.label,
      shortLabel: shortText,
      entryLabel: `${transitPlanetLabel} ${aspectDisplayLabel} ${natalPointLabel}`,
      entrySymbols: `${transitPlanetSymbol} ${aspectSymbol} ${natalPointSymbol}`,
      transitPlanet: transit.transit_planet,
      transitPlanetLabel,
      transitPlanetSymbol,
      natalPoint: transit.natal_point,
      natalPointLabel,
      natalPointSymbol,
      groupLabel: transitPlanetLabel.toUpperCase(),
      groupSymbol: transitPlanetSymbol,
      aspectType: transit.aspect_type,
      category: transit.category,
      rowIndex: index,
      sourceRowIndex: index,
      startDay,
      endDay,
      continuesPrev: clipped.continuesPrev,
      continuesNext: clipped.continuesNext,
      exactHitCount: exactHitsInYear.length,
      exactThisMonth: exactHitsInYear.length > 0,
      startsThisMonth: clipped.startsInWindow,
      endsThisMonth: clipped.endsInWindow,
      metadata: {
        exactDatetimes: transit.exact_datetimes || [],
        exactHitsInMonth: exactHitsInYear,
        endDatetime: transit.end_datetime,
        houses: transit.houses || null,
        passType: transit.pass_type,
        startDatetime: transit.start_datetime,
        periodStartOffset: clipped.startOffsetDays,
        periodEndOffset: clipped.endOffsetDays
      }
    }];
  });

  const rowsAll = mergeTransitPassRows(passRows).map((row, rowIndex) => {
    const houseDisplayLabel = config.filters?.includeHouseLabels ? getHouseDisplayLabel(row) : "";
    return {
      ...row,
      shortLabel: houseDisplayLabel ? `${row.shortLabel} · ${houseDisplayLabel}` : row.shortLabel,
      entryLabel: houseDisplayLabel ? `${row.entryLabel} · ${houseDisplayLabel}` : row.entryLabel,
      rowIndex,
      sourceRowIndex: rowIndex
    };
  });

  const scoredRows = rowsAll.map((row) => {
    const tier = getTransitTier(row);
    return {
      ...row,
      tier,
      score: scoreTransitRow(row, tier)
    };
  });
  const rows = selectDisplayRows(config, scoredRows);

  return {
    kind: "yearly",
    config,
    year: yearWindow.year,
    daysInMonth: yearWindow.totalDays,
    monthLabel: formatYearLabel(yearWindow.year),
    requestLabel: buildRequestLabel(config),
    meta: apiResponse.meta,
    inputMode: apiResponse.input?.mode || "year_slow",
    retrogrades: [],
    rowsAll: scoredRows,
    rows,
    groups: buildPlanetGroups(rows),
    legend: buildLegend(config),
    yearWindow
  };
}

function mergeTransitPassRows(rows) {
  const mergedByKey = new Map();

  for (const row of rows) {
    const key = buildTransitMergeKey(row);
    const existing = mergedByKey.get(key);

    if (!existing) {
      mergedByKey.set(key, createMergedTransitRow(row));
      continue;
    }

    mergeTransitRowInto(existing, row);
  }

  return [...mergedByKey.values()].sort(compareTransits);
}

function buildTransitMergeKey(row) {
  return [row.transitPlanet, row.aspectType, row.natalPoint].join("|");
}

function createMergedTransitRow(row) {
  return {
    ...row,
      metadata: {
        ...row.metadata,
        exactDatetimes: [...(row.metadata.exactDatetimes || [])],
        exactHitsInMonth: [...(row.metadata.exactHitsInMonth || [])],
        houses: row.metadata.houses || null,
        passTypes: row.metadata.passType ? [row.metadata.passType] : [],
        sourcePasses: [createSourcePass(row)],
        segments: [createSegment(row)]
      }
  };
}

function mergeTransitRowInto(target, row) {
  target.startDay = Math.min(target.startDay, row.startDay);
  target.endDay = Math.max(target.endDay, row.endDay);
  target.continuesPrev = target.continuesPrev || row.continuesPrev;
  target.continuesNext = target.continuesNext || row.continuesNext;
  target.startsThisMonth = target.startsThisMonth || row.startsThisMonth;
  target.endsThisMonth = target.endsThisMonth || row.endsThisMonth;

  const mergedExactDatetimes = uniqueSortedValues([
    ...(target.metadata.exactDatetimes || []),
    ...(row.metadata.exactDatetimes || [])
  ]);
  const mergedExactHitsInMonth = uniqueSortedValues([
    ...(target.metadata.exactHitsInMonth || []),
    ...(row.metadata.exactHitsInMonth || [])
  ]);
  const mergedPassTypes = uniqueOrderedValues([
    ...(target.metadata.passTypes || []),
    row.metadata.passType
  ]);
  const mergedSourcePasses = [...(target.metadata.sourcePasses || []), createSourcePass(row)]
    .sort((left, right) => compareText(left.startDatetime, right.startDatetime) || compareText(left.id, right.id));
  const mergedSegments = [...(target.metadata.segments || []), createSegment(row)]
    .sort((left, right) => {
      return (
        left.startDay - right.startDay ||
        compareText(left.startDatetime, right.startDatetime) ||
        left.endDay - right.endDay
      );
    });

  target.metadata = {
    ...target.metadata,
    exactDatetimes: mergedExactDatetimes,
    exactHitsInMonth: mergedExactHitsInMonth,
    passTypes: mergedPassTypes,
    sourcePasses: mergedSourcePasses,
    segments: mergedSegments,
    startDatetime: firstDefined(
      mergedSourcePasses.map((pass) => pass.startDatetime)
    ) || target.metadata.startDatetime,
    endDatetime: lastDefined(
      mergedSourcePasses.map((pass) => pass.endDatetime)
    ) || target.metadata.endDatetime
  };

  target.exactHitCount = mergedExactHitsInMonth.length;
  target.exactThisMonth = target.exactHitCount > 0;
}

function createSourcePass(row) {
  return {
    id: row.id,
    startDay: row.startDay,
    endDay: row.endDay,
    continuesPrev: row.continuesPrev,
    continuesNext: row.continuesNext,
    startDatetime: row.metadata.startDatetime,
    endDatetime: row.metadata.endDatetime,
    periodStartOffset: row.metadata.periodStartOffset,
    periodEndOffset: row.metadata.periodEndOffset,
    passType: row.metadata.passType,
    houses: row.metadata.houses || null,
    exactDatetimes: [...(row.metadata.exactDatetimes || [])],
    exactHitsInMonth: [...(row.metadata.exactHitsInMonth || [])]
  };
}

function createSegment(row) {
  return {
    category: row.category,
    startDay: row.startDay,
    endDay: row.endDay,
    continuesPrev: row.continuesPrev,
    continuesNext: row.continuesNext,
    startDatetime: row.metadata.startDatetime,
    endDatetime: row.metadata.endDatetime,
    periodStartOffset: row.metadata.periodStartOffset,
    periodEndOffset: row.metadata.periodEndOffset,
    houses: row.metadata.houses || null,
    exactDatetimes: [...(row.metadata.exactDatetimes || [])],
    exactHitsInMonth: [...(row.metadata.exactHitsInMonth || [])]
  };
}

function getHouseDisplayLabel(row) {
  const sourcePasses = row.metadata?.sourcePasses || [];

  const exactHouse = sourcePasses.find((pass) =>
    Array.isArray(pass.exactHitsInMonth) &&
    pass.exactHitsInMonth.length > 0 &&
    pass.houses?.transit_house_at_exact
  )?.houses?.transit_house_at_exact;

  if (exactHouse) {
    return `${exactHouse}⌂`;
  }

  const fallbackExactHouse = sourcePasses.find((pass) => pass.houses?.transit_house_at_exact)?.houses?.transit_house_at_exact;
  if (fallbackExactHouse) {
    return `${fallbackExactHouse}⌂`;
  }

  const monthHouse = sourcePasses.find((pass) => pass.houses?.transit_house_in_month)?.houses?.transit_house_in_month;
  return monthHouse ? `${monthHouse}⌂` : "";
}

export function normalizeRetrogrades(config, ephemerisResponse) {
  if (!ephemerisResponse || !Array.isArray(ephemerisResponse.data)) {
    return [];
  }

  const visibleRows = ephemerisResponse.data
    .map((entry, index) => ({
      index,
      timestamp: entry.timestamp,
      date: String(entry.timestamp || "").slice(0, 10),
      entry
    }))
    .filter((entry) => entry.date);

  const firstVisibleIndex = visibleRows.findIndex((entry) => entry.date.startsWith(`${config.month}-`));
  const lastVisibleIndex = findLastIndex(visibleRows, (entry) => entry.date.startsWith(`${config.month}-`));

  if (firstVisibleIndex === -1 || lastVisibleIndex === -1) {
    return [];
  }

  const bodies = ((ephemerisResponse.meta && ephemerisResponse.meta.bodies) || []).filter(
    (bodyLabel) => !["Sun", "Moon"].includes(bodyLabel)
  );
  const normalizedRows = [];

  for (const bodyLabel of bodies) {
    const bodyKey = keyForBodyLabel(bodyLabel);

    const segments = extractRetrogradeSegments({
      bodyKey,
      bodyLabel: labelForKey(bodyKey),
      bodySymbol: symbolForKey(bodyKey),
      rows: visibleRows,
      firstVisibleIndex,
      lastVisibleIndex
    });

    normalizedRows.push(...segments);
  }

  return normalizedRows.sort((left, right) => {
    return (
      rank(PLANET_RANK, left.body) - rank(PLANET_RANK, right.body) ||
      left.startDay - right.startDay ||
      compareText(left.bodyLabel, right.bodyLabel)
    );
  });
}

function compareTransits(left, right) {
  return (
    rank(PLANET_RANK, transitPlanetKey(left)) - rank(PLANET_RANK, transitPlanetKey(right)) ||
    rank(ASPECT_RANK, aspectTypeKey(left)) - rank(ASPECT_RANK, aspectTypeKey(right)) ||
    compareText(natalPointKey(left), natalPointKey(right)) ||
    rank(CATEGORY_RANK, categoryKey(left)) - rank(CATEGORY_RANK, categoryKey(right)) ||
    compareText(idKey(left), idKey(right))
  );
}

function compareText(left, right) {
  return String(left).localeCompare(String(right));
}

function uniqueSortedValues(values) {
  return [...new Set(values.filter(Boolean))].sort(compareText);
}

function uniqueOrderedValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstDefined(values) {
  return values.find((value) => value);
}

function lastDefined(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index]) {
      return values[index];
    }
  }
  return undefined;
}

function transitPlanetKey(item) {
  return item.transitPlanet ?? item.transit_planet;
}

function natalPointKey(item) {
  return item.natalPoint ?? item.natal_point;
}

function aspectTypeKey(item) {
  return item.aspectType ?? item.aspect_type;
}

function categoryKey(item) {
  return item.category;
}

function idKey(item) {
  return item.id;
}

function rank(table, key) {
  return table[key] ?? Number.MAX_SAFE_INTEGER;
}

function clampDay(day, daysInMonth) {
  const numericDay = Number(day);
  if (!Number.isFinite(numericDay)) {
    return 1;
  }
  return Math.min(daysInMonth, Math.max(1, numericDay));
}

function labelForKey(key) {
  return PLANET_LABELS[key] || String(key).replaceAll("_", " ");
}

function symbolForKey(key) {
  return PLANET_SYMBOLS[key] || labelForKey(key);
}

function formatMonthLabel(monthValue) {
  const [yearText, monthText] = monthValue.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1));
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatYearLabel(yearValue) {
  return String(yearValue);
}

function getInsightMonthWindow(monthValue) {
  const [yearText, monthText] = String(monthValue).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  return {
    startMs: Date.UTC(year, monthIndex, 1, 0, 0, 0, 0),
    endMs: Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0)
  };
}

function buildRequestLabel(config) {
  const categories = (config.filters.transit_categories || []).join(" + ");
  const aspects = (config.filters.aspect_types || []).length;
  return `${config.natal.name || "Natal chart"} - ${config.natal.city} - ${categories} - ${aspects} main aspects`;
}

function buildPlanetGroups(rows) {
  const groups = [];
  let currentGroup = null;

  for (const row of rows) {
    if (!currentGroup || currentGroup.planet !== row.transitPlanet) {
      currentGroup = {
        planet: row.transitPlanet,
        label: row.groupLabel,
        symbol: row.groupSymbol,
        startRow: row.rowIndex,
        endRow: row.rowIndex
      };
      groups.push(currentGroup);
    } else {
      currentGroup.endRow = row.rowIndex;
    }
  }

  return groups;
}

function buildImportanceByFactId(importanceRows) {
  const map = new Map();

  for (const importance of importanceRows || []) {
    for (const factId of importance.source_fact_ids || []) {
      if (!map.has(factId)) {
        map.set(factId, importance);
      }
    }
  }

  return map;
}

function normalizeInsightFactRow(fact, index, config, payload, monthWindow, importanceByFactId, derivedIngressWindow = null) {
  const evidence = fact?.evidence || {};
  const timing = resolveInsightTiming(fact, evidence, derivedIngressWindow);
  const startDatetime = timing.startDatetime;
  const endDatetime = timing.endDatetime;
  const peakDatetime = timing.peakDatetime;
  const startMs = Date.parse(startDatetime);
  const endMs = Date.parse(endDatetime);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  const normalizedEndMs = Math.max(startMs, endMs);
  if (normalizedEndMs < monthWindow.startMs || startMs >= monthWindow.endMs) {
    return null;
  }

  const dayLengthMs = 24 * 60 * 60 * 1000;
  const clippedStartMs = Math.max(startMs, monthWindow.startMs);
  const clippedEndMs = Math.min(normalizedEndMs, monthWindow.endMs - 1);
  const startDay = clampDay(Math.floor((clippedStartMs - monthWindow.startMs) / dayLengthMs) + 1, payload.daysInMonth);
  const endDay = Math.max(
    startDay,
    clampDay(Math.ceil((clippedEndMs - monthWindow.startMs) / dayLengthMs), payload.daysInMonth)
  );
  const exactHitsInMonth = filterInsightDatesToMonth([peakDatetime], monthWindow);
  const houseDisplayLabel = config.filters?.includeHouseLabels ? getInsightHouseDisplayLabel(evidence) : "";
  const importance = importanceByFactId.get(fact.id) || null;
  const groupKey = `insight:${fact.category || "general"}`;
  const groupLabel = labelForInsightCategory(fact.category);
  const groupSymbol = symbolForInsightCategory(fact.category);
  const entryLabel = buildInsightEntryLabel(fact, importance);
  const fullEntryLabel = houseDisplayLabel ? `${entryLabel} · ${houseDisplayLabel}` : entryLabel;

  return {
    id: fact.id,
    label: fullEntryLabel,
    shortLabel: fullEntryLabel,
    entryLabel: fullEntryLabel,
    entrySymbols: buildInsightEntrySymbols(fact),
    transitPlanet: groupKey,
    transitPlanetLabel: groupLabel,
    transitPlanetSymbol: groupSymbol,
    natalPoint: fact.kind,
    natalPointLabel: humanizeInsightKind(fact.kind),
    natalPointSymbol: buildInsightEntrySymbols(fact),
    groupLabel: groupLabel.toUpperCase(),
    groupSymbol,
    aspectType: fact.kind,
    category: mapInsightVisualCategory(fact.kind),
    rowIndex: index,
    sourceRowIndex: index,
    startDay,
    endDay,
    continuesPrev: startMs < monthWindow.startMs,
    continuesNext: normalizedEndMs >= monthWindow.endMs,
    exactHitCount: exactHitsInMonth.length,
    exactThisMonth: exactHitsInMonth.length > 0,
    startsThisMonth: startMs >= monthWindow.startMs,
    endsThisMonth: normalizedEndMs < monthWindow.endMs,
    priority: Number(fact.priority || 0),
    importanceRank: Number(importance?.rank || 999),
    strength: Number(fact.strength || 0),
    metadata: {
      exactDatetimes: peakDatetime ? [peakDatetime] : [],
      exactHitsInMonth,
      endDatetime,
      houses: null,
      passType: fact.kind,
      startDatetime,
      insight: {
        category: fact.category || "general",
        detector: fact.detector || "",
        evidence,
        flags: fact.flags || {},
        importance: importance ? {
          focusType: importance.focus_type || null,
          peakDatetime: importance.peak_datetime || null,
          rank: importance.rank,
          score: importance.score,
          title: importance.title || null,
          windowDays: importance.window_days || null
        } : null,
        indexKeys: fact.index_keys || [],
        kind: fact.kind || "fact",
        isPointEvent: timing.isPointEvent,
        priority: Number(fact.priority || 0),
        relationKey: fact.relation_key || "",
        searchText: fact.search_text || "",
        strength: Number(fact.strength || 0),
        subjects: fact.subjects || [],
        tags: fact.tags || []
      },
      sourcePasses: [{
        id: fact.id,
        startDay,
        endDay,
        continuesPrev: startMs < monthWindow.startMs,
        continuesNext: normalizedEndMs >= monthWindow.endMs,
        startDatetime,
        endDatetime,
        passType: fact.kind,
        exactDatetimes: peakDatetime ? [peakDatetime] : [],
        exactHitsInMonth
      }],
      segments: [{
        category: mapInsightVisualCategory(fact.kind),
        startDay,
        endDay,
        continuesPrev: startMs < monthWindow.startMs,
        continuesNext: normalizedEndMs >= monthWindow.endMs,
        startDatetime,
        endDatetime,
        exactDatetimes: peakDatetime ? [peakDatetime] : [],
        exactHitsInMonth
      }]
    }
  };
}

function buildIngressDisplayWindows(facts, monthWindow) {
  const groupedIngresses = new Map();

  for (const fact of facts || []) {
    if (fact?.kind !== "ingress") {
      continue;
    }

    const evidence = fact.evidence || {};
    const planetKey = evidence.transit_planets?.[0]
      || fact.subjects?.find((subject) => PLANET_SYMBOLS[subject])
      || "";
    const ingressType = String(evidence.ingress_type || "");
    const startDatetime = firstNonEmptyText([fact.start_datetime, evidence.start_datetime]);
    const startMs = Date.parse(startDatetime);

    if (!planetKey || !ingressType || !Number.isFinite(startMs)) {
      continue;
    }

    const key = `${planetKey}|${ingressType}`;
    const list = groupedIngresses.get(key) || [];
    list.push({
      id: fact.id,
      startDatetime,
      startMs
    });
    groupedIngresses.set(key, list);
  }

  const windows = new Map();

  for (const ingresses of groupedIngresses.values()) {
    const sorted = [...ingresses].sort((left, right) => left.startMs - right.startMs);

    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1] || null;
      windows.set(current.id, {
        startDatetime: current.startDatetime,
        endDatetime: next?.startDatetime || new Date(monthWindow.endMs - 1).toISOString(),
        isPointEvent: false
      });
    }
  }

  return windows;
}

function resolveInsightTiming(fact, evidence, derivedIngressWindow = null) {
  const derivedStart = derivedIngressWindow?.startDatetime || "";
  const derivedEnd = derivedIngressWindow?.endDatetime || "";
  const startDatetime = firstNonEmptyText([
    derivedStart,
    fact?.start_datetime,
    evidence?.start_datetime,
    fact?.peak_datetime,
    evidence?.peak_datetime
  ]);
  const peakDatetime = firstNonEmptyText([
    fact?.peak_datetime,
    evidence?.peak_datetime,
    startDatetime
  ]);
  const endDatetime = firstNonEmptyText([
    derivedEnd,
    fact?.end_datetime,
    evidence?.end_datetime,
    fact?.is_point_event ? peakDatetime : "",
    peakDatetime,
    startDatetime
  ]);

  return {
    startDatetime,
    endDatetime,
    peakDatetime,
    isPointEvent: derivedIngressWindow ? Boolean(derivedIngressWindow.isPointEvent) : Boolean(fact?.is_point_event)
  };
}

function selectInsightDisplayRows(config, rows) {
  const mode = config.filters.render_mode || "filtered";
  if (mode === "full") {
    return [...rows];
  }

  const maxRows = Number(config.filters.max_rows_filtered || 56);
  return [...rows]
    .sort(compareInsightPriority)
    .slice(0, maxRows);
}

function orderInsightRows(rows) {
  const categoryOrder = new Map(
    [...rows.reduce((map, row) => {
      const existing = map.get(row.transitPlanet);
      const nextValue = existing
        ? {
            label: row.groupLabel,
            priority: Math.max(existing.priority, row.priority || 0),
            rank: Math.min(existing.rank, row.importanceRank || 999),
            strength: Math.max(existing.strength, row.strength || 0)
          }
        : {
            label: row.groupLabel,
            priority: row.priority || 0,
            rank: row.importanceRank || 999,
            strength: row.strength || 0
          };
      map.set(row.transitPlanet, nextValue);
      return map;
    }, new Map()).entries()]
      .sort((left, right) => (
        right[1].priority - left[1].priority ||
        right[1].strength - left[1].strength ||
        left[1].rank - right[1].rank ||
        compareText(left[1].label, right[1].label)
      ))
      .map(([key], index) => [key, index])
  );

  return [...rows].sort((left, right) => (
    (categoryOrder.get(left.transitPlanet) || 0) - (categoryOrder.get(right.transitPlanet) || 0) ||
    compareInsightPriority(left, right)
  ));
}

function compareInsightPriority(left, right) {
  return (
    (right.priority || 0) - (left.priority || 0) ||
    (right.strength || 0) - (left.strength || 0) ||
    (left.importanceRank || 999) - (right.importanceRank || 999) ||
    compareText(left.metadata?.startDatetime, right.metadata?.startDatetime) ||
    compareText(left.entryLabel, right.entryLabel)
  );
}

function scoreInsightRow(row) {
  return (
    (row.priority || 0) * 10 +
    Math.round((row.strength || 0) * 100) -
    Math.min(20, row.importanceRank || 20)
  );
}

function buildInsightEntryLabel(fact, importance) {
  if (importance?.title) {
    return importance.title;
  }

  const evidence = fact.evidence || {};
  switch (fact.kind) {
    case "station":
      return `${labelForKey(evidence.transit_planets?.[0] || fact.subjects?.[0])} ${formatStationType(evidence.station_type)}`.trim();
    case "ingress":
      return buildIngressLabel(evidence, fact);
    case "pressure_window":
      return `${labelForKey(evidence.focus_point || evidence.natal_points?.[0] || fact.subjects?.[0])} pressure window`.trim();
    case "support_window":
      return `${labelForKey(evidence.focus_point || evidence.natal_points?.[0] || fact.subjects?.[0])} support window`.trim();
    case "activation_cluster":
      return `${labelForKey(evidence.natal_points?.[0] || evidence.focus_point || fact.subjects?.[fact.subjects.length - 1])} activation cluster`.trim();
    case "angular_activation":
      return `${labelForKey(evidence.angle_point || evidence.natal_points?.[0] || fact.subjects?.[fact.subjects.length - 1])} angular activation`.trim();
    case "background_theme_window":
      return String(evidence.topic_title || `${labelForInsightCategory(fact.category)} theme window`);
    case "retrograde_loop_phase":
      return `${labelForKey(evidence.loop_body || evidence.transit_planets?.[0] || fact.subjects?.[0])} ${formatLoopPhase(evidence.loop_phase)}`.trim();
    case "stellium":
      return buildStelliumLabel(evidence);
    default:
      return humanizeInsightKind(fact.kind);
  }
}

function buildInsightEntrySymbols(fact) {
  const evidence = fact.evidence || {};
  const supportPlanetKeys = getInsightSupportPlanetKeys(evidence);
  const primaryKey = evidence.loop_body
    || evidence.angle_point
    || evidence.focus_point
    || evidence.transit_planets?.[0]
    || evidence.natal_points?.[0]
    || fact.subjects?.find((subject) => PLANET_SYMBOLS[subject]);
  const primaryPlanetGlyph = primaryKey ? symbolForKey(primaryKey) : "";
  const transitGlyphs = compactPlanetGlyphs(
    supportPlanetKeys.length ? supportPlanetKeys : (primaryKey && PLANET_SYMBOLS[primaryKey] ? [primaryKey] : []),
    fact.kind === "stellium" ? 5 : 4
  );

  switch (fact.kind) {
    case "stellium":
      return joinSymbolParts([
        transitGlyphs,
        buildStelliumTargetGlyph(evidence)
      ]);
    case "ingress":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        "↦",
        buildIngressTargetGlyph(evidence)
      ]);
    case "support_window":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        "△",
        buildInsightTargetGlyph(evidence, fact, { includeHouseFallback: true })
      ]);
    case "pressure_window":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        "□",
        buildInsightTargetGlyph(evidence, fact, { includeHouseFallback: true })
      ]);
    case "activation_cluster":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        buildInsightTargetGlyph(evidence, fact, { includeHouseFallback: true })
      ]);
    case "angular_activation":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        buildAngularTargetGlyph(evidence, fact)
      ]);
    case "background_theme_window":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        buildThemeTargetGlyph(evidence)
      ]);
    case "retrograde_loop_phase":
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        "℞",
        buildInsightTargetGlyph(evidence, fact, { includeHouseFallback: false })
      ]);
    case "station":
      return transitGlyphs || primaryPlanetGlyph || "•";
    default:
      return joinSymbolParts([
        transitGlyphs || primaryPlanetGlyph,
        INSIGHT_KIND_SYMBOLS[fact.kind] || ""
      ]) || "•";
  }
}

function getInsightSupportPlanetKeys(evidence) {
  return uniqueOrderedValues(
    (evidence?.transit_planets || [])
      .map((planetKey) => String(planetKey || "").trim().toLowerCase())
      .filter((planetKey) => PLANET_SYMBOLS[planetKey])
  );
}

function compactPlanetGlyphs(planetKeys, maxCount = 4) {
  const glyphs = uniqueOrderedValues((planetKeys || []).map((planetKey) => symbolForKey(planetKey)).filter(Boolean));
  if (!glyphs.length) {
    return "";
  }

  const limited = glyphs.slice(0, maxCount).join("");
  return glyphs.length > maxCount ? `${limited}+` : limited;
}

function buildStelliumTargetGlyph(evidence) {
  return buildSignOrHouseGlyph(evidence.sign_id, evidence.house);
}

function buildIngressTargetGlyph(evidence) {
  return buildSignOrHouseGlyph(evidence.sign_id, evidence.house);
}

function buildInsightTargetGlyph(evidence, fact, { includeHouseFallback } = {}) {
  const pointGlyph = firstNonEmptyText([
    glyphForPointKey(evidence.focus_point),
    glyphForPointKey(evidence.angle_point),
    glyphForPointKey(evidence.natal_points?.[0]),
    glyphForPointKey(fact.subjects?.[fact.subjects.length - 1])
  ]);

  if (pointGlyph) {
    return pointGlyph;
  }

  if (includeHouseFallback) {
    return buildHouseGlyph(evidence.houses?.[0]);
  }

  return "";
}

function buildAngularTargetGlyph(evidence, fact) {
  return firstNonEmptyText([
    glyphForPointKey(evidence.angle_point),
    glyphForPointKey(evidence.natal_points?.[0]),
    glyphForPointKey(fact.subjects?.[fact.subjects.length - 1])
  ]);
}

function buildThemeTargetGlyph(evidence) {
  const pointGlyphs = uniqueOrderedValues((evidence.matched_natal_points || evidence.natal_points || [])
    .map((pointKey) => glyphForPointKey(pointKey))
    .filter(Boolean))
    .slice(0, 2)
    .join("");

  if (pointGlyphs) {
    return pointGlyphs;
  }

  return buildHouseGlyph((evidence.matched_houses || evidence.houses || [])[0]);
}

function glyphForPointKey(pointKey) {
  if (!pointKey) {
    return "";
  }

  const normalized = String(pointKey).trim().toLowerCase();
  return PLANET_SYMBOLS[normalized] || "";
}

function buildSignOrHouseGlyph(signId, houseNumber) {
  return glyphForSign(signId) || buildHouseGlyph(houseNumber);
}

function glyphForSign(signId) {
  if (!signId) {
    return "";
  }

  return SIGN_SYMBOLS[String(signId).trim().toLowerCase()] || "";
}

function buildHouseGlyph(houseNumber) {
  return Number.isFinite(houseNumber) ? `H${houseNumber}` : "";
}

function joinSymbolParts(parts) {
  return (parts || []).filter(Boolean).join(" ").trim();
}

function buildIngressLabel(evidence, fact) {
  const transitLabel = labelForKey(evidence.transit_planets?.[0] || fact.subjects?.[0]);

  if (evidence.ingress_type === "sign" && evidence.sign_id) {
    return `${transitLabel} enters ${formatSignLabel(evidence.sign_id)}`.trim();
  }

  if (evidence.ingress_type === "house" && Number.isFinite(evidence.house)) {
    return `${transitLabel} enters House ${evidence.house}`.trim();
  }

  return `${transitLabel} ingress`.trim();
}

function buildStelliumLabel(evidence) {
  const count = Number(evidence.count || (evidence.transit_planets || []).length || 0);
  const prefix = count > 0 ? `${count}-planet stellium` : "Stellium";

  if (Number.isFinite(evidence.house)) {
    return `${prefix} in House ${evidence.house}`;
  }

  if (evidence.sign_id) {
    return `${prefix} in ${formatSignLabel(evidence.sign_id)}`;
  }

  return prefix;
}

function formatStationType(stationType) {
  return stationType === "station_retrograde"
    ? "station retrograde"
    : stationType === "station_direct"
      ? "station direct"
      : humanizeInsightKind(stationType);
}

function formatLoopPhase(loopPhase) {
  return loopPhase === "station_retrograde"
    ? "retrograde loop"
    : loopPhase === "station_direct"
      ? "station direct"
      : humanizeInsightKind(loopPhase);
}

function filterInsightDatesToMonth(values, monthWindow) {
  return (values || []).filter((value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms >= monthWindow.startMs && ms < monthWindow.endMs;
  }).sort(compareText);
}

function getInsightHouseDisplayLabel(evidence) {
  if (Number.isFinite(evidence?.house)) {
    return `${evidence.house}⌂`;
  }

  if (Array.isArray(evidence?.houses) && evidence.houses.length && Number.isFinite(evidence.houses[0])) {
    return `${evidence.houses[0]}⌂`;
  }

  return "";
}

function mapInsightVisualCategory(kind) {
  if (kind === "stellium" || kind === "background_theme_window" || kind === "activation_cluster") {
    return "slow";
  }

  if (kind === "pressure_window" || kind === "support_window" || kind === "angular_activation") {
    return "medium";
  }

  return "fast";
}

function labelForInsightCategory(category) {
  return INSIGHT_CATEGORY_LABELS[category] || humanizeInsightKind(category);
}

function symbolForInsightCategory(category) {
  void category;
  return "";
}

function formatSignLabel(signId) {
  const normalized = String(signId || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeInsightKind(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reindexRows(rows) {
  return rows.map((row, rowIndex) => ({
    ...row,
    rowIndex,
    sourceRowIndex: row.sourceRowIndex ?? row.rowIndex ?? rowIndex
  }));
}

function firstNonEmptyText(values) {
  const value = (values || []).find((entry) => String(entry || "").trim());
  return String(value || "");
}

function buildLegend(config) {
  return {
    categories: config.filters.transit_categories || [],
    aspects: config.filters.aspect_types || []
  };
}

function selectDisplayRows(config, rows) {
  const mode = config.filters.render_mode || "filtered";
  if (mode === "full") {
    return rows.map((row, rowIndex) => ({
      ...row,
      rowIndex
    }));
  }

  const maxRows = Number(config.filters.max_rows_filtered || 56);
  const curatedRows = rows
    .filter(isUsefulForCurated)
    .sort(compareDisplayPriority)
    .slice(0, maxRows)
    .sort(compareTransits);

  return curatedRows.map((row, rowIndex) => ({
    ...row,
    rowIndex
  }));
}

function compareDisplayPriority(left, right) {
  return (
    left.tier - right.tier ||
    right.score - left.score ||
    right.exactHitCount - left.exactHitCount ||
    compareTransits(left, right)
  );
}

function isUsefulForCurated(row) {
  if (row.tier <= 3) {
    return true;
  }

  return row.exactThisMonth || row.startsThisMonth || row.endsThisMonth;
}

function getTransitTier(row) {
  const isHardAspect = ["conjunction", "opposition", "square"].includes(row.aspectType);
  const majorTransit = MAJOR_TRANSIT_PLANETS.has(row.transitPlanet);
  const majorNatal = MAJOR_NATAL_POINTS.has(row.natalPoint);
  const personalNatal = PERSONAL_NATAL_POINTS.has(row.natalPoint);
  const socialTransit = SOCIAL_TRANSIT_PLANETS.has(row.transitPlanet);

  if (majorTransit && majorNatal && isHardAspect) {
    return 1;
  }

  if (
    (majorTransit && (majorNatal || personalNatal)) ||
    (socialTransit && majorNatal && (isHardAspect || row.exactThisMonth))
  ) {
    return 2;
  }

  if (majorTransit || row.exactThisMonth || socialTransit) {
    return 3;
  }

  return 4;
}

function scoreTransitRow(row, tier) {
  let score = 0;

  if (row.exactThisMonth) {
    score += 100;
  }
  if (row.startsThisMonth) {
    score += 30;
  }
  if (row.endsThisMonth) {
    score += 30;
  }
  if (row.exactHitCount > 1) {
    score += 10;
  }

  score += TRANSIT_PLANET_SCORE[row.transitPlanet] || 0;
  score += NATAL_POINT_SCORE[row.natalPoint] || 0;
  score += ASPECT_SCORE[row.aspectType] || 0;
  score -= tier * 2;

  return score;
}

function extractRetrogradeSegments({ bodyKey, bodyLabel, bodySymbol, rows, firstVisibleIndex, lastVisibleIndex }) {
  const segments = [];
  let runStartIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const isRetrograde = Boolean(rows[index].entry.bodies && rows[index].entry.bodies[bodyLabel]?.retrograde);

    if (isRetrograde && runStartIndex === -1) {
      runStartIndex = index;
    }

    const nextIsRetrograde = index + 1 < rows.length
      ? Boolean(rows[index + 1].entry.bodies && rows[index + 1].entry.bodies[bodyLabel]?.retrograde)
      : false;
    if (!isRetrograde || nextIsRetrograde) {
      continue;
    }

    const runEndIndex = index;
    if (runEndIndex >= firstVisibleIndex && runStartIndex <= lastVisibleIndex) {
      const visibleStartIndex = Math.max(runStartIndex, firstVisibleIndex);
      const visibleEndIndex = Math.min(runEndIndex, lastVisibleIndex);

      segments.push({
        id: `${bodyKey}-retrograde-${rows[visibleStartIndex].date}`,
        body: bodyKey,
        bodyLabel,
        bodySymbol,
        entryLabel: `${bodyLabel} retrograde`,
        entrySymbols: bodySymbol,
        startDay: Number(rows[visibleStartIndex].date.slice(8, 10)),
        endDay: Number(rows[visibleEndIndex].date.slice(8, 10)),
        continuesPrev: runStartIndex < firstVisibleIndex,
        continuesNext: runEndIndex > lastVisibleIndex,
        startDatetime: rows[runStartIndex].timestamp,
        endDatetime: rows[Math.min(runEndIndex + 1, rows.length - 1)].timestamp
      });
    }

    runStartIndex = -1;
  }

  return segments;
}

function keyForBodyLabel(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");
}

function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index])) {
      return index;
    }
  }
  return -1;
}
