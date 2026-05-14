import { getUtcDayOffsetInWindow, getYearWindow } from "./year-range.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHLY_CONTENT_WIDTH = 980;
const LABEL_COLUMN_WIDTH = 350;
const PLOT_RIGHT_PADDING = 34;
const TOP_AXIS_HEIGHT = 80;
const BOTTOM_PADDING = 8;
const GROUP_HEADER_HEIGHT = 16;
const GROUP_HEADER_BASELINE_OFFSET = 14;
const HEADER_TO_ROWS_GAP = 4;
const ROW_PITCH = 14;
const ROW_CENTER_OFFSET = 7;
const ROW_TEXT_BASELINE_OFFSET = 4;
const GROUP_GAP = 12;
const GROUP_SEPARATOR_OFFSET = 6;
const GROUP_GLYPH_X = 34;
const GROUP_TITLE_X = 66;
const ROW_SYMBOLS_X = 66;
const ROW_TEXT_X = 132;
const GROUP_SEPARATOR_X = 44;
const DAY_WEEKDAY_Y = 12;
const DAY_NUMBER_Y = 25;
const DAY_MOON_ICON_Y = 31;
const DAY_MOON_ICON_SIZE = 12;
const INSIGHT_ROW_SYMBOLS_RIGHT_EDGE = ROW_TEXT_X - 14;
const HOUSE_MARKER_HEIGHT = 2.5;
const HOUSE_MARKER_LABEL_OFFSET = 5;
const YEARLY_MONTH_SLOT_COUNT = 4;
const YEARLY_LANDSCAPE_LAYOUT = {
  width: 1360,
  labelColumnWidth: 360,
  plotRightPadding: 24,
  topAxisHeight: 58,
  bottomPadding: 12,
  groupHeaderHeight: 14,
  groupHeaderBaselineOffset: 12,
  headerToRowsGap: 4,
  groupGap: 8,
  groupSeparatorOffset: 4,
  groupGlyphX: 34,
  groupTitleX: 58,
  rowSymbolsX: 58,
  rowTextX: 122,
  groupSeparatorX: 40,
  plotHeight: 720,
  rowPitchMin: 7.25,
  rowPitchMax: 11.5,
  barHeight: 2.8,
  labelFontSize: 10.25,
  groupFontSize: 16,
  symbolFontSize: 10.4
};
const YEARLY_PORTRAIT_LAYOUT = {
  width: 980,
  labelColumnWidth: 280,
  plotRightPadding: 18,
  topAxisHeight: 60,
  bottomPadding: 12,
  groupHeaderHeight: 14,
  groupHeaderBaselineOffset: 12,
  headerToRowsGap: 4,
  groupGap: 8,
  groupSeparatorOffset: 4,
  groupGlyphX: 24,
  groupTitleX: 46,
  rowSymbolsX: 46,
  rowTextX: 96,
  groupSeparatorX: 30,
  plotHeight: 760,
  rowPitchMin: 7,
  rowPitchMax: 10,
  barHeight: 2.6,
  labelFontSize: 9.4,
  groupFontSize: 14,
  symbolFontSize: 9.6
};

export function renderMonthlyDocument(root, models, coverModel = null) {
  root.replaceChildren();
  applyDocumentPageMetrics(models, coverModel);

  if (coverModel) {
    root.append(buildCoverPage(coverModel));
  }

  for (const model of models) {
    root.append(model.kind === "yearly" ? buildYearlyPage(model) : buildMonthlyPage(model));
  }
}

function buildMonthlyPage(model) {
  const page = document.createElement("section");
  page.className = "month-page monthly-page";
  applyThemeVars(page, model.config.theme);
  page.style.setProperty("--monthly-content-width", `${MONTHLY_CONTENT_WIDTH}px`);
  page.style.setProperty("--monthly-header-offset-ratio", String(GROUP_TITLE_X / MONTHLY_CONTENT_WIDTH));

  const header = document.createElement("header");
  header.className = "page-header monthly-page-header";
  header.innerHTML = `
    <div class="header-main">
      <div>
        <h2>${escapeHtml(model.config.title || model.monthLabel)}</h2>
      </div>
    </div>
  `;

  const chartCard = document.createElement("div");
  chartCard.className = "chart-card";
  chartCard.appendChild(buildTimelineSvg(model));

  const legendFooter = buildLegendFooter(model.config.theme, model.kind === "monthly_insights"
    ? {
        showRetrograde: false,
        lineLabel: "Insight Window",
        dotLabel: "Peak"
      }
    : undefined);

  page.append(header, chartCard, legendFooter);
  return page;
}

export function renderPanelMeta(target, models, coverModel = null) {
  target.replaceChildren();

  const modelList = Array.isArray(models) ? models : [models];
  if (!modelList.length) {
    const items = [
      ["Mode", "Cover"],
      ["Pages", String(coverModel ? 1 : 0)],
      ["Rows", "0"],
      ["Days", "N/A"],
      ["API", "/api/v1/natal/chart/"],
      ["Generated", new Date().toISOString()]
    ];

    for (const [label, value] of items) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      target.append(dt, dd);
    }
    return;
  }

  const primaryModel = modelList[0];
  const totalRowsShown = modelList.reduce((sum, model) => sum + model.rows.length, 0);
  const totalRowsAvailable = modelList.reduce((sum, model) => sum + (model.rowsAll ? model.rowsAll.length : model.rows.length), 0);

  const items = [
    ["Mode", primaryModel.config.filters.render_mode === "full" ? "Full" : "Curated"],
    ["API Mode", primaryModel.inputMode || "month"],
    ["Pages", String(modelList.length + (coverModel ? 1 : 0))],
    ["Rows", `${totalRowsShown}${totalRowsAvailable ? ` / ${totalRowsAvailable}` : ""}`],
    ["Days", modelList.length === 1 ? String(primaryModel.daysInMonth) : "12 months"],
    ["API", primaryModel.meta.endpoint],
    ["Generated", primaryModel.meta.generated_at]
  ];

  for (const [label, value] of items) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    target.append(dt, dd);
  }
}

function buildYearlyPage(model) {
  const page = document.createElement("section");
  const isPortrait = model.config.filters.period_mode === "year_single_portrait";
  page.className = `month-page year-page ${isPortrait ? "year-page-portrait" : "year-page-landscape"}`;
  applyThemeVars(page, model.config.theme);

  const header = document.createElement("header");
  header.className = "page-header";
  header.innerHTML = `
    <div class="header-main">
      <div>
        <h2>${escapeHtml(model.config.title || model.monthLabel)}</h2>
        <p class="header-subtitle">Slow transits across the full year</p>
      </div>
    </div>
  `;

  const chartCard = document.createElement("div");
  chartCard.className = "chart-card";
  chartCard.appendChild(buildYearlyTimelineSvg(model, getYearlyLayout(model)));

  const legendFooter = buildLegendFooter(model.config.theme, {
    showRetrograde: false
  });

  page.append(header, chartCard, legendFooter);
  return page;
}

export function buildCoverModel(config, svgMarkup) {
  return {
    config,
    svgMarkup: sanitizeNatalSvgMarkup(svgMarkup),
    birthLine: formatBirthLine(config.natal),
    locationLine: config.natal.city || "",
    title: config.natal.name || "Natal Chart"
  };
}

function buildCoverPage(model) {
  const page = document.createElement("section");
  page.className = "month-page cover-page";
  applyThemeVars(page, model.config.theme);

  const header = document.createElement("header");
  header.className = "cover-header";
  header.innerHTML = `
    <p class="cover-kicker">Theme Natal</p>
    <h1>${escapeHtml(model.title)}</h1>
    <p class="cover-birth">${escapeHtml(model.birthLine)}</p>
    <p class="cover-location">${escapeHtml(model.locationLine)}</p>
  `;

  const chartFrame = document.createElement("div");
  chartFrame.className = "cover-chart";
  chartFrame.innerHTML = model.svgMarkup;

  page.append(header, chartFrame);
  return page;
}

function buildTimelineSvg(model) {
  const theme = model.config.theme;
  const chartBackground = theme.pageBackground;
  const transitBarColor = theme.transitLineColor;
  const separatorColor = theme.separatorColor;
  const glyphColor = theme.glyphColor;
  const pageText = theme.pageText;
  const exactDotStroke = theme.exactDotStroke;
  const exactDotFill = theme.exactDotFill;
  const width = MONTHLY_CONTENT_WIDTH;
  const plotLeft = LABEL_COLUMN_WIDTH;
  const plotWidth = width - LABEL_COLUMN_WIDTH - PLOT_RIGHT_PADDING;
  const plotTop = TOP_AXIS_HEIGHT;
  const retroSectionLayout = buildStandaloneSectionLayout("RETROGRADES", model.retrogrades || [], plotTop);
  const groupsStartY = retroSectionLayout ? retroSectionLayout.endY + GROUP_GAP : plotTop;
  const groupLayouts = buildGroupLayouts(model.groups, model.rows, groupsStartY);
  const plotHeight = Math.max(
    340,
    getContentEndY({ retroSectionLayout, groupLayouts, plotTop }) - plotTop
  );
  const height = TOP_AXIS_HEIGHT + plotHeight + BOTTOM_PADDING;
  const dayWidth = plotWidth / model.daysInMonth;
  const weekdayLetters = buildWeekdayLetters(model.config.month, model.daysInMonth);
  const monthWindow = getMonthWindow(model.config.month);
  const retrogradeSegmentsByBody = buildRetrogradeSegmentsByBody(model.retrogrades || []);
  const moonPhaseMap = new Map((model.moonPhases || []).map((phase) => [phase.day, phase]));
  const labelFontSize = 11.5;
  const groupHeaderFontSize = 19;
  const groupGlyphFontSize = 14;
  const rowSymbolFontSize = 11.5;
  const barHeight = 2.2;
  const rowSymbolLayout = getMonthlyRowSymbolLayout(model);
  const svg = createSvgNode("svg", {
    class: "timeline-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${model.monthLabel} transit timeline`
  });
  const defs = createSvgNode("defs");
  svg.appendChild(defs);

  svg.appendChild(createSvgNode("rect", {
    class: "chart-background",
    x: "0",
    y: "0",
    width: String(width),
    height: String(height),
    fill: chartBackground
  }));

  for (let day = 0; day <= model.daysInMonth; day += 1) {
    if (day === 0 || day === model.daysInMonth) {
      continue;
    }

    const x = plotLeft + day * dayWidth;
    svg.appendChild(createSvgNode("line", {
      x1: String(x),
      y1: String(plotTop - 12),
      x2: String(x),
      y2: String(plotTop + plotHeight),
      stroke: separatorColor,
      "stroke-width": "1",
      opacity: "0.18"
    }));
  }

  for (let day = 1; day <= model.daysInMonth; day += 1) {
    const x = plotLeft + (day - 0.5) * dayWidth;
    const moonPhase = moonPhaseMap.get(day);
    if (moonPhase && moonPhase.moon_visual && moonPhase.moon_visual.svg) {
      svg.appendChild(createSvgNode("image", {
        x: String(x - DAY_MOON_ICON_SIZE / 2),
        y: String(DAY_MOON_ICON_Y),
        width: String(DAY_MOON_ICON_SIZE),
        height: String(DAY_MOON_ICON_SIZE),
        href: svgToDataUrl(moonPhase.moon_visual.svg),
        preserveAspectRatio: "xMidYMid meet"
      }));
    }

    svg.appendChild(createSvgNode("text", {
      x: String(x),
      y: String(DAY_WEEKDAY_Y),
      "text-anchor": "middle",
      class: "axis-weekday",
      fill: pageText
    }, weekdayLetters[day - 1]));

    svg.appendChild(createSvgNode("text", {
      x: String(x),
      y: String(DAY_NUMBER_Y),
      "text-anchor": "middle",
      class: "axis-number",
      fill: pageText
    }, String(day)));
  }

  for (const groupLayout of groupLayouts) {
    if (groupLayout.separatorY === null) {
      continue;
    }

    svg.appendChild(createSvgNode("line", {
      x1: String(GROUP_SEPARATOR_X),
      y1: String(groupLayout.separatorY),
      x2: String(plotLeft + plotWidth),
      y2: String(groupLayout.separatorY),
      stroke: separatorColor,
      "stroke-width": "0.8",
      opacity: "0.16"
    }));
  }

  if (retroSectionLayout) {
    svg.appendChild(createSvgNode("text", {
      x: String(GROUP_TITLE_X),
      y: String(retroSectionLayout.headerBaselineY),
      class: "group-label",
      fill: glyphColor,
      "font-size": String(groupHeaderFontSize)
    }, retroSectionLayout.label));

    if (retroSectionLayout.separatorY !== null) {
      svg.appendChild(createSvgNode("line", {
        x1: String(GROUP_SEPARATOR_X),
        y1: String(retroSectionLayout.separatorY),
        x2: String(plotLeft + plotWidth),
        y2: String(retroSectionLayout.separatorY),
        stroke: separatorColor,
        "stroke-width": "0.8",
        opacity: "0.16"
      }));
    }

    for (const rowLayout of retroSectionLayout.rows) {
      const { row, centerY } = rowLayout;
      const barX = plotLeft + (row.startDay - 1) * dayWidth + 2;
      const barWidth = Math.max(dayWidth - 4, (row.endDay - row.startDay + 1) * dayWidth - 4);

      svg.appendChild(createSvgNode("text", {
        x: String(rowSymbolLayout.x),
        y: String(centerY + ROW_TEXT_BASELINE_OFFSET),
        class: "row-symbols",
        fill: glyphColor,
        "font-size": String(rowSymbolFontSize),
        "text-anchor": rowSymbolLayout.textAnchor
      }, row.entrySymbols));

      svg.appendChild(createSvgNode("text", {
        x: String(ROW_TEXT_X),
        y: String(centerY + ROW_TEXT_BASELINE_OFFSET),
        class: "row-label",
        fill: pageText,
        "font-size": String(labelFontSize)
      }, truncateLabel(row.entryLabel, 30)));

      const bar = createSvgNode("line", {
        x1: String(barX),
        y1: String(centerY),
        x2: String(barX + barWidth),
        y2: String(centerY),
        stroke: transitBarColor,
        "stroke-width": String(barHeight * 1.8),
        "stroke-linecap": "butt",
        "stroke-dasharray": "12 4",
        opacity: "0.88"
      });
      bar.appendChild(
        createSvgNode("title", {}, `${row.entryLabel}\n${row.startDatetime} -> ${row.endDatetime}${formatHouseTooltip(row.houses || row.metadata?.houses)}`)
      );
      svg.appendChild(bar);

      if (row.continuesPrev) {
        appendContinuationTail(svg, {
          direction: "left",
          edgeX: plotLeft + 2,
          centerY,
          color: transitBarColor,
          strokeWidth: Math.max(1, barHeight)
        });
      }

      if (row.continuesNext) {
        appendContinuationTail(svg, {
          direction: "right",
          edgeX: plotLeft + plotWidth,
          centerY,
          color: transitBarColor,
          strokeWidth: Math.max(1, barHeight)
        });
      }
    }
  }

  for (const groupLayout of groupLayouts) {
    svg.appendChild(createSvgNode("text", {
      x: String(GROUP_GLYPH_X),
      y: String(groupLayout.headerBaselineY),
      class: "group-glyph",
      fill: glyphColor,
      "font-size": String(groupGlyphFontSize)
    }, groupLayout.group.symbol));

    svg.appendChild(createSvgNode("text", {
      x: String(GROUP_TITLE_X),
      y: String(groupLayout.headerBaselineY),
      class: "group-label",
      fill: glyphColor,
      "font-size": String(groupHeaderFontSize)
    }, groupLayout.group.label));

    for (const rowLayout of groupLayout.rows) {
      const { row, centerY } = rowLayout;
      const barColor = transitBarColor;

      svg.appendChild(createSvgNode("text", {
        x: String(rowSymbolLayout.x),
        y: String(centerY + ROW_TEXT_BASELINE_OFFSET),
        class: "row-symbols",
        fill: glyphColor,
        "font-size": String(rowSymbolFontSize),
        "text-anchor": rowSymbolLayout.textAnchor
      }, row.entrySymbols));

      svg.appendChild(createSvgNode("text", {
        x: String(ROW_TEXT_X),
        y: String(centerY + ROW_TEXT_BASELINE_OFFSET),
        class: "row-label",
        fill: pageText,
        "font-size": String(labelFontSize)
      }, truncateLabel(row.entryLabel, 30)));

      const segments = row.metadata.segments && row.metadata.segments.length
        ? row.metadata.segments
        : [{
            startDay: row.startDay,
            endDay: row.endDay,
            continuesPrev: row.continuesPrev,
            continuesNext: row.continuesNext,
            startDatetime: row.metadata.startDatetime,
            endDatetime: row.metadata.endDatetime,
            exactDatetimes: row.metadata.exactDatetimes || [],
            exactHitsInMonth: row.metadata.exactHitsInMonth || []
          }];

      for (const [segmentIndex, segment] of segments.entries()) {
        const barX = plotLeft + (segment.startDay - 1) * dayWidth + 2;
        const barWidth = Math.max(dayWidth - 4, (segment.endDay - segment.startDay + 1) * dayWidth - 4);
        const gradientId = `transit-strength-${row.rowIndex}-${segmentIndex}`;

        defs.appendChild(
          buildStrengthGradient({
            gradientId,
            segment,
            monthWindow,
            color: barColor
          })
        );

        const bar = createSvgNode("rect", {
          x: String(barX),
          y: String(centerY - barHeight / 2),
          width: String(barWidth),
          height: String(barHeight),
          rx: String(barHeight / 2),
          fill: `url(#${gradientId})`
        });
        bar.appendChild(
          createSvgNode("title", {}, `${row.label}\n${segment.startDatetime} -> ${segment.endDatetime}${formatHouseTooltip(segment.houses)}`)
        );
        svg.appendChild(bar);

        if (model.config.filters.showRetrogradeMarkers) {
          appendRetrogradeMarkers(svg, {
            transitPlanet: row.transitPlanet,
            segment,
            retrogradeSegmentsByBody,
            monthWindow,
            plotLeft,
            dayWidth,
            centerY,
            color: barColor,
            strokeWidth: Math.max(1.25, barHeight + 0.5)
          });
        }

        // House markers on the plot are currently disabled in favor of the
        // left-column house suffix in the row label.

        if (segment.continuesPrev) {
          appendContinuationTail(svg, {
            direction: "left",
            edgeX: plotLeft + 2,
            centerY,
            color: barColor,
            strokeWidth: Math.max(1, barHeight)
          });
        }

        if (segment.continuesNext) {
          appendContinuationTail(svg, {
            direction: "right",
            edgeX: plotLeft + plotWidth,
            centerY,
            color: barColor,
            strokeWidth: Math.max(1, barHeight)
          });
        }
      }

      appendExactHitDots(svg, {
        exactHitsInMonth: row.metadata.exactHitsInMonth,
        monthWindow,
        plotLeft,
        dayWidth,
        centerY,
        color: barColor,
        background: exactDotFill,
        stroke: exactDotStroke,
        radius: 2.4
      });
    }
  }

  return svg;
}

function buildYearlyTimelineSvg(model, layout) {
  const theme = model.config.theme;
  const chartBackground = theme.pageBackground;
  const transitBarColor = theme.transitLineColor;
  const separatorColor = theme.separatorColor;
  const glyphColor = theme.glyphColor;
  const pageText = theme.pageText;
  const exactDotStroke = theme.exactDotStroke;
  const exactDotFill = theme.exactDotFill;
  const yearWindow = model.yearWindow || getYearWindow(model.config.month);
  const width = layout.width;
  const plotLeft = layout.labelColumnWidth;
  const plotWidth = width - layout.labelColumnWidth - layout.plotRightPadding;
  const plotTop = layout.topAxisHeight;
  const plotHeight = layout.plotHeight;
  const height = layout.topAxisHeight + layout.plotHeight + layout.bottomPadding;
  const svg = createSvgNode("svg", {
    class: "timeline-svg yearly-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${model.monthLabel} yearly transit timeline`
  });
  const defs = createSvgNode("defs");
  svg.appendChild(defs);

  svg.appendChild(createSvgNode("rect", {
    class: "chart-background",
    x: "0",
    y: "0",
    width: String(width),
    height: String(height),
    fill: chartBackground
  }));

  for (const guide of buildYearlyWeekGuides(plotLeft, plotWidth)) {
    svg.appendChild(createSvgNode("line", {
      x1: String(guide.x),
      y1: String(plotTop - 8),
      x2: String(guide.x),
      y2: String(plotTop + plotHeight),
      stroke: separatorColor,
      "stroke-width": "0.8",
      opacity: guide.emphasis ? "0.24" : "0.14"
    }));
  }

  const monthBoundaries = buildYearlyMonthBoundaries(plotLeft, plotWidth);
  for (const boundary of monthBoundaries) {
    svg.appendChild(createSvgNode("line", {
      x1: String(boundary.x),
      y1: String(plotTop - 12),
      x2: String(boundary.x),
      y2: String(plotTop + plotHeight),
      stroke: separatorColor,
      "stroke-width": boundary.isEdge ? "1.2" : "1",
      opacity: boundary.isEdge ? "0.42" : "0.28"
    }));
  }

  for (const label of buildYearlyMonthLabels(yearWindow, plotLeft, plotWidth)) {
    svg.appendChild(createSvgNode("text", {
      x: String(label.x),
      y: "24",
      "text-anchor": "middle",
      class: "axis-number",
      fill: pageText,
      "font-size": "12"
    }, label.label));
  }

  const groupLayoutData = buildYearlyGroupLayouts(model.groups, model.rows, plotTop, plotHeight, layout);
  for (const groupLayout of groupLayoutData.groupLayouts) {
    if (groupLayout.separatorY === null) {
      continue;
    }

    svg.appendChild(createSvgNode("line", {
      x1: String(layout.groupSeparatorX),
      y1: String(groupLayout.separatorY),
      x2: String(plotLeft + plotWidth),
      y2: String(groupLayout.separatorY),
      stroke: separatorColor,
      "stroke-width": "0.8",
      opacity: "0.16"
    }));
  }

  for (const groupLayout of groupLayoutData.groupLayouts) {
    svg.appendChild(createSvgNode("text", {
      x: String(layout.groupGlyphX),
      y: String(groupLayout.headerBaselineY),
      class: "group-glyph",
      fill: glyphColor,
      "font-size": String(layout.groupFontSize - 2)
    }, groupLayout.group.symbol));

    svg.appendChild(createSvgNode("text", {
      x: String(layout.groupTitleX),
      y: String(groupLayout.headerBaselineY),
      class: "group-label",
      fill: glyphColor,
      "font-size": String(layout.groupFontSize)
    }, groupLayout.group.label));

    for (const rowLayout of groupLayout.rows) {
      const { row, centerY } = rowLayout;
      svg.appendChild(createSvgNode("text", {
        x: String(layout.rowSymbolsX),
        y: String(centerY + groupLayoutData.rowTextBaselineOffset),
        class: "row-symbols",
        fill: glyphColor,
        "font-size": String(layout.symbolFontSize)
      }, row.entrySymbols));

      svg.appendChild(createSvgNode("text", {
        x: String(layout.rowTextX),
        y: String(centerY + groupLayoutData.rowTextBaselineOffset),
        class: "row-label",
        fill: pageText,
        "font-size": String(layout.labelFontSize)
      }, truncateLabelToWidth(
        row.entryLabel,
        layout.labelColumnWidth - layout.rowTextX - 12,
        layout.labelFontSize
      )));

      const segments = row.metadata.segments && row.metadata.segments.length
        ? row.metadata.segments
        : [{
            continuesPrev: row.continuesPrev,
            continuesNext: row.continuesNext,
            exactHitsInMonth: row.metadata.exactHitsInMonth || [],
            periodEndOffset: row.metadata.periodEndOffset,
            periodStartOffset: row.metadata.periodStartOffset,
            startDatetime: row.metadata.startDatetime,
            endDatetime: row.metadata.endDatetime,
            houses: row.metadata.houses || null
          }];

      const renderedSegments = mergeYearlyRenderedSegments(segments, yearWindow, plotLeft, plotWidth, row);

      for (const [segmentIndex, segment] of renderedSegments.entries()) {
        const barStartX = segment.barStartX;
        const barEndX = segment.barEndX;
        const barX = barStartX + 1.5;
        const barWidth = Math.max(1.5, barEndX - barStartX - 3);
        const gradientId = `yearly-transit-strength-${row.rowIndex}-${segmentIndex}`;

        defs.appendChild(
          buildYearlyStrengthGradient({
            gradientId,
            segment,
            yearWindow,
            plotLeft,
            plotWidth,
            color: transitBarColor
          })
        );

        const bar = createSvgNode("rect", {
          x: String(barX),
          y: String(centerY - layout.barHeight / 2),
          width: String(barWidth),
          height: String(layout.barHeight),
          rx: String(layout.barHeight / 2),
          fill: `url(#${gradientId})`
        });
        bar.appendChild(
          createSvgNode("title", {}, `${row.label}\n${segment.startDatetime} -> ${segment.endDatetime}${formatHouseTooltip(segment.houses)}`)
        );
        svg.appendChild(bar);

        if (segment.continuesPrev) {
          appendContinuationTail(svg, {
            direction: "left",
            edgeX: plotLeft + 1.5,
            centerY,
            color: transitBarColor,
            strokeWidth: layout.barHeight
          });
        }

        if (segment.continuesNext) {
          appendContinuationTail(svg, {
            direction: "right",
            edgeX: plotLeft + plotWidth - 1.5,
            centerY,
            color: transitBarColor,
            strokeWidth: layout.barHeight
          });
        }

        appendYearlyExactHitDots(svg, {
          exactHits: segment.exactHitsInMonth,
          yearWindow,
          plotLeft,
          plotWidth,
          centerY,
          color: transitBarColor,
          background: exactDotFill,
          stroke: exactDotStroke,
          radius: 2.3,
          minX: barStartX,
          maxX: barEndX
        });
      }
    }
  }

  return svg;
}

function getMonthlyRowSymbolLayout(model) {
  return model.kind === "monthly_insights"
    ? {
        x: INSIGHT_ROW_SYMBOLS_RIGHT_EDGE,
        textAnchor: "end"
      }
    : {
        x: ROW_SYMBOLS_X,
        textAnchor: "start"
      };
}

function getContentEndY({ retroSectionLayout, groupLayouts, plotTop }) {
  if (groupLayouts.length) {
    return groupLayouts[groupLayouts.length - 1].endY;
  }

  if (retroSectionLayout) {
    return retroSectionLayout.endY;
  }

  return plotTop + ROW_PITCH * 12;
}

function applyDocumentPageMetrics(models, coverModel) {
  const metrics = getDocumentPageMetrics(models, coverModel);
  document.documentElement.style.setProperty("--page-width", metrics.pageWidth);
  document.documentElement.style.setProperty("--page-height", metrics.pageHeight);
}

export function getDocumentPageMetrics(models, coverModel) {
  const yearlyMode = !coverModel && models.length === 1 && models[0]?.kind === "yearly"
    ? models[0]?.config?.filters?.period_mode
    : null;

  return yearlyMode === "year_single"
    ? { pageWidth: "420mm", pageHeight: "297mm" }
    : { pageWidth: "297mm", pageHeight: "420mm" };
}

export function sanitizeNatalSvgMarkup(svgMarkup) {
  if (typeof svgMarkup !== "string" || !svgMarkup.includes("<text")) {
    return svgMarkup;
  }

  return svgMarkup;
}

function buildYearlyMonthBoundaries(plotLeft, plotWidth) {
  const boundaries = [];
  for (let monthIndex = 0; monthIndex <= 12; monthIndex += 1) {
    boundaries.push({
      isEdge: monthIndex === 0 || monthIndex === 12,
      x: plotLeft + (monthIndex / 12) * plotWidth
    });
  }
  return boundaries;
}

function buildYearlyWeekGuides(plotLeft, plotWidth) {
  const guides = [];
  const monthWidth = plotWidth / 12;
  const slotWidth = monthWidth / YEARLY_MONTH_SLOT_COUNT;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    for (let slotIndex = 1; slotIndex < YEARLY_MONTH_SLOT_COUNT; slotIndex += 1) {
      guides.push({
        monthIndex,
        emphasis: slotIndex % 2 === 0,
        x: plotLeft + monthIndex * monthWidth + slotIndex * slotWidth
      });
    }
  }

  return guides;
}

function buildYearlyMonthLabels(yearWindow, plotLeft, plotWidth) {
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC"
  });

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const startMs = Date.UTC(yearWindow.year, monthIndex, 1, 0, 0, 0, 0);

    return {
      label: formatter.format(new Date(startMs)),
      x: plotLeft + (monthIndex + 0.5) * (plotWidth / 12)
    };
  });
}

function getYearlyBoundaryX(offsetDays, yearWindow, plotLeft, plotWidth, edge) {
  const date = new Date(yearWindow.startMs + offsetDays * 24 * 60 * 60 * 1000);
  return getYearlyDateX(date, yearWindow, plotLeft, plotWidth, edge === "end" ? "boundary-end" : "boundary-start");
}

function getYearlyDateX(date, yearWindow, plotLeft, plotWidth, placement = "point") {
  if (date.getTime() <= yearWindow.startMs) {
    return plotLeft;
  }

  if (date.getTime() >= yearWindow.endMs) {
    return plotLeft + plotWidth;
  }

  const monthWidth = plotWidth / 12;
  const slotWidth = monthWidth / YEARLY_MONTH_SLOT_COUNT;
  const monthIndex = date.getUTCMonth();
  const monthStartMs = Date.UTC(yearWindow.year, monthIndex, 1, 0, 0, 0, 0);
  const nextMonthStartMs = Date.UTC(yearWindow.year, monthIndex + 1, 1, 0, 0, 0, 0);
  const monthLengthMs = nextMonthStartMs - monthStartMs;
  const monthProgress = monthLengthMs > 0
    ? Math.min(1, Math.max(0, (date.getTime() - monthStartMs) / monthLengthMs))
    : 0;
  const rawSlot = monthProgress * YEARLY_MONTH_SLOT_COUNT;
  const monthLeft = plotLeft + monthIndex * monthWidth;

  if (placement === "boundary-start") {
    const slotIndex = clamp(Math.floor(rawSlot), 0, YEARLY_MONTH_SLOT_COUNT);
    return monthLeft + slotIndex * slotWidth;
  }

  if (placement === "boundary-end") {
    const slotIndex = clamp(Math.ceil(rawSlot), 0, YEARLY_MONTH_SLOT_COUNT);
    return monthLeft + slotIndex * slotWidth;
  }

  const slotIndex = clamp(Math.floor(rawSlot), 0, YEARLY_MONTH_SLOT_COUNT - 1);
  return monthLeft + (slotIndex + 0.5) * slotWidth;
}

export function mergeYearlyRenderedSegments(segments, yearWindow, plotLeft, plotWidth, row = null) {
  const resolvedSegments = (segments || []).map((segment) => {
    const fallbackStartOffset = row ? Math.max(0, row.startDay - 1) : 0;
    const fallbackEndOffset = row ? row.endDay : 0;
    const startOffset = Number.isFinite(segment.periodStartOffset) ? segment.periodStartOffset : fallbackStartOffset;
    const endOffset = Number.isFinite(segment.periodEndOffset) ? segment.periodEndOffset : fallbackEndOffset;

    return {
      ...segment,
      periodStartOffset: startOffset,
      periodEndOffset: endOffset,
      barStartX: getYearlyBoundaryX(startOffset, yearWindow, plotLeft, plotWidth, "start"),
      barEndX: getYearlyBoundaryX(endOffset, yearWindow, plotLeft, plotWidth, "end")
    };
  }).sort((left, right) => (
    left.barStartX - right.barStartX ||
    compareText(left.startDatetime, right.startDatetime) ||
    left.barEndX - right.barEndX
  ));

  const mergedSegments = [];

  for (const segment of resolvedSegments) {
    const previous = mergedSegments[mergedSegments.length - 1];
    if (!previous || segment.barStartX > previous.barEndX) {
      mergedSegments.push({
        ...segment,
        exactHitsInMonth: [...(segment.exactHitsInMonth || [])],
        exactDatetimes: [...(segment.exactDatetimes || [])]
      });
      continue;
    }

    previous.barEndX = Math.max(previous.barEndX, segment.barEndX);
    previous.periodStartOffset = Math.min(previous.periodStartOffset, segment.periodStartOffset);
    previous.periodEndOffset = Math.max(previous.periodEndOffset, segment.periodEndOffset);
    previous.continuesPrev = previous.continuesPrev || segment.continuesPrev;
    previous.continuesNext = previous.continuesNext || segment.continuesNext;
    previous.startDatetime = firstDefined([previous.startDatetime, segment.startDatetime]);
    previous.endDatetime = lastDefined([previous.endDatetime, segment.endDatetime]);
    previous.exactHitsInMonth = uniqueSortedTextValues([
      ...(previous.exactHitsInMonth || []),
      ...(segment.exactHitsInMonth || [])
    ]);
    previous.exactDatetimes = uniqueSortedTextValues([
      ...(previous.exactDatetimes || []),
      ...(segment.exactDatetimes || [])
    ]);
  }

  return mergedSegments;
}

function buildYearlyGroupLayouts(groups, rows, plotTop, plotHeight, layout) {
  const rowCount = Math.max(rows.length, 1);
  const headerAndGapHeight = groups.length * (layout.groupHeaderHeight + layout.headerToRowsGap);
  const groupGapHeight = Math.max(0, groups.length - 1) * layout.groupGap;
  const rowPitch = clamp(
    (plotHeight - headerAndGapHeight - groupGapHeight) / rowCount,
    layout.rowPitchMin,
    layout.rowPitchMax
  );
  const rowCenterOffset = rowPitch / 2;
  const rowTextBaselineOffset = Math.min(3.8, rowCenterOffset * 0.6);
  let currentY = plotTop;

  const groupLayouts = groups.map((group, groupIndex) => {
    const groupRows = rows.slice(group.startRow, group.endRow + 1);
    const headerBaselineY = currentY + layout.groupHeaderBaselineOffset;
    const firstRowTop = currentY + layout.groupHeaderHeight + layout.headerToRowsGap;
    const rowLayouts = groupRows.map((row, rowIndex) => ({
      row,
      centerY: firstRowTop + rowIndex * rowPitch + rowCenterOffset
    }));
    const groupHeight = layout.groupHeaderHeight + layout.headerToRowsGap + groupRows.length * rowPitch;
    const groupLayout = {
      group,
      headerBaselineY,
      rows: rowLayouts,
      separatorY: groupIndex === 0 ? null : currentY - layout.groupSeparatorOffset,
      endY: currentY + groupHeight
    };

    currentY += groupHeight + layout.groupGap;
    return groupLayout;
  });

  return {
    groupLayouts,
    rowPitch,
    rowTextBaselineOffset
  };
}

function getYearlyLayout(model) {
  return model.config.filters.period_mode === "year_single_portrait"
    ? YEARLY_PORTRAIT_LAYOUT
    : YEARLY_LANDSCAPE_LAYOUT;
}

function buildStandaloneSectionLayout(label, rows, startY) {
  if (!rows || !rows.length) {
    return null;
  }

  const headerBaselineY = startY + GROUP_HEADER_BASELINE_OFFSET;
  const firstRowTop = startY + GROUP_HEADER_HEIGHT + HEADER_TO_ROWS_GAP;
  const rowLayouts = rows.map((row, rowIndex) => ({
    row,
    centerY: firstRowTop + rowIndex * ROW_PITCH + ROW_CENTER_OFFSET
  }));
  const sectionHeight = GROUP_HEADER_HEIGHT + HEADER_TO_ROWS_GAP + rows.length * ROW_PITCH;

  return {
    label,
    headerBaselineY,
    rows: rowLayouts,
    separatorY: startY + sectionHeight + GROUP_SEPARATOR_OFFSET,
    endY: startY + sectionHeight
  };
}

function buildGroupLayouts(groups, rows, plotTop) {
  let currentY = plotTop;

  return groups.map((group, groupIndex) => {
    const groupRows = rows.slice(group.startRow, group.endRow + 1);
    const headerBaselineY = currentY + GROUP_HEADER_BASELINE_OFFSET;
    const firstRowTop = currentY + GROUP_HEADER_HEIGHT + HEADER_TO_ROWS_GAP;
    const rowLayouts = groupRows.map((row, rowIndex) => ({
      row,
      centerY: firstRowTop + rowIndex * ROW_PITCH + ROW_CENTER_OFFSET
    }));
    const groupHeight = GROUP_HEADER_HEIGHT + HEADER_TO_ROWS_GAP + groupRows.length * ROW_PITCH;
    const layout = {
      group,
      headerBaselineY,
      rows: rowLayouts,
      separatorY: groupIndex === 0 ? null : currentY - GROUP_SEPARATOR_OFFSET,
      endY: currentY + groupHeight
    };

    currentY += groupHeight + GROUP_GAP;
    return layout;
  });
}

function buildStrengthGradient({ gradientId, segment, monthWindow, color }) {
  const gradient = createSvgNode("linearGradient", {
    id: gradientId,
    x1: "0%",
    y1: "0%",
    x2: "100%",
    y2: "0%"
  });

  const stops = buildStrengthStops(segment, monthWindow);
  for (const stop of stops) {
    gradient.appendChild(createSvgNode("stop", {
      offset: `${(stop.offset * 100).toFixed(2)}%`,
      "stop-color": color,
      "stop-opacity": String(stop.opacity)
    }));
  }

  return gradient;
}

function buildRetrogradeSegmentsByBody(retrogrades) {
  const segmentsByBody = new Map();

  for (const retrograde of retrogrades || []) {
    if (!retrograde?.body) {
      continue;
    }

    const list = segmentsByBody.get(retrograde.body) || [];
    list.push(retrograde);
    segmentsByBody.set(retrograde.body, list);
  }

  return segmentsByBody;
}

export function getRetrogradeMarkerIntervals(transitSegment, retrogradeSegments, monthWindow) {
  const segmentStartMs = Date.parse(transitSegment?.startDatetime);
  const segmentEndMs = Date.parse(transitSegment?.endDatetime);

  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) {
    return [];
  }

  return (retrogradeSegments || []).flatMap((retrograde) => {
    const retrogradeStartMs = Date.parse(retrograde?.startDatetime);
    const retrogradeEndMs = Date.parse(retrograde?.endDatetime);

    if (!Number.isFinite(retrogradeStartMs) || !Number.isFinite(retrogradeEndMs) || retrogradeEndMs <= retrogradeStartMs) {
      return [];
    }

    const overlapStartMs = Math.max(segmentStartMs, retrogradeStartMs, monthWindow.startMs);
    const overlapEndMs = Math.min(segmentEndMs, retrogradeEndMs, monthWindow.endMs);

    if (overlapEndMs <= overlapStartMs) {
      return [];
    }

    return [{
      startOffset: (overlapStartMs - monthWindow.startMs) / (24 * 60 * 60 * 1000),
      endOffset: (overlapEndMs - monthWindow.startMs) / (24 * 60 * 60 * 1000)
    }];
  });
}

function buildYearlyStrengthGradient({ gradientId, segment, yearWindow, plotLeft, plotWidth, color }) {
  const gradient = createSvgNode("linearGradient", {
    id: gradientId,
    gradientUnits: "userSpaceOnUse",
    x1: String(getYearlyBoundaryX(segment.periodStartOffset, yearWindow, plotLeft, plotWidth, "start")),
    y1: "0",
    x2: String(getYearlyBoundaryX(segment.periodEndOffset, yearWindow, plotLeft, plotWidth, "end")),
    y2: "0"
  });

  const stops = buildYearlyStrengthStops(segment, yearWindow, plotLeft, plotWidth);
  for (const stop of stops) {
    gradient.appendChild(createSvgNode("stop", {
      offset: `${(stop.offset * 100).toFixed(2)}%`,
      "stop-color": color,
      "stop-opacity": String(stop.opacity)
    }));
  }

  return gradient;
}

function buildStrengthStops(segment, monthWindow) {
  const baseOpacity = segment.category === "slow" ? 0.5 : 0.42;
  const shoulderOpacity = segment.category === "slow" ? 0.82 : 0.74;
  const peakOpacity = segment.category === "slow" ? 0.98 : 0.92;
  const visibleStartMs = Math.max(Date.parse(segment.startDatetime), monthWindow.startMs);
  const visibleEndMs = Math.min(Date.parse(segment.endDatetime), monthWindow.endMs);

  if (!Number.isFinite(visibleStartMs) || !Number.isFinite(visibleEndMs) || visibleEndMs <= visibleStartMs) {
    return [
      { offset: 0, opacity: baseOpacity },
      { offset: 1, opacity: baseOpacity }
    ];
  }

  const exactOffsets = (segment.exactDatetimes || [])
    .map((isoDatetime) => (Date.parse(isoDatetime) - visibleStartMs) / (visibleEndMs - visibleStartMs))
    .filter((offset) => Number.isFinite(offset))
    .map((offset) => clamp(offset, 0, 1))
    .sort((left, right) => left - right);

  if (!exactOffsets.length) {
    return [
      { offset: 0, opacity: baseOpacity },
      { offset: 1, opacity: baseOpacity }
    ];
  }

  const stops = [
    { offset: 0, opacity: baseOpacity },
    { offset: 1, opacity: baseOpacity }
  ];

  for (const offset of exactOffsets) {
    const shoulderWidth = 0.12;
    stops.push(
      { offset: clamp(offset - shoulderWidth, 0, 1), opacity: shoulderOpacity },
      { offset, opacity: peakOpacity },
      { offset: clamp(offset + shoulderWidth, 0, 1), opacity: shoulderOpacity }
    );
  }

  return normalizeGradientStops(stops);
}

function buildYearlyStrengthStops(segment, yearWindow, plotLeft, plotWidth) {
  const baseOpacity = segment.category === "slow" ? 0.5 : 0.42;
  const shoulderOpacity = segment.category === "slow" ? 0.82 : 0.74;
  const peakOpacity = segment.category === "slow" ? 0.98 : 0.92;
  const startX = getYearlyBoundaryX(segment.periodStartOffset, yearWindow, plotLeft, plotWidth, "start");
  const endX = getYearlyBoundaryX(segment.periodEndOffset, yearWindow, plotLeft, plotWidth, "end");

  if (!Number.isFinite(startX) || !Number.isFinite(endX) || endX <= startX) {
    return [
      { offset: 0, opacity: baseOpacity },
      { offset: 1, opacity: baseOpacity }
    ];
  }

  const exactOffsets = (segment.exactHitsInMonth || [])
    .map((isoDatetime) => {
      const offset = getUtcDayOffsetInWindow(isoDatetime, yearWindow);
      if (offset === null) {
        return null;
      }
      const x = getYearlyDateX(
        new Date(yearWindow.startMs + offset * 24 * 60 * 60 * 1000),
        yearWindow,
        plotLeft,
        plotWidth,
        "point"
      );
      if (x < startX || x > endX) {
        return null;
      }
      return (x - startX) / (endX - startX);
    })
    .filter((offset) => Number.isFinite(offset))
    .map((offset) => clamp(offset, 0, 1))
    .sort((left, right) => left - right);

  if (!exactOffsets.length) {
    return [
      { offset: 0, opacity: baseOpacity },
      { offset: 1, opacity: baseOpacity }
    ];
  }

  const stops = [
    { offset: 0, opacity: baseOpacity },
    { offset: 1, opacity: baseOpacity }
  ];

  for (const offset of exactOffsets) {
    const shoulderWidth = 0.12;
    stops.push(
      { offset: clamp(offset - shoulderWidth, 0, 1), opacity: shoulderOpacity },
      { offset, opacity: peakOpacity },
      { offset: clamp(offset + shoulderWidth, 0, 1), opacity: shoulderOpacity }
    );
  }

  return normalizeGradientStops(stops);
}

function normalizeGradientStops(stops) {
  const dedupedStops = new Map();

  for (const stop of stops) {
    const key = stop.offset.toFixed(4);
    const previous = dedupedStops.get(key);
    if (!previous || previous.opacity < stop.opacity) {
      dedupedStops.set(key, stop);
    }
  }

  return [...dedupedStops.values()].sort((left, right) => left.offset - right.offset);
}

function appendContinuationTail(svg, { direction, edgeX, centerY, color, strokeWidth }) {
  const tailLength = 16;
  const gap = 1;
  const x1 = direction === "left" ? edgeX - tailLength : edgeX + gap;
  const x2 = direction === "left" ? edgeX - gap : edgeX + tailLength;

  svg.appendChild(createSvgNode("line", {
    x1: String(x1),
    y1: String(centerY),
    x2: String(x2),
    y2: String(centerY),
    stroke: color,
    "stroke-width": String(strokeWidth),
    "stroke-linecap": "round",
    "stroke-dasharray": "0.5 4.5",
    opacity: "0.95"
  }));
}

function appendExactHitDots(svg, { exactHitsInMonth, monthWindow, plotLeft, dayWidth, centerY, color, background, stroke, radius }) {
  for (const isoDatetime of exactHitsInMonth || []) {
    const offset = getDayOffsetInMonth(isoDatetime, monthWindow);
    if (offset === null) {
      continue;
    }

    const cx = plotLeft + offset * dayWidth;
    svg.appendChild(createSvgNode("circle", {
      cx: String(cx),
      cy: String(centerY),
      r: String(radius),
      fill: background,
      stroke: stroke || color,
      "stroke-width": "1.15"
    }));
  }
}

function appendRetrogradeMarkers(svg, {
  transitPlanet,
  segment,
  retrogradeSegmentsByBody,
  monthWindow,
  plotLeft,
  dayWidth,
  centerY,
  color,
  strokeWidth
}) {
  const retrogradeIntervals = getRetrogradeMarkerIntervals(
    segment,
    retrogradeSegmentsByBody.get(transitPlanet) || [],
    monthWindow
  );

  for (const interval of retrogradeIntervals) {
    const startX = plotLeft + interval.startOffset * dayWidth + 2;
    const endX = plotLeft + interval.endOffset * dayWidth - 2;
    if (endX <= startX) {
      continue;
    }

    svg.appendChild(createSvgNode("line", {
      x1: String(startX),
      y1: String(centerY),
      x2: String(endX),
      y2: String(centerY),
      stroke: color,
      "stroke-width": String(strokeWidth),
      "stroke-linecap": "round",
      "stroke-dasharray": "5 2.5",
      opacity: "0.95"
    }));
  }
}

function appendYearlyExactHitDots(svg, {
  exactHits,
  yearWindow,
  plotLeft,
  plotWidth,
  centerY,
  color,
  background,
  stroke,
  radius,
  minX = Number.NEGATIVE_INFINITY,
  maxX = Number.POSITIVE_INFINITY
}) {
  for (const isoDatetime of exactHits || []) {
    const offset = getUtcDayOffsetInWindow(isoDatetime, yearWindow);
    if (offset === null) {
      continue;
    }

    const cx = getYearlyDateX(
      new Date(yearWindow.startMs + offset * 24 * 60 * 60 * 1000),
      yearWindow,
      plotLeft,
      plotWidth,
      "point"
    );
    if (cx < minX || cx > maxX) {
      continue;
    }

    svg.appendChild(createSvgNode("circle", {
      cx: String(cx),
      cy: String(centerY),
      r: String(radius),
      fill: background,
      stroke: stroke || color,
      "stroke-width": "1.05"
    }));
  }
}

function appendHouseMarker(svg, { segment, barX, barWidth, centerY, color }) {
  const houseNumber = segment.houses?.transit_house_in_month || segment.houses?.transit_house_at_exact || null;
  if (!houseNumber) {
    return;
  }

  const markerX = barX + barWidth / 2;
  const markerTopY = centerY - HOUSE_MARKER_HEIGHT - 3;

  svg.appendChild(createSvgNode("line", {
    x1: String(markerX),
    y1: String(markerTopY),
    x2: String(markerX),
    y2: String(centerY - 2),
    stroke: color,
    "stroke-width": "0.6",
    opacity: "0.32"
  }));

  svg.appendChild(createSvgNode("text", {
    x: String(markerX),
    y: String(markerTopY - HOUSE_MARKER_LABEL_OFFSET + 6),
    "text-anchor": "middle",
    class: "house-label",
    fill: color,
    "font-size": "7.2",
    "font-weight": "400",
    opacity: "0.5"
  }, `${houseNumber}⌂`));
}

function formatHouseTooltip(houses) {
  if (!houses) {
    return "";
  }

  const parts = [];
  if (houses.transit_house_in_month) {
    parts.push(`Transit house: ${houses.transit_house_in_month}H`);
  } else if (houses.transit_house_at_exact) {
    parts.push(`Transit house: ${houses.transit_house_at_exact}H`);
  }

  if (houses.natal_house) {
    parts.push(`Natal house: ${houses.natal_house}H`);
  }

  return parts.length ? `\n${parts.join(" · ")}` : "";
}

function getMonthWindow(monthValue) {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  return {
    startMs: Date.UTC(year, monthIndex, 1, 0, 0, 0, 0),
    endMs: Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0)
  };
}

function getDayOffsetInMonth(isoDatetime, monthWindow) {
  const ms = Date.parse(isoDatetime);
  if (!Number.isFinite(ms) || ms < monthWindow.startMs || ms >= monthWindow.endMs) {
    return null;
  }

  const dayLengthMs = 24 * 60 * 60 * 1000;
  return (ms - monthWindow.startMs) / dayLengthMs;
}

function buildWeekdayLetters(monthValue, daysInMonth) {
  const [yearText, monthText] = monthValue.split("-");
  const formatter = new Intl.DateTimeFormat("en", {
    weekday: "narrow",
    timeZone: "UTC"
  });

  return Array.from({ length: daysInMonth }, (_, index) =>
    formatter.format(new Date(Date.UTC(Number(yearText), Number(monthText) - 1, index + 1)))
  );
}

function createSvgNode(name, attributes = {}, textContent = "") {
  const node = document.createElementNS(SVG_NS, name);

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  if (textContent) {
    node.textContent = textContent;
  }

  return node;
}

function svgToDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

function truncateLabel(label, maxLength) {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 3)}...`;
}

function truncateLabelToWidth(label, availableWidth, fontSize) {
  const averageGlyphWidth = fontSize * 0.56;
  const maxLength = Math.max(10, Math.floor(availableWidth / averageGlyphWidth));
  return truncateLabel(label, maxLength);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSortedTextValues(values) {
  return [...new Set((values || []).filter(Boolean))].sort(compareText);
}

function firstDefined(values) {
  return (values || []).find((value) => value !== undefined && value !== null && value !== "");
}

function lastDefined(values) {
  return [...(values || [])]
    .reverse()
    .find((value) => value !== undefined && value !== null && value !== "");
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function buildLegendFooter(theme, {
  showRetrograde = true,
  lineLabel = "Transit Line",
  dotLabel = "Exact Hit",
  retrogradeLabel = "Retrograde",
  continuesLabel = "Continues"
} = {}) {
  const legendColor = theme.legendColor;
  const exactDotFill = theme.exactDotFill;
  const exactDotStroke = theme.exactDotStroke;
  const footer = document.createElement("footer");
  footer.className = "legend-footer";
  const items = [
    `
      <div class="legend-item">
        <svg viewBox="0 0 120 20" aria-hidden="true" focusable="false">
          <line x1="12" y1="10" x2="108" y2="10" stroke="${legendColor}" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <span>${escapeHtml(lineLabel)}</span>
      </div>
    `,
    `
      <div class="legend-item">
        <svg viewBox="0 0 120 20" aria-hidden="true" focusable="false">
          <line x1="12" y1="10" x2="108" y2="10" stroke="${legendColor}" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="60" cy="10" r="2.8" fill="${exactDotFill}" stroke="${exactDotStroke}" stroke-width="1.1" />
        </svg>
        <span>${escapeHtml(dotLabel)}</span>
      </div>
    `
  ];

  if (showRetrograde) {
    items.push(`
      <div class="legend-item">
        <svg viewBox="0 0 120 20" aria-hidden="true" focusable="false">
          <line x1="12" y1="10" x2="108" y2="10" stroke="${legendColor}" stroke-width="3.5" stroke-dasharray="12 4" />
        </svg>
        <span>${escapeHtml(retrogradeLabel)}</span>
      </div>
    `);
  }

  items.push(`
    <div class="legend-item">
      <svg viewBox="0 0 120 20" aria-hidden="true" focusable="false">
        <line x1="12" y1="10" x2="76" y2="10" stroke="${legendColor}" stroke-width="2.2" stroke-linecap="round" />
        <line x1="78" y1="10" x2="108" y2="10" stroke="${legendColor}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.5 4.5" />
      </svg>
      <span>${escapeHtml(continuesLabel)}</span>
    </div>
  `);

  footer.innerHTML = `
    <div class="legend-header">Legend</div>
    <div class="legend-grid ${showRetrograde ? "" : "legend-grid-compact"}">
      ${items.join("")}
    </div>
  `;
  return footer;
}

function applyThemeVars(element, theme) {
  element.style.setProperty("--page-tint", theme.pageBackground);
  element.style.setProperty("--page-text", theme.pageText);
  element.style.setProperty("--title-accent", theme.titleText);
  element.style.setProperty("--glyph-color", theme.glyphColor);
  element.style.setProperty("--legend-color", theme.legendColor);
  element.style.setProperty("--separator-color", theme.separatorColor);
  element.style.setProperty("--degree-outline-color", theme.degreeOutlineColor);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBirthLine(natal) {
  const date = new Date(Date.UTC(Number(natal.year), Number(natal.month) - 1, Number(natal.day)));
  const dateText = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);

  if (!natal.time_known) {
    return `Né·e le ${dateText}`;
  }

  const hour = String(natal.hour || 0).padStart(2, "0");
  const minute = String(natal.minute || 0).padStart(2, "0");
  return `Né·e le ${dateText} à ${hour}:${minute}`;
}
