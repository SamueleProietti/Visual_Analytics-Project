/* View D — contrast panel, divergent horizontal bars.
 *
 * Phase 9 scope: the layout only. Nothing here computes a contrast - analytics 6.3
 * arrives in phase 14, and CLAUDE.md sec.6 forbids any result existing before a
 * selection does. On load the panel shows its prompt and nothing else.
 *
 * TWO QUANTITIES, NOT ONE. CLAUDE.md sec.5 asks for "bar length = magnitude, vertical
 * order = |z-score| (reliability), not magnitude", and the proposal for features
 * "ranked by reliability, with bar length showing magnitude". Those are only
 * non-contradictory if length and order encode different things:
 *
 *   length = the raw difference in proportion (effect size, in percentage points)
 *   order  = |z-score| (how much the sample size lets us trust that difference)
 *
 * A feature that differs hugely across six incidents gets a long bar but sinks to the
 * bottom of the list. That separation is the whole point of the panel: it stops the
 * analyst from reading a dramatic-looking bar as a dependable finding.
 */

"use strict";

const ViewD = (() => {
  // Divergent, and here a divergent scale is correct rather than decorative: the
  // quantity has a meaningful zero (no difference) and a meaningful sign. Blue/red from
  // ColorBrewer RdBu - an opponent pair that stays distinguishable under the common
  // colour-vision deficiencies, unlike red/green.
  const OVER = "#b2182b";    // more frequent in the selection than in the comparison
  const UNDER = "#2166ac";   // less frequent
  const MAX_BARS = 9;        // fits the fixed-height canvas without scrolling

  const MARGIN = { top: 6, right: 34, bottom: 18, left: 168 };

  function setHeader(text, muted = false) {
    d3.select("#view-d-header")
      .attr("class", muted ? "panel-header is-muted" : "panel-header")
      .text(text);
  }

  /** The load-time state, and the state whenever a selection is cleared. */
  function showEmpty(reason) {
    d3.select("#view-d-canvas").html(
      `<span class="placeholder">${reason || "select a country or lasso a cluster"}</span>`);
    d3.select("#view-d-legend").html("");
    setHeader("no selection", true);
  }

  /**
   * Draw a contrast. Called by phase 14 with real z-scores; never on load.
   *
   * @param {Array} items  {label, difference, z, nSelection, nComplement}
   *                       difference is a signed proportion difference in [-1, 1]
   * @param {string} mode  the comparison, stated in full - "Italy vs rest of world"
   */
  function render(items, mode, note) {
    if (!items || !items.length) return showEmpty("nothing to contrast");

    // Reliability decides who is shown and in what order; magnitude only sets length.
    const ranked = [...items].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, MAX_BARS);

    const host = d3.select("#view-d-canvas");
    host.html("");
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    // Symmetric domain so that equal magnitudes in either direction draw equal bars -
    // an asymmetric axis would make one side look systematically stronger.
    const extent = d3.max(ranked, (d) => Math.abs(d.difference)) || 0.01;
    const x = d3.scaleLinear().domain([-extent, extent]).range([0, innerW]).nice();
    const y = d3.scaleBand().domain(ranked.map((d) => d.label))
      .range([0, innerH]).padding(0.22);

    const svg = host.append("svg").attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "Contrast panel: " + mode);
    const plot = svg.append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    plot.selectAll("rect.bar").data(ranked).join("rect")
      .attr("class", "bar")
      .attr("x", (d) => (d.difference >= 0 ? x(0) : x(d.difference)))
      .attr("y", (d) => y(d.label))
      .attr("width", (d) => Math.abs(x(d.difference) - x(0)))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => (d.difference >= 0 ? OVER : UNDER))
      .append("title")
      .text((d) => `${d.label}\n`
        + `${(d.difference * 100).toFixed(1)} percentage points\n`
        + `z = ${d.z.toFixed(2)}`
        + (d.nSelection != null ? `\nn = ${d.nSelection} in selection` : ""));

    plot.selectAll("text.bar-label").data(ranked).join("text")
      .attr("class", "bar-label")
      .attr("x", -6).attr("y", (d) => y(d.label) + y.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "end")
      .text((d) => d.label);

    // z printed next to each bar: the ranking key must be legible, not just implied by
    // position, or the reader cannot tell a solid finding from a marginal one.
    plot.selectAll("text.z-value").data(ranked).join("text")
      .attr("class", "z-value")
      .attr("x", innerW + 4).attr("y", (d) => y(d.label) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .text((d) => "z " + d.z.toFixed(1));

    plot.append("line").attr("class", "zero-line")
      .attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", innerH);

    plot.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((d) => (d * 100).toFixed(0) + "pp"));

    setHeader(mode);
    renderLegend(note);
  }

  function renderLegend(note) {
    const legend = d3.select("#view-d-legend");
    legend.selectAll("*").remove();

    for (const [colour, text] of [[OVER, "more frequent in selection"],
                                  [UNDER, "less frequent in selection"]]) {
      const item = legend.append("span").attr("class", "legend-item");
      item.append("span").attr("class", "legend-swatch").style("background", colour);
      item.append("span").text(text);
    }
    legend.append("span").attr("class", "legend-note")
      .text(note || "bar length = difference in percentage points · "
        + "order = |z|, i.e. reliability, not size");
  }

  /**
   * Layout check with obviously fake numbers, callable only from the console.
   *
   * Deliberately not reachable from the interface, and it stamps a warning across the
   * panel: a chart of invented data that looked like a result would be worse than no
   * chart at all.
   */
  function demo() {
    const fake = [
      { label: "access: Supply Chain Compromise", difference: 0.18, z: 4.6, nSelection: 41 },
      { label: "target: Critical Infrastructure", difference: -0.14, z: -3.9, nSelection: 12 },
      { label: "impact: Data Exfiltration", difference: 0.11, z: 3.1, nSelection: 33 },
      { label: "init: State-affiliated", difference: 0.09, z: 2.7, nSelection: 28 },
      { label: "issue: Espionage", difference: -0.08, z: -2.2, nSelection: 9 },
      { label: "ilaw: Sovereignty breach", difference: 0.06, z: 1.8, nSelection: 21 },
      { label: "type: Ransomware", difference: 0.22, z: 1.1, nSelection: 4 },
    ];
    render(fake, "DEMO — invented numbers, not a result",
      "layout check only · these values are fabricated");
    d3.select("#view-d-canvas svg").append("text")
      .attr("class", "demo-stamp").attr("x", "50%").attr("y", "52%")
      .attr("text-anchor", "middle").text("DEMO DATA");
    console.warn("[view D] demo layout drawn from fabricated numbers - not a result.");
  }

  return { showEmpty, render, demo };
})();
