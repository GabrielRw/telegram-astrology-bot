import { getYearWindow } from "./year-range.js";

const DEFAULT_ASPECT_TYPES = ["conjunction", "square", "opposition", "trine", "sextile"];
const DEFAULT_TRANSIT_CATEGORIES = ["fast", "medium", "slow"];
const DEFAULT_RENDER_MODE = "filtered";
const DEFAULT_MAX_ROWS_FILTERED = 56;
const DEFAULT_PERIOD_MODE = "month";
export const DEFAULT_THEME = {
  pageBackground: "#0a1220",
  pageText: "#d3bd8a",
  titleText: "#d3bd8a",
  glyphColor: "#d3bd8a",
  transitLineColor: "#d3bd8a",
  separatorColor: "#d3bd8a",
  exactDotStroke: "#d3bd8a",
  exactDotFill: "#0a1220",
  legendColor: "#d3bd8a",
  panelBackground: "#0a1220",
  panelText: "#d3bd8a",
  panelMuted: "#b7a170",
  natalSvgMono: "#d3bd8a",
  degreeOutlineColor: "#ffffff"
};
export const DEFAULT_ORB_SETTINGS = {
  Conjunction: 5,
  Opposition: 5,
  Square: 4,
  Trine: 4,
  Sextile: 3
};
const DEFAULT_PLANET_SYMBOL_SCALE = 0.35;
export const DEFAULT_TRANSIT_PLANETS = [
  "sun",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "north_node",
  "chiron"
];

const RETROGRADE_PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "chiron"];

const EPHEMERIS_BODY_NAMES = {
  sun: "Sun",
  moon: "Moon",
  chiron: "Chiron",
  jupiter: "Jupiter",
  mars: "Mars",
  mercury: "Mercury",
  neptune: "Neptune",
  pluto: "Pluto",
  saturn: "Saturn",
  uranus: "Uranus",
  venus: "Venus"
};

export async function loadChartConfig() {
  const response = await fetch("/api/config");

  if (!response.ok) {
    throw new Error(`Failed to load config: ${response.status}`);
  }

  const config = await response.json();
  validateConfig(config);
  return applyDefaults(config);
}

export function buildTimelinePayload(config) {
  const periodMode = config.filters?.period_mode || DEFAULT_PERIOD_MODE;
  if (isSingleYearMode(periodMode)) {
    return buildYearlyTimelinePayload(config);
  }

  const { rangeStart, rangeEnd, daysInMonth } = getMonthWindow(config.month);
  const natal = {
    ...config.natal
  };
  const filters = config.filters || {};
  const transitPlanets = resolveSelectedTransitPlanets(filters);

  if (!natal.time_known) {
    delete natal.hour;
    delete natal.minute;
  }

  const request = {
    natal,
    range_start: rangeStart,
    range_end: rangeEnd,
    include_houses: Boolean(natal.time_known),
    transit_categories: filters.transit_categories,
    aspect_types: filters.aspect_types,
    orb_settings: filters.orb_settings,
    transit_planets: transitPlanets
  };

  return {
    month: config.month,
    daysInMonth,
    request
  };
}

export function buildInsightsPayload(config) {
  const { rangeStart, rangeEnd, daysInMonth } = getMonthWindow(config.month);
  const natal = {
    ...config.natal
  };
  const filters = config.filters || {};
  const transitPlanets = resolveSelectedTransitPlanets(filters);

  if (!natal.time_known) {
    delete natal.hour;
    delete natal.minute;
  }

  return {
    month: config.month,
    daysInMonth,
    request: {
      natal,
      mode: "month",
      range_start: rangeStart,
      range_end: rangeEnd,
      include_houses: Boolean(natal.time_known),
      transit_categories: filters.transit_categories,
      aspect_types: filters.aspect_types,
      orb_settings: filters.orb_settings,
      transit_planets: transitPlanets
    }
  };
}

function buildYearlyTimelinePayload(config) {
  const yearWindow = getYearWindow(config.month);
  const natal = {
    ...config.natal
  };
  const filters = config.filters || {};

  if (!natal.time_known) {
    delete natal.hour;
    delete natal.minute;
  }

  return {
    month: config.month,
    daysInMonth: yearWindow.totalDays,
    request: {
      natal,
      mode: "year_slow",
      range_start: yearWindow.rangeStart,
      range_end: yearWindow.rangeEnd,
      include_houses: Boolean(natal.time_known),
      transit_categories: ["slow"],
      aspect_types: filters.aspect_types,
      orb_settings: filters.orb_settings
    }
  };
}

function isSingleYearMode(periodMode) {
  return periodMode === "year_single" || periodMode === "year_single_portrait";
}

export function buildEphemerisPayload(config) {
  const retrogradeBodies = resolveRetrogradeBodies(config.filters || {});
  if (!retrogradeBodies.length) {
    return null;
  }

  const { year, month, daysInMonth } = getMonthWindow(config.month);
  const startDate = new Date(Date.UTC(year, month - 1, 0));
  const endDate = new Date(Date.UTC(year, month - 1, daysInMonth + 1));

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    step: "1d",
    format: "json",
    lat: config.natal.lat,
    lng: config.natal.lng,
    tz_str: config.natal.tz_str || "AUTO",
    include_houses: false,
    include_angles: false,
    bodies: [...new Set(retrogradeBodies)].map((body) => EPHEMERIS_BODY_NAMES[body]).filter(Boolean)
  };
}

export function buildNatalChartSvgPayload(config) {
  const natal = {
    ...config.natal
  };
  const theme = normalizeTheme(config.theme);
  const mono = theme.natalSvgMono;
  const filters = config.filters || {};

  if (!natal.time_known) {
    delete natal.hour;
    delete natal.minute;
  }

  return {
    ...natal,
    format: "svg",
    size: 1200,
    theme_type: "dark",
    show_metadata: false,
    chart_config: {
      french_style: true,
      chart_background: "transparent",
      custom_planet_color: mono,
      custom_sign_color: mono,
      custom_house_color: mono,
      custom_sign_bg_color: "transparent",
      custom_house_bg_color: "transparent",
      sign_line_color: mono,
      house_line_color: mono,
      sign_ring_inner_color: mono,
      sign_ring_outer_color: mono,
      house_ring_inner_color: mono,
      house_ring_outer_color: mono,
      sign_tick_color: mono,
      asc_line_color: mono,
      dsc_line_color: mono,
      mc_line_color: mono,
      ic_line_color: mono,
      aspect_conjunction_color: mono,
      aspect_opposition_color: mono,
      aspect_trine_color: mono,
      aspect_square_color: mono,
      aspect_sextile_color: mono,
      aspect_quincunx_color: mono,
      planet_symbol_scale: DEFAULT_PLANET_SYMBOL_SCALE * 1.3,
      french_planet_radius_offset: 50,
      french_degree_label_offset: 30,
      degree_label_scale: 0.5,
      show_retrograde_markers: Boolean(filters.showRetrogradeMarkers),
      retrograde_marker_style: "R",
      show_sign_background: false,
      show_house_background: false,
      show_color_background: false
    }
  };
}

export function getMonthWindow(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);

  if (!match) {
    throw new Error(`Invalid month format "${monthValue}". Expected YYYY-MM.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rangeStart = `${monthValue}-01`;
  const rangeEnd = `${monthValue}-${String(daysInMonth).padStart(2, "0")}`;

  return {
    year,
    month,
    daysInMonth,
    rangeStart,
    rangeEnd
  };
}

function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Config must be an object.");
  }

  if (!config.month) {
    throw new Error("Config is missing month.");
  }

  if (!config.natal || typeof config.natal !== "object") {
    throw new Error("Config is missing natal data.");
  }

  const requiredNatalFields = ["year", "month", "day", "city", "lat", "lng"];
  for (const field of requiredNatalFields) {
    if (config.natal[field] === undefined || config.natal[field] === null || config.natal[field] === "") {
      throw new Error(`Config natal.${field} is required.`);
    }
  }
}

export function applyDefaults(config) {
  const incomingFilters = config.filters || {};

  return {
    ...config,
    filters: {
      transit_categories: DEFAULT_TRANSIT_CATEGORIES,
      aspect_types: DEFAULT_ASPECT_TYPES,
      includeMoon: false,
      includeHouseLabels: true,
      showRetrogradeMarkers: false,
      render_mode: DEFAULT_RENDER_MODE,
      max_rows_filtered: DEFAULT_MAX_ROWS_FILTERED,
      period_mode: DEFAULT_PERIOD_MODE,
      ...incomingFilters,
      orb_settings: {
        ...DEFAULT_ORB_SETTINGS,
        ...(incomingFilters.orb_settings || {})
      }
    },
    theme: normalizeTheme(config.theme || {})
  };
}

export function normalizeTheme(theme = {}) {
  return {
    ...DEFAULT_THEME,
    pageBackground: theme.pageBackground || theme.pageTint || DEFAULT_THEME.pageBackground,
    pageText: theme.pageText || DEFAULT_THEME.pageText,
    titleText: theme.titleText || theme.titleAccent || DEFAULT_THEME.titleText,
    glyphColor: theme.glyphColor || DEFAULT_THEME.glyphColor,
    transitLineColor: theme.transitLineColor || DEFAULT_THEME.transitLineColor,
    separatorColor: theme.separatorColor || DEFAULT_THEME.separatorColor,
    exactDotStroke: theme.exactDotStroke || DEFAULT_THEME.exactDotStroke,
    exactDotFill: theme.exactDotFill || theme.pageBackground || theme.pageTint || DEFAULT_THEME.exactDotFill,
    legendColor: theme.legendColor || theme.transitLineColor || DEFAULT_THEME.legendColor,
    panelBackground: theme.panelBackground || theme.pageBackground || theme.pageTint || DEFAULT_THEME.panelBackground,
    panelText: theme.panelText || theme.pageText || DEFAULT_THEME.panelText,
    panelMuted: theme.panelMuted || DEFAULT_THEME.panelMuted,
    natalSvgMono: theme.natalSvgMono || theme.titleAccent || DEFAULT_THEME.natalSvgMono,
    degreeOutlineColor: theme.degreeOutlineColor || DEFAULT_THEME.degreeOutlineColor
  };
}

export function resolveSelectedTransitPlanets(filters = {}) {
  const explicitPlanets = Array.isArray(filters.transit_planets) && filters.transit_planets.length
    ? filters.transit_planets
    : DEFAULT_TRANSIT_PLANETS;

  const planets = filters.includeMoon ? ["moon", ...explicitPlanets] : explicitPlanets;
  return [...new Set(planets)];
}

export function resolveRetrogradeBodies(filters = {}) {
  return resolveSelectedTransitPlanets(filters).filter((planet) => RETROGRADE_PLANETS.includes(planet));
}
