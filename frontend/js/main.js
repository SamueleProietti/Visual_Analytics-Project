/* Threat-Shape — application bootstrap.
 *
 * Phase 1 scope: confirm the backend is reachable and report what it knows. The shared
 * selection store (the pub/sub hub that makes the four views bidirectionally
 * coordinated) lands in phase 10; its seam is marked at the bottom of this file.
 */

"use strict";

const API = {
  health: "/api/health",
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

function bootstrap() {
  if (typeof d3 === "undefined") {
    // The CDN is the only external dependency; failing loudly here beats four views
    // silently rendering nothing later.
    setStatus("D3 failed to load from CDN — check your connection", "error");
    console.error("[threat-shape] d3 is undefined; the CDN script did not load.");
    return;
  }
  console.info(`[threat-shape] d3 v${d3.version} loaded`);

  checkBackend();

  // --- phase 10 seam -------------------------------------------------------------
  // The shared selection store goes here. Until it exists, no view holds selection
  // state of its own: CLAUDE.md sec.6 requires that none of the three analytics run
  // before a selection exists, and the cleanest way to guarantee that is to keep a
  // single source of truth from the start.
}

document.addEventListener("DOMContentLoaded", bootstrap);
