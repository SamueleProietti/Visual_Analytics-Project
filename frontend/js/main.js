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

/**
 * Phase 15 — the runtime half of the interaction contract check.
 *
 * scripts/05_verify_triggers.py proves statically that only three things can start an
 * analytic and that the API has no parameterless form. This proves the other half: that
 * on screen, nothing analytic exists until one of those three happens, and that clearing
 * removes it again. Run it from the console:
 *
 *     await verifyTriggers()
 *
 * Written as a callable rather than an automatic startup check on purpose - a test that
 * ran on load would itself be a computation happening before a selection exists.
 */
async function verifyTriggers() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (label, ok, detail = "") => {
    results.push(ok);
    console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? "  - " + detail : ""}`);
    return ok;
  };

  const analyticOutput = () => ({
    contrastBars: document.querySelectorAll("#view-d-canvas rect.bar").length,
    residualHatching: document.querySelectorAll("path.country.is-unreliable").length,
    localBanner: document.querySelectorAll(".local-banner").length,
    header: document.getElementById("view-d-header").textContent,
    toggleFirst: document.querySelector(".toggle-button")?.textContent,
  });

  console.log("%c--- interaction contract, runtime ---", "font-weight:bold");

  SelectionStore.clear();
  await wait(500);
  let state = analyticOutput();
  check("no contrast bars before any interaction", state.contrastBars === 0);
  check("no residual hatching before any interaction", state.residualHatching === 0);
  check("no local re-projection banner before any interaction", state.localBanner === 0);
  check("View D header says 'no selection'", state.header === "no selection", state.header);
  check("map toggle offers volume, not residual",
    state.toggleFirst === "Incident volume", state.toggleFirst);

  // The two-state toggle is a DISPLAY switch: pressing it must not compute anything.
  const before = analyticOutput().contrastBars;
  document.querySelectorAll(".toggle-button").forEach((b) => b.click());
  await wait(600);
  check("pressing the layer toggle starts no analytic",
    analyticOutput().contrastBars === before);
  document.querySelector(".toggle-button").click();

  // Trigger 1 - map click.
  const country = [...document.querySelectorAll("path.country")]
    .find((p) => (p.querySelector("title") || {}).textContent?.startsWith("United States"));
  country.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(2000);
  state = analyticOutput();
  check("map click produces a contrast", state.contrastBars > 0,
    `${state.contrastBars} bars`);
  check("map click names the comparison", state.header.includes("vs"), state.header);

  // Trigger 2 - timeline brush.
  SelectionStore.setYearRange([2022, 2024]);
  await wait(2000);
  check("brush produces a residual layer",
    analyticOutput().toggleFirst === "Residual", analyticOutput().toggleFirst);

  // Clearing must remove every analytic result, not leave a stale one on screen.
  SelectionStore.clear();
  await wait(900);
  state = analyticOutput();
  check("clearing removes the contrast", state.contrastBars === 0);
  check("clearing removes the residual", state.residualHatching === 0);
  check("clearing restores the volume toggle", state.toggleFirst === "Incident volume");
  check("clearing restores the empty header", state.header === "no selection");

  const passed = results.filter(Boolean).length;
  console.log(`%c${passed}/${results.length} runtime checks passed`,
    `font-weight:bold;color:${passed === results.length ? "green" : "red"}`);
  return { passed, total: results.length };
}

document.addEventListener("DOMContentLoaded", bootstrap);
