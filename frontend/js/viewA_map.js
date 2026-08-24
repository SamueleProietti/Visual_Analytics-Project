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
      // Single-hue sequential: the variable has no meaningful zero point or sign, so a
      // divergent scale would invent one (CLAUDE.md sec.2).
      colours: ["#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
      breaks: VOLUME_BREAKS,
      value: (d) => d.incidents,
      format: (v) => String(v),
      legendLabels: ["1", "2–5", "6–20", "21–50", "51–200", "200+"],
    },
    attribution: {
      label: "Attribution",
      legendTitle: "share with no named initiator state",
      colours: ["#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#de2d26"],
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

  function draw() {
    const svg = state.svg;
    svg.selectAll("path.country")
      .attr("fill", (f) => colourFor(state.byNumeric.get(String(+f.id))))
      .classed("is-unreliable", (f) => {
        if (activeLayer() !== "residual") return false;
        const d = state.byNumeric.get(String(+f.id));
        return !!(d && d.residual && !d.residual.reliable);
      })
      .attr("stroke", (f) => (state.selected.has(codeOf(f))
        ? (state.indirect ? "#6a51a3" : "#1a1a1a") : OUTLINE))
      .attr("stroke-width", (f) => (state.selected.has(codeOf(f))
        ? (state.indirect ? 1.0 : 1.6) : 0.3));
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

    legend.append("span").attr("class", "legend-title").text(layer.legendTitle + ":");

    const items = legend.selectAll("span.legend-item")
      .data(layer.colours.map((colour, i) => ({ colour, label: layer.legendLabels[i] })))
      .join("span").attr("class", "legend-item");
    items.append("span").attr("class", "legend-swatch")
      .style("background", (d) => d.colour);
    items.append("span").text((d) => d.label);

    const none = legend.append("span").attr("class", "legend-item");
    none.append("span").attr("class", "legend-swatch").style("background", NO_DATA);
    none.append("span").text("no data");

    if (activeLayer() === "residual" && state.residuals) {
      const flagged = legend.append("span").attr("class", "legend-item");
      flagged.append("span").attr("class", "legend-swatch is-unreliable-swatch");
      flagged.append("span").text(`small sample (expected < ${state.residuals
        ? state.residuals.summary.min_expected : 5})`);
      legend.append("span").attr("class", "legend-note")
        .text(`${state.residuals.summary.reliable} of `
          + `${state.residuals.summary.countries} countries have a reliable residual`);
    }
  }

  function showDetails(datum, residuals) {
    const panel = d3.select("#view-a-details");
    if (!datum) {
      panel.html('<span class="hint">click a country for details</span>');
      return;
    }

    // The country-level residual, then the sector breakdown that says where the
    // deviation comes from. Cells below the expected-frequency threshold are marked,
    // never dropped: sec.6.1 asks for a badge, not for suppression.
    // Three distinct states, and saying which one applies matters: "not computed yet"
    // and "cannot be computed without begging the question" are different answers.
    let residualLine = SelectionStore.isEmpty()
      ? '<span class="pending">residual: select something first</span>'
      : '<span class="pending">geographic residual needs a time or lasso context '
        + '(selecting a country alone would compare it with itself)</span>';
    if (datum.residual) {
      const r = datum.residual;
      const badge = r.reliable ? "" : ' <em class="badge">small sample</em>';
      residualLine = `<span>residual <strong>z = ${r.z > 0 ? "+" : ""}${r.z.toFixed(2)}</strong>`
        + ` (${r.observed} seen vs ${r.expected.toFixed(1)} expected)${badge}</span>`;
    }

    let sectorLine = "";
    if (residuals && residuals.sectors && residuals.sectors.length) {
      const top = residuals.sectors.slice(0, 2).map((s) => {
        const badge = s.reliable ? "" : ' <em class="badge">small n</em>';
        return `${s.sector.split("(")[0].trim().slice(0, 26)} `
          + `${s.z > 0 ? "+" : ""}${s.z.toFixed(1)}${badge}`;
      }).join(" · ");
      sectorLine = `<span class="sectors">by sector: ${top}</span>`;
    }

    // Kept short deliberately - CLAUDE.md sec.5 asks for a summary, not a profile dump.
    panel.html(`
      <strong>${datum.country}</strong>
      <span>${datum.incidents} incidents · top sector: `
      + `${datum.top_sector.split("(")[0].trim()} (${datum.top_sector_count})</span>
      ${residualLine}
      ${sectorLine}
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

    // A lasso or a brush selects incidents, not countries. Highlighting the countries
    // those incidents hit is what makes the map a target as well as a source - the
    // proposal's "each view both source and target".
    const touched = new Set();
    if (!snapshot.empty && !codes.size) {
      for (const incident of snapshot.selected) {
        for (const c of incident.countries || []) touched.add(c);
      }
    }
    state.selected = codes.size ? codes : touched;
    state.indirect = codes.size === 0 && touched.size > 0;
    draw();

    const list = [...codes];
    if (list.length === 1) {
      showDetails(state.byCode.get(list[0]), state.residuals);
    } else if (list.length > 1) {
      d3.select("#view-a-details").html(
        `<strong>${list.length} countries selected</strong>`
        + `<span>${list.join(", ")}</span>`
        + `<span class="pending">contrast A-vs-B: phase 14</span>`);
    } else if (!snapshot.empty) {
      d3.select("#view-a-details").html(
        `<strong>${snapshot.selected.length} incidents selected</strong>`
        + `<span>from ${snapshot.sources.join(" + ")} · touching ${touched.size} countries</span>`
        + `<span class="pending">residual: phase 12</span>`);
    } else {
      showDetails(null);
    }
  }

  async function init(countries) {
    const host = d3.select("#view-a-canvas");
    host.html("");

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

    svg.append("path").attr("class", "sphere")
      .attr("d", state.path({ type: "Sphere" }));

    svg.append("g").selectAll("path.country")
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
