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
  const PALETTE = {
    "Hijacking with Misuse": "#0072B2",
    "Disruption": "#D55E00",
    "Data theft": "#009E73",
    "Ransomware": "#CC79A7",
    "Data theft & Doxing": "#E69F00",
    "Hijacking without Misuse": "#56B4E9",
    "Not available": "#999999",
  };

  // Fixed stacking order, largest at the bottom. Fixed rather than data-driven so the
  // bands do not reorder between phases and mislead a reader comparing screenshots.
  const ORDER = ["Hijacking with Misuse", "Disruption", "Data theft", "Ransomware",
                 "Data theft & Doxing", "Hijacking without Misuse", "Not available"];

  const MARGIN = { top: 8, right: 8, bottom: 22, left: 34 };

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
    const byYear = new Map(years.map((y) => [y, Object.fromEntries(
      ORDER.map((t) => [t, 0]))]));
    for (const row of timeline) {
      const entry = byYear.get(row.year);
      if (entry && row.type in entry) entry[row.type] = row.count;
    }
    const rows = years.map((y) => ({ year: y, ...byYear.get(y) }));

    const series = d3.stack().keys(ORDER)(rows);

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

    renderLegend(series);
    console.info(`[view C] ${years[0]}-${years[years.length - 1]}, `
      + `${ORDER.length} types, ${timeline.length} year-type cells`);
    return years;
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

  return { init };
})();
