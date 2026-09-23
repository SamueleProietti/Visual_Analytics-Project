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
  };

  // Fixed stacking order, largest at the bottom. Fixed rather than data-driven so the
  // bands do not reorder between phases and mislead a reader comparing screenshots.
  //
  // "Not available" is not drawn. It occurs twice in 25 years against ~5,650 typed
  // occurrences - a band less than a pixel thick at any height this card has - and a
  // legend entry for a colour that cannot be found on the chart is noise, not a key.
  // The two incidents are still in the corpus and in every analytic; only this band
  // is omitted, and toSeries() drops the rows because the type is not in ORDER.
  const ORDER = ["Hijacking with Misuse", "Disruption", "Data theft", "Ransomware",
                 "Data theft & Doxing", "Hijacking without Misuse"];

  // Right margin wide enough for the last year label, which is centred on the end of
  // the axis: at 8px, "2024" was cut in half, and d3's default ticks skipped it anyway.
  const MARGIN = { top: 8, right: 16, bottom: 20, left: 36 };

  let state = { plot: null, x: null, y: null, area: null, years: [], order: null,
                brushGroup: null, grid: null, yAxis: null, innerW: 0, innerH: 0,
                globalMax: 0, globalPeak: 0, 
                // Legend highlight: hovered is transient, locked survives the pointer
                // leaving the legend. Both are DISPLAY state of this view only - they
                // never reach the selection store, so no analytic can start here.
                hovered: null, locked: null };

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
    // Clamped at 0: a canvas laid out while hidden reports width 0, and a negative
    // size would make d3 write invalid rect attributes.
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

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
    //
    // Year ticks are counted BACK from the last year, so the final year is always
    // labelled - d3's "nice" ticks stop at 2020 and left 2024, the year the corpus is
    // densest, as an unlabelled edge.
    const first = years[0];
    const last = years[years.length - 1];
    const step = innerW < 300 ? 8 : 4;
    const yearTicks = d3.range(last, first - 1, -step).reverse();

    // Light horizontal guides behind the bands, so a band's height can be read against
    // the count axis without a ruler.
    const grid = plot.insert("g", ":first-child")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));

    plot.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickValues(yearTicks).tickFormat(d3.format("d")));

    const yAxis = plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(5));

    state.plot = plot;
    state.x = x;
    state.y = y;
    state.area = area;
    state.years = years;
    state.grid = grid;
    state.yAxis = yAxis;
    state.innerW = innerW;
    state.innerH = innerH;
    // Two different numbers, on purpose: globalMax is where the axis ends once d3 has
    // rounded it, and is what restores the axis; globalPeak is the tallest year the
    // corpus actually has, and is what the note quotes - reporting 1,600 when the peak
    // is 1,543 would be stating a rounding as a measurement.
    state.globalMax = y.domain()[1];
    state.globalPeak = stackMax(series);
    attachBrush(plot, x, innerW, innerH, years);

    renderLegend();
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
        // Our own snap-back below re-enters this handler with a null sourceEvent.
        // Returning early is what stops it from looping and from republishing.
        if (!event.sourceEvent) return;

        if (!event.selection) {
          SelectionStore.setYearRange(null);
          return;
        }
        const [x0, x1] = event.selection.map(x.invert);
        const from = Math.max(years[0], Math.round(x0));
        const to = Math.min(years[years.length - 1], Math.round(x1));
        SelectionStore.setYearRange(from === to ? [from, from] : [from, to]);

        // Redraw the rectangle on the years actually used. It was left wherever the
        // mouse was released, so a window analysed as 2016-2022 could be drawn as
        // 2016.4-2022.7 - the picture and the analysis disagreeing by up to half a year
        // each side, with only the picture visible. A single-year window would be a
        // zero-width rectangle, which d3 reads as no selection, so it keeps the drawn
        // one.
        if (to > from) state.brushGroup.call(brush.move, [x(from), x(to)]);
        console.info(`[view C] brushed ${from}-${to}`);
      });
    state.brushGroup = plot.append("g").attr("class", "brush").call(brush);
  }

  /**
   * Put the count axis on a given maximum, animating the ticks.
   *
   * The selection used to be drawn on the corpus-wide axis, so that a small country's
   * bands could be compared with the world's. Measured, that comparison cost the
   * selection its legibility: Italy's 81 incidents over 25 years are a two-pixel strip
   * under an axis that runs to 1,500, and a shape that thin says nothing at all.
   *
   * So the axis follows the selection, and the loss is paid for rather than hidden:
   *   - the global context bands are removed while the axis is local, because drawing
   *     them on a 20x smaller scale would push them off the top of the frame;
   *   - the global peak stays on screen as a number, so the reference is still there;
   *   - the ticks animate, which is what makes the change impossible to miss - the risk
   *     of a rescaled chart is not misreading it on screen, it is comparing two
   *     screenshots taken at different scales.
   */
  function rescale(max, note) {
    const target = max > 0 ? max : state.globalMax;
    state.y.domain([0, target]).nice();
    state.yAxis.transition().duration(450).call(d3.axisLeft(state.y).ticks(5));
    state.grid.transition().duration(450)
      .call(d3.axisLeft(state.y).ticks(5).tickSize(-state.innerW).tickFormat(""));
    // The note lives in the title row, not over the plot: inside the frame it was
    // covered by the bands exactly when the axis was smallest, which is when it matters.
    d3.select("#view-c-scale").text(note || "");
  }

  /** The tallest stacked total in a set of series - what the axis has to hold. */
  function stackMax(series) {
    return d3.max(series[series.length - 1] || [], (d) => d[1]) || 0;
  }

  /**
   * Emphasise one incident type, or clear the emphasis.
   *
   * Display only. The other bands are dimmed, never removed: the stack is what gives a
   * band its meaning - remove the others and the highlighted one jumps to the baseline,
   * which is a different chart answering a different question. Hover emphasises while
   * the pointer is on a legend entry, a click locks it so the analyst can look at the
   * chart instead of holding the mouse still.
   */
  function highlight() {
    const active = state.hovered || state.locked;
    state.plot.selectAll("path.band, path.band-selected")
      .classed("is-faded", (d) => !!active && d.key !== active);
    d3.select("#view-c-legend").selectAll(".legend-item")
      .classed("is-locked", (d) => d === state.locked)
      .classed("is-faded", (d) => !!active && d !== active);
  }

  /**
   * React to the shared selection by redrawing the bands over only the selected
   * incidents, on an axis scaled to that selection.
   */
  function applySelection(snapshot) {
    if (!state.plot) return;
    state.plot.selectAll("path.band-selected").remove();

    if (snapshot.empty) {
      // Back to the corpus: full-strength context bands and the global axis.
      state.plot.selectAll("path.band").classed("is-context", false)
        .attr("display", null);
      rescale(state.globalMax, "");
      redrawContext();
      highlight();
      return;
    }

    // Recount year x type over the selection, from the same exploded atoms the global
    // series uses, so focus and context can never disagree about what a type is.
    const rows = typeRows(snapshot.selected);

    // WHAT THE AXIS FOLLOWS: the selection WITHOUT its time filter.
    //
    // A brush is a window onto a series, not a different series, and its whole point is
    // to be compared with the years outside it. Letting the axis follow the brushed
    // subset defeated that: dragging the window made its bands grow to fill the panel,
    // so a quiet stretch of years looked exactly like a busy one, and with only a brush
    // active - no country, no lasso - the window was redrawn as tall as the entire
    // corpus. Measuring the reference over all years instead keeps the axis still while
    // the brush moves, which is what makes the window readable AS a window.
    //
    // It also settles the no-selection case by itself: with only a brush, the selection
    // minus its time filter is the whole corpus, so the axis stays global and the
    // context bands stay on screen.
    const reference = SelectionStore.resolveIgnoring("yearRange");
    const referenceMax = stackMax(toSeries(typeRows(reference.selected), state.years));
    const isLocal = referenceMax > 0 && referenceMax < state.globalPeak;

    state.plot.selectAll("path.band").classed("is-context", true);
    if (!rows.length) {
      rescale(state.globalMax, "");
      redrawContext();
      return;
    }

    // Draw the focus bands over the BRUSHED years only, not over all 25.
    //
    // Built across the full domain, the years outside the window are real zeros, and the
    // area generator dutifully fills the ramp between a zero and the first selected year
    // - so a 2016-2022 brush painted colour from 2015 to 2023, spilling past both walls
    // of the rectangle and claiming selected incidents in years the brush excludes.
    // Restricting the domain makes the band start and stop exactly where the window does.
    //
    // Only when the window comes from the brush: a lasso selects incidents that may be
    // scattered across the whole timeline, and there the interior zeros are the truth.
    const range = SelectionStore.getState().yearRange;
    const domain = range
      ? state.years.filter((y) => y >= range[0] && y <= range[1])
      : state.years;

    // An area needs two points. A single-year window has none to draw, and inventing
    // width for it would misstate the window.
    if (domain.length < 2) return;

    // On a local axis the global bands are hidden rather than drawn off the top of the
    // frame, and their peak is stated in words instead. On the global axis they stay,
    // pale, because there they still fit and still give the comparison.
    const selected = toSeries(rows, domain);
    if (isLocal) {
      rescale(referenceMax,
        `axis: selection · global peak ${state.globalPeak.toLocaleString("en")}/yr`);
      state.plot.selectAll("path.band").attr("display", "none");
    } else {
      rescale(state.globalMax, "");
      state.plot.selectAll("path.band").attr("display", null);
      redrawContext();
    }

    state.plot.selectAll("path.band-selected")
      .data(selected).join("path")
      .attr("class", "band-selected")
      .attr("fill", (d) => PALETTE[d.key])
      .attr("d", state.area);
    highlight();
  }

  /** One {year, type, count} row per type occurrence of each dated incident. */
  function typeRows(incidents) {
    const rows = [];
    for (const incident of incidents) {
      if (incident.year == null) continue;
      for (const type of incident.types || []) {
        rows.push({ year: incident.year, type, count: 1 });
      }
    }
    return rows;
  }

  /** Redraw the corpus-wide bands after the axis has moved under them. */
  function redrawContext() {
    state.plot.selectAll("path.band").attr("d", state.area);
  }

  /** Key in one line under the time axis, spread across the full width of the view.
   *
   * It floated over the early years before, which are quiet but not empty - and a key
   * over data invites the eye to read it as data. In a single row it costs one line of
   * height and sits exactly where the eye goes after reading the years.
   *
   * The caveat that bands count type OCCURRENCES, not incidents, is the view title's
   * tooltip: an incident can carry several types, so the bands sum to about 1.7x the
   * incident count - 2.1x in 2023. */
  function renderLegend() {
    const legend = d3.select("#view-c-legend");
    legend.selectAll("*").remove();
    const items = legend.selectAll("span.legend-item")
      // No title attribute: the browser's own tooltip would pop up over the chart on
      // every pass across the key, and the entries already read as what they are.
      .data(ORDER).join("span").attr("class", "legend-item is-clickable");
    items.append("span").attr("class", "legend-swatch")
      .style("background", (d) => PALETTE[d]);
    items.append("span").text((d) => d);

    // A DISPLAY control, not an analytic trigger: it dims bands and nothing else, and
    // it never writes to the selection store, so no computation can start from here.
    // The course rules ask for at least one analytic started by visual interaction -
    // the lasso, the map click and this view's own brush are those - and say nothing
    // against a control that only changes what is drawn (see CLAUDE.md sec.2).
    items
      .on("mouseenter", (event, d) => { state.hovered = d; highlight(); })
      .on("mouseleave", () => { state.hovered = null; highlight(); })
      .on("click", (event, d) => {
        state.locked = state.locked === d ? null : d;
        highlight();
      });
  }

  return { init, applySelection };
})();
