/* View C — stacked area timeline, incident types 2000-2024.
 *
 * Phase 8 scope: draw the chart from the exploded type atoms. The brush that restricts
 * every analytic to a time window is a trigger, so it arrives with phase 11/15 - this
 * view computes nothing.
 *
 * Unlike View B, these axes DO carry meaning and are labelled: years on x, type
 * occurrences on y.
 */

"use strict";

const ViewC = (() => {
  // Okabe-Ito, the standard colour-vision-deficiency-safe qualitative palette. Phase 0
  // measured incident_type at 7 atomic categories, under the 12 that CLAUDE.md sec.2
  // sets as the limit for a categorical timeline palette, so no regrouping was needed
  // and each type keeps its own hue.
  //
  // "Data theft & Doxing" uses the palette's yellow rather than its orange. Being from a
  // safe palette is not the same as being safe in combination: measured under simulated
  // deuteranopia, the orange (#E69F00) and the vermillion (#D55E00) already in use fell
  // to a Delta E of 6.6 - effectively the same colour. The yellow restores it to 13.3.
  // See scripts/06_verify_visual.py.
  const PALETTE = {
    "Hijacking with Misuse": "#0072B2",
    "Disruption": "#D55E00",
    "Data theft": "#009E73",
    "Ransomware": "#CC79A7",
    "Data theft & Doxing": "#F0E442",
    "Hijacking without Misuse": "#56B4E9",
    "Not available": "#999999",
  };

  // Fixed stacking order, largest at the bottom. Fixed rather than data-driven so the
  // bands do not reorder between phases and mislead a reader comparing screenshots.
  const ORDER = ["Hijacking with Misuse", "Disruption", "Data theft", "Ransomware",
                 "Data theft & Doxing", "Hijacking without Misuse", "Not available"];

  const MARGIN = { top: 8, right: 8, bottom: 22, left: 34 };

  let state = { plot: null, x: null, y: null, area: null, years: [], order: null };

  /** Pivot a long table of {year, type, count} into stacked series. */
  function toSeries(rows, years) {
    const byYear = new Map(years.map((y) => [y, Object.fromEntries(
      ORDER.map((t) => [t, 0]))]));
    for (const row of rows) {
      const entry = byYear.get(row.year);
      if (entry && row.type in entry) entry[row.type] += row.count;
    }
    return d3.stack().keys(ORDER)(years.map((y) => ({ year: y, ...byYear.get(y) })));
  }

  function init(timeline) {
    const host = d3.select("#view-c-canvas");
    host.html("");

    const width = host.node().clientWidth;
    const height = host.node().clientHeight;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    // Pivot the long table into one row per year with a column per type, filling the
    // gaps: a type absent in a year is a real zero, and leaving it undefined would make
    // d3.stack open a hole in the band.
    const years = [...new Set(timeline.map((d) => d.year))].sort((a, b) => a - b);
    const series = toSeries(timeline, years);

    const x = d3.scaleLinear().domain([years[0], years[years.length - 1]])
      .range([0, innerW]);
    const y = d3.scaleLinear()
      .domain([0, d3.max(series[series.length - 1], (d) => d[1])]).nice()
      .range([innerH, 0]);

    const svg = host.append("svg")
      .attr("width", width).attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "Stacked area timeline of incident types, 2000 to 2024");

    const plot = svg.append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    const area = d3.area()
      .x((d) => x(d.data.year))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    plot.selectAll("path.band")
      .data(series).join("path")
      .attr("class", "band")
      .attr("fill", (d) => PALETTE[d.key])
      .attr("d", area)
      .append("title")
      .text((d) => `${d.key}: ${d3.sum(d, (v) => v[1] - v[0])} occurrences 2000-2024`);

    // Both axes are meaningful here, so both are drawn and labelled - the opposite of
    // View B, where labelling them would assert a metric that does not exist.
    plot.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));

    plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(5));

    state.plot = plot;
    state.x = x;
    state.y = y;
    state.area = area;
    state.years = years;
    attachBrush(plot, x, innerW, innerH, years);

    renderLegend(series);
    console.info(`[view C] ${years[0]}-${years[years.length - 1]}, `
      + `${ORDER.length} types, ${timeline.length} year-type cells`);
    return years;
  }

  /* Timeline brush — the third permitted analytic trigger. Snapped to whole years,
   * because the underlying data is annual: a window of "2019.4 to 2022.7" would imply
   * a resolution the corpus does not have. */
  function attachBrush(plot, x, innerW, innerH, years) {
    const brush = d3.brushX()
      .extent([[0, 0], [innerW, innerH]])
      .on("end", (event) => {
        if (!event.selection) {
          SelectionStore.setYearRange(null);
          return;
        }
        const [x0, x1] = event.selection.map(x.invert);
        const from = Math.max(years[0], Math.round(x0));
        const to = Math.min(years[years.length - 1], Math.round(x1));
        SelectionStore.setYearRange(from === to ? [from, from] : [from, to]);
        console.info(`[view C] brushed ${from}-${to}`);
      });
    plot.append("g").attr("class", "brush").call(brush);
  }

  /**
   * React to the shared selection by redrawing the bands over only the selected
   * incidents, keeping the full series behind as pale context.
   *
   * Context plus focus rather than focus alone: a band that shrinks is only readable
   * against the shape it had before, and without the backdrop an analyst cannot tell a
   * small selection from a quiet year.
   */
  function applySelection(snapshot) {
    if (!state.plot) return;
    state.plot.selectAll("path.band-selected").remove();

    if (snapshot.empty) {
      state.plot.selectAll("path.band").classed("is-context", false);
      return;
    }

    // Recount year x type over the selection, from the same exploded atoms the global
    // series uses, so focus and context can never disagree about what a type is.
    const rows = [];
    for (const incident of snapshot.selected) {
      if (incident.year == null) continue;
      for (const type of incident.types || []) {
        rows.push({ year: incident.year, type, count: 1 });
      }
    }

    state.plot.selectAll("path.band").classed("is-context", true);
    if (!rows.length) return;

    // Same y scale as the context, deliberately: rescaling would make a tiny selection
    // fill the panel and read as though it were the whole corpus.
    state.plot.selectAll("path.band-selected")
      .data(toSeries(rows, state.years)).join("path")
      .attr("class", "band-selected")
      .attr("fill", (d) => PALETTE[d.key])
      .attr("d", state.area);
  }

  function renderLegend(series) {
    const legend = d3.select("#view-c-legend");
    legend.selectAll("*").remove();

    const items = legend.selectAll("span.legend-item")
      .data(ORDER).join("span").attr("class", "legend-item");
    items.append("span").attr("class", "legend-swatch")
      .style("background", (d) => PALETTE[d]);
    items.append("span").text((d) => d);

    // The honest caveat, in the view rather than buried in the report. An incident can
    // carry several types, so the bands sum to about 1.7x the incident count - 2.1x in
    // 2023 - and the chart shows how often each type occurs, not a partition of
    // incidents. Without this the y axis would overstate volume by up to 100%.
    legend.append("span")
      .attr("class", "legend-note")
      .text("bands count type occurrences, not incidents: one incident can carry several types");
  }

  return { init, applySelection };
})();
