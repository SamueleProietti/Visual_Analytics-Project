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
    const layer = LAYERS[state.layer];
    const value = layer.value(datum);
    if (value == null) return NO_DATA;
    let index = 0;
    while (index < layer.breaks.length && value >= layer.breaks[index]) index += 1;
    return layer.colours[index];
  }

  function draw() {
    const svg = state.svg;
    svg.selectAll("path.country")
      .attr("fill", (f) => colourFor(state.byNumeric.get(String(+f.id))))
      .attr("stroke", (f) => (state.selected.has(codeOf(f)) ? "#1a1a1a" : OUTLINE))
      .attr("stroke-width", (f) => (state.selected.has(codeOf(f)) ? 1.6 : 0.3));
    renderLegend();
  }

  function codeOf(feature) {
    const datum = state.byNumeric.get(String(+feature.id));
    return datum ? datum.code : null;
  }

  function renderLegend() {
    const layer = LAYERS[state.layer];
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
  }

  function showDetails(datum) {
    const panel = d3.select("#view-a-details");
    if (!datum) {
      panel.html('<span class="hint">click a country for details</span>');
      return;
    }
    // Kept short deliberately - CLAUDE.md sec.5 asks for a summary, not a profile dump.
    panel.html(`
      <strong>${datum.country}</strong>
      <span>${datum.incidents} incidents · ${datum.observations} target records</span>
      <span>top sector: ${datum.top_sector.split("(")[0].trim()} (${datum.top_sector_count})</span>
      <span>no named initiator: ${(datum.not_attributed_rate * 100).toFixed(0)}%</span>
      <span class="pending">residual: needs a selection (phase 12)</span>
    `);
  }

  function onCountryClick(event, feature) {
    const code = codeOf(feature);
    if (!code) return;                       // unmapped geometry: nothing to select
    // ctrl/cmd-click accumulates, plain click replaces - the interaction the proposal
    // specifies for driving a multi-country comparison.
    if (event.ctrlKey || event.metaKey) {
      state.selected.has(code) ? state.selected.delete(code) : state.selected.add(code);
    } else {
      state.selected = state.selected.has(code) && state.selected.size === 1
        ? new Set() : new Set([code]);
    }
    draw();
    const codes = [...state.selected];
    showDetails(codes.length === 1 ? state.byCode.get(codes[0]) : null);
    if (codes.length > 1) {
      d3.select("#view-a-details").html(
        `<strong>${codes.length} countries selected</strong>` +
        `<span>${codes.join(", ")}</span>` +
        `<span class="pending">contrast A-vs-B: phase 14</span>`);
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

  /** Two-state control, not a dropdown: CLAUDE.md sec.2 keeps this a display switch. */
  function buildToggle() {
    const host = d3.select("#view-a-toggle");
    host.selectAll("*").remove();
    host.selectAll("button")
      .data(Object.entries(LAYERS))
      .join("button")
      .attr("class", ([key]) => "toggle-button" + (key === state.layer ? " is-active" : ""))
      .text(([, layer]) => layer.label)
      .on("click", (event, [key]) => {
        state.layer = key;
        host.selectAll("button").attr("class", ([k]) =>
          "toggle-button" + (k === state.layer ? " is-active" : ""));
        draw();
      });
  }

  return { init };
})();
