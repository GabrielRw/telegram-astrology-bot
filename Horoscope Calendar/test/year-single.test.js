import test from "node:test";
import assert from "node:assert/strict";

import { applyDefaults, buildInsightsPayload, buildNatalChartSvgPayload, buildTimelinePayload } from "../src/config.js";
import { getDocumentPageMetrics, mergeYearlyRenderedSegments, sanitizeNatalSvgMarkup } from "../src/render.js";
import { normalizeInsightsTimeline } from "../src/normalize.js";
import {
  clipUtcIntervalToWindow,
  filterIsoDatesToWindow,
  getUtcDayOffsetInWindow,
  getYearWindow
} from "../src/year-range.js";

function createConfig(overrides = {}) {
  return applyDefaults({
    month: "2026-01",
    natal: {
      name: "Gabriel",
      year: 1995,
      month: 9,
      day: 5,
      hour: 20,
      minute: 0,
      time_known: true,
      city: "Paris",
      lat: 48.8566,
      lng: 2.3522,
      tz_str: "Europe/Paris"
    },
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: true,
      period_mode: "year_single"
    },
    ...overrides
  });
}

test("getYearWindow returns the correct full-year bounds for leap and non-leap years", () => {
  const standardYear = getYearWindow("2025");
  const leapYear = getYearWindow("2024-01");

  assert.equal(standardYear.rangeStart, "2025-01-01");
  assert.equal(standardYear.rangeEnd, "2025-12-31");
  assert.equal(standardYear.totalDays, 365);

  assert.equal(leapYear.rangeStart, "2024-01-01");
  assert.equal(leapYear.rangeEnd, "2024-12-31");
  assert.equal(leapYear.totalDays, 366);
});

test("clipUtcIntervalToWindow clips transits to the visible year window", () => {
  const window = getYearWindow("2026");
  const clipped = clipUtcIntervalToWindow(
    "2025-12-20T00:00:00Z",
    "2026-02-15T12:00:00Z",
    window
  );

  assert.ok(clipped);
  assert.equal(clipped.continuesPrev, true);
  assert.equal(clipped.continuesNext, false);
  assert.equal(clipped.startsInWindow, false);
  assert.equal(clipped.endsInWindow, true);
  assert.equal(clipped.startOffsetDays, 0);
  assert.equal(clipped.endOffsetDays, 45.5);
});

test("yearly exact-hit helpers keep only dates inside the requested year", () => {
  const window = getYearWindow("2026");
  const exactHits = filterIsoDatesToWindow([
    "2025-12-30T12:00:00Z",
    "2026-03-01T06:00:00Z",
    "2026-10-14T18:30:00Z",
    "2027-01-01T00:00:00Z"
  ], window);

  assert.deepEqual(exactHits, [
    "2026-03-01T06:00:00Z",
    "2026-10-14T18:30:00Z"
  ]);
  assert.equal(getUtcDayOffsetInWindow("2026-03-01T06:00:00Z", window), 59.25);
  assert.equal(getUtcDayOffsetInWindow("2027-01-01T00:00:00Z", window), null);
});

test("buildTimelinePayload forces year_slow and slow-only request fields for year_single", () => {
  const config = createConfig();
  const payload = buildTimelinePayload(config);

  assert.equal(payload.daysInMonth, 365);
  assert.equal(payload.request.mode, "year_slow");
  assert.equal(payload.request.range_start, "2026-01-01");
  assert.equal(payload.request.range_end, "2026-12-31");
  assert.deepEqual(payload.request.transit_categories, ["slow"]);
  assert.equal("transit_planets" in payload.request, false);
});

test("buildTimelinePayload uses the same yearly contract for portrait yearly mode", () => {
  const config = createConfig({
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: true,
      period_mode: "year_single_portrait"
    }
  });
  const payload = buildTimelinePayload(config);

  assert.equal(payload.daysInMonth, 365);
  assert.equal(payload.request.mode, "year_slow");
  assert.equal(payload.request.range_start, "2026-01-01");
  assert.equal(payload.request.range_end, "2026-12-31");
  assert.deepEqual(payload.request.transit_categories, ["slow"]);
  assert.equal("transit_planets" in payload.request, false);
});

test("buildNatalChartSvgPayload includes retrograde markers in chart_config", () => {
  const config = createConfig({
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: true,
      period_mode: "month"
    }
  });
  const payload = buildNatalChartSvgPayload(config);

  assert.equal(payload.chart_config.show_retrograde_markers, true);
  assert.equal(payload.chart_config.retrograde_marker_style, "R");
  assert.ok(Math.abs(payload.chart_config.planet_symbol_scale - 0.455) < 1e-9);
  assert.equal(payload.chart_config.french_planet_radius_offset, 50);
  assert.equal(payload.chart_config.french_degree_label_offset, 30);
  assert.equal(payload.chart_config.degree_label_scale, 0.5);
});

test("buildInsightsPayload uses the monthly insights contract without unsupported simplification flags", () => {
  const config = createConfig({
    month: "2026-03",
    filters: {
      transit_categories: ["fast", "medium"],
      includeMoon: true,
      showRetrogradeMarkers: false,
      period_mode: "month_insights"
    }
  });
  const payload = buildInsightsPayload(config);

  assert.equal(payload.daysInMonth, 31);
  assert.equal(payload.request.mode, "month");
  assert.equal(payload.request.range_start, "2026-03-01");
  assert.equal(payload.request.range_end, "2026-03-31");
  assert.deepEqual(payload.request.transit_categories, ["fast", "medium"]);
  assert.equal(payload.request.include_houses, true);
  assert.deepEqual(payload.request.transit_planets.slice(0, 3), ["moon", "sun", "mercury"]);
  assert.equal("separate_signatures_from_facts" in payload.request, false);
});

test("document page metrics preserve monthly portrait, yearly landscape, and yearly portrait modes", () => {
  const monthlyMetrics = getDocumentPageMetrics([], null);
  assert.deepEqual(monthlyMetrics, {
    pageWidth: "297mm",
    pageHeight: "420mm"
  });

  const landscapeMetrics = getDocumentPageMetrics([{
    kind: "yearly",
    config: {
      filters: {
        period_mode: "year_single"
      }
    }
  }], null);
  assert.deepEqual(landscapeMetrics, {
    pageWidth: "420mm",
    pageHeight: "297mm"
  });

  const portraitMetrics = getDocumentPageMetrics([{
    kind: "yearly",
    config: {
      filters: {
        period_mode: "year_single_portrait"
      }
    }
  }], null);
  assert.deepEqual(portraitMetrics, {
    pageWidth: "297mm",
    pageHeight: "420mm"
  });
});

test("sanitizeNatalSvgMarkup preserves degree halo and filled degree text", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text x="10" y="10" fill="none" stroke="#343a40" stroke-width="3px">26°</text>
      <text x="10" y="10" fill="#d3bd8a" stroke="none">26°</text>
      <text x="20" y="20" fill="none" stroke="#343a40" stroke-width="3px">☿</text>
    </svg>
  `;

  const sanitized = sanitizeNatalSvgMarkup(svg);
  assert.equal((sanitized.match(/>26°</g) || []).length, 2);
  assert.match(sanitized, /fill="none"[^>]*stroke="#343a40"[^>]*>26°</);
  assert.match(sanitized, /fill="#d3bd8a"[^>]*>26°</);
  assert.match(sanitized, /fill="none"[^>]*>☿</);
});

test("normalizeInsightsTimeline maps fact windows onto the monthly chart rows", () => {
  const config = createConfig({
    month: "2026-03",
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: false,
      render_mode: "full",
      period_mode: "month_insights"
    }
  });
  const payload = buildInsightsPayload(config);
  const model = normalizeInsightsTimeline(config, payload, {
    meta: {
      endpoint: "western_transit_insights",
      mode: "month"
    },
    importance: [{
      rank: 1,
      score: 0.88,
      title: "Mercury Station Direct",
      source_fact_ids: ["fact-station-1"]
    }],
    facts: [
      {
        id: "fact-station-1",
        category: "mind",
        detector: "station_ingress_events.stations.v1",
        kind: "station",
        start_datetime: "2026-03-08T03:00:00Z",
        end_datetime: "2026-03-14T03:00:00Z",
        peak_datetime: "2026-03-11T03:00:00Z",
        is_point_event: false,
        strength: 0.88,
        priority: 86,
        subjects: ["mercury", "station_direct"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "mercury__station_direct",
        search_text: "",
        evidence: {
          station_type: "station_direct",
          start_datetime: "2026-03-08T03:00:00Z",
          end_datetime: "2026-03-14T03:00:00Z",
          peak_datetime: "2026-03-11T03:00:00Z",
          transit_planets: ["mercury"],
          natal_points: []
        }
      },
      {
        id: "fact-topic-1",
        category: "structure",
        detector: "topics.career.v1",
        kind: "background_theme_window",
        start_datetime: "2026-03-01T00:00:00Z",
        end_datetime: "2026-03-31T23:59:59Z",
        peak_datetime: "2026-03-12T18:00:00Z",
        is_point_event: false,
        strength: 0.72,
        priority: 82,
        subjects: ["career"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "career",
        search_text: "",
        evidence: {
          topic_title: "Career Window",
          start_datetime: "2026-03-01T00:00:00Z",
          end_datetime: "2026-03-31T23:59:59Z",
          peak_datetime: "2026-03-12T18:00:00Z",
          houses: [10]
        }
      },
      {
        id: "fact-clipped-1",
        category: "relationships",
        detector: "activation_clusters.retrograde_cycle.v1",
        kind: "retrograde_loop_phase",
        start_datetime: "2026-03-29T20:23:26Z",
        end_datetime: "2026-04-09T00:43:35Z",
        peak_datetime: "2026-03-20T19:32:48Z",
        is_point_event: false,
        strength: 0.74,
        priority: 84,
        subjects: ["mercury", "station_direct"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "mercury__loop",
        search_text: "",
        evidence: {
          loop_body: "mercury",
          loop_phase: "station_direct",
          start_datetime: "2026-03-29T20:23:26Z",
          end_datetime: "2026-04-09T00:43:35Z",
          peak_datetime: "2026-03-20T19:32:48Z"
        }
      }
    ]
  });

  assert.equal(model.kind, "monthly_insights");
  assert.equal(model.rows.length, 3);
  assert.deepEqual(model.groups.map((group) => group.label), ["MIND", "RELATIONSHIPS", "STRUCTURE"]);
  assert.equal(model.rows[0].entryLabel, "Mercury Station Direct");
  assert.equal(model.rows[0].entrySymbols, "☿");
  assert.equal(model.rows[0].startDay, 8);
  assert.equal(model.rows[0].endDay, 14);
  assert.deepEqual(model.rows[0].metadata.exactHitsInMonth, ["2026-03-11T03:00:00Z"]);
  assert.equal(model.rows[1].continuesNext, true);
  assert.equal(model.rows[1].endDay, 31);
  assert.equal(model.rows[2].entryLabel, "Career Window · 10⌂");
  assert.equal(model.rows[0].metadata.insight.isPointEvent, false);
});

test("normalizeInsightsTimeline expands ingress point events into active windows", () => {
  const config = createConfig({
    month: "2026-03",
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: false,
      render_mode: "full",
      period_mode: "month_insights"
    }
  });
  const payload = buildInsightsPayload(config);
  const model = normalizeInsightsTimeline(config, payload, {
    meta: {
      endpoint: "western_transit_insights",
      mode: "month"
    },
    facts: [
      {
        id: "fact-point-1",
        category: "growth",
        detector: "station_ingress_events.sign_ingresses.v1",
        kind: "ingress",
        start_datetime: "2026-03-09T00:00:00Z",
        end_datetime: "2026-03-09T00:00:00Z",
        peak_datetime: "2026-03-09T00:00:00Z",
        is_point_event: true,
        strength: 0.67,
        priority: 80,
        subjects: ["jupiter", "aries"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "jupiter__aries",
        search_text: "",
        evidence: {
          ingress_type: "sign",
          sign_id: "aries",
          transit_planets: ["jupiter"]
        }
      },
      {
        id: "fact-point-2",
        category: "growth",
        detector: "station_ingress_events.sign_ingresses.v1",
        kind: "ingress",
        start_datetime: "2026-03-21T00:00:00Z",
        end_datetime: "2026-03-21T00:00:00Z",
        peak_datetime: "2026-03-21T00:00:00Z",
        is_point_event: true,
        strength: 0.6,
        priority: 78,
        subjects: ["jupiter", "taurus"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "jupiter__taurus",
        search_text: "",
        evidence: {
          ingress_type: "sign",
          sign_id: "taurus",
          transit_planets: ["jupiter"]
        }
      }
    ]
  });

  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].startDay, 9);
  assert.equal(model.rows[0].endDay, 20);
  assert.deepEqual(model.rows[0].metadata.exactHitsInMonth, ["2026-03-09T00:00:00Z"]);
  assert.equal(model.rows[0].metadata.insight.isPointEvent, false);
  assert.equal(model.rows[1].startDay, 21);
  assert.equal(model.rows[1].endDay, 31);
});

test("normalizeInsightsTimeline prefixes useful multi-body facts with planet glyphs", () => {
  const config = createConfig({
    month: "2026-03",
    filters: {
      transit_categories: ["fast", "medium", "slow"],
      includeMoon: true,
      showRetrogradeMarkers: false,
      render_mode: "full",
      period_mode: "month_insights"
    }
  });
  const payload = buildInsightsPayload(config);
  const model = normalizeInsightsTimeline(config, payload, {
    meta: {
      endpoint: "western_transit_insights",
      mode: "month"
    },
    facts: [
      {
        id: "fact-stellium-1",
        category: "chart_pattern",
        detector: "stelliums.sign.v1",
        kind: "stellium",
        start_datetime: "2026-03-01T00:00:00Z",
        end_datetime: "2026-03-18T23:59:59Z",
        peak_datetime: "2026-03-09T12:00:00Z",
        is_point_event: false,
        strength: 0.82,
        priority: 86,
        subjects: ["pisces", "mercury", "venus", "saturn"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "stellium__pisces",
        search_text: "",
        evidence: {
          sign_id: "pisces",
          count: 3,
          transit_planets: ["mercury", "venus", "saturn"]
        }
      },
      {
        id: "fact-career-1",
        category: "structure",
        detector: "topics.career.v1",
        kind: "background_theme_window",
        start_datetime: "2026-03-01T00:00:00Z",
        end_datetime: "2026-03-31T23:59:59Z",
        peak_datetime: "2026-03-12T18:00:00Z",
        is_point_event: false,
        strength: 0.72,
        priority: 82,
        subjects: ["career"],
        tags: [],
        flags: {},
        index_keys: [],
        relation_key: "career",
        search_text: "",
        evidence: {
          topic_title: "Career Window",
          transit_planets: ["sun", "lilith", "uranus"],
          matched_houses: [10]
        }
      }
    ]
  });

  assert.equal(model.rows[0].entrySymbols, "☿♀♄ ♓");
  assert.equal(model.rows[1].entrySymbols, "☉⚸♅ H10");
});

test("mergeYearlyRenderedSegments collapses yearly passes that overlap after slot snapping", () => {
  const yearWindow = getYearWindow("2026");
  const merged = mergeYearlyRenderedSegments([
    {
      category: "slow",
      periodStartOffset: 0,
      periodEndOffset: 10,
      startDatetime: "2026-01-01T00:00:00Z",
      endDatetime: "2026-01-11T00:00:00Z",
      exactHitsInMonth: ["2026-01-05T00:00:00Z"],
      exactDatetimes: ["2026-01-05T00:00:00Z"],
      continuesPrev: false,
      continuesNext: false
    },
    {
      category: "slow",
      periodStartOffset: 8,
      periodEndOffset: 12,
      startDatetime: "2026-01-09T00:00:00Z",
      endDatetime: "2026-01-13T00:00:00Z",
      exactHitsInMonth: ["2026-01-10T00:00:00Z"],
      exactDatetimes: ["2026-01-10T00:00:00Z"],
      continuesPrev: false,
      continuesNext: true
    },
    {
      category: "slow",
      periodStartOffset: 40,
      periodEndOffset: 46,
      startDatetime: "2026-02-10T00:00:00Z",
      endDatetime: "2026-02-16T00:00:00Z",
      exactHitsInMonth: ["2026-02-12T00:00:00Z"],
      exactDatetimes: ["2026-02-12T00:00:00Z"],
      continuesPrev: false,
      continuesNext: false
    }
  ], yearWindow, 300, 600);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].exactHitsInMonth, [
    "2026-01-05T00:00:00Z",
    "2026-01-10T00:00:00Z"
  ]);
  assert.equal(merged[0].continuesNext, true);
  assert.ok(merged[0].barEndX < merged[1].barStartX);
});
