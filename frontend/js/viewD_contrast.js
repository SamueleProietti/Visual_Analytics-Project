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
  // How many features to show is decided by the panel's height, not fixed. The canvas
  // is sized from the window now: at a laptop's height nine bars is what fits, and on a
  // 1080p screen a fixed nine drew bars twice as thick as they needed to be while
  // hiding the next five features. One band per 26px keeps bars comfortably readable.
  const BAND_PX = 26;
  const MIN_BARS = 6;
  const MAX_BARS = 14;

  // The label gutter never takes more than 45% of the panel. At 168px fixed it left a
  // narrow panel with almost no room for the bars, which are the actual answer.
  const MARGIN = { top: 6, right: 34, bottom: 18, left: 168 };
  const GUTTER_SHARE = 0.45;

  // Explains the faded, dashed bars - which the legend did not cover at all before.
  const VALIDITY_NOTE = "faded, dashed bars fail the validity test";

  function setHeader(text, muted = false) {
    d3.select("#view-d-header")
      .attr("class", muted ? "panel-header is-muted" : "panel-header")
      .text(text);
  }

  /** The load-time state, and the state whenever a selection is cleared.
   *
   * The legend stays populated even with nothing to plot. Leaving it blank read as a
   * missing legend - the thing CLAUDE.md sec.2 penalises - when in fact there was simply
   * nothing yet to decode. Showing the encoding before the bars exist also tells the
   * analyst what the panel is going to answer, without asserting any result.
   */
  function showEmpty(reason) {
    d3.select("#view-d-canvas").html(
      `<span class="placeholder">${reason || "select a country or lasso a cluster"}</span>`);
    setHeader("no selection", true);

    const legend = d3.select("#view-d-legend");
    legend.selectAll("*").remove();
    for (const [colour, text] of [[OVER, "more frequent in selection"],
                                  [UNDER, "less frequent in selection"]]) {
      const item = legend.append("span").attr("class", "legend-item is-inactive");
      item.append("span").attr("class", "legend-swatch").style("background", colour);
      item.append("span").text(text);
    }
    // The encoding itself ("bar length = difference · order = |z|") is the panel's
    // subtitle, so it is not repeated here; the legend keeps what only it explains.
    legend.append("span").attr("class", "legend-note").text(VALIDITY_NOTE);
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
    //
    // The `reliable` term is not optional. Sorting on |z| alone re-broke what the
    // backend had already ordered correctly, putting a 2.3pp difference that fails the
    // two-proportion validity test above a 21.7pp one that passes - because a z
    // computed where the normal approximation does not hold can be arbitrarily large.
    // Unreliable features stay in the list, flagged; they just do not take the
    // positions the eye reads first.
    const host = d3.select("#view-d-canvas");
    host.html("");
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;
    const left = Math.min(MARGIN.left, Math.round(width * GUTTER_SHARE));
    const innerW = width - left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    const bars = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(innerH / BAND_PX)));
    const ranked = [...items]
      .sort((a, b) => (a.reliable === false) - (b.reliable === false)
        || Math.abs(b.z) - Math.abs(a.z))
      .slice(0, bars);

    // Symmetric domain so that equal magnitudes in either direction draw equal bars -
    // an asymmetric axis would make one side look systematically stronger.
    const extent = d3.max(ranked, (d) => Math.abs(d.difference)) || 0.01;
    const x = d3.scaleLinear().domain([-extent, extent]).range([0, innerW]).nice();
    const y = d3.scaleBand().domain(ranked.map((d) => d.label))
      .range([0, innerH]).padding(0.22);

    const svg = host.append("svg").attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "Contrast panel: " + mode);
    const plot = svg.append("g")
      .attr("transform", `translate(${left},${MARGIN.top})`);

    plot.selectAll("rect.bar").data(ranked).join("rect")
      .attr("class", "bar")
      .attr("x", (d) => (d.difference >= 0 ? x(0) : x(d.difference)))
      .attr("y", (d) => y(d.label))
      .attr("width", (d) => Math.abs(x(d.difference) - x(0)))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => (d.difference >= 0 ? OVER : UNDER))
      .attr("fill-opacity", (d) => (d.reliable === false ? 0.4 : 0.88))
      .classed("is-unreliable-bar", (d) => d.reliable === false)
      .append("title")
      .text((d) => `${d.label}\n`
        + `${(d.difference * 100).toFixed(1)} percentage points\n`
        + `z = ${d.z.toFixed(2)}`
        + (d.nSelection != null ? `\nn = ${d.nSelection} in selection` : ""));

    // Labels are shortened to fit the gutter, with the full text in a tooltip. They used
    // to be drawn at full length and run off the left edge of the canvas, where the
    // clipping cut the START of the label - the block name ("impact:", "issue:") that
    // says what kind of feature it is.
    const labels = plot.selectAll("text.bar-label").data(ranked).join("text")
      .attr("class", "bar-label")
      .attr("x", -6).attr("y", (d) => y(d.label) + y.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "end")
      .text((d) => d.label);
    labels.each(function fit(d) {
      const node = this;
      const room = left - 10;
      if (node.getComputedTextLength() <= room) return;
      let text = d.label;
      while (text.length > 4 && node.getComputedTextLength() > room) {
        text = text.slice(0, -2);
        node.textContent = text + "…";
      }
    });
    labels.append("title").text((d) => d.label);

    // z printed next to each bar: the ranking key must be legible, not just implied by
    // position, or the reader cannot tell a solid finding from a marginal one.
    plot.selectAll("text.z-value").data(ranked).join("text")
      .attr("class", "z-value")
      .attr("x", innerW + 4).attr("y", (d) => y(d.label) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .text((d) => "z " + d.z.toFixed(1) + (d.reliable === false ? " ⚠" : ""));

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
    legend.append("span").attr("class", "legend-note").text(note || VALIDITY_NOTE);
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

  /**
   * Phase 11: the panel learns WHAT would be compared, but still computes nothing.
   *
   * The header naming the comparison is not decoration - CLAUDE.md sec.5 forbids
   * leaving the target implicit, and stating it before the bars exist makes the
   * distinction visible: the question is defined, the answer is not yet computed.
   */
  let pending = 0;

  /**
   * Analytics 6.3 — fetch the contrast for the current selection and draw it.
   *
   * Two modes, decided by the selection itself rather than by a control: two countries
   * selected means a direct A-vs-B contrast, anything else is vs-rest (sec.6.3). The
   * header states which one is in force, so the comparison target is never implicit.
   */
  async function applySelection(snapshot) {
    if (snapshot.empty) return showEmpty();

    setHeader(snapshot.mode);
    d3.select("#view-d-canvas").html(
      `<span class="placeholder">contrasting ${snapshot.selected.length} incidents…</span>`);

    const token = ++pending;
    try {
      const body = { incident_ids: [...snapshot.ids] };

      // Direct A-vs-B: group B is the second country's incidents, not the complement.
      const countries = SelectionStore.getState().countries;
      if (countries.length === 2) {
        const [a, b] = countries;
        const inA = snapshot.selected.filter((d) => (d.countries || []).includes(a));
        const groupB = snapshot.selected.filter((d) => (d.countries || []).includes(b)
          && !(d.countries || []).includes(a));
        if (inA.length && groupB.length) {
          body.incident_ids = inA.map((d) => d.incident_id);
          body.comparison_ids = groupB.map((d) => d.incident_id);
        }
      }

      const response = await fetch("/api/contrast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // A slower earlier request must not overwrite a newer result.
      if (token !== pending) return;
      if (!response.ok) throw new Error(`${response.status} on /api/contrast`);
      const result = await response.json();
      if (token !== pending) return;

      if (!result.ok) return showEmpty(result.reason);

      render(result.features.map((f) => ({
        label: f.label,
        difference: f.difference,
        z: f.z,
        nSelection: f.n_selection,
        reliable: f.reliable,
        isNullish: f.is_nullish,
      })), snapshot.mode,
        `${VALIDITY_NOTE} · ${result.n_reliable} of ${result.n_features} pass`);
    } catch (error) {
      if (token !== pending) return;
      showEmpty(`contrast failed: ${error.message}`);
      console.error("[view D] contrast failed:", error);
    }
  }

  return { showEmpty, render, demo, applySelection };
})();
