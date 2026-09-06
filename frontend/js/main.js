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

/**
 * Show a failure banner, or hide it when everything is working.
 *
 * Asymmetric on purpose. A healthy stack says nothing - the four views ARE the evidence
 * that the backend answered. Only the states where the interface would otherwise look
 * merely empty (backend down, artifacts missing) get a visible line, because "no data"
 * and "no connection" are indistinguishable to the eye and mean very different things.
 */
function setAlert(text, kind) {
  const el = document.getElementById("app-alert");
  if (!el) return;
  if (kind === "ok") {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = kind === "pending" ? "app-alert app-alert--pending" : "app-alert";
}

/** Phase-1 round trip: prove the frontend and backend actually talk to each other. */
async function checkBackend() {
  try {
    const health = await getJSON(API.health);

    const missing = health.datasets.filter((d) => !d.present);
    if (health.data_ready) {
      setAlert("", "ok");
    } else {
      const names = missing.map((d) => d.name).join(", ");
      setAlert(`backend ok, but raw data is missing: ${names}`, "error");
    }

    // The corpus size and AS index used to sit in a page footer. They are report and
    // slide material, not something the analyst reads while working, so they stay on
    // /api/health and in the console - one place, still checkable at the oral exam.
    console.info(`[threat-shape] ${health.n_incidents.toLocaleString("en")} incidents × `
      + `${health.n_raw_analytical_columns} analytical columns · `
      + `AS index ${health.as_index.toLocaleString("en")}`);
    console.info("[threat-shape] backend health:", health);
    return health;
  } catch (error) {
    setAlert(`backend unreachable — ${error.message}. `
      + "Start uvicorn, then reload.", "error");
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
    // View D stays empty on purpose: analytics 6.3 must not run before a selection
    // exists (CLAUDE.md sec.6), so there is nothing to show yet.

    console.info(`[threat-shape] datasets loaded in ${elapsed} ms`, {
      incidents: incidents.length, timeline: timeline.length,
      countries: countries.length, features: features.length,
    });
    return elapsed;
  } catch (error) {
    setAlert(`failed to load data — ${error.message}`, "error");
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
    setAlert("D3 failed to load from CDN — check your connection", "error");
    console.error("[threat-shape] d3 is undefined; the CDN script did not load.");
    return;
  }
  console.info(`[threat-shape] d3 v${d3.version} loaded`);

  const health = await checkBackend();
  if (!health) return;
  if (!health.artifacts_ready) {
    setAlert(`missing artifacts: ${health.missing_artifacts.join(", ")} — `
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
  if (store.incidents) {
    try {
      ViewB.init(store.incidents);
    } catch (error) {
      setPlaceholder("view-b-canvas", `scatter failed: ${error.message}`);
      console.error("[threat-shape] View B failed:", error);
    }
  }
  if (store.timeline) {
    try {
      ViewC.init(store.timeline);
    } catch (error) {
      setPlaceholder("view-c-canvas", `timeline failed: ${error.message}`);
      console.error("[threat-shape] View C failed:", error);
    }
  }

  // View D is initialised into its EMPTY state on purpose. It is the visible proof of
  // the "no default global state" rule: analytics 6.3 has nothing to say until the
  // analyst selects something (CLAUDE.md sec.6).
  ViewD.showEmpty();

  // The store is handed the corpus so it can resolve a selection into incidents, but
  // nothing is wired to it yet: phase 11 makes the views publish and subscribe. It
  // starts empty, and isEmpty() is what every analytic will check before running.
  SelectionStore.setCorpus(store.incidents || []);

  // Phase 11: every view subscribes. Each is now both source and target - the map
  // publishes clicks, the projection publishes lassos, the timeline publishes brushes,
  // and all four redraw from the same snapshot regardless of which one caused it.
  //
  // No view listens to another view directly. That is what keeps the wiring at four
  // subscriptions instead of the twelve a bidirectional mesh would need, and it is why
  // a click cannot echo back and forth into an infinite loop.
  SelectionStore.subscribe((snapshot, origin) => {
    ViewA.applySelection(snapshot, origin);
    ViewB.applySelection(snapshot, origin);
    ViewC.applySelection(snapshot, origin);
    ViewD.applySelection(snapshot, origin);

    // Analytics 6.2 fires on the LASSO only, which is what CLAUDE.md sec.5 specifies
    // for View B. Not on every selection change: a refit costs two to three seconds,
    // and running it on each step of a ctrl-click sequence would make the interface
    // feel broken while telling the analyst nothing new.
    if (origin === "projection" && !snapshot.empty) {
      ViewB.reproject(snapshot).catch((error) =>
        console.error("[threat-shape] re-projection failed:", error));
    }
  });

  console.info(`[selection] store ready · empty=${SelectionStore.isEmpty()} · `
    + `subscribers=${SelectionStore._subscriberCount()}`);
}

document.addEventListener("DOMContentLoaded", bootstrap);
