/* View B — t-SNE projection, one point per incident.
 *
 * Draws the 3,414 precomputed positions with the colour and size the proposal
 * specifies. The lasso selects the incidents it encloses, and the view is coordinated
 * with the other four through the shared selection. It computes nothing: both layouts
 * are built offline, and the gesture publishes a selection, nothing more.
 *
 * The axes are deliberately unlabelled and undrawn. t-SNE coordinates carry no units,
 * and inter-cluster distances are not meaningful, so any tick or axis
 * title would assert a metric that does not exist.
 */

"use strict";

const ViewB = (() => {
  // Sequential single-hue. Divergent would be wrong: intensity has no meaningful
  // midpoint or sign.
  //
  // ColorBrewer Greens, not Purples. Purple was doing two jobs at once - it was this
  // ramp AND the colour of a selection (the lasso outline).
  // A point could be dark because it was intense or because it was picked, which is the
  // one distinction this view exists to support. Moving intensity to green leaves purple
  // to mean "chosen by the analyst" and nothing else.
  const COLOURS = ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"];

  const R_MIN = 2.0;
  const R_MAX = 8.0;

  let state = { svg: null, points: null, colour: null, radius: null, maxLog: 1,
                x: null, y: null, lassoPath: null, drawing: false, vertices: [],
                // The last snapshot this view was handed. The mode switch rebuilds the
                // plot and re-applies it from here rather than asking the store to
                // republish: a display control must not write to the store at all.
                snapshot: null,
                // Camera. `layer` is the group the zoom transform is applied to, and
                // `transform` the current one: the lasso needs it to test points where
                // they are drawn rather than where they were laid out.
                layer: null, zoom: null, transform: null };

  // Zoom limits, the same pair of buttons as the map. 1 is the whole projection fitted
  // to the card; 12 is enough to pull apart the densest clusters, where a few hundred
  // incidents sit within a few pixels of each other.
  const ZOOM_LIMITS = [1, 12];
  const ZOOM_STEP = 1.6;

  /* Which global layout is on screen.
   *
   *   "direct" t-SNE straight from the 127 standardised columns, no PCA stage
   *   "pca"    127 columns -> PCA 20 -> t-SNE 2D
   *
   * Both are precomputed and travel in the same payload, so switching costs a redraw
   * and no round trip. Measured against the original 127-column space, at k=20, their
   * trustworthiness is 0.9616 and 0.9163.
   *
   * The view opens on the direct layout because it is the more faithful of the two. The
   * staged one stays one press away, as the thing the direct layout is compared with:
   * scripts/10_compare_layouts.py measures that half the clusters differ between the
   * two, and that the staged layout draws the two groups of insight 1 about twice as far
   * apart as the direct one does.
   */
  let mode = "direct";

  /** The pair of coordinates the active mode reads.
   *
   * Falls back to the first layout when the payload carries no alternative, which happens
   * against a backend started before those artifacts existed. Without the fallback every
   * point would be positioned at NaN and the view would simply go blank - a silent
   * failure that looks like a bug in the projection rather than a stale server.
   */
  const coords = (p) => {
    if (mode === "direct" && p.x_direct != null) return [p.x_direct, p.y_direct];
    return [p.x, p.y];
  };

  /** Whether the payload actually contains the direct layout. */
  const has = () => corpus.length > 0 && corpus[0].x_direct != null;

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

  /** Legend in one line under the plot, spread across the view - the same form as
   * View C's key.
   *
   * It floated inside the plot before, first in a corner and then in the title row,
   * and wherever it floated it either covered points or forced the plot to shrink
   * around it. Below the plot it costs one line of height and covers nothing.
   */
  function renderLegend() {
    const legend = d3.select("#view-b-legend");
    legend.selectAll("*").remove();

    // Colour: seven intensity classes as a stepped ramp, labelled under each block,
    // because the classes are integers rather than intervals.
    const colourGroup = legend.append("span").attr("class", "legend-item");
    colourGroup.append("span").attr("class", "legend-title legend-title--inline")
      .text("weighted intensity");
    const BLOCK = 14;
    const ramp = colourGroup.append("svg").attr("class", "ramp")
      .attr("width", BLOCK * COLOURS.length).attr("height", 18);
    ramp.selectAll("rect").data(COLOURS).join("rect")
      .attr("x", (d, i) => i * BLOCK).attr("width", BLOCK).attr("height", 8)
      .attr("fill", (d) => d);
    ramp.selectAll("text").data(COLOURS).join("text")
      .attr("x", (d, i) => i * BLOCK + BLOCK / 2).attr("y", 17)
      .attr("text-anchor", "middle")
      .text((d, i) => (i === COLOURS.length - 1 ? i + "+" : i));

    // Size: three reference circles drawn at the plot's own scale, so the reader
    // compares against the marks rather than guesses.
    const sizeGroup = legend.append("span").attr("class", "legend-item");
    sizeGroup.append("span").attr("class", "legend-title legend-title--inline")
      .text("affected entities");
    const sizes = [0, 10, 1000];
    const svg = sizeGroup.append("svg").attr("class", "ramp").attr("height", 2 * R_MAX + 2);
    let x = R_MIN + 1;
    let right = 0;
    for (const value of sizes) {
      const r = radiusFor(value);
      svg.append("circle").attr("cx", x).attr("cy", R_MAX + 1).attr("r", r)
        .attr("fill", "none").attr("stroke", "#6a6a6a");
      const label = svg.append("text").attr("x", x + r + 3).attr("y", R_MAX + 4)
        .text(value.toLocaleString("en"));
      right = x + r + 3 + (label.node().getComputedTextLength()
        || String(value).length * 5.5);
      x = right + 6 + R_MAX;
    }
    svg.attr("width", Math.ceil(right) + 2);
  }

  /**
   * Map an embedding onto the canvas, filling it.
   *
   * t-SNE preserves NEIGHBOURHOODS, not global geometry: its axes carry no units, and
   * which point is next to which is the only thing a reader may take from it. That
   * survives any monotone per-axis rescaling, so the plot is allowed to stretch one axis
   * more than the other to use the card. A perfectly isotropic fit left a quarter of a
   * wide card as blank margin either side of a roughly round cloud.
   *
   * The stretch is capped, not free: past about 2x a round cluster starts to read as
   * an elongated one, which would suggest an ordering along the long axis that t-SNE
   * never produced. Below the cap the plot fills the card; above it the rest is
   * margin, centred. orient() below first rotates the cloud - which distorts nothing -
   * so that the cap is reached as rarely as possible.
   *
   */
  const MAX_STRETCH = 2.0;
  const PAD = R_MAX + 2;

  /** The two axis factors fitScales() would use, and the canvas area they fill. */
  function fitFactors(spanX, spanY, width, height) {
    let kx = (width - 2 * PAD) / (spanX || 1);
    let ky = (height - 2 * PAD) / (spanY || 1);
    if (kx > ky * MAX_STRETCH) kx = ky * MAX_STRETCH;
    if (ky > kx * MAX_STRETCH) ky = kx * MAX_STRETCH;
    return { kx, ky, filled: kx * spanX * ky * spanY };
  }

  /**
   * Rotate an embedding so it fills the canvas best, and store the result as u, v.
   *
   * A t-SNE layout has no preferred orientation: the cost it minimises depends only on
   * distances between points, so any rotation of it is an equally valid answer (the
   * optimiser's random start is what picked the one we got). Rotating it costs nothing
   * in faithfulness and lets its longest extent lie along the card's longest side. The
   * angle is searched in 5-degree steps and the one that fills the most canvas area,
   * under the same stretch cap, wins.
   */
  function orient(points, width, height, get = (p) => [p.x, p.y]) {
    const cx = d3.mean(points, (p) => get(p)[0]);
    const cy = d3.mean(points, (p) => get(p)[1]);
    let best = { angle: 0, filled: -1 };
    for (let deg = 0; deg < 180; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
      for (const p of points) {
        const [px, py] = get(p);
        const u = (px - cx) * cos - (py - cy) * sin;
        const v = (px - cx) * sin + (py - cy) * cos;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      const { filled } = fitFactors(u1 - u0, v1 - v0, width, height);
      if (filled > best.filled) best = { angle: a, filled };
    }
    const cos = Math.cos(best.angle);
    const sin = Math.sin(best.angle);
    for (const p of points) {
      const [px, py] = get(p);
      p.u = (px - cx) * cos - (py - cy) * sin;
      p.v = (px - cx) * sin + (py - cy) * cos;
    }
    return points;
  }

  function fitScales(xs, ys, width, height) {
    const [x0, x1] = d3.extent(xs);
    const [y0, y1] = d3.extent(ys);
    const spanX = (x1 - x0) || 1;
    const spanY = (y1 - y0) || 1;
    const { kx, ky } = fitFactors(spanX, spanY, width, height);

    const left = (width - kx * spanX) / 2;
    const top = (height - ky * spanY) / 2;

    return {
      x: d3.scaleLinear().domain([x0, x1]).range([left, left + kx * spanX]),
      // Inverted range: SVG y grows downward, the embedding's does not.
      y: d3.scaleLinear().domain([y0, y1]).range([top + ky * spanY, top]),
    };
  }

  // Kept so the mode switch can rebuild the plot without asking main.js for the data
  // again. Set once, in init().
  let corpus = [];

  /** Two-state display switch, the same form as View A's layer toggle.
   *
   * It swaps which precomputed layout is drawn. It starts no computation, writes nothing
   * to the selection store, and needs no round trip, because both embeddings arrive in
   * the same payload.
   */
  function buildModeToggle() {
    const host = d3.select("#view-b-toggle");
    host.selectAll("*").remove();
    const stale = "this payload has no such layout - restart the backend";
    host.selectAll("button")
      // The reference layout comes first: it is the state the view opens in.
      .data([["direct", "t-SNE only", "t-SNE fitted on all 127 standardised columns, no "
              + "PCA stage. Trustworthiness 0.962"],
             ["pca", "PCA + t-SNE", "127 columns reduced to 20 principal components, "
              + "then t-SNE. Trustworthiness 0.916"]])
      .join("button")
      .attr("type", "button")
      .attr("class", (d) => "toggle-button" + (d[0] === mode ? " is-active" : ""))
      // Disabled rather than hidden when the payload has no such layout: a button that
      // vanishes looks like a bug in the interface, one that refuses and says why points
      // at the stale backend that actually caused it.
      .property("disabled", (d) => d[0] !== "pca" && !has())
      .attr("title", (d) => (d[0] === "pca" || has() ? d[2] : stale))
      .text((d) => d[1])
      .on("click", (event, d) => setMode(d[0]));
  }

  /** Redraw in the other space.
   *
   * The selection survives: the points are the same incidents, drawn from the other
   * embedding. Only their positions change, so a lasso drawn afterwards encloses what it
   * looks like it encloses.
   */
  const LAYOUT_NAME = {
    pca: "PCA 20 then t-SNE",
    direct: "t-SNE on 127 columns",
  };

  function setMode(next) {
    if (next === mode || !corpus.length) return;
    if (next !== "pca" && !has()) {
      console.warn(`[view B] the payload has no ${LAYOUT_NAME[next]} layout. Restart the `
        + "backend so /api/incidents serves it, then reload.");
      return;
    }
    mode = next;
    init(corpus);
    if (state.snapshot) applySelection(state.snapshot, "mode");
    console.info(`[view B] layout: ${LAYOUT_NAME[mode]}`);
  }

  function init(incidents) {
    const host = d3.select("#view-b-canvas");
    host.html("");
    corpus = incidents;
    // Against a backend that predates the alternative layouts, fall back to the one
    // every payload carries, so the active button and the picture cannot disagree.
    if (mode !== "pca" && !has()) mode = "pca";
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;

    state.maxLog = Math.max(...incidents.map(
      (d) => Math.log1p(Math.max(0, d.affected_entities_value ?? 0))));

    // u, v: the active layout, placed on this canvas. It is rotated first, which costs
    // nothing because the orientation of a t-SNE layout is arbitrary, and then stretched
    // up to 2x to use the card.
    orient(incidents, width, height, coords);
    const { x, y } = fitScales(incidents.map((d) => d.u), incidents.map((d) => d.v),
      width, height);

    const svg = host.append("svg")
      .attr("width", width).attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "t-SNE projection of 3,414 cyber incidents");
    state.svg = svg;

    state.layer = svg.append("g").attr("class", "points-layer");
    state.transform = d3.zoomIdentity;

    // Draw the largest marks first so small points are not hidden underneath them.
    const ordered = [...incidents].sort(
      (a, b) => (b.affected_entities_value ?? 0) - (a.affected_entities_value ?? 0));

    state.points = state.layer.selectAll("circle")
      .data(ordered).join("circle")
      .attr("class", "point")
      .attr("cx", (d) => x(d.u))
      .attr("cy", (d) => y(d.v))
      .attr("r", (d) => radiusFor(d.affected_entities_value))
      .attr("fill", (d) => colourFor(d.weighted_intensity))
      .attr("fill-opacity", 0.78)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.35);

    // Details on demand: what the incident was, then when, what kind, how severe and
    // how wide. The type is what a cluster is usually made of, so it is the fact an
    // analyst reads a neighbourhood by.
    Tooltip.attach(state.points, "view-b", (d) => {
      const types = (d.types || []).length ? d.types.join(", ") : "type not available";
      return `<strong>${Tooltip.esc((d.name || "").trim())}</strong>`
        + `<span>${d.year ?? "no date"} · ${Tooltip.esc(types)} · `
        + `intensity ${d.weighted_intensity ?? "?"} · `
        + `${(d.affected_entities_value ?? 0).toLocaleString("en")} affected entities</span>`;
    });

    // The "no units" caveat is not painted over the plot. It still has to be said - it
    // is what stops the plane being read as a map - so it is the view title's tooltip in
    // index.html, beside the other instructions. Same statement, off the data.

    state.x = x;
    state.y = y;
    attachLasso(svg, ordered, width, height);
    attachZoom(svg, host, width, height);

    renderLegend();
    buildModeToggle();
    console.info(`[view B] ${incidents.length} points drawn (${mode})`);
    return incidents.length;
  }

  /* Free lasso — one of the three permitted analytic triggers (no
   * menu, dropdown or radio button may start a computation). Drag to trace a shape,
   * release to select what falls inside; a click without a drag clears. */
  function attachLasso(svg, data, width, height) {
    state.lassoPath = svg.append("path").attr("class", "lasso").attr("d", "");

    const point = (event) => {
      const rect = svg.node().getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    svg.on("mousedown.lasso", (event) => {
      // Shift-drag belongs to the camera (see attachZoom). A plain drag is the lasso.
      if (event.shiftKey) return;
      event.preventDefault();
      Tooltip.hide("view-b");
      state.drawing = true;
      state.vertices = [point(event)];
      state.lassoPath.attr("d", "").classed("is-active", true);
    });

    svg.on("mousemove.lasso", (event) => {
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
        // Only a lasso can be cleared from here. With none active the click publishes
        // nothing at all: a notification that changes no state still wakes every
        // subscriber, and that is how a click once refitted a country selection.
        if (SelectionStore.getState().lasso) SelectionStore.setLasso(null);
        return;
      }

      // Tested where each point is drawn, which is what the analyst enclosed. The lasso
      // is traced in screen coordinates and the points may be under a zoom, so each one
      // is carried through the current transform first: at 4x, the stored position of a
      // point and the place it appears on screen are far apart.
      const nodes = state.points.nodes();
      const hits = [];
      const camera = state.transform || d3.zoomIdentity;
      for (const node of nodes) {
        const [sx, sy] = camera.apply([+node.getAttribute("cx"), +node.getAttribute("cy")]);
        if (insidePolygon(sx, sy, state.vertices)) {
          hits.push(d3.select(node).datum());
        }
      }
      SelectionStore.setLasso(new Set(hits.map((d) => d.incident_id)));
      console.info(`[view B] lasso selected ${hits.length} incidents`);
    });
  }

  /* ---------------------------------------------------------------- zoom control
   *
   * A DISPLAY control, like the map's: it moves the camera and touches nothing else, so
   * no analytic can start from it. Two buttons to zoom, shift-drag to pan. The plain
   * drag stays the lasso, which is the gesture this view exists for; the wheel is left
   * to the page, as on the map.
   *
   * The zoom is semantic. The group is scaled, but each mark is given its radius divided
   * by the scale, so the points keep their size on screen while the gaps between them
   * open up. Scaling the marks with everything else would magnify the overlap along with
   * the distances, which is the opposite of what zooming into a dense cluster is for.
   */
  function attachZoom(svg, host, width, height) {
    state.zoom = d3.zoom()
      .scaleExtent(ZOOM_LIMITS)
      .translateExtent([[0, 0], [width, height]])
      .filter((event) => event.type !== "wheel" && event.type !== "dblclick"
        && event.shiftKey)
      .on("zoom", (event) => {
        const t = event.transform;
        state.transform = t;
        state.layer.attr("transform", t);
        state.points.attr("r", (d) => radiusFor(d.affected_entities_value) / t.k);
        updateZoomButtons();
      });
    svg.call(state.zoom);

    const box = host.append("div").attr("class", "map-zoom").attr("id", "view-b-zoom");
    box.selectAll("button").data(["in", "out"]).join("button")
      .attr("type", "button")
      .attr("class", "zoom-button")
      .attr("aria-label", (d) => (d === "in" ? "zoom in" : "zoom out"))
      .attr("title", (d) => (d === "in"
        ? "zoom in · shift-drag to move around"
        : "zoom out"))
      .text((d) => (d === "in" ? "+" : "−"))
      .on("click", (event, d) => zoomBy(d));
    updateZoomButtons();
  }

  function updateZoomButtons() {
    const k = state.transform ? state.transform.k : 1;
    d3.select("#view-b-zoom").selectAll("button")
      .property("disabled", (d) => (d === "in"
        ? k >= ZOOM_LIMITS[1] - 1e-6 : k <= ZOOM_LIMITS[0] + 1e-6));
  }

  function zoomBy(direction) {
    if (!state.svg || !state.zoom) return;
    const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
    const k = state.transform ? state.transform.k : 1;
    // Back at 1 the pan is reset too, so zooming all the way out returns the view the
    // analyst started from, as on the map.
    if (k * factor <= ZOOM_LIMITS[0] + 1e-6) {
      state.zoom.transform(state.svg, d3.zoomIdentity);
      return;
    }
    state.zoom.scaleBy(state.svg, factor);
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
    state.snapshot = snapshot;

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
