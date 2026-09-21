/* View B — t-SNE projection, one point per incident.
 *
 * Phase 7 scope: draw the 3,414 precomputed positions with the colour and size the
 * proposal specifies. The lasso that triggers analytics 6.2 arrives in phase 13/15, and
 * coordination with the other views in phase 11 - nothing here computes anything.
 *
 * The axes are deliberately unlabelled and undrawn. t-SNE coordinates carry no units,
 * and inter-cluster distances are not meaningful (CLAUDE.md sec.5), so any tick or axis
 * title would assert a metric that does not exist.
 */

"use strict";

const ViewB = (() => {
  // Sequential single-hue. Divergent would be wrong: intensity has no meaningful
  // midpoint or sign (CLAUDE.md sec.2).
  //
  // ColorBrewer Greens, not Purples. Purple was doing two jobs at once - it was this
  // ramp AND the colour of a selection (the lasso outline, the local-projection banner).
  // A point could be dark because it was intense or because it was picked, which is the
  // one distinction this view exists to support. Moving intensity to green leaves purple
  // to mean "chosen by the analyst" and nothing else.
  const COLOURS = ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"];

  const R_MIN = 2.0;
  const R_MAX = 8.0;

  let state = { svg: null, points: null, colour: null, radius: null, maxLog: 1,
                x: null, y: null, lassoPath: null, drawing: false, vertices: [] };

  /* Ray casting: count how many times a ray from the point crosses the polygon edges.
   * Odd means inside. Written out rather than pulled from a library because d3 has no
   * lasso and the whole test is a dozen lines - a dependency would cost more to justify
   * at the exam than the code costs to read. */
  function insidePolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const crosses = (yi > py) !== (yj > py)
        && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  /** Radius such that the drawn AREA is proportional to log1p(affected entities).
   *
   * Two compressions stacked on purpose. log1p first, because the raw variable spans
   * 0 to 1,000,000 and one mass-breach incident would otherwise dwarf every other
   * point. Then sqrt, so that area - which is what the eye actually integrates - tracks
   * the log value rather than its square. Course material is explicit that people
   * estimate area ratios badly, so encoding the value on the radius directly would
   * exaggerate every difference.
   */
  function radiusFor(value) {
    const v = Math.log1p(Math.max(0, value ?? 0));
    return R_MIN + (R_MAX - R_MIN) * Math.sqrt(v) / Math.sqrt(state.maxLog);
  }

  function colourFor(intensity) {
    if (intensity == null) return "#cccccc";
    const index = Math.min(COLOURS.length - 1, Math.max(0, Math.round(intensity)));
    return COLOURS[Math.min(index, COLOURS.length - 1)];
  }

  function renderLegend(incidents) {
    const legend = d3.select("#view-b-legend");
    legend.selectAll("*").remove();

    // Two encodings, two groups side by side, each with its title above its values.
    // The titles used to sit inline with the swatches, which put two different scales on
    // one run of symbols and left the reader to work out where one ended and the other
    // began. Grouping is the separation.
    const colourGroup = legend.append("div").attr("class", "legend-group");
    colourGroup.append("span").attr("class", "legend-title").text("weighted intensity");
    const colourRow = colourGroup.append("div").attr("class", "legend-row");

    const swatches = colourRow.selectAll("span.legend-item.c")
      .data(COLOURS.map((c, i) => ({ c, i })))
      .join("span").attr("class", "legend-item c");
    swatches.append("span").attr("class", "legend-swatch").style("background", (d) => d.c);
    swatches.append("span").text((d) => (d.i === COLOURS.length - 1 ? d.i + "+" : d.i));

    // Size legend: three reference circles drawn at the same scale as the plot, so the
    // reader can compare against the marks rather than guess.
    const sizeGroup = legend.append("div").attr("class", "legend-group");
    sizeGroup.append("span").attr("class", "legend-title").text("affected entities");
    const sizeRow = sizeGroup.append("div").attr("class", "legend-row");
    // 15px tall: one line of legend text plus a little, so it fits the legend's fixed
    // two-line height. The circles are still drawn with the plot's own radiusFor(), so
    // they stay directly comparable with the marks - the 1000 circle is about 12px wide,
    // which the height holds. Width is measured from what was drawn rather than fixed.
    const sizes = [0, 10, 1000];
    const svg = sizeRow.append("svg").attr("height", 15);
    let x = 7;
    let right = 0;
    for (const value of sizes) {
      const r = radiusFor(value);
      svg.append("circle").attr("cx", x).attr("cy", 7.5).attr("r", r)
        .attr("fill", "none").attr("stroke", "#6a6a6a");
      const label = svg.append("text").attr("x", x + r + 3).attr("y", 11)
        .attr("font-size", 9).attr("fill", "#6b6b6b").text(value);
      // getComputedTextLength() is 0 if the legend is not laid out yet; fall back to
      // an estimate rather than sizing the svg to nothing.
      right = x + r + 3 + (label.node().getComputedTextLength()
        || String(value).length * 5.5);
      x += r + 24;
    }
    svg.attr("width", Math.ceil(right) + 2);
  }

  /**
   * Map an embedding onto the canvas with ONE scale factor for both axes.
   *
   * Not two independent d3.extent stretches, which is what this did until the grid
   * became fluid. t-SNE axes carry no units, but the embedding is still isotropic: the
   * ratio of two distances inside it is the only thing it does assert. Stretching x and
   * y by different factors destroys exactly that - a round cluster is drawn as an
   * ellipse, and the wider the view gets the more elongated it becomes. The unused space
   * is left as margin instead, and the plot is centred in it.
   *
   * @param {number} topPad extra room at the top, for the local-projection banner
   */
  function fitScales(xs, ys, width, height, topPad = 0) {
    const [x0, x1] = d3.extent(xs);
    const [y0, y1] = d3.extent(ys);
    const pad = R_MAX + 2;
    const spanX = (x1 - x0) || 1;
    const spanY = (y1 - y0) || 1;

    const k = Math.min((width - 2 * pad) / spanX,
                       (height - 2 * pad - topPad) / spanY);

    const left = (width - k * spanX) / 2;
    const top = topPad + (height - topPad - k * spanY) / 2;

    return {
      x: d3.scaleLinear().domain([x0, x1]).range([left, left + k * spanX]),
      // Inverted range: SVG y grows downward, the embedding's does not.
      y: d3.scaleLinear().domain([y0, y1]).range([top + k * spanY, top]),
    };
  }

  function init(incidents) {
    const host = d3.select("#view-b-canvas");
    host.html("");

    const width = host.node().clientWidth;
    const height = host.node().clientHeight;

    state.maxLog = Math.max(...incidents.map(
      (d) => Math.log1p(Math.max(0, d.affected_entities_value ?? 0))));

    const { x, y } = fitScales(incidents.map((d) => d.x), incidents.map((d) => d.y),
      width, height);

    const svg = host.append("svg")
      .attr("width", width).attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "t-SNE projection of 3,414 cyber incidents");
    state.svg = svg;

    // Draw the largest marks first so small points are not hidden underneath them.
    const ordered = [...incidents].sort(
      (a, b) => (b.affected_entities_value ?? 0) - (a.affected_entities_value ?? 0));

    state.points = svg.append("g").selectAll("circle")
      .data(ordered).join("circle")
      .attr("class", "point")
      .attr("cx", (d) => x(d.x))
      .attr("cy", (d) => y(d.y))
      .attr("r", (d) => radiusFor(d.affected_entities_value))
      .attr("fill", (d) => colourFor(d.weighted_intensity))
      .attr("fill-opacity", 0.78)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.35);

    state.points.append("title").text((d) =>
      `${(d.name || "").trim().slice(0, 70)}\n`
      + `${d.year ?? "no date"} · intensity ${d.weighted_intensity ?? "?"} · `
      + `${d.affected_entities_value ?? 0} affected entities`);

    // The "no units" caveat is no longer painted over the plot. It still has to be
    // said - it is what stops the plane being read as a map - so it moved to the view's
    // subtitle in index.html, beside the other instructions. Same statement, off the
    // data.

    state.x = x;
    state.y = y;
    attachLasso(svg, ordered, width, height);

    renderLegend(incidents);
    console.info(`[view B] ${incidents.length} points drawn`);
    return incidents.length;
  }

  /* Free lasso — one of the three permitted analytic triggers (CLAUDE.md sec.2: no
   * menu, dropdown or radio button may start a computation). Drag to trace a shape,
   * release to select what falls inside; a click without a drag clears. */
  function attachLasso(svg, data, width, height) {
    state.lassoPath = svg.append("path").attr("class", "lasso").attr("d", "");

    const point = (event) => {
      const rect = svg.node().getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    svg.on("mousedown", (event) => {
      event.preventDefault();
      state.drawing = true;
      state.vertices = [point(event)];
      // No outline is drawn while a local layout is on screen: the gesture cannot
      // produce a selection there (see mouseup), and drawing it would promise one.
      if (!local.active) state.lassoPath.attr("d", "").classed("is-active", true);
    });

    svg.on("mousemove", (event) => {
      if (!state.drawing) return;
      // Vertices are recorded even in the local layout, where no lasso will be drawn or
      // acted on. They are what distinguishes a drag from a click at mouseup, and
      // without them a drag would fall through to the click branch and clear the
      // selection - doing something, when the point is to do nothing.
      state.vertices.push(point(event));
      if (local.active) return;
      state.lassoPath.attr("d", "M" + state.vertices.map((p) => p.join(",")).join("L") + "Z");
    });

    // Listening on window, not the svg: releasing the button outside the plot must
    // still finish the gesture, otherwise the lasso stays stuck in drawing mode.
    d3.select(window).on("mouseup.viewB", () => {
      if (!state.drawing) return;
      state.drawing = false;
      state.lassoPath.attr("d", "").classed("is-active", false);

      // Fewer than three vertices is a click, not a lasso: treat it as "clear". This
      // stays available in the local layout - it is the way back to the global one.
      if (state.vertices.length < 3) {
        // Only a lasso can be cleared from here. With none active the click publishes
        // nothing at all: a notification that changes no state still wakes every
        // subscriber, and that is how a click once refitted a country selection.
        if (SelectionStore.getState().lasso) SelectionStore.setLasso(null);
        return;
      }

      // No lassoing inside a local re-projection.
      //
      // The two layouts are different coordinate systems, and a lasso is a claim about
      // position. While the local one is on screen the points it does not contain are
      // hidden rather than dimmed, so an enclosure here could only ever mean "a
      // sub-cluster of the sub-cluster" - a drill-down whose result would replace the
      // very selection the analyst is reading, with no way back to it. Clearing returns
      // to the global layout, where a new lasso means what it says.
      if (local.active) {
        console.info("[view B] lasso ignored: the local layout is on screen. "
          + "Click empty space to return to the global one, then lasso again.");
        return;
      }
      // Test against where each point is drawn NOW, not against its global coordinates.
      // After a local re-projection the marks have moved, and using the global scales
      // here would select whatever happens to sit at the old positions - points the
      // analyst never enclosed.
      const nodes = state.points.nodes();
      const hits = [];
      for (const node of nodes) {
        if (insidePolygon(+node.getAttribute("cx"), +node.getAttribute("cy"),
                          state.vertices)) {
          hits.push(d3.select(node).datum());
        }
      }
      SelectionStore.setLasso(new Set(hits.map((d) => d.incident_id)));
      console.info(`[view B] lasso selected ${hits.length} incidents`);
    });
  }

  /**
   * React to the shared selection, whatever produced it.
   *
   * Selected points keep their colour; the rest fade rather than disappear, so the
   * selection is read against the shape of the whole corpus instead of floating in an
   * empty plane.
   */
  function applySelection(snapshot, origin) {
    if (!state.points) return;

    // A local layout describes ONE selection. When the next selection comes from
    // somewhere else - a map click, a timeline brush - that layout no longer describes
    // what is selected, so the global one comes back rather than being left on screen
    // with a different set highlighted on it.
    if (local.active && origin && origin !== "projection") restoreGlobal();

    if (snapshot.empty) {
      restoreGlobal();
      state.points.attr("fill-opacity", 0.78).attr("stroke", "#ffffff")
        .attr("stroke-width", 0.35).classed("is-dimmed", false);
      return;
    }
    state.points
      .classed("is-dimmed", (d) => !snapshot.ids.has(d.incident_id))
      .attr("fill-opacity", (d) => (snapshot.ids.has(d.incident_id) ? 0.9 : 0.12))
      .attr("stroke", (d) => (snapshot.ids.has(d.incident_id) ? "#1a1a1a" : "#ffffff"))
      .attr("stroke-width", (d) => (snapshot.ids.has(d.incident_id) ? 0.7 : 0.2));
  }

  // ---------------------------------------------------------------------------------
  // Analytics 6.2 — local re-projection
  //
  // The proposal names t-SNE as the technique integrated in the interactive flow, and
  // this is where that happens: the layout is genuinely refitted on the selected subset,
  // not filtered from the precomputed one. Structure the global embedding had to
  // compress can re-emerge at local scale.

  let local = { active: false, banner: null };

  function setBanner(text, kind) {
    if (!state.svg) return;
    state.svg.selectAll("g.local-banner").remove();
    if (!text) return;
    const g = state.svg.append("g").attr("class", "local-banner");
    g.append("rect").attr("x", 0).attr("y", 0)
      .attr("width", state.svg.attr("width")).attr("height", 19)
      .attr("class", "banner-bg is-" + kind);
    g.append("text").attr("x", 6).attr("y", 13).attr("class", "banner-text")
      .text(text);
  }

  /** Put every point back on its global coordinates, and back on screen. */
  function restoreGlobal() {
    if (!local.active) { setBanner(null); return; }
    local.active = false;
    state.points.attr("display", null);
    state.points.transition().duration(400)
      .attr("cx", (d) => state.x(d.x))
      .attr("cy", (d) => state.y(d.y));
    setBanner(null);
  }

  /**
   * Refit the projection on the current selection.
   *
   * Called by phase 15's explicit trigger rather than on every selection change: a
   * refit costs two to three seconds, and firing it on each click of a ctrl-click
   * sequence would make the interface feel broken.
   */
  async function reproject(snapshot) {
    if (!state.points || snapshot.empty) return null;
    setBanner("re-projecting " + snapshot.ids.size + " incidents…", "busy");

    const response = await fetch("/api/reproject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_ids: [...snapshot.ids] }),
    });
    if (!response.ok) { setBanner("re-projection failed", "error"); return null; }
    const result = await response.json();

    // A refusal is a result. Showing an unstable layout of 12 points would look exactly
    // as authoritative as a good one (CLAUDE.md sec.6.2).
    if (!result.ok) {
      setBanner(result.reason + " — showing the global layout", "warn");
      restoreGlobalKeepBanner();
      return result;
    }

    const byId = new Map(result.points.map((p) => [p.incident_id, p]));
    const xs = result.points.map((p) => p.x);
    const ys = result.points.map((p) => p.y);
    // Same isotropic fit as the global layout. Using a different mapping here would make
    // the two embeddings visually incomparable for a reason that has nothing to do with
    // the data - 20px of top padding leaves room for the banner.
    const { x: lx, y: ly } = fitScales(xs, ys, +state.svg.attr("width"),
      +state.svg.attr("height"), 20);

    local.active = true;

    // Everything outside the subset is HIDDEN, not dimmed.
    //
    // Context-behind-focus works in View C because context and focus share one pair of
    // axes. Here they would not: a re-projected point sits in the local embedding, an
    // unselected one in the global embedding, and drawing both on the same plane puts
    // two coordinate systems in one picture. The faded points were not the same data in
    // the background - they were a different map underneath, and a lasso drawn over the
    // result caught both. Set directly rather than through the transition: whether a
    // mark is on screen must not depend on an animation frame.
    state.points.attr("display", (d) => (byId.has(d.incident_id) ? null : "none"));

    state.points.transition().duration(600)
      .attr("cx", (d) => (byId.has(d.incident_id) ? lx(byId.get(d.incident_id).x) : state.x(d.x)))
      .attr("cy", (d) => (byId.has(d.incident_id) ? ly(byId.get(d.incident_id).y) : state.y(d.y)));

    // The banner is not decoration: an analyst must never mistake a local layout for
    // the global one, because the axes mean something different in each.
    setBanner(`LOCAL re-projection · n=${result.n} · perplexity ${result.perplexity}`
      + ` · trustworthiness ${result.trustworthiness.toFixed(3)}`, "local");
    return result;
  }

  function restoreGlobalKeepBanner() {
    if (!local.active) return;
    local.active = false;
    state.points.attr("display", null);
    state.points.transition().duration(400)
      .attr("cx", (d) => state.x(d.x)).attr("cy", (d) => state.y(d.y));
  }

  return { init, applySelection, reproject, restoreGlobal,
           isLocal: () => local.active };
})();
