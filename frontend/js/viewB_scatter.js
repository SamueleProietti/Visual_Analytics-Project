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
  // Sequential single-hue, and a different hue from View A's blues so the two views are
  // not read as sharing a scale. Divergent would be wrong: intensity has no meaningful
  // midpoint or sign (CLAUDE.md sec.2).
  const COLOURS = ["#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"];

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

    legend.append("span").attr("class", "legend-title").text("weighted intensity:");
    const swatches = legend.selectAll("span.legend-item.c")
      .data(COLOURS.map((c, i) => ({ c, i })))
      .join("span").attr("class", "legend-item c");
    swatches.append("span").attr("class", "legend-swatch").style("background", (d) => d.c);
    swatches.append("span").text((d) => (d.i === COLOURS.length - 1 ? d.i + "+" : d.i));

    // Size legend: three reference circles drawn at the same scale as the plot, so the
    // reader can compare against the marks rather than guess.
    legend.append("span").attr("class", "legend-title").style("margin-left", "10px")
      .text("affected entities:");
    const sizes = [0, 10, 1000];
    const svg = legend.append("svg").attr("width", 108).attr("height", 20);
    let x = 8;
    for (const value of sizes) {
      const r = radiusFor(value);
      svg.append("circle").attr("cx", x).attr("cy", 10).attr("r", r)
        .attr("fill", "none").attr("stroke", "#6a6a6a");
      svg.append("text").attr("x", x + r + 3).attr("y", 13)
        .attr("font-size", 9).attr("fill", "#6b6b6b").text(value);
      x += r + 30;
    }
  }

  function init(incidents) {
    const host = d3.select("#view-b-canvas");
    host.html("");

    const width = host.node().clientWidth;
    const height = host.node().clientHeight;

    state.maxLog = Math.max(...incidents.map(
      (d) => Math.log1p(Math.max(0, d.affected_entities_value ?? 0))));

    const pad = R_MAX + 2;
    const x = d3.scaleLinear()
      .domain(d3.extent(incidents, (d) => d.x)).range([pad, width - pad]);
    const y = d3.scaleLinear()
      .domain(d3.extent(incidents, (d) => d.y)).range([height - pad, pad]);

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

    // A standing reminder that the plane has no metric. Phrased as a caption, not an
    // axis label, precisely because there is no axis to label.
    svg.append("text")
      .attr("x", width - 4).attr("y", height - 5)
      .attr("text-anchor", "end")
      .attr("font-size", 9).attr("fill", "#9a9a9a")
      .text("axes have no units · distances between clusters are not meaningful");

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
      state.lassoPath.attr("d", "").classed("is-active", true);
    });

    svg.on("mousemove", (event) => {
      if (!state.drawing) return;
      state.vertices.push(point(event));
      state.lassoPath.attr("d", "M" + state.vertices.map((p) => p.join(",")).join("L") + "Z");
    });

    // Listening on window, not the svg: releasing the button outside the plot must
    // still finish the gesture, otherwise the lasso stays stuck in drawing mode.
    d3.select(window).on("mouseup.viewB", () => {
      if (!state.drawing) return;
      state.drawing = false;
      state.lassoPath.attr("d", "").classed("is-active", false);

      // Fewer than three vertices is a click, not a lasso: treat it as "clear".
      if (state.vertices.length < 3) {
        SelectionStore.setLasso(null);
        return;
      }
      const hits = data.filter((d) =>
        insidePolygon(state.x(d.x), state.y(d.y), state.vertices));
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
  function applySelection(snapshot) {
    if (!state.points) return;
    if (snapshot.empty) {
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

  return { init, applySelection };
})();
