/* View D — contrast panel: the selection against its comparison, on six fixed indicators.
 *
 * The contrastive z-scores are a two-proportion z-test for each of the 123 indicators.
 * This view decides which of them an analyst reads, and how.
 *
 * THREE DESIGN DECISIONS:
 *
 * 1. THE SAME SIX INDICATORS FOR EVERY SELECTION. The panel used to show the strongest
 *    one or two indicators of each question, ranked by |z|. Every selection then voted
 *    its own rows, and two countries could not be compared: one showed "Ransomware",
 *    the next "Data Exfiltration" in the same place. The rows are now fixed - two for
 *    each of three questions, who attacks, what kind of attack, against whom - so the
 *    panel is a form with constant fields and a difference between two selections is a
 *    difference in the numbers, never in the questions. FIXED_CORE says why these six.
 *
 * 2. A SMALL SELECTION IS SHOWN, AND SAID TO BE SMALL. Half the countries have fewer
 *    than ten incidents, and /api/contrast refuses to contrast a group under twenty.
 *    The refusal stands, but the counts come with it, and the panel draws them as raw
 *    rates with a note that the reading is indicative. An empty panel for 120 countries
 *    out of 168 told the analyst nothing; faded rows and a stated n tell the truth.
 *
 * 3. TWO PROPORTIONS, NOT ONE DIFFERENCE (dumbbell). "+22.7pp" does not say from what
 *    to what: 31% against 8% and 80% against 57% draw the same bar and mean very
 *    different things. Each row shows both rates as two dots joined by a segment:
 *    position on a common scale for the levels - the most accurate encoding the course
 *    material lists - and the segment's LENGTH for the effect size. Colour carries the
 *    sign. Nothing is left to a hover: each rate is printed beside its own dot and the
 *    gap in percentage points above the segment.
 */

"use strict";

const ViewD = (() => {
  // Divergent, and here a divergent scale is correct rather than decorative: the
  // quantity has a meaningful zero (no difference) and a meaningful sign. Blue/red from
  // ColorBrewer RdBu - an opponent pair that stays distinguishable under the common
  // colour-vision deficiencies, unlike red/green.
  const OVER = "#b2182b";    // more frequent in the selection than in the comparison
  const UNDER = "#2166ac";   // less frequent
  const COMPARISON = "#6b7180";   // the comparison group's dot: neutral, never a sign

  /* The six indicators every selection is read on, two for each of the three questions
   * the corpus can answer for most countries. `block` and `atoms` name them as
   * /api/features does (atoms trimmed as shortAtom trims them).
   *
   * Chosen for FREQUENCY first: only an indicator that a fifth or more of the corpus
   * carries leaves a small selection with something to compare. Each also separates
   * countries (significant against the rest of the world in a third to two thirds of
   * the countries with 30+ incidents) and names something a CSIRT acts on. Initial
   * access is absent on purpose: it is "Not available" for 85% of incidents. */
  const FIXED_CORE = [
    { title: ["WHO", "ATTACKS"], block: "init",
      atoms: ["State affiliated actor", "Non-state-group"] },
    { title: ["WHAT KIND", "OF ATTACK"], block: "type",
      atoms: ["Data theft", "Disruption"] },
    { title: ["AGAINST", "WHOM"], block: "target",
      atoms: ["State institutions / political system", "Critical infrastructure"] },
  ];
  // The one name too long for its column, shortened.
  const FIXED_LABELS = { "State institutions / political system": "State institutions" };

  // The backend's MIN_GROUP: under it /api/contrast refuses the contrast (ok: false) and
  // sends the counts all the same. The panel draws them and says they are indicative.
  const FEW_INCIDENTS = 20;

  // The table has two text columns before the plot: the question, written once beside
  // the rows it covers, and the indicator. The second is as wide as its longest name,
  // "State affiliated actor", needs; together they never take more than GUTTER_SHARE.
  const GROUP_COL = 66;
  const LABEL_COL = 110;
  const GUTTER_SHARE = 0.52;

  const DOT_R = 4;
  const BAR_Y = 4;                // the dumbbell, below the row's centre line
  const RATE_ROOM = 36;           // room for a "31.2%" beside the outermost dot
  const AXIS_H = 18;
  const GROUP_GAP = 8;            // white space between two questions
  const ROW_MIN = 22;             // still holds the gap above its dumbbell
  const ROW_MAX = 36;             // past this the rows drift apart
  const MARGIN = { top: 4, right: RATE_ROOM + 6 };

  // column -> {block, atom}, from /api/features. Set once at startup by main.js: it is
  // what finds the six indicators' columns from their block and their name.
  let featureIndex = new Map();

  function setFeatureBlocks(features) {
    featureIndex = new Map((features || []).map(
      (f) => [f.column, { block: f.block, atom: f.atom }]));
  }

  /** The codebook category, trimmed of the notes EuRepoC writes inside brackets -
   * "Corporate Targets (corporate targets only coded if ...)" is a definition, not a
   * name. */
  function shortAtom(atom) {
    return String(atom || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  }

  function setHeader(text, muted = false) {
    d3.select("#view-d-header")
      .attr("class", "view-head-extra panel-header" + (muted ? " is-muted" : ""))
      .text(text);
  }

  /** The load-time state, and the state whenever a selection is cleared.
   *
   * The legend stays populated even with nothing to plot. Leaving it blank read as a
   * missing legend - the thing the course rules penalise - when in fact there was simply
   * nothing yet to decode.
   */
  function showEmpty(reason) {
    d3.select("#view-d-canvas").html(
      `<span class="placeholder">${reason || "select a country or lasso a cluster"}</span>`);
    setHeader("no selection", true);
    renderLegend(true);
  }

  /**
   * The six rows, grouped by question, from whatever the contrast returned.
   *
   * The response leaves out an indicator that is constant across both groups (nobody in
   * either has it). Here it is put back as 0% against 0%: a row that disappears when it
   * is empty is exactly the instability the fixed rows remove.
   */
  function coreGroups(items) {
    const have = new Map(items.map((d) => [d.column, d]));
    const groups = [];
    for (const group of FIXED_CORE) {
      const rows = [];
      for (const atom of group.atoms) {
        let column = null;
        for (const [key, entry] of featureIndex) {
          if (entry.block === group.block && shortAtom(entry.atom) === atom) column = key;
        }
        if (!column) continue;
        rows.push({
          label: FIXED_LABELS[atom] || atom,
          row: have.get(column) || {
            column, difference: 0, z: 0, pSelection: 0, pComparison: 0,
            reliable: false, isEmpty: true,
          },
        });
      }
      if (rows.length) groups.push({ title: group.title, rows });
    }
    return groups;
  }

  /**
   * Draw a contrast. Called with real counts; never on load.
   *
   * @param {Array} items   {column, difference, z, pSelection, pComparison, reliable}
   * @param {string} mode   the comparison, stated in full - "Italy vs rest of world"
   * @param {Object} sizes  {nA, nB} - incidents in the selection and in the comparison;
   *                        {shared} - incidents common to both countries, left out
   */
  function render(items, mode, sizes) {
    if (!items || !items.length) return showEmpty("nothing to contrast");
    const groups = coreGroups(items);
    if (!groups.length) return showEmpty("nothing to contrast");
    const nA = sizes ? sizes.nA : 0;
    const nB = sizes ? sizes.nB : 0;
    const shared = sizes ? sizes.shared || 0 : 0;

    const host = d3.select("#view-d-canvas");
    host.html("");
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;

    // The table is fitted to the panel: rows as tall as there is room for, between
    // ROW_MIN and ROW_MAX. Nothing may run under the axis.
    const axisY = height - AXIS_H;
    const nRows = d3.sum(groups, (g) => g.rows.length);
    const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(
      (axisY - MARGIN.top - (groups.length - 1) * GROUP_GAP - 4) / nRows)));
    const left = Math.min(GROUP_COL + LABEL_COL, Math.round(width * GUTTER_SHARE));
    const innerW = width - left - MARGIN.right;
    const labelX = -left + 2 + GROUP_COL;

    // The question is not a row above its indicators but a cell beside them, spanning
    // their rows, as in a table with a merged first column. It costs no height, so the
    // rows keep all of it, and the grouping is carried by the layout alone: a column,
    // white space and one firmer rule between questions.
    const rows = [];
    let y = 0;
    groups.forEach((group, i) => {
      if (i) y += GROUP_GAP;
      group.top = y;
      group.rows.forEach((entry, j) => {
        rows.push({ row: entry.row, label: entry.label, y: y + rowH / 2,
          // No rule under the last row of a question: the white space closes it.
          isLast: j === group.rows.length - 1 });
        y += rowH;
      });
      group.bottom = y;
    });
    const drawn = rows.map((r) => r.row);

    // Proportions on a common scale from zero: the reader compares levels, so the axis
    // must start at zero, and it stops just past the largest rate shown rather than at
    // 100% - a panel where every rate is under 40% would otherwise use a third of its
    // width.
    const maxRate = d3.max(drawn, (d) => Math.max(d.pSelection, d.pComparison)) || 0.1;
    // The range starts inset: a dot at zero still needs room for its rate on its left.
    const x = d3.scaleLinear().domain([0, maxRate]).range([RATE_ROOM, innerW]).nice();

    const svg = host.append("svg").attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "Contrast panel: " + mode);
    const plot = svg.append("g")
      .attr("transform", `translate(${left},${MARGIN.top})`);

    // The column rule: the same hairline as the row rules, separating the names from
    // the chart. With it the panel reads as a table - text columns and a plot column -
    // rather than as labels floating beside marks.
    plot.append("line")
      .attr("class", "row-rule")
      .attr("x1", -6).attr("x2", -6).attr("y1", 0).attr("y2", y);

    // The question, on two lines, centred on the rows it covers.
    const title = plot.selectAll("text.dim-header").data(groups).join("text")
      .attr("class", "dim-header")
      .attr("transform", (d) => `translate(${-left + 2},${(d.top + d.bottom) / 2})`);
    title.selectAll("tspan").data((d) => d.title.map((line) => [line, d.title.length]))
      .join("tspan")
      .attr("x", 0)
      .attr("y", ([, count], i) => (i - (count - 1) / 2) * 11)
      .attr("dy", "0.35em")
      .text(([line]) => line);

    // One firmer rule between questions, in the middle of the white space.
    plot.selectAll("line.group-rule").data(groups.slice(1)).join("line")
      .attr("class", "group-rule")
      .attr("x1", -left).attr("x2", innerW + MARGIN.right - 6)
      .attr("y1", (d) => d.top - GROUP_GAP / 2).attr("y2", (d) => d.top - GROUP_GAP / 2);

    const rowG = plot.selectAll("g.row").data(rows).join("g")
      .attr("class", "row")
      .attr("transform", (d) => `translate(0,${d.y})`)
      // Faded when the two-proportion validity test fails: shown and marked, never
      // removed - the same rule the residual map follows.
      .attr("opacity", (d) => (d.row.reliable === false ? 0.45 : 1));

    // The rule between the two rows of a question starts at the indicator column, not
    // at the panel's edge: the question's cell is left whole, which is what shows it
    // belongs to both rows.
    rowG.filter((d) => !d.isLast).append("line")
      .attr("class", "row-rule")
      .attr("x1", labelX - 2).attr("x2", innerW + MARGIN.right - 6)
      .attr("y1", rowH / 2).attr("y2", rowH / 2);

    // The segment IS the difference: its length is the effect size.
    rowG.append("line")
      .attr("class", "dumbbell")
      .classed("is-unreliable-link", (d) => d.row.reliable === false)
      .attr("x1", (d) => x(d.row.pComparison)).attr("x2", (d) => x(d.row.pSelection))
      .attr("y1", BAR_Y).attr("y2", BAR_Y)
      .attr("stroke", (d) => (d.row.difference >= 0 ? OVER : UNDER));

    // Hollow dot: the comparison group. Filled dot: the selection. Same shape, so the
    // pair reads as one measurement taken twice, not as two different quantities.
    rowG.append("circle")
      .attr("class", "dot-comparison")
      .attr("cx", (d) => x(d.row.pComparison)).attr("cy", BAR_Y).attr("r", DOT_R - 0.5)
      .attr("fill", "#ffffff").attr("stroke", COMPARISON);

    rowG.append("circle")
      .attr("class", "dot-selection")
      .attr("cx", (d) => x(d.row.pSelection)).attr("cy", BAR_Y).attr("r", DOT_R)
      .attr("fill", (d) => (d.row.difference >= 0 ? OVER : UNDER));

    // Each rate is printed beside its own dot, on the outer side of the pair: the
    // lower one to the left, the higher one to the right, so neither sits on the
    // segment and each number is read with the mark it belongs to.
    const pct = (p) => (p * 100).toFixed(1) + "%";
    for (const [cls, own, other] of [["rate-comparison", "pComparison", "pSelection"],
                                     ["rate-selection", "pSelection", "pComparison"]]) {
      // On a tie the selection goes right and the comparison left.
      const isRight = (d) => (d.row[own] > d.row[other]
        || (d.row[own] === d.row[other] && own === "pSelection"));
      rowG.append("text")
        .attr("class", "rate-value " + cls)
        .attr("x", (d) => x(d.row[own]) + (isRight(d) ? DOT_R + 3 : -DOT_R - 3))
        .attr("y", BAR_Y).attr("dy", "0.35em")
        .attr("text-anchor", (d) => (isRight(d) ? "start" : "end"))
        .text((d) => pct(d.row[own]));
    }

    // The gap in percentage points, centred above the segment whose length encodes it.
    // A category nobody has in either group has no gap to state.
    rowG.filter((d) => !d.row.isEmpty).append("text")
      .attr("class", "pp-value")
      .attr("x", (d) => (x(d.row.pSelection) + x(d.row.pComparison)) / 2)
      .attr("y", BAR_Y - DOT_R - 3)
      .attr("text-anchor", "middle")
      .text((d) => `${d.row.difference > 0 ? "+" : ""}`
        + `${(d.row.difference * 100).toFixed(1)}pp`
        + `${d.row.reliable === false ? " ⚠" : ""}`);

    const labels = rowG.append("text")
      .attr("class", "bar-label")
      .attr("x", labelX).attr("dy", "0.35em")
      .text((d) => d.label);
    labels.each(function fit(d) {
      const node = this;
      const room = -labelX - 10;
      if (node.getComputedTextLength() <= room) return;
      let text = d.label;
      while (text.length > 4 && node.getComputedTextLength() > room) {
        text = text.slice(0, -2);
        node.textContent = text + "…";
      }
    });

    plot.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${axisY - MARGIN.top})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((d) => (d * 100).toFixed(0) + "%"));

    // How many incidents stand on each side, in the corner the axis leaves empty - and,
    // under the backend's minimum, that the differences are no more than indicative.
    if (nA || nB) {
      const count = d3.format(",");
      const note = svg.append("text").attr("class", "rows-note")
        .attr("x", 2).attr("y", axisY + 12);
      note.append("tspan").text(`${count(nA)} vs ${count(nB)} incidents`
        + (shared ? `  ·  ${count(shared)} common to both left out` : ""));
      if (Math.min(nA, nB) < FEW_INCIDENTS) {
        note.append("tspan").attr("class", "few-note")
          .text(`  ·  under ${FEW_INCIDENTS}: indicative only`);
      }
    }

    setHeader(mode);
    renderLegend(false);
  }

  /** The key: what the two dots are, and what the segment's colour means. */
  function renderLegend(inactive) {
    const legend = d3.select("#view-d-legend");
    legend.selectAll("*").remove();
    const cls = "legend-item" + (inactive ? " is-inactive" : "");

    // One entry per dot, each beside its own word. The filled dot is drawn in ink, not
    // in a sign colour: in the chart it takes red or blue from the direction, and a
    // legend that picked one of the two would look like it meant that direction.
    for (const [filled, text] of [[false, "comparison"], [true, "selection"]]) {
      const item = legend.append("span").attr("class", cls);
      const svg = item.append("svg").attr("width", 12).attr("height", 12);
      svg.append("circle").attr("cx", 6).attr("cy", 6)
        .attr("r", filled ? 4 : 3.5)
        .attr("fill", filled ? "#1f2330" : "#ffffff")
        .attr("stroke", filled ? "none" : COMPARISON);
      item.append("span").text(text);
    }

    for (const [colour, text] of [[OVER, "more frequent in selection"],
                                  [UNDER, "less frequent in selection"]]) {
      const item = legend.append("span").attr("class", cls);
      item.append("span").attr("class", "legend-swatch").style("background", colour);
      item.append("span").text(text);
    }
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
      ["init_state_affiliated_actor", 0.38, 0.29],
      ["init_non_state_group", 0.18, 0.32],
      ["type_data_theft", 0.44, 0.33],
      ["type_disruption", 0.30, 0.41],
      ["target_state_institutions_political_system", 0.52, 0.46],
      ["target_critical_infrastructure", 0.31, 0.13],
    ].map(([column, pSelection, pComparison]) => ({
      column, pSelection, pComparison, z: 0,
      difference: pSelection - pComparison, reliable: true,
    }));
    render(fake, "DEMO — invented numbers, not a result", { nA: 100, nB: 1000 });
    d3.select("#view-d-canvas svg").append("text")
      .attr("class", "demo-stamp").attr("x", "50%").attr("y", "52%")
      .attr("text-anchor", "middle").text("DEMO DATA");
    console.warn("[view D] demo layout drawn from fabricated numbers - not a result.");
  }

  let pending = 0;

  /**
   * Fetch the contrast for the current selection and draw it.
   *
   * Two modes, decided by the selection itself rather than by a control: two countries
   * selected means a direct A-vs-B contrast, anything else is vs-rest. The
   * header states which one is in force, so the comparison target is never implicit.
   */
  async function applySelection(snapshot) {
    if (snapshot.empty) return showEmpty();

    setHeader(snapshot.mode);
    // While the new contrast is computed, the previous chart stays on screen, faded,
    // rather than being swapped for a loading line: blanking the panel for the length of
    // a round trip read as a flicker. The placeholder is only for the first contrast,
    // when there is no chart to keep.
    const canvas = d3.select("#view-d-canvas");
    if (canvas.select("svg").empty()) {
      canvas.html(
        `<span class="placeholder">contrasting ${snapshot.selected.length} incidents…</span>`);
    } else {
      canvas.select("svg").classed("is-stale", true);
    }

    const token = ++pending;
    try {
      const body = { incident_ids: [...snapshot.ids] };

      // Direct A-vs-B: group B is the second country's incidents, not the complement.
      //
      // An incident that hit BOTH countries belongs to neither side. It used to be
      // given to whichever country was clicked first, so "US vs RU" and "RU vs US"
      // compared different groups and returned differences that were not each other's
      // opposite (-10.6pp one way, +7.9pp the other, on the same two countries). Left
      // out of both, the contrast is the same whichever way round it is read - and the
      // two groups are disjoint, which the two-proportion test assumes.
      let shared = 0;
      const countries = SelectionStore.getState().countries;
      if (countries.length === 2) {
        const [a, b] = countries;
        const hit = (d, code) => (d.countries || []).includes(code);
        const onlyA = snapshot.selected.filter((d) => hit(d, a) && !hit(d, b));
        const onlyB = snapshot.selected.filter((d) => hit(d, b) && !hit(d, a));
        if (onlyA.length && onlyB.length) {
          body.incident_ids = onlyA.map((d) => d.incident_id);
          body.comparison_ids = onlyB.map((d) => d.incident_id);
          shared = snapshot.selected.filter((d) => hit(d, a) && hit(d, b)).length;
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

      // A group under the backend's minimum is refused (ok: false) with its counts
      // attached: the panel draws them and marks them. Refused with nothing to draw -
      // an empty group - is the only case that leaves the panel empty.
      if (!result.ok && !(result.features || []).length) return showEmpty(result.reason);

      // The two rates the dumbbell draws. They are not sent as such: the response
      // carries each group's count and size, and a proportion is the one from the
      // other - computing it here keeps the API contract unchanged.
      render(result.features.map((f) => ({
        column: f.column,
        label: f.label,
        difference: f.difference,
        z: f.z,
        nSelection: f.n_selection,
        nComparison: f.n_comparison,
        pSelection: result.n_a ? f.n_selection / result.n_a : 0,
        pComparison: result.n_b ? f.n_comparison / result.n_b : 0,
        reliable: f.reliable,
        isNullish: f.is_nullish,
      })), snapshot.mode, { nA: result.n_a, nB: result.n_b, shared });
    } catch (error) {
      if (token !== pending) return;
      showEmpty(`contrast failed: ${error.message}`);
      console.error("[view D] contrast failed:", error);
    }
  }

  return { showEmpty, render, demo, applySelection, setFeatureBlocks };
})();
