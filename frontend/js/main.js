/* Threat-Shape — application bootstrap.
 *
 * Phase 1 scope: confirm the backend is reachable and report what it knows. The shared
 * selection store (the pub/sub hub that makes the four views bidirectionally
 * coordinated) lands in phase 10; its seam is marked at the bottom of this file.
 */

"use strict";

const API = {
  health: "/api/health",
  incidents: "/api/incidents",
  timeline: "/api/timeline",
  countries: "/api/countries",
  features: "/api/features",
};

/**
 * Everything the four views draw from, fetched once at startup.
 * Views read from here rather than re-fetching: a lasso or a map click must not cost a
 * round trip, and phase 10's selection store will filter this same in-memory copy.
 */
const store = {
  incidents: null,
  timeline: null,
  countries: null,
  features: null,
};

/**
 * Fetch JSON, turning a non-2xx response into a thrown Error.
 * fetch() only rejects on network failure, so an HTTP 500 would otherwise sail through
 * as a successful promise and surface later as a confusing parse error.
 */
async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} on ${url}`);
  }
  return response.json();
}

function setStatus(text, kind) {
  const el = document.getElementById("backend-status");
  el.textContent = text;
  el.className = `status status--${kind}`;
}

/** Phase-1 round trip: prove the frontend and backend actually talk to each other. */
async function checkBackend() {
  try {
    const health = await getJSON(API.health);

    const missing = health.datasets.filter((d) => !d.present);
    if (health.data_ready) {
      setStatus(`backend ok · phase ${health.phase} · all 4 datasets present`, "ok");
    } else {
      const names = missing.map((d) => d.name).join(", ");
      setStatus(`backend ok · missing raw data: ${names}`, "error");
    }

    // toLocaleString gives the thousands separators the report uses (61,452).
    document.getElementById("dataset-summary").textContent =
      `${health.n_incidents.toLocaleString("en")} incidents × ` +
      `${health.n_raw_analytical_columns} analytical columns · ` +
      `AS index ${health.as_index.toLocaleString("en")}`;

    console.info("[threat-shape] backend health:", health);
    return health;
  } catch (error) {
    setStatus(`backend unreachable — ${error.message}`, "error");
    document.getElementById("dataset-summary").textContent =
      "backend unreachable: start uvicorn, then reload";
    console.error("[threat-shape] health check failed:", error);
    return null;
  }
}

/** Load the four static datasets in parallel and report what arrived. */
async function loadData() {
  const started = performance.now();
  try {
    const [incidents, timeline, countries, features] = await Promise.all([
      getJSON(API.incidents),
      getJSON(API.timeline),
      getJSON(API.countries),
      getJSON(API.features),
    ]);
    Object.assign(store, { incidents, timeline, countries, features });
    const elapsed = Math.round(performance.now() - started);

    // Until the real views land in phases 6-9, each placeholder reports what its view
    // will have to work with. It is the visible proof that the API layer is wired up.
    const years = timeline.map((d) => d.year);
    setPlaceholder("view-b-canvas",
      `phase 7 — ${incidents.length.toLocaleString("en")} incidents ready`);
    setPlaceholder("view-c-canvas",
      `phase 8 — ${Math.min(...years)}–${Math.max(...years)} ready`);
    // View D stays empty on purpose: analytics 6.3 must not run before a selection
    // exists (CLAUDE.md sec.6), so there is nothing to show yet.

    console.info(`[threat-shape] datasets loaded in ${elapsed} ms`, {
      incidents: incidents.length, timeline: timeline.length,
      countries: countries.length, features: features.length,
    });
    return elapsed;
  } catch (error) {
    setStatus(`failed to load data — ${error.message}`, "error");
    console.error("[threat-shape] data load failed:", error);
    return null;
  }
}

function setPlaceholder(id, text) {
  const placeholder = document.querySelector(`#${id} .placeholder`);
  if (placeholder) placeholder.textContent = text;
}

async function bootstrap() {
  if (typeof d3 === "undefined") {
    // The CDN is the only external dependency; failing loudly here beats four views
    // silently rendering nothing later.
    setStatus("D3 failed to load from CDN — check your connection", "error");
    console.error("[threat-shape] d3 is undefined; the CDN script did not load.");
    return;
  }
  console.info(`[threat-shape] d3 v${d3.version} loaded`);

  const health = await checkBackend();
  if (!health) return;
  if (!health.artifacts_ready) {
    setStatus(`missing artifacts: ${health.missing_artifacts.join(", ")} — `
      + `run the scripts in scripts/`, "error");
    return;
  }
  await loadData();

  // View A is the entry view, so it renders as soon as the data is in. Views B, C and D
  // follow in phases 7-9. None of them may compute an analytic yet.
  if (store.countries) {
    try {
      await ViewA.init(store.countries);
    } catch (error) {
      setPlaceholder("view-a-canvas", `map failed: ${error.message}`);
      console.error("[threat-shape] View A failed:", error);
    }
  }

  // --- phase 10 seam -------------------------------------------------------------
  // The shared selection store goes here. Until it exists, no view holds selection
  // state of its own: CLAUDE.md sec.6 requires that none of the three analytics run
  // before a selection exists, and the cleanest way to guarantee that is to keep a
  // single source of truth from the start.
}

document.addEventListener("DOMContentLoaded", bootstrap);
