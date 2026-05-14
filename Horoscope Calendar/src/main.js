import { fetchEphemeris, fetchMoonPhases, fetchNatalChartSvg, fetchTransitInsights, fetchTransitTimeline, searchCities } from "./astro-api.js";
import {
  applyDefaults,
  buildEphemerisPayload,
  buildInsightsPayload,
  buildNatalChartSvgPayload,
  buildTimelinePayload,
  DEFAULT_THEME,
  DEFAULT_ORB_SETTINGS,
  loadChartConfig,
  normalizeTheme
} from "./config.js";
import { normalizeInsightsTimeline, normalizeRetrogrades, normalizeTimeline, normalizeYearlyTimeline } from "./normalize.js";
import { renderMonthlyDocument, renderPanelMeta, buildCoverModel } from "./render.js";

const chartForm = document.querySelector("#chart-form");
const periodModeInput = document.querySelector("#period-mode-input");
const monthField = document.querySelector("#month-field");
const yearField = document.querySelector("#year-field");
const cityInput = document.querySelector("#city-input");
const cityResults = document.querySelector("#city-results");
const cityStatus = document.querySelector("#city-status");
const documentRoot = document.querySelector("#document-root");
const panelMeta = document.querySelector("#panel-meta");
const printButton = document.querySelector("#print-button");
const renderButton = document.querySelector("#render-button");
const copyJsonButton = document.querySelector("#copy-json-button");
const statusPill = document.querySelector("#status-pill");
const peoplePresetSelect = document.querySelector("#people-preset-select");
const themePresetSelect = document.querySelector("#theme-preset-select");
const savePersonButton = document.querySelector("#save-person-button");
const overwritePersonButton = document.querySelector("#overwrite-person-button");
const deletePersonButton = document.querySelector("#delete-person-button");
const saveThemeButton = document.querySelector("#save-theme-button");
const overwriteThemeButton = document.querySelector("#overwrite-theme-button");
const deleteThemeButton = document.querySelector("#delete-theme-button");

const STORAGE_KEYS = {
  people: "horoscopeCalendar.peoplePresets",
  themes: "horoscopeCalendar.themePresets",
  lastState: "horoscopeCalendar.lastState"
};

const THEME_FIELDS = {
  themePageBackground: "pageBackground",
  themePageText: "pageText",
  themeTitleText: "titleText",
  themeGlyphColor: "glyphColor",
  themeTransitLineColor: "transitLineColor",
  themeSeparatorColor: "separatorColor",
  themeExactDotStroke: "exactDotStroke",
  themeExactDotFill: "exactDotFill",
  themeLegendColor: "legendColor",
  themePanelBackground: "panelBackground",
  themePanelText: "panelText",
  themePanelMuted: "panelMuted",
  themeNatalSvgMono: "natalSvgMono",
  themeDegreeOutlineColor: "degreeOutlineColor"
};

let baseConfig = null;
let selectedCity = null;
let latestCitySearchToken = 0;
let citySearchTimer = 0;
let isRendering = false;
let peoplePresets = [];
let themePresets = [];
let selectedPersonPresetId = "";
let selectedThemePresetId = "";
let persistTimer = 0;
let latestDebugExport = null;

printButton.addEventListener("click", handlePrintClick);
copyJsonButton.addEventListener("click", handleCopyJsonClick);
chartForm.addEventListener("submit", handleFormSubmit);
chartForm.addEventListener("input", handleFormChanged);
chartForm.addEventListener("change", handleFormChanged);
periodModeInput.addEventListener("change", syncPeriodInputs);
cityInput.addEventListener("input", () => {
  selectedCity = null;
  cityStatus.textContent = "Start typing 2+ characters to search cities.";
  scheduleCitySearch();
});
cityResults.addEventListener("click", handleCityResultClick);
peoplePresetSelect.addEventListener("change", handlePeoplePresetChange);
themePresetSelect.addEventListener("change", handleThemePresetChange);
savePersonButton.addEventListener("click", handleSavePersonPreset);
overwritePersonButton.addEventListener("click", handleOverwritePersonPreset);
deletePersonButton.addEventListener("click", handleDeletePersonPreset);
saveThemeButton.addEventListener("click", handleSaveThemePreset);
overwriteThemeButton.addEventListener("click", handleOverwriteThemePreset);
deleteThemeButton.addEventListener("click", handleDeleteThemePreset);
window.addEventListener("afterprint", () => {
  statusPill.textContent = "Ready for print";
  setBusyState(false);
});

boot().catch((error) => {
  console.error(error);
  showRenderError(error);
});

async function boot() {
  statusPill.textContent = "Loading config...";
  baseConfig = await loadChartConfig();
  peoplePresets = readStoredCollection(STORAGE_KEYS.people);
  themePresets = readStoredCollection(STORAGE_KEYS.themes);
  renderPresetOptions();
  populateForm(baseConfig);
  applyLastState();
  syncPeriodInputs();
  applyPreviewTheme(readThemeSettings(new FormData(chartForm)));
  setResolvedCityMessage(selectedCity || baseConfig.natal);
  statusPill.textContent = "Review inputs and click Update chart";
  documentRoot.innerHTML = `
    <section class="month-page empty-page">
      <h2>Chart Ready to Generate</h2>
      <p>Adjust the birth data and filters, then click Update chart.</p>
    </section>
  `;
  syncCopyJsonButton();
}

function handleFormChanged() {
  applyPreviewTheme(readThemeSettings(new FormData(chartForm)));
  schedulePersistLastState();
}

async function handleFormSubmit(event) {
  event.preventDefault();

  try {
    const renderRequest = await buildRenderRequestFromForm(new FormData(chartForm));
    await renderWithConfigs(renderRequest.configs);
  } catch (error) {
    console.error(error);
    showRenderError(error);
  }
}

async function handlePrintClick() {
  if (isRendering) {
    return;
  }

  try {
    setBusyState(true);
    const renderRequest = await buildRenderRequestFromForm(new FormData(chartForm));
    await renderWithConfigs(renderRequest.configs, {
      finalStatus: "Preparing print...",
      releaseBusy: false
    });
    statusPill.textContent = "Opening print dialog...";
    await waitForNextPaint();
    window.print();
  } catch (error) {
    console.error(error);
    showRenderError(error);
    setBusyState(false);
  }
}

async function handleCopyJsonClick() {
  if (!latestDebugExport) {
    flashStatus("Generate a chart first");
    return;
  }

  try {
    const payloadToCopy = {
      ...structuredClone(latestDebugExport),
      copiedAt: new Date().toISOString()
    };
    await copyTextToClipboard(JSON.stringify(payloadToCopy, null, 2));
    flashStatus("Debug JSON copied");
  } catch (error) {
    console.error(error);
    flashStatus("Copy failed");
  }
}

async function buildRenderRequestFromForm(formData) {
  if (!baseConfig) {
    throw new Error("Base config is not loaded yet.");
  }

  const periodMode = String(formData.get("periodMode") || "month");
  const isYearSingleMode = isSingleYearMode(periodMode);
  const isCoverOnlyMode = periodMode === "cover_only";
  const usesYearInput = periodMode === "year" || isYearSingleMode;
  const month = periodMode === "month" ? readRequiredText(formData, "month", "Month") : "";
  const yearValue = usesYearInput
    ? readRequiredText(formData, "year", "Year")
    : (month || baseConfig.month || "").slice(0, 4);
  const birthDate = readRequiredText(formData, "birthDate", "Date of birth");
  const cityQuery = readRequiredText(formData, "city", "City");
  const [yearText, monthText, dayText] = birthDate.split("-");

  if (!yearText || !monthText || !dayText) {
    throw new Error("Birth date must be a valid date.");
  }

  const categories = isYearSingleMode
    ? ["slow"]
    : ["fast", "medium", "slow"].filter((category) => formData.get(`category-${category}`) === "on");

  if (!categories.length && !isCoverOnlyMode) {
    throw new Error("Select at least one transit speed.");
  }

  statusPill.textContent = "Resolving city...";
  const resolvedCity = await resolveCity(cityQuery);
  setResolvedCityMessage(resolvedCity);

  const birthTime = String(formData.get("birthTime") || "").trim();
  const orbSettings = readOrbSettings(formData);
  const baseNextConfig = applyDefaults({
    ...baseConfig,
    title: "",
    month: month || `${yearValue}-01`,
    natal: {
      ...baseConfig.natal,
      name: readRequiredText(formData, "name", "Name"),
      year: Number(yearText),
      month: Number(monthText),
      day: Number(dayText),
      hour: birthTime ? Number(birthTime.split(":")[0]) : undefined,
      minute: birthTime ? Number(birthTime.split(":")[1] || "0") : undefined,
      time_known: Boolean(birthTime),
      city: resolvedCity.name,
      lat: resolvedCity.lat,
      lng: resolvedCity.lng,
      tz_str: resolvedCity.timezone
    },
    filters: {
      ...baseConfig.filters,
      transit_categories: categories,
      includeMoon: isYearSingleMode ? false : formData.get("includeMoon") === "on",
      includeHouseLabels: formData.get("includeHouseLabels") === "on",
      showRetrogradeMarkers: formData.get("showRetrogradeMarkers") === "on",
      render_mode: String(formData.get("renderMode") || "filtered"),
      period_mode: periodMode,
      orb_settings: orbSettings
    },
    theme: readThemeSettings(formData)
  });

  if (periodMode === "year") {
    const yearText = String(yearValue).padStart(4, "0");
    return {
      configs: Array.from({ length: 12 }, (_, index) => ({
        ...baseNextConfig,
        month: `${yearText}-${String(index + 1).padStart(2, "0")}`
      }))
    };
  }

  if (isYearSingleMode) {
    return {
      configs: [{
        ...baseNextConfig,
        month: `${String(yearValue).padStart(4, "0")}-01`
      }]
    };
  }

  if (isCoverOnlyMode) {
    return {
      configs: [{
        ...baseNextConfig,
        month: `${String(yearValue).padStart(4, "0")}-01`
      }]
    };
  }

  return {
    configs: [baseNextConfig]
  };
}

async function resolveCity(query) {
  if (selectedCity && matchesSelectedCity(query, selectedCity)) {
    return selectedCity;
  }

  const results = await searchCities(query, {
    limit: query.trim().length < 4 ? 5 : 10
  });

  if (!results.length) {
    throw new Error(`No city match found for "${query}".`);
  }

  return results[0];
}

async function renderWithConfigs(configs, { finalStatus = "Ready for print", releaseBusy = true } = {}) {
  setBusyState(true);
  const debugExport = createDebugExportSession(configs);

  try {
    const models = [];
    const primaryPeriodMode = configs[0]?.filters.period_mode;
    const coverOnlyMode = primaryPeriodMode === "cover_only";
    const includeYearOverview = primaryPeriodMode === "year";
    const includeCoverPage = coverOnlyMode || configs.length > 1 || primaryPeriodMode === "year";
    let coverModel = null;

    if (includeCoverPage) {
      statusPill.textContent = "Loading natal cover...";
      const coverConfig = configs[0];
      const natalChartPayload = buildNatalChartSvgPayload(coverConfig);
      const natalChartSvg = await fetchNatalChartSvg(natalChartPayload);
      coverModel = buildCoverModel(coverConfig, natalChartSvg);
      debugExport.cover = buildCoverDebugEntry(coverConfig, natalChartPayload);
    }

    if (includeYearOverview) {
      const overviewConfig = buildYearOverviewConfig(configs[0]);
      statusPill.textContent = "Loading yearly overview...";
      const overviewPayload = buildTimelinePayload(overviewConfig);
      const overviewResponse = await fetchTransitTimeline(overviewPayload.request);
      const overviewModel = normalizeYearlyTimeline(overviewConfig, overviewPayload, overviewResponse);
      overviewModel.retrogrades = [];
      overviewModel.moonPhases = [];
      traceGeneratedDocument({
        index: 0,
        total: configs.length + 1,
        config: overviewConfig,
        payload: overviewPayload,
        apiResponse: overviewResponse,
        ephemerisPayload: null,
        ephemerisResponse: null,
        moonPhases: [],
        model: overviewModel
      });
      debugExport.documents.push(buildDocumentDebugEntry({
        index: 0,
        total: configs.length + 1,
        config: overviewConfig,
        payload: overviewPayload,
        apiResponse: overviewResponse,
        ephemerisPayload: null,
        ephemerisResponse: null,
        moonPhases: [],
        model: overviewModel
      }));
      models.push(overviewModel);
    }

    for (let index = 0; index < configs.length; index += 1) {
      const config = configs[index];
      if (coverOnlyMode) {
        break;
      }
      const isYearSingle = isSingleYearMode(config.filters.period_mode);
      const isMonthlyInsights = isMonthlyInsightsMode(config.filters.period_mode);
      statusPill.textContent = configs.length === 1
        ? (isYearSingle ? "Loading yearly overview..." : isMonthlyInsights ? "Loading monthly insights..." : "Loading chart data...")
        : `Loading ${config.month} (${index + 1}/${configs.length})...`;
      const payload = isMonthlyInsights ? buildInsightsPayload(config) : buildTimelinePayload(config);
      const ephemerisPayload = isYearSingle || isMonthlyInsights ? null : buildEphemerisPayload(config);
      const [apiResponse, ephemerisResponse, moonPhases] = await Promise.all([
        isMonthlyInsights
          ? fetchTransitInsights(payload.request)
          : fetchTransitTimeline(payload.request),
        ephemerisPayload ? fetchEphemeris(ephemerisPayload) : Promise.resolve(null),
        isYearSingle
          ? Promise.resolve([])
          : fetchMoonPhases({
              month: config.month,
              lat: config.natal.lat,
              lon: config.natal.lng,
              moonColor: config.theme.pageText,
              shadowColor: config.theme.pageBackground
            })
      ]);

      const model = isYearSingle
        ? normalizeYearlyTimeline(config, payload, apiResponse)
        : isMonthlyInsights
          ? normalizeInsightsTimeline(config, payload, apiResponse)
        : normalizeTimeline(config, payload, apiResponse);
      model.retrogrades = isMonthlyInsights ? [] : normalizeRetrogrades(config, ephemerisResponse);
      model.moonPhases = moonPhases;
      traceGeneratedDocument({
        index,
        total: configs.length,
        config,
        payload,
        apiResponse,
        ephemerisPayload,
        ephemerisResponse,
        moonPhases,
        model
      });
      debugExport.documents.push(buildDocumentDebugEntry({
        index,
        total: configs.length,
        config,
        payload,
        apiResponse,
        ephemerisPayload,
        ephemerisResponse,
        moonPhases,
        model
      }));
      models.push(model);
    }

    statusPill.textContent = "Drawing chart...";
    renderMonthlyDocument(documentRoot, models, coverModel);
    renderPanelMeta(panelMeta, models, coverModel);
    latestDebugExport = finalizeDebugExport(debugExport, models, coverModel);
    syncCopyJsonButton();

    await waitForPagedPolyfill();
    removePagedPreview();
    statusPill.textContent = "Paginating preview...";
    await window.PagedPolyfill.preview();
    statusPill.textContent = finalStatus;
  } finally {
    if (releaseBusy) {
      setBusyState(false);
    }
  }
}

function traceGeneratedDocument({
  index,
  total,
  config,
  payload,
  apiResponse,
  ephemerisPayload,
  ephemerisResponse,
  moonPhases,
  model
}) {
  const documentLabel = getDocumentLabel(index, total, config);
  const summary = buildDocumentSummary(config, apiResponse, moonPhases, model);

  console.groupCollapsed(documentLabel);
  console.log("summary", summary);
  console.log("config", structuredClone(config));
  console.log("timelinePayload", structuredClone(payload));
  console.log("timelineResponse", structuredClone(apiResponse));
  console.log("ephemerisPayload", ephemerisPayload ? structuredClone(ephemerisPayload) : null);
  console.log("ephemerisResponse", ephemerisResponse ? structuredClone(ephemerisResponse) : null);
  console.log("moonPhases", structuredClone(moonPhases));
  console.log("model", {
    monthLabel: model.monthLabel,
    rows: structuredClone(model.rows),
    rowsAll: structuredClone(model.rowsAll),
    retrogrades: structuredClone(model.retrogrades)
  });
  console.groupEnd();
}

function buildDocumentDebugEntry({
  index,
  total,
  config,
  payload,
  apiResponse,
  ephemerisPayload,
  ephemerisResponse,
  moonPhases,
  model
}) {
  return {
    label: getDocumentLabel(index, total, config),
    summary: buildDocumentSummary(config, apiResponse, moonPhases, model),
    config: cloneForDebug(config),
    timelinePayload: cloneForDebug(payload),
    timelineResponse: cloneForDebug(apiResponse),
    ephemerisPayload: ephemerisPayload ? cloneForDebug(ephemerisPayload) : null,
    ephemerisResponse: ephemerisResponse ? cloneForDebug(ephemerisResponse) : null,
    moonPhases: cloneForDebug(moonPhases),
    model: {
      monthLabel: model.monthLabel,
      rows: cloneForDebug(model.rows),
      rowsAll: cloneForDebug(model.rowsAll),
      retrogrades: cloneForDebug(model.retrogrades)
    }
  };
}

function buildCoverDebugEntry(config, natalChartPayload) {
  return {
    label: "Natal Cover PDF",
    summary: {
      month: config.month,
      periodMode: config.filters.period_mode,
      name: config.natal.name || "",
      city: config.natal.city || "",
      timeKnown: Boolean(config.natal.time_known)
    },
    config: cloneForDebug(config),
    natalChartPayload: cloneForDebug(natalChartPayload)
  };
}

function createDebugExportSession(configs) {
  const primaryConfig = configs[0] || null;

  return {
    exportType: "horoscope-calendar-ai-debug",
    generatedAt: new Date().toISOString(),
    report: {
      primaryPeriodMode: primaryConfig?.filters?.period_mode || "month",
      requestedConfigs: configs.map((config) => ({
        month: config.month,
        periodMode: config.filters.period_mode,
        renderMode: config.filters.render_mode
      }))
    },
    cover: null,
    documents: []
  };
}

function finalizeDebugExport(debugExport, models, coverModel) {
  return {
    ...debugExport,
    report: {
      ...debugExport.report,
      renderedDocuments: models.length + (coverModel ? 1 : 0),
      renderedTimelinePages: models.length
    }
  };
}

function buildDocumentSummary(config, apiResponse, moonPhases, model) {
  return {
    month: config.month,
    mode: config.filters.render_mode,
    periodMode: config.filters.period_mode,
    displayedRows: model.rows.length,
    totalRows: model.rowsAll.length,
    retrogrades: model.retrogrades.length,
    moonPhases: moonPhases.length,
    generatedAt: apiResponse?.meta?.generated_at || null
  };
}

function getDocumentLabel(index, total, config) {
  return config.filters.period_mode === "cover_only"
    ? "Natal Cover PDF"
    : isMonthlyInsightsMode(config.filters.period_mode)
      ? `Monthly Insight PDF: ${config.month}`
    : isSingleYearMode(config.filters.period_mode)
    ? `Yearly Transit PDF: ${String(config.month).slice(0, 4)}`
    : total === 1
      ? `Monthly Transit PDF: ${config.month}`
      : `Monthly Transit PDF ${index + 1}/${total}: ${config.month}`;
}

function cloneForDebug(value) {
  return value == null ? value : structuredClone(value);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function flashStatus(message) {
  const previousStatus = statusPill.textContent;
  statusPill.textContent = message;
  window.setTimeout(() => {
    if (!isRendering && statusPill.textContent === message) {
      statusPill.textContent = previousStatus;
    }
  }, 2200);
}

async function waitForPagedPolyfill() {
  const timeoutAt = Date.now() + 15000;

  while (!window.PagedPolyfill) {
    if (Date.now() > timeoutAt) {
      throw new Error("Paged.js did not load.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }
}

function populateForm(config) {
  chartForm.elements.periodMode.value = config.filters.period_mode || "month";
  chartForm.elements.month.value = config.month;
  chartForm.elements.year.value = String(config.month).slice(0, 4);
  chartForm.elements.name.value = config.natal.name || "";
  chartForm.elements.birthDate.value = formatDateInput(config.natal);
  chartForm.elements.birthTime.value = formatTimeInput(config.natal);
  chartForm.elements.city.value = config.natal.city || "";
  selectedCity = {
    name: config.natal.city,
    country: "",
    lat: config.natal.lat,
    lng: config.natal.lng,
    timezone: config.natal.tz_str
  };
  chartForm.elements.includeMoon.checked = Boolean(config.filters.includeMoon);
  chartForm.elements.includeHouseLabels.checked = Boolean(config.filters.includeHouseLabels);
  chartForm.elements.showRetrogradeMarkers.checked = Boolean(config.filters.showRetrogradeMarkers);
  chartForm.elements.renderMode.value = config.filters.render_mode || "filtered";
  populateThemeFields(normalizeTheme(config.theme));

  for (const category of ["fast", "medium", "slow"]) {
    chartForm.elements[`category-${category}`].checked =
      (config.filters.transit_categories || []).includes(category);
  }

  const orbFields = {
    orbConjunction: config.filters.orb_settings.Conjunction,
    orbOpposition: config.filters.orb_settings.Opposition,
    orbSquare: config.filters.orb_settings.Square,
    orbTrine: config.filters.orb_settings.Trine,
    orbSextile: config.filters.orb_settings.Sextile
  };

  for (const [fieldName, value] of Object.entries(orbFields)) {
    chartForm.elements[fieldName].value = String(value);
    chartForm.elements[fieldName].placeholder = String(value);
  }
}

function populateThemeFields(theme) {
  for (const [fieldName, themeKey] of Object.entries(THEME_FIELDS)) {
    chartForm.elements[fieldName].value = theme[themeKey] || DEFAULT_THEME[themeKey];
  }
}

function syncPeriodInputs() {
  const usesYearInput = periodModeInput.value === "year" || isSingleYearMode(periodModeInput.value);
  monthField.hidden = usesYearInput;
  yearField.hidden = !usesYearInput;
  chartForm.elements.month.disabled = usesYearInput;
  chartForm.elements.year.disabled = !usesYearInput;
  chartForm.elements.month.required = !usesYearInput;
  chartForm.elements.year.required = usesYearInput;
  syncTransitSpeedInputs(periodModeInput.value);
}

function syncTransitSpeedInputs(periodMode) {
  const forceSlowOnly = isSingleYearMode(periodMode);
  const fastInput = chartForm.elements["category-fast"];
  const mediumInput = chartForm.elements["category-medium"];
  const slowInput = chartForm.elements["category-slow"];
  const moonInput = chartForm.elements.includeMoon;

  fastInput.disabled = forceSlowOnly;
  mediumInput.disabled = forceSlowOnly;
  slowInput.disabled = false;
  moonInput.disabled = forceSlowOnly;

  if (forceSlowOnly) {
    fastInput.checked = false;
    mediumInput.checked = false;
    slowInput.checked = true;
    moonInput.checked = false;
  } else {
    slowInput.disabled = false;
    fastInput.disabled = false;
    mediumInput.disabled = false;
    moonInput.disabled = false;
  }
}

function isSingleYearMode(periodMode) {
  return periodMode === "year_single" || periodMode === "year_single_portrait";
}

function isMonthlyInsightsMode(periodMode) {
  return periodMode === "month_insights";
}

function buildYearOverviewConfig(config) {
  return applyDefaults({
    ...config,
    filters: {
      ...config.filters,
      period_mode: "year_single_portrait",
      transit_categories: ["slow"],
      includeMoon: false
    }
  });
}

function readOrbSettings(formData) {
  return {
    Conjunction: readOrbNumber(formData, "orbConjunction", DEFAULT_ORB_SETTINGS.Conjunction),
    Opposition: readOrbNumber(formData, "orbOpposition", DEFAULT_ORB_SETTINGS.Opposition),
    Square: readOrbNumber(formData, "orbSquare", DEFAULT_ORB_SETTINGS.Square),
    Trine: readOrbNumber(formData, "orbTrine", DEFAULT_ORB_SETTINGS.Trine),
    Sextile: readOrbNumber(formData, "orbSextile", DEFAULT_ORB_SETTINGS.Sextile)
  };
}

function readOrbNumber(formData, fieldName, fallback) {
  const rawValue = String(formData.get(fieldName) || "").trim();
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid orb value for ${fieldName}.`);
  }

  return value;
}

function readRequiredText(formData, fieldName, label) {
  const value = String(formData.get(fieldName) || "").trim();
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function formatDateInput(natal) {
  return `${String(natal.year).padStart(4, "0")}-${String(natal.month).padStart(2, "0")}-${String(
    natal.day
  ).padStart(2, "0")}`;
}

function formatTimeInput(natal) {
  if (!natal.time_known) {
    return "";
  }

  return `${String(natal.hour || 0).padStart(2, "0")}:${String(natal.minute || 0).padStart(2, "0")}`;
}

function setResolvedCityMessage(city) {
  const pieces = [city.name];

  if (city.country) {
    pieces.push(city.country);
  }

  if (city.timezone || city.tz_str) {
    pieces.push(city.timezone || city.tz_str);
  }

  cityStatus.textContent = `Using ${pieces.join(" · ")}`;
}

function scheduleCitySearch() {
  window.clearTimeout(citySearchTimer);

  const query = cityInput.value.trim();
  if (query.length < 2) {
    renderCityResults([]);
    return;
  }

  citySearchTimer = window.setTimeout(async () => {
    const token = ++latestCitySearchToken;

    try {
      const results = await searchCities(query, {
        limit: query.length < 4 ? 5 : 8
      });

      if (token !== latestCitySearchToken) {
        return;
      }

      renderCityResults(results);
    } catch (error) {
      if (token !== latestCitySearchToken) {
        return;
      }

      cityStatus.textContent = "City lookup failed. You can still submit to try the top match.";
      renderCityResults([]);
    }
  }, 180);
}

function renderCityResults(results) {
  cityResults.replaceChildren();

  if (!results.length) {
    cityResults.hidden = true;
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "city-result";
    button.dataset.city = JSON.stringify(result);
    button.innerHTML = `
      <span>${escapeHtml(result.name)}</span>
      <span>${escapeHtml(result.country)} · ${escapeHtml(result.timezone)}</span>
    `;
    cityResults.append(button);
  }

  cityResults.hidden = false;
}

function handleCityResultClick(event) {
  const button = event.target.closest(".city-result");
  if (!button) {
    return;
  }

  selectedCity = JSON.parse(button.dataset.city);
  cityInput.value = `${selectedCity.name}, ${selectedCity.country}`;
  setResolvedCityMessage(selectedCity);
  renderCityResults([]);
  schedulePersistLastState();
}

function matchesSelectedCity(query, city) {
  const normalizedQuery = query.trim().toLowerCase();
  const cityLabel = `${city.name}, ${city.country}`.trim().toLowerCase();
  return normalizedQuery === cityLabel || normalizedQuery === String(city.name).trim().toLowerCase();
}

function readThemeSettings(formData) {
  return normalizeTheme(Object.fromEntries(
    Object.entries(THEME_FIELDS).map(([fieldName, themeKey]) => [
      themeKey,
      String(formData.get(fieldName) || "").trim() || DEFAULT_THEME[themeKey]
    ])
  ));
}

function applyPreviewTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.style.setProperty("--blue", normalized.panelBackground);
  document.documentElement.style.setProperty("--gold", normalized.panelText);
  document.documentElement.style.setProperty("--panel", normalized.panelBackground);
  document.documentElement.style.setProperty("--panel-ink", normalized.panelText);
  document.documentElement.style.setProperty("--panel-soft", normalized.panelMuted);
  document.documentElement.style.setProperty("--ink", normalized.panelText);
  document.documentElement.style.setProperty("--muted", normalized.panelMuted);
}

function renderPresetOptions() {
  populatePresetSelect(peoplePresetSelect, peoplePresets, "No saved profile");
  populatePresetSelect(themePresetSelect, themePresets, "No saved theme");
  peoplePresetSelect.value = selectedPersonPresetId;
  themePresetSelect.value = selectedThemePresetId;
}

function populatePresetSelect(select, presets, emptyLabel) {
  select.replaceChildren();
  select.append(new Option(emptyLabel, ""));
  for (const preset of presets) {
    select.append(new Option(preset.name, preset.id));
  }
}

function handlePeoplePresetChange() {
  selectedPersonPresetId = peoplePresetSelect.value;
  if (!selectedPersonPresetId) {
    schedulePersistLastState();
    return;
  }
  const preset = peoplePresets.find((item) => item.id === selectedPersonPresetId);
  if (!preset) {
    return;
  }
  applyPersonPreset(preset);
  schedulePersistLastState();
}

function handleThemePresetChange() {
  selectedThemePresetId = themePresetSelect.value;
  if (!selectedThemePresetId) {
    schedulePersistLastState();
    return;
  }
  const preset = themePresets.find((item) => item.id === selectedThemePresetId);
  if (!preset) {
    return;
  }
  populateThemeFields(normalizeTheme(preset.theme));
  applyPreviewTheme(preset.theme);
  schedulePersistLastState();
}

function handleSavePersonPreset() {
  const name = window.prompt("Profile name?");
  if (!name) {
    return;
  }
  const preset = {
    id: createId("person"),
    name: name.trim(),
    natal: buildPersonPresetPayload(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  peoplePresets.push(preset);
  selectedPersonPresetId = preset.id;
  persistCollection(STORAGE_KEYS.people, peoplePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function handleOverwritePersonPreset() {
  if (!selectedPersonPresetId) {
    return;
  }
  peoplePresets = peoplePresets.map((preset) => preset.id === selectedPersonPresetId ? {
    ...preset,
    natal: buildPersonPresetPayload(),
    updatedAt: new Date().toISOString()
  } : preset);
  persistCollection(STORAGE_KEYS.people, peoplePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function handleDeletePersonPreset() {
  if (!selectedPersonPresetId) {
    return;
  }
  peoplePresets = peoplePresets.filter((preset) => preset.id !== selectedPersonPresetId);
  selectedPersonPresetId = "";
  persistCollection(STORAGE_KEYS.people, peoplePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function handleSaveThemePreset() {
  const name = window.prompt("Theme name?");
  if (!name) {
    return;
  }
  const preset = {
    id: createId("theme"),
    name: name.trim(),
    theme: readThemeSettings(new FormData(chartForm)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  themePresets.push(preset);
  selectedThemePresetId = preset.id;
  persistCollection(STORAGE_KEYS.themes, themePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function handleOverwriteThemePreset() {
  if (!selectedThemePresetId) {
    return;
  }
  themePresets = themePresets.map((preset) => preset.id === selectedThemePresetId ? {
    ...preset,
    theme: readThemeSettings(new FormData(chartForm)),
    updatedAt: new Date().toISOString()
  } : preset);
  persistCollection(STORAGE_KEYS.themes, themePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function handleDeleteThemePreset() {
  if (!selectedThemePresetId) {
    return;
  }
  themePresets = themePresets.filter((preset) => preset.id !== selectedThemePresetId);
  selectedThemePresetId = "";
  persistCollection(STORAGE_KEYS.themes, themePresets);
  renderPresetOptions();
  schedulePersistLastState();
}

function buildPersonPresetPayload() {
  const formData = new FormData(chartForm);
  const birthDate = String(formData.get("birthDate") || "");
  const [yearText, monthText, dayText] = birthDate.split("-");
  const birthTime = String(formData.get("birthTime") || "").trim();
  const city = selectedCity || {
    name: String(formData.get("city") || "").trim(),
    lat: baseConfig?.natal?.lat ?? null,
    lng: baseConfig?.natal?.lng ?? null,
    timezone: baseConfig?.natal?.tz_str ?? ""
  };

  return {
    name: String(formData.get("name") || "").trim(),
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: birthTime ? Number(birthTime.split(":")[0]) : undefined,
    minute: birthTime ? Number(birthTime.split(":")[1] || "0") : undefined,
    time_known: Boolean(birthTime),
    city: city.name,
    country: city.country || "",
    lat: city.lat,
    lng: city.lng,
    tz_str: city.timezone || city.tz_str || ""
  };
}

function applyPersonPreset(preset) {
  const natal = preset.natal;
  chartForm.elements.name.value = natal.name || "";
  chartForm.elements.birthDate.value = formatDateInput(natal);
  chartForm.elements.birthTime.value = natal.time_known ? formatTimeInput(natal) : "";
  chartForm.elements.city.value = natal.country ? `${natal.city}, ${natal.country}` : natal.city || "";
  selectedCity = {
    name: natal.city,
    country: natal.country || "",
    lat: natal.lat,
    lng: natal.lng,
    timezone: natal.tz_str
  };
  setResolvedCityMessage(selectedCity);
}

function schedulePersistLastState() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistCollection(STORAGE_KEYS.lastState, buildLastState());
  }, 120);
}

function buildLastState() {
  return {
    formValues: readFormValues(),
    resolvedCity: selectedCity,
    selectedThemePresetId,
    selectedPersonPresetId
  };
}

function readFormValues() {
  const values = {};
  for (const element of chartForm.elements) {
    if (!element.name) {
      continue;
    }
    values[element.name] = element.type === "checkbox" ? element.checked : element.value;
  }
  return values;
}

function applyLastState() {
  const state = readStoredCollection(STORAGE_KEYS.lastState);
  if (!state || typeof state !== "object" || !state.formValues) {
    return;
  }

  for (const [name, value] of Object.entries(state.formValues)) {
    const element = chartForm.elements[name];
    if (!element) {
      continue;
    }
    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = String(value ?? "");
    }
  }

  selectedCity = state.resolvedCity || selectedCity;
  selectedThemePresetId = state.selectedThemePresetId || "";
  selectedPersonPresetId = state.selectedPersonPresetId || "";
  renderPresetOptions();
}

function readStoredCollection(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return key === STORAGE_KEYS.lastState ? null : [];
    }
    return JSON.parse(raw);
  } catch {
    return key === STORAGE_KEYS.lastState ? null : [];
  }
}

function persistCollection(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function removePagedPreview() {
  for (const pages of document.querySelectorAll(".pagedjs_pages")) {
    pages.remove();
  }
}

function setBusyState(nextBusyState) {
  isRendering = nextBusyState;
  renderButton.disabled = nextBusyState;
  printButton.disabled = nextBusyState;
  syncCopyJsonButton();
}

function syncCopyJsonButton() {
  copyJsonButton.disabled = isRendering || !latestDebugExport;
}

async function waitForNextPaint() {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function showRenderError(error) {
  statusPill.textContent = "Render failed";
  document.documentElement.style.setProperty("--page-width", "297mm");
  document.documentElement.style.setProperty("--page-height", "420mm");
  documentRoot.innerHTML = `
    <section class="month-page error-page">
      <h2>Unable to render transit timeline</h2>
      <p>${escapeHtml(error.message)}</p>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
