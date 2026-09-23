/* View D — contrast panel: what makes this selection different, as a profile.
 *
 * Analytics 6.3 computes a two-proportion z-test for each of the 123 indicators. This
 * view decides which of them an analyst actually reads, and how.
 *
 * THREE DESIGN DECISIONS, each answering a way the earlier flat bar chart failed:
 *
 * 1. READABLE LABELS. The indicators are named after the EuRepoC columns they come
 *    from - "issue: System / ideology", "iimpact: Minor data breach/exfilt…". Those are
 *    two layers of jargon: an internal block prefix and a codebook category. BLOCKS
 *    below translates every block into the question it answers, and the row's tooltip
 *    carries the codebook definition, so nothing has to be memorised.
 *
 * 2. GROUPED INTO A PROFILE. The 14 blocks are 14 different questions, and ranking them
 *    together by |z| produced a list where four of the eight rows were the same finding
 *    seen from four angles ("more data theft") while nothing at all was said about who
 *    the attacker was. The blocks are gathered into the six questions an analyst asks -
 *    who, what, against whom, how, with what effect, why - and each contributes its
 *    strongest one or two indicators. The result is a profile with no gaps and no
 *    repetitions. Within a dimension the order is still reliability then |z|, as
 *    CLAUDE.md sec.5 requires; the grouping decides WHICH features are shown, the
 *    ranking decides the order they are shown in.
 *
 * 3. TWO PROPORTIONS, NOT ONE DIFFERENCE (dumbbell). "+22.7pp" does not say from what
 *    to what: 31% against 8% and 80% against 57% draw the same bar and mean very
 *    different things. Each row now shows both rates as two dots joined by a segment:
 *    position on a common scale for the levels - the most accurate encoding the course
 *    material lists - and the segment's LENGTH for the effect size, which is what the
 *    old bar encoded. Colour still carries the sign, order still carries |z|.
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

  /* The 14 one-hot blocks, each with the question it answers and what its categories
   * mean. `short` is what the row label says; `definition` is what the tooltip says.
   * The source column is named because it is the link back to the EuRepoC codebook. */
  const BLOCKS = {
    init: { dim: "who", short: "actor type", source: "initiator_category",
      definition: "What kind of actor is named as the initiator: a state, a "
        + "state-affiliated group, a non-state group, an individual - or nobody." },
    stateresp: { dim: "who", short: "state responsibility",
      source: "state_responsibility_actor",
      definition: "How directly a state is held responsible: members of state agencies "
        + "acting themselves, a state knowingly sanctioning or supporting non-state "
        + "actors, or no state involvement." },
    type: { dim: "what", short: "operation", source: "incident_type",
      definition: "What kind of operation the incident was: data theft, disruption, "
        + "hijacking, ransomware, doxing." },
    impact: { dim: "what", short: "technique", source: "mitre_impact",
      definition: "MITRE ATT&CK impact technique: what the attacker did to the target "
        + "once inside - exfiltrate, encrypt, wipe, deface, deny service." },
    hijack: { dim: "what", short: "hijacking severity", source: "hijacking",
      definition: "Whether systems were taken over, and whether the attacker then "
        + "misused them. One of the components of EuRepoC's intensity score." },
    target: { dim: "target", short: "sector", source: "receiver_category",
      definition: "What kind of entity was targeted: critical infrastructure, "
        + "corporate, state institutions, media, science, end users." },
    access: { dim: "how", short: "initial access", source: "mitre_initial_access",
      definition: "MITRE ATT&CK initial-access technique: how the attacker first got "
        + "in - phishing, a public-facing application, a supply chain, valid accounts." },
    fimpact: { dim: "effect", short: "downtime", source: "functional_impact",
      definition: "How long the target's systems were disrupted, from no interference "
        + "at all to months." },
    iimpact: { dim: "effect", short: "data impact", source: "intelligence_impact",
      definition: "How much data was breached, exfiltrated, corrupted or leaked." },
    dtheft: { dim: "effect", short: "data theft severity", source: "data_theft",
      definition: "Whether data was stolen and whether it was sensitive. One of the "
        + "components of EuRepoC's intensity score." },
    disrupt: { dim: "effect", short: "disruption severity", source: "disruption",
      definition: "Whether services were disrupted and for how long (under or over 24 "
        + "hours). One of the components of EuRepoC's intensity score." },
    issue: { dim: "why", short: "cyber conflict issue", source: "cyber_conflict_issue",
      definition: "What the conflict between attacker and target is about, in the "
        + "categories used for armed conflicts: territory, secession, autonomy, "
        + "political system or ideology, national or international power, resources." },
    oissue: { dim: "why", short: "offline conflict issue",
      source: "offline_conflict_issue",
      definition: "The issue of the real-world conflict the incident is part of, in the "
        + "same categories. Set when the incident belongs to an offline dispute." },
    ilaw: { dim: "why", short: "international law", source: "il_breach_indicator",
      definition: "Which area of international law the incident touches: sovereignty, "
        + "non-intervention, human rights, armed conflict, espionage, and others." },
  };

  /* The six questions a threat-intelligence analyst asks of a profile, in reading
   * order. A dimension with nothing to show is skipped rather than shown empty. */
  const DIMENSIONS = [
    { key: "who", title: "WHO ATTACKS" },
    { key: "what", title: "WHAT KIND OF ATTACK" },
    { key: "target", title: "AGAINST WHOM" },
    { key: "how", title: "HOW THEY GET IN" },
    { key: "effect", title: "WITH WHAT EFFECT" },
    { key: "why", title: "WHY" },
  ];

  const PER_DIMENSION = 2;        // at most; reduced to 1 when the panel is short
  const ROW_H = 21;
  const HEADER_H = 15;
  const DOT_R = 4;

  // The label gutter never takes more than half the panel. Wider than the old bar
  // chart's: a row label now names the block AND the category ("cyber conflict issue ·
  // System / ideology"), which is the whole point of the relabelling.
  const MARGIN = { top: 4, right: 86, bottom: 18, left: 210 };
  const GUTTER_SHARE = 0.52;

  // column -> {block, atom}, from /api/features. Set once at startup by main.js: the
  // contrast response carries the column name, and this is what turns it into a block
  // (which dimension it belongs to) and an atom (the category itself).
  let featureIndex = new Map();

  function setFeatureBlocks(features) {
    featureIndex = new Map((features || []).map(
      (f) => [f.column, { block: f.block, atom: f.atom }]));
  }

  /** The codebook category, trimmed of the notes EuRepoC writes inside brackets -
   * "Short-term disruption (< 24h; incident scores 1 point in intensity)" is a
   * definition, not a name. The full text stays in the tooltip. */
  function shortAtom(atom) {
    return String(atom || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  }

  function decorate(item) {
    const entry = featureIndex.get(item.column) || {};
    const meta = BLOCKS[entry.block];
    // A block with no entry here is shown under its own name rather than hidden: a new
    // indicator must never disappear from the panel just because this table is stale.
    return Object.assign({}, item, {
      block: entry.block,
      atom: entry.atom || item.label,
      dim: meta ? meta.dim : "what",
      rowLabel: meta
        ? `${meta.short} · ${shortAtom(entry.atom)}`
        : item.label,
    });
  }

  /** Split the stated comparison into the two group names the tooltip reports.
   *
   * The store writes the mode out in full - `"US" vs rest of world`, `"IT" vs "FR"` -
   * and it is the same string the panel header shows, so the tooltip cannot disagree
   * with the header about who is being compared with whom. */
  function groupNames(mode) {
    const unquote = (part) => String(part || "").trim().replace(/^"|"$/g, "");
    const at = String(mode || "").lastIndexOf(" vs ");
    if (at < 0) return [unquote(mode), "comparison group"];
    return [unquote(mode.slice(0, at)), unquote(mode.slice(at + 4))];
  }

  function setHeader(text, muted = false) {
    d3.select("#view-d-header")
      .attr("class", "view-head-extra panel-header" + (muted ? " is-muted" : ""))
      .text(text);
  }

  /** The load-time state, and the state whenever a selection is cleared.
   *
   * The legend stays populated even with nothing to plot. Leaving it blank read as a
   * missing legend - the thing CLAUDE.md sec.2 penalises - when in fact there was simply
   * nothing yet to decode.
   */
  function showEmpty(reason) {
    d3.select("#view-d-canvas").html(
      `<span class="placeholder">${reason || "select a country or lasso a cluster"}</span>`);
    setHeader("no selection", true);
    renderLegend(true);
  }

  /**
   * Choose what to draw: the strongest indicators of each dimension, in reading order.
   *
   * Reliability first, then |z| - the backend's own ranking - applied WITHIN each
   * dimension. The panel then always answers all six questions rather than repeating
   * the loudest one, and a dimension that has nothing reliable to say still shows its
   * best evidence, flagged.
   */
  function pickByDimension(items, perDimension) {
    const groups = [];
    for (const dimension of DIMENSIONS) {
      const rows = items
        .filter((d) => d.dim === dimension.key)
        .sort((a, b) => (a.reliable === false) - (b.reliable === false)
          || Math.abs(b.z) - Math.abs(a.z))
        .slice(0, perDimension);
      if (rows.length) groups.push({ title: dimension.title, rows });
    }
    return groups;
  }

  /** Total height a set of groups needs, headers included. */
  function heightOf(groups) {
    return groups.reduce((sum, g) => sum + HEADER_H + g.rows.length * ROW_H, 0);
  }

  /**
   * Draw a contrast. Called by phase 14 with real z-scores; never on load.
   *
   * @param {Array} items  {column, label, difference, z, pSelection, pComparison, ...}
   * @param {string} mode  the comparison, stated in full - "Italy vs rest of world"
   */
  function render(items, mode) {
    if (!items || !items.length) return showEmpty("nothing to contrast");

    const host = d3.select("#view-d-canvas");
    host.html("");
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;
    const left = Math.min(MARGIN.left, Math.round(width * GUTTER_SHARE));
    const innerW = width - left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    // Two per dimension when the panel is tall enough, one when it is not: twelve rows
    // squeezed into a laptop's panel would be thinner than the dots they carry.
    const decorated = items.map(decorate);
    let groups = pickByDimension(decorated, PER_DIMENSION);
    if (heightOf(groups) > innerH) groups = pickByDimension(decorated, 1);
    // Still too tall (a very short window): drop whole dimensions from the weakest end,
    // so what remains is complete rather than half-drawn.
    while (groups.length > 1 && heightOf(groups) > innerH) groups.pop();

    const rows = [];
    let y = 0;
    for (const group of groups) {
      rows.push({ header: group.title, y: y + HEADER_H - 4 });
      y += HEADER_H;
      for (const row of group.rows) {
        rows.push({ row, y: y + ROW_H / 2 });
        y += ROW_H;
      }
    }
    const featureRows = rows.filter((r) => r.row);
    // The last row gets no rule beneath it: a table is closed by its last entry, and a
    // line there would read as the start of a section that never comes.
    featureRows[featureRows.length - 1].isLast = true;
    const drawn = featureRows.map((r) => r.row);

    // Proportions on a common scale from zero: the reader compares levels, so the axis
    // must start at zero, and it stops just past the largest rate shown rather than at
    // 100% - a panel where every rate is under 40% would otherwise use a third of its
    // width.
    const maxRate = d3.max(drawn, (d) => Math.max(d.pSelection, d.pComparison)) || 0.1;
    const x = d3.scaleLinear().domain([0, maxRate]).range([0, innerW]).nice();

    const svg = host.append("svg").attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "Contrast panel: " + mode);
    const plot = svg.append("g")
      .attr("transform", `translate(${left},${MARGIN.top})`);

    // The column rule: the same hairline as the row rules, separating the names from
    // the chart. With it the panel reads as a table - a text column and a plot column -
    // rather than as labels floating beside marks.
    plot.append("line")
      .attr("class", "row-rule")
      .attr("x1", -6).attr("x2", -6).attr("y1", 0).attr("y2", y);

    // Dimension headers: they are what turns a list into a profile.
    plot.selectAll("text.dim-header").data(rows.filter((r) => r.header)).join("text")
      .attr("class", "dim-header")
      .attr("x", -left + 2).attr("y", (d) => d.y)
      .text((d) => d.header);

    const rowG = plot.selectAll("g.row").data(rows.filter((r) => r.row)).join("g")
      .attr("class", "row")
      .attr("transform", (d) => `translate(0,${d.y})`)
      // Faded when the two-proportion validity test fails: shown and marked, never
      // removed - sec.6.1's rule applied to 6.3.
      .attr("opacity", (d) => (d.row.reliable === false ? 0.45 : 1));

    // A rule under every row, drawn across the label gutter and the plot together, so
    // the panel reads as a table: the eye follows one row from its name to its dots
    // without drifting onto the neighbouring one.
    rowG.filter((d) => !d.isLast).append("line")
      .attr("class", "row-rule")
      .attr("x1", -left).attr("x2", innerW + MARGIN.right - 6)
      .attr("y1", ROW_H / 2).attr("y2", ROW_H / 2);

    // The segment IS the difference: its length is the effect size the old bar drew.
    rowG.append("line")
      .attr("class", "dumbbell")
      .classed("is-unreliable-link", (d) => d.row.reliable === false)
      .attr("x1", (d) => x(d.row.pComparison)).attr("x2", (d) => x(d.row.pSelection))
      .attr("y1", 0).attr("y2", 0)
      .attr("stroke", (d) => (d.row.difference >= 0 ? OVER : UNDER));

    // Hollow dot: the comparison group. Filled dot: the selection. Same shape, so the
    // pair reads as one measurement taken twice, not as two different quantities.
    rowG.append("circle")
      .attr("class", "dot-comparison")
      .attr("cx", (d) => x(d.row.pComparison)).attr("r", DOT_R - 0.5)
      .attr("fill", "#ffffff").attr("stroke", COMPARISON);

    rowG.append("circle")
      .attr("class", "dot-selection")
      .attr("cx", (d) => x(d.row.pSelection)).attr("r", DOT_R)
      .attr("fill", (d) => (d.row.difference >= 0 ? OVER : UNDER));

    // Left aligned, flush with the dimension headers: one column of text with a single
    // starting edge. Right aligned against the plot, every group started at a different
    // x and the grouping was hard to see.
    const LABEL_X = -left + 2;
    const labels = rowG.append("text")
      .attr("class", "bar-label")
      .attr("x", LABEL_X).attr("dy", "0.35em")
      .text((d) => d.row.rowLabel);
    labels.each(function fit(d) {
      const node = this;
      const room = left - 2 - 10;
      if (node.getComputedTextLength() <= room) return;
      let text = d.row.rowLabel;
      while (text.length > 4 && node.getComputedTextLength() > room) {
        text = text.slice(0, -2);
        node.textContent = text + "…";
      }
    });

    // The two numbers that are not positions: the gap in percentage points, which the
    // segment's length encodes, and the z, which decides the order. z divides the
    // difference by its standard error, so the same gap earns a smaller z on fewer
    // incidents or near a 50% base rate - printing both stops the reader from taking
    // length for significance.
    const values = rowG.append("text")
      .attr("class", "z-value")
      .attr("x", innerW + 6).attr("dy", "0.35em");
    values.append("tspan").attr("class", "pp-value")
      .text((d) => `${d.row.difference > 0 ? "+" : ""}`
        + `${(d.row.difference * 100).toFixed(1)}pp`);
    values.append("tspan")
      .text((d) => `  z ${d.row.z.toFixed(1)}${d.row.reliable === false ? " ⚠" : ""}`);

    // The hover target is the DUMBBELL, not the whole row: the tooltip reports the two
    // rates, which is what the two dots and the segment between them encode, so it
    // belongs to that mark. Stretched across the row it also fired over the label and
    // the numbers, where nothing was being pointed at.
    const PAD = DOT_R + 3;
    const hit = rowG.append("rect")
      .attr("class", "row-hit")
      .attr("x", (d) => Math.min(x(d.row.pSelection), x(d.row.pComparison)) - PAD)
      .attr("y", -ROW_H / 2 + 2)
      .attr("width", (d) => Math.abs(x(d.row.pSelection) - x(d.row.pComparison)) + 2 * PAD)
      .attr("height", ROW_H - 4);

    // The tooltip says the one thing the two dots cannot: the exact rates, named after
    // the groups they belong to. Everything else it used to carry is already on screen -
    // the label on the left, the gap and the z on the right.
    const [selectionName, comparisonName] = groupNames(mode);
    Tooltip.attach(hit, "view-d", (d) => {
      const pSel = (d.row.pSelection * 100).toFixed(1);
      const pComp = (d.row.pComparison * 100).toFixed(1);
      return `<span>selection: ${Tooltip.esc(selectionName)} `
        + `${pSel}% (${d.row.nSelection})</span>`
        + `<span>comparison: ${Tooltip.esc(comparisonName)} `
        + `${pComp}% (${d.row.nComparison})</span>`;
    });

    plot.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((d) => (d * 100).toFixed(0) + "%"));

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
      ["access_phishing", 0.31, 0.13, 4.6, 41],
      ["target_critical_infrastructure", 0.18, 0.32, -3.9, 12],
      ["impact_data_exfiltration", 0.44, 0.33, 3.1, 33],
      ["init_state", 0.38, 0.29, 2.7, 28],
      ["issue_territory", 0.06, 0.14, -2.2, 9],
      ["ilaw_sovereignty", 0.21, 0.15, 1.8, 21],
      ["type_ransomware", 0.30, 0.08, 1.1, 4],
    ].map(([column, pSelection, pComparison, z, nSelection]) => ({
      column, label: column, pSelection, pComparison, z, nSelection,
      nComparison: 100, difference: pSelection - pComparison, reliable: true,
    }));
    render(fake, "DEMO — invented numbers, not a result");
    d3.select("#view-d-canvas svg").append("text")
      .attr("class", "demo-stamp").attr("x", "50%").attr("y", "52%")
      .attr("text-anchor", "middle").text("DEMO DATA");
    console.warn("[view D] demo layout drawn from fabricated numbers - not a result.");
  }

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
      })), snapshot.mode);
    } catch (error) {
      if (token !== pending) return;
      showEmpty(`contrast failed: ${error.message}`);
      console.error("[view D] contrast failed:", error);
    }
  }

  return { showEmpty, render, demo, applySelection, setFeatureBlocks };
})();
