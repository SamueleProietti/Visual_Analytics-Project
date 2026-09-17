/* View A — world choropleth, the entry view.
 *
 * Phase 6 scope: draw the map from real data, the two-state layer toggle, and the
 * details-on-demand panel. The map is not yet coordinated with the other views - that
 * is phase 11 - and it shows no residual, because analytics 6.1 may not run before a
 * selection exists (CLAUDE.md sec.6).
 *
 * Geometry is fetched from a CDN, matching the no-build-step frontend the proposal
 * describes. The join runs on ISO codes rather than names: our data carries alpha-2
 * from EuRepoC, world-atlas keys on numeric-3, and i18n-iso-countries bridges the two.
 * Matching on country names would have had to guess at "W. Sahara" and
 * "Korea, Republic of".
 */

"use strict";

const ViewA = (() => {
  // 50m rather than 110m: measured against our own data, 110m resolves 142/168
  // countries (97.1% of incidents) and drops Hong Kong, Singapore, Bahrain and Malta
  // entirely, while 50m resolves 162/168 (99.4%) for 739 KB fetched once.
  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
  const ISO_URL = "https://cdn.jsdelivr.net/npm/i18n-iso-countries@7/codes.json";
  const TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js";

  // Class breaks, not a continuous scale. Incident counts run 1 to 871 with most
  // countries in single digits, so a linear ramp would paint the whole world one shade
  // and the United States another. Fixed magnitude classes stay readable and, unlike
  // quantiles, do not shift meaning when the selection changes in later phases.
  const VOLUME_BREAKS = [2, 6, 21, 51, 201];
  const RATE_BREAKS = [0.2, 0.4, 0.6, 0.8];

  const NO_DATA = "#eeeeee";
  const OUTLINE = "#b0b0b0";

  // Zoom limits. The lower bound is 1 - "the whole world, fitted" - because below it the
  // map would shrink inside its own frame for no analytical gain; there is nothing
  // outside the sphere to reveal. The upper bound is 8, which resolves the small island
  // states EuRepoC records (Malta, Bahrain, Singapore) without letting a country fill
  // the frame: a choropleth compares places, and one country alone compares nothing.
  const ZOOM_LIMITS = [1, 8];
  const ZOOM_STEP = 1.6;      // ~4 clicks from end to end, few enough to stay orienting

  const LAYERS = {
    residual: {
      label: "Residual",
      legendTitle: "standardized deviation z",
      // Divergent, and legitimately so: zero means "exactly as expected" and the sign
      // says over- or under-represented. ColorBrewer RdBu, the same opponent pair
      // View D uses, so red means "more than expected" in both views.
      colours: ["#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b"],
      breaks: [-3, -2, -1, 1, 2, 3],
      value: (d) => (d.residual == null ? null : d.residual.z),
      legendLabels: ["≤ -3", "-3..-2", "-2..-1", "-1..1", "1..2", "2..3", "≥ 3"],
    },
    volume: {
      label: "Incident volume",
      legendTitle: "incidents recorded",
      // Sequential: the variable has no meaningful zero point or sign, so a divergent
      // scale would invent one (CLAUDE.md sec.2).
      //
      // ColorBrewer BuPu, not Blues. Blues put this layer's dark end on the same hue as
      // the residual layer's "below expected" - and these three layers paint THE SAME
      // PIXELS, swapped by the toggle, so two of them looking alike means the analyst
      // cannot tell which question the map is answering. A legend does not fix that,
      // because the colour is read before the legend.
      colours: ["#edf8fb", "#bfd3e6", "#9ebcda", "#8c96c6", "#8856a7", "#810f7c"],
      breaks: VOLUME_BREAKS,
      value: (d) => d.incidents,
      format: (v) => String(v),
      legendLabels: ["1", "2–5", "6–20", "21–50", "51–200", "200+"],
    },
    attribution: {
      label: "Attribution",
      legendTitle: "share with no named initiator state",
      // ColorBrewer YlOrBr, not Reds. Reds was the worst collision in the tool: measured
      // under tritanopia its dark end (#a50f15) sat at deltaE 5.0 from the residual
      // layer's "above expected" (#b2182b) - the same dark red carrying two different
      // meanings on the same pixels. See docs/roadmap.md, palette study.
      colours: ["#ffffd4", "#fed98e", "#fe9929", "#d95f0e", "#993404"],
      breaks: RATE_BREAKS,
      value: (d) => d.not_attributed_rate,
      format: (v) => (v * 100).toFixed(0) + "%",
      legendLabels: ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"],
    },
  };

  let state = {
    layer: "volume",
    selected: new Set(),   // ISO alpha-2 codes; phase 11 will lift this to the shared store
    byCode: new Map(),
    byNumeric: new Map(),
    countries: null,
    residuals: null,
    svg: null,
    path: null,
    mapLayer: null,        // the <g> the zoom transform is applied to
    zoom: null,
    scale: 1,              // current zoom factor, mirrored so the buttons can disable
    panStart: null,        // transform at the start of a drag, to tell a pan from a click
    panned: false,
  };

  /** Load the topojson-client helper, which D3 does not bundle. */
  function loadTopojson() {
    if (window.topojson) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TOPOJSON_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error("topojson-client failed to load from CDN"));
      document.head.appendChild(script);
    });
  }

  function colourFor(datum) {
    if (!datum) return NO_DATA;
    const layer = LAYERS[activeLayer()];
    const value = layer.value(datum);
    if (value == null) return NO_DATA;
    let index = 0;
    while (index < layer.breaks.length && value >= layer.breaks[index]) index += 1;
    return layer.colours[index];
  }

  function activeLayer() {
    // The residual layer only exists while a selection does. Without one there is
    // nothing to deviate from, so the toggle falls back to plain volume - which is the
    // "no default global state" rule made visible in the control itself.
    if (state.layer === "residual"
        && !(state.residuals && state.residuals.geographic !== false)) return "volume";
    return state.layer;
  }

  /* The border carries TWO independent facts, on two channels that do not fight:
   *
   *   colour     was this country chosen by the analyst?   grey = no, black = yes
   *   dash       is its residual trustworthy?              solid = yes, dashed = no
   *
   * They used to be one channel. The CSS rule for an unreliable country set the stroke
   * colour too, and a CSS declaration outranks the presentation attribute set here, so
   * "unreliable" silently erased "selected" - on a residual map, where 104 of 168
   * countries are typically unreliable, that hid most of the selection.
   *
   * The third state this used to have, a purple border for countries merely TOUCHED by
   * a lasso or a brush, is gone. Measured, it marked 66% of the world on a tight lasso
   * and 91% on a time brush: a mark that applies to nearly everything separates nothing.
   * View A already answers a lasso by repainting all 168 countries onto the residual
   * scale, which is a far louder statement that the view is a target as well as a
   * source, and the popup still reports how many countries the selection touches.
   */
  function draw() {
    const svg = state.svg;
    const unreliable = (f) => {
      if (activeLayer() !== "residual") return false;
      const d = state.byNumeric.get(String(+f.id));
      return !!(d && d.residual && !d.residual.reliable);
    };

    svg.selectAll("path.country")
      .attr("fill", (f) => colourFor(state.byNumeric.get(String(+f.id))))
      .classed("is-unreliable", unreliable)
      .attr("stroke", (f) => (state.selected.has(codeOf(f)) ? "#1a1a1a" : OUTLINE))
      // Widths live here rather than in the CSS so one function decides the whole
      // border. A dashed hairline at 0.3px reads as a smudge, so an unreliable country
      // gets enough weight for the dashes to be legible as dashes.
      .attr("stroke-width", (f) => (state.selected.has(codeOf(f)) ? 1.6
        : (unreliable(f) ? 0.9 : 0.3)));
    renderLegend();
  }

  function codeOf(feature) {
    const datum = state.byNumeric.get(String(+feature.id));
    return datum ? datum.code : null;
  }

  function renderLegend() {
    const layer = LAYERS[activeLayer()];
    const legend = d3.select("#view-a-legend");
    legend.selectAll("*").remove();

    // On the residual layer the reliability count rides on the title line. It used to
    // be a third line of its own, and the legend has a fixed two-line height now - a
    // third line would be clipped, or would have to steal height from the map.
    const title = legend.append("span").attr("class", "legend-title").text(layer.legendTitle);
    if (activeLayer() === "residual" && state.residuals && state.residuals.summary) {
      title.append("span").attr("class", "legend-note")
        .text(` · ${state.residuals.summary.reliable} of `
          + `${state.residuals.summary.countries} countries have a reliable residual`);
    }

    // The classes go in their own row under the title. Inline, the title took enough of
    // the width that the attribution layer's last class dropped onto a second line by
    // itself - and a class sitting alone below the others reads as a separate thing,
    // not as the top of one ordered scale.
    const row = legend.append("div").attr("class", "legend-row");

    const items = row.selectAll("span.legend-item")
      .data(layer.colours.map((colour, i) => ({ colour, label: layer.legendLabels[i] })))
      .join("span").attr("class", "legend-item");
    items.append("span").attr("class", "legend-swatch")
      .style("background", (d) => d.colour);
    items.append("span").text((d) => d.label);

    const none = row.append("span").attr("class", "legend-item");
    none.append("span").attr("class", "legend-swatch").style("background", NO_DATA);
    none.append("span").text("no data");

    if (activeLayer() === "residual" && state.residuals) {
      const flagged = row.append("span").attr("class", "legend-item");
      flagged.append("span").attr("class", "legend-swatch is-unreliable-swatch");
      flagged.append("span").text(`small sample (exp. < ${state.residuals
        ? state.residuals.summary.min_expected : 5})`);
    }
  }

  /* ---------------------------------------------------------------- zoom control
   *
   * A DISPLAY control, not an analytic trigger. Zooming changes which part of the map
   * you are looking at and nothing else: it does not touch the selection store, so no
   * residual, re-projection or contrast can be started by pressing it. That is what
   * keeps it compatible with CLAUDE.md sec.2 - the forbidden thing is a control that
   * STARTS an analysis, not a control that moves the camera.
   */
  function updateZoomButtons() {
    d3.select("#view-a-zoom").selectAll("button")
      .property("disabled", (d) => (d === "in"
        ? state.scale >= ZOOM_LIMITS[1] - 1e-6
        : state.scale <= ZOOM_LIMITS[0] + 1e-6));
  }

  function zoomBy(direction) {
    if (!state.svg || !state.zoom) return;
    const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
    const target = state.scale * factor;

    // Applied immediately, NOT through a d3 transition. An animated zoom is driven by
    // requestAnimationFrame, which browsers freeze in a hidden or backgrounded tab - so
    // the button's effect would depend on something outside the button. A stepped
    // control should land where it says it lands, every time it is pressed.
    //
    // Landing back at 1 resets the pan as well. Scaling alone would leave the world
    // pinned against whichever edge it was dragged to, so "zoom all the way out" would
    // not give back the view the analyst started from.
    if (target <= ZOOM_LIMITS[0] + 1e-6) {
      state.zoom.transform(state.svg, d3.zoomIdentity);
      return;
    }
    state.zoom.scaleBy(state.svg, factor);
  }

  function buildZoom() {
    const host = d3.select("#view-a-zoom");
    host.selectAll("*").remove();
    host.selectAll("button").data(["in", "out"]).join("button")
      .attr("type", "button")
      .attr("class", "zoom-button")
      .attr("aria-label", (d) => (d === "in" ? "zoom in" : "zoom out"))
      .attr("title", (d) => (d === "in" ? "zoom in" : "zoom out"))
      .text((d) => (d === "in" ? "+" : "−"))
      .on("click", (event, d) => zoomBy(d));
    updateZoomButtons();
  }

  function attachZoom(svg, width, height) {
    state.zoom = d3.zoom()
      .scaleExtent(ZOOM_LIMITS)
      // Panning is bounded by the canvas, so the world cannot be dragged off screen and
      // leave the analyst looking at an empty rectangle with no way back.
      .translateExtent([[0, 0], [width, height]])
      .filter((event) => {
        // Wheel is deliberately NOT a zoom gesture. The page itself scrolls, and a wheel
        // that silently zooms the map instead of scrolling past it makes the page feel
        // broken - the classic embedded-map complaint. Zoom is the two buttons; drag
        // still pans once you are in. ctrl is left alone because ctrl-click is the
        // multi-country selection gesture.
        return event.type !== "wheel" && event.type !== "dblclick" && !event.ctrlKey;
      })
      .on("zoom", (event) => {
        state.mapLayer.attr("transform", event.transform);
        state.scale = event.transform.k;
        updateZoomButtons();
      })
      // A drag that pans the map ends with a click event, and that click must not be
      // read as "the analyst clicked the sea".
      //
      // The test is whether the POINTER moved, not whether the transform changed. Those
      // differ exactly where it matters: at scale 1, and at the edge of the pan bounds,
      // the transform is pinned, so a real drag leaves it untouched - and the analyst
      // who dragged expecting to pan would have lost their selection instead. 4px is
      // above the jitter of a firm click and well below an intentional drag.
      //
      // sourceEvent is null for the button-driven transforms, so those never arm the
      // flag and cannot swallow a later real click.
      .on("start", (event) => {
        const source = event.sourceEvent;
        state.panStart = source ? [source.clientX, source.clientY] : null;
      })
      .on("end", (event) => {
        const source = event.sourceEvent;
        state.panned = !!(source && state.panStart
          && Math.hypot(source.clientX - state.panStart[0],
                        source.clientY - state.panStart[1]) > 4);
      });
    svg.call(state.zoom);

    /* Clicking empty space clears the country selection.
     *
     * Without this, the only way out of a three-country selection was to click a fourth
     * country (which replaces the set) and then click it again to drop it - two clicks
     * that both assert something the analyst did not mean. Clicking nothing is the
     * natural way to say "nothing", and View B already answers a click on empty space
     * the same way, so the gesture means one thing across the tool.
     *
     * setCountries([]) rather than clear(): the map owns the country filter and nothing
     * else. A time brush belongs to View C, and wiping it from here would undo a
     * decision taken in another view.
     */
    svg.on("click", (event) => {
      const target = event.target;
      if (target.classList && target.classList.contains("country")) return;
      if (state.panned) { state.panned = false; return; }
      if (SelectionStore.getState().countries.length) SelectionStore.setCountries([]);
    });
  }

  /** Write the popup, or hide it.
   *
   * Hidden rather than showing "click a country for details": as a panel below the map
   * that prompt filled a box that was there anyway, but as a popup it would sit over the
   * geometry permanently, covering countries to say nothing. The invitation lives in the
   * view's subtitle instead, where it costs no map.
   */
  function setPopup(html) {
    const panel = d3.select("#view-a-details");
    panel.property("hidden", !html);
    panel.html(html || "");
  }

  function showDetails(datum, residuals) {
    if (!datum) return setPopup(null);

    // The country-level residual, when there is a non-circular context to compute it in.
    //
    // When there is not - a country picked on its own - the line is simply absent. It
    // used to carry an explanation of why the number was missing, which spent three
    // lines of a popup that floats over the map to describe something the analyst had
    // not asked for. The sector breakdown below IS the analysis in that state, and it
    // names its own comparison, so nothing is silently missing.
    let residualLine = "";
    if (datum.residual) {
      const r = datum.residual;
      const badge = r.reliable ? "" : ' <em class="badge">small sample</em>';
      residualLine = '<span>share of this selection: '
        + `<strong>z ${r.z > 0 ? "+" : ""}${r.z.toFixed(2)}</strong>`
        + ` · ${r.observed} seen vs ${Math.round(r.expected)} expected${badge}</span>`;
    }

    // Sector breakdown, split by DIRECTION rather than listed by |z|.
    //
    // The old line read "by sector: Critical infrastructure +4.1 · Education +3.8" - the
    // two largest deviations by absolute value, with the sign left to be decoded and no
    // statement of what they deviate FROM. Two things went wrong with it. The reader had
    // to know that + means "more than expected", and because the list was ranked on |z|
    // alone it could show two positives and hide an equally strong negative: the United
    // States' Media sector sits at -3.35, just behind Education's +3.76, and never
    // appeared. Splitting the list guarantees both directions are represented when both
    // exist, and the heading says what the comparison is.
    let sectorLines = "";
    if (residuals && residuals.sectors && residuals.sectors.length) {
      const format = (s) => {
        const badge = s.reliable ? "" : ' <em class="badge">small n</em>';
        // Sector names are cut at 24 characters so each direction stays on one line of
        // the popup - "State institutions / political system" would otherwise wrap and
        // push the other direction out of the box.
        const name = s.sector.split("(")[0].trim();
        return `${name.length > 24 ? name.slice(0, 23) + "…" : name} `
          + `<strong>z ${s.z > 0 ? "+" : ""}${s.z.toFixed(1)}</strong>${badge}`;
      };
      const over = residuals.sectors.filter((s) => s.z > 0).slice(0, 2);
      const under = residuals.sectors.filter((s) => s.z < 0).slice(0, 2);
      if (over.length || under.length) {
        sectorLines = '<span class="sectors-head">which sectors are hit, '
          + "against the global sector mix</span>";
        if (over.length) {
          sectorLines += `<span class="sectors">more than expected: `
            + `${over.map(format).join(" · ")}</span>`;
        }
        if (under.length) {
          sectorLines += `<span class="sectors">less than expected: `
            + `${under.map(format).join(" · ")}</span>`;
        }
      }
    }

    // Kept short deliberately - CLAUDE.md sec.5 asks for a summary, not a profile dump.
    // Shorter still now that it floats over the map: every extra line is a line of
    // geometry the analyst cannot see.
    setPopup(`
      <strong>${datum.country}</strong>
      <span>${datum.incidents} incidents · top sector: `
      + `${datum.top_sector.split("(")[0].trim()} (${datum.top_sector_count})</span>
      ${residualLine}
      ${sectorLines}
    `);
  }

  function onCountryClick(event, feature) {
    const code = codeOf(feature);
    if (!code) return;                       // unmapped geometry: nothing to select

    // Phase 11: the map no longer owns the selection. It publishes to the store and
    // then redraws from what comes back, exactly like the views that did not originate
    // the change. One path in, one path out - no local copy to drift out of sync.
    const current = SelectionStore.getState().countries;
    if (event.ctrlKey || event.metaKey) {
      SelectionStore.setCountries([code], { additive: true });
    } else {
      const onlyThis = current.length === 1 && current[0] === code;
      SelectionStore.setCountries(onlyThis ? [] : [code]);
    }
  }

  /** React to the shared selection, whoever produced it.
   *
   * Async because analytics 6.1 runs on the backend. The residual is requested ONLY
   * when a selection exists; on an empty snapshot the previous result is discarded and
   * the map falls back to plain volume, so no stale analytic can survive a clear.
   */
  async function applySelection(snapshot, origin) {
    if (snapshot.empty) {
      clearResiduals();
    } else {
      try {
        const result = await loadResiduals(snapshot);
        if (result) {
          attachResiduals(result);
          if (state.layer !== "attribution") state.layer = "residual";
        } else {
          // Only countries are selected: there is no non-circular context to compute a
          // geographic residual against, so the map stays on volume and the sector
          // breakdown in the details panel carries the analysis instead.
          clearResiduals();
          const only = [...SelectionStore.getState().countries];
          if (only.length === 1) {
            state.residuals = await loadSectors(snapshot, only[0]);
            state.residuals.geographic = false;   // sectors only; do not paint the map
          }
        }
      } catch (error) {
        clearResiduals();
        console.error("[view A] residuals failed:", error);
      }
    }
    buildToggle();
    renderSelection(snapshot);
  }

  function renderSelection(snapshot) {
    const codes = new Set(SelectionStore.getState().countries);

    // A lasso or a brush selects incidents, not countries, so the countries those
    // incidents hit are still counted - the popup reports the figure. They are no longer
    // outlined: see draw(). The border now means "the analyst picked this", and only a
    // map click can say that.
    const touched = new Set();
    if (!snapshot.empty && !codes.size) {
      for (const incident of snapshot.selected) {
        for (const c of incident.countries || []) touched.add(c);
      }
    }
    state.selected = codes;
    draw();

    const list = [...codes];
    if (list.length === 1) {
      showDetails(state.byCode.get(list[0]), state.residuals);
    } else if (list.length > 1) {
      // No "contrast A-vs-B" line any more: it named a phase rather than a result, and
      // the contrast itself is in View D, which states its own comparison in full.
      // Repeating it here would give the analyst two places to read one answer.
      setPopup(`<strong>${list.length} countries selected</strong>`
        + `<span>${list.join(", ")}</span>`);
    } else if (!snapshot.empty) {
      setPopup(`<strong>${snapshot.selected.length} incidents selected</strong>`
        + `<span>from ${snapshot.sources.join(" + ")} · `
        + `touching ${touched.size} countries</span>`);
    } else {
      showDetails(null);
    }
  }

  async function init(countries) {
    const host = d3.select("#view-a-canvas");
    // Not host.html(""): the zoom control and the details popup are children of this
    // canvas now, and emptying it would delete them along with the placeholder.
    host.selectAll(".placeholder, svg").remove();

    state.byCode = new Map(countries.map((c) => [c.code, c]));

    const [isoCodes, topo] = await Promise.all([
      d3.json(ISO_URL),
      d3.json(GEO_URL),
      loadTopojson(),
    ]);

    // alpha-2 -> numeric-3, stripped of leading zeros so "004" and "4" compare equal.
    const toNumeric = new Map(isoCodes.map((row) => [row[0], String(parseInt(row[2], 10))]));
    state.byNumeric = new Map();
    for (const country of countries) {
      const numeric = toNumeric.get(country.code);
      if (numeric) state.byNumeric.set(numeric, country);
    }

    const features = topojson.feature(topo, topo.objects.countries).features;
    const width = host.node().clientWidth;
    const height = host.node().clientHeight;

    // Equal Earth is an equal-area projection. A choropleth encodes a quantity by
    // filling area, so a projection that inflates high latitudes - Mercator above all -
    // would make Russia and Canada shout regardless of their values.
    const projection = d3.geoEqualEarth().fitSize([width, height - 6], { type: "Sphere" });
    state.path = d3.geoPath(projection);

    const svg = host.append("svg")
      .attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "World choropleth of cyber incidents");
    state.svg = svg;

    // Everything geographic goes in one group, and zooming transforms that group rather
    // than re-projecting. Re-projecting on every zoom step would be the "correct"
    // cartographic answer and the wrong engineering one: it would rebuild 240 path
    // strings per frame to produce a picture indistinguishable from a scale transform
    // at these magnifications.
    const mapLayer = svg.append("g").attr("class", "map-layer");
    state.mapLayer = mapLayer;

    mapLayer.append("path").attr("class", "sphere")
      .attr("d", state.path({ type: "Sphere" }));

    mapLayer.append("g").selectAll("path.country")
      .data(features).join("path")
      .attr("class", "country")
      .attr("d", state.path)
      .on("click", onCountryClick)
      .append("title")
      .text((f) => {
        const datum = state.byNumeric.get(String(+f.id));
        return datum
          ? `${datum.country}: ${datum.incidents} incidents, `
            + `${(datum.not_attributed_rate * 100).toFixed(0)}% unattributed`
          : `${f.properties.name}: no incidents recorded`;
      });

    attachZoom(svg, width, height);
    buildZoom();
    buildToggle();
    draw();
    showDetails(null);

    // Count what actually got painted, not what merely had a numeric code: 166 of our
    // countries resolve to a numeric id but only those present in the 50m geometry can
    // be drawn. Reporting the former would overstate the coverage.
    const drawnIds = new Set(features.map((f) => String(+f.id)));
    const painted = [...state.byNumeric.keys()].filter((n) => drawnIds.has(n)).length;
    const dropped = countries.filter((c) => {
      const n = toNumeric.get(c.code);
      return !n || !drawnIds.has(n);
    });
    console.info(`[view A] ${painted}/${countries.length} countries painted; `
      + `${dropped.length} without geometry `
      + `(${dropped.reduce((s, c) => s + c.incidents, 0)} incidents)`);
    return painted;
  }

  /** Two-state control, not a dropdown: CLAUDE.md sec.2 keeps this a display switch.
   *
   * Exactly two buttons, always. The first one is the analytic slot: it reads "Incident
   * volume" with no selection and "Residual" once one exists, because a residual has
   * nothing to deviate from until the analyst has chosen something. Adding a third
   * button would turn a display switch into the menu the brief forbids.
   */
  function buildToggle() {
    const host = d3.select("#view-a-toggle");
    host.selectAll("*").remove();
    const slots = ["primary", "attribution"];
    host.selectAll("button")
      .data(slots)
      .join("button")
      .attr("class", (slot) => "toggle-button"
        + ((slot === "attribution") === (state.layer === "attribution") ? " is-active" : ""))
      .text((slot) => (slot === "attribution"
        ? LAYERS.attribution.label
        : (state.residuals && state.residuals.geographic !== false
            ? LAYERS.residual.label : LAYERS.volume.label)))
      .on("click", (event, slot) => {
        state.layer = slot === "attribution" ? "attribution"
          : (state.residuals && state.residuals.geographic !== false
              ? "residual" : "volume");
        buildToggle();
        draw();
      });
  }

  /** Fetch analytics 6.1 for the current selection and repaint the map on it.
   *
   * The geographic residual is computed over the selection WITHOUT its country filter.
   * Asking which countries are unusual in a selection defined by picking countries is
   * circular: selecting Italy alone made Italy 100% of the selection against 3%
   * expected, a z of +23 that says nothing. The context comes from the lasso and the
   * brush; the map reports deviation inside that context.
   *
   * The sector breakdown, by contrast, uses the FULL selection - "within the Italian
   * incidents I picked, which sectors deviate?" is a real question, not a circular one.
   */
  async function loadResiduals(snapshot) {
    const country = [...SelectionStore.getState().countries];
    const geographic = country.length
      ? SelectionStore.resolveIgnoring("countries") : snapshot;
    if (geographic.empty || !geographic.ids.size) return null;

    const body = { incident_ids: [...geographic.ids] };
    if (country.length === 1 && snapshot.ids.size) body.country_code = country[0];

    const response = await fetch("/api/residuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status} on /api/residuals`);
    return response.json();
  }

  /** Sector breakdown for the clicked country, over the full selection. */
  async function loadSectors(snapshot, code) {
    const response = await fetch("/api/residuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_ids: [...snapshot.ids], country_code: code }),
    });
    if (!response.ok) throw new Error(`${response.status} on /api/residuals`);
    return response.json();
  }

  function attachResiduals(result) {
    for (const datum of state.byCode.values()) datum.residual = null;
    for (const row of result.countries) {
      const datum = state.byCode.get(row.code);
      if (datum) datum.residual = row;
    }
    state.residuals = result;
  }

  function clearResiduals() {
    for (const datum of state.byCode.values()) datum.residual = null;
    state.residuals = null;
    if (state.layer === "residual") state.layer = "volume";
  }

  return { init, applySelection };
})();
