/* Interaction-contract verification — a TEST tool, not part of the application.
 *
 * This file lives apart from the four views and the bootstrap on purpose. It writes to
 * the selection store in order to simulate interactions, which is exactly what
 * scripts/05_verify_triggers.py forbids production code from doing: that script counts
 * every writer to the store and fails if a fourth one appears beside the map, the lasso
 * and the brush.
 *
 * It found this file. Keeping the test in main.js made the verifier report a violation,
 * correctly - a function shipped in the bootstrap that can set a time range without any
 * interaction IS a fourth path into the store. Splitting it out is the honest fix; the
 * verifier skips this file by name and asserts that it is the only one skipped.
 *
 * Run from the console:  await verifyTriggers()
 */

"use strict";

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

  // The map's zoom buttons are the other display-only control, and they are the newest
  // buttons in the interface - which makes them the likeliest place for the "no menu
  // may start an analysis" rule to be broken by accident. Pressed to both limits and
  // back, they must move the camera and change nothing else.
  const zoomButtons = [...document.querySelectorAll("#view-a-zoom button")];
  check("the map has exactly two zoom buttons", zoomButtons.length === 2,
    `${zoomButtons.length} found`);
  const selectionBefore = JSON.stringify(SelectionStore.getState());
  const scaleOf = () => d3.zoomTransform(document.querySelector("#view-a-canvas svg")).k;
  for (let i = 0; i < 7; i += 1) zoomButtons[0].click();
  const zoomedIn = scaleOf();
  for (let i = 0; i < 7; i += 1) zoomButtons[1].click();
  await wait(400);
  check("zoom in changes the scale and stops at the limit", zoomedIn === 8,
    `reached ${zoomedIn}`);
  check("zoom out returns to the fitted world", scaleOf() === 1, `at ${scaleOf()}`);
  check("zooming starts no analytic and changes no selection",
    JSON.stringify(SelectionStore.getState()) === selectionBefore
    && analyticOutput().contrastBars === before);

  // Trigger 1 - map click.
  const country = [...document.querySelectorAll("path.country")]
    .find((p) => (p.querySelector("title") || {}).textContent?.startsWith("United States"));
  country.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(2000);
  state = analyticOutput();
  check("map click produces a contrast", state.contrastBars > 0,
    `${state.contrastBars} bars`);
  check("map click names the comparison", state.header.includes("vs"), state.header);

  // The case that was reported: a country selected on the map, then a plain click in
  // View B. It re-projected the country's incidents. Only a lasso may refit t-SNE.
  const plane = document.querySelector("#view-b-canvas svg");
  const box = plane.getBoundingClientRect();
  const at = { bubbles: true, view: window,
    clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  plane.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
  window.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
  await wait(1500);
  check("a click in View B does not re-project a country selection",
    analyticOutput().localBanner === 0
    && SelectionStore.getState().countries.length === 1,
    `banner ${analyticOutput().localBanner}, countries ${SelectionStore.getState().countries}`);

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

  // Clicking empty sea clears the countries in one gesture. Worth pinning down because
  // it shares the mousedown with the pan: the guard that tells a drag from a click is
  // the kind of thing a later change breaks silently, and the symptom - a selection
  // vanishing when the analyst tried to pan - would be blamed on anything but this.
  const countries = [...document.querySelectorAll("path.country")];
  const byName = (n) => countries.find(
    (p) => (p.querySelector("title") || {}).textContent?.startsWith(n));
  byName("Italy").dispatchEvent(new MouseEvent("click", { bubbles: true, view: window }));
  await wait(1200);
  byName("Germany").dispatchEvent(
    new MouseEvent("click", { bubbles: true, view: window, ctrlKey: true }));
  await wait(1200);
  check("ctrl-click builds a multi-country selection",
    SelectionStore.getState().countries.length === 2,
    SelectionStore.getState().countries.join(","));

  document.querySelector("#view-a-canvas path.sphere")
    .dispatchEvent(new MouseEvent("click", { bubbles: true, view: window }));
  await wait(1200);
  state = analyticOutput();
  check("clicking the sea clears every selected country in one gesture",
    SelectionStore.getState().countries.length === 0);
  check("clearing by sea click also removes the contrast", state.contrastBars === 0);

  const passed = results.filter(Boolean).length;
  console.log(`%c${passed}/${results.length} runtime checks passed`,
    `font-weight:bold;color:${passed === results.length ? "green" : "red"}`);
  return { passed, total: results.length };
}

/**
 * Phase 16 — the runtime half of the visual-encoding check.
 *
 * scripts/06_verify_visual.py measures the palettes against simulated colour-vision
 * deficiencies and reads the source for divergent-scale misuse. What it cannot see is
 * whether a legend is actually populated on screen in every state the interface passes
 * through - and an empty legend container reads as a missing legend, which is the thing
 * CLAUDE.md sec.2 charges two points for.
 *
 *     await verifyLegends()
 */
async function verifyLegends() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (label, ok, detail = "") => {
    results.push(ok);
    console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? "  - " + detail : ""}`);
  };

  const legends = () => ["a", "b", "c", "d"].map((v) => {
    const el = document.getElementById(`view-${v}-legend`);
    return {
      view: v.toUpperCase(),
      chars: el.textContent.trim().length,
      symbols: el.querySelectorAll(".legend-swatch, circle").length,
    };
  });

  const assertAll = (label) => {
    for (const l of legends()) {
      check(`${label} · View ${l.view} legend is populated`,
        l.chars > 0 && l.symbols > 0, `${l.chars} chars, ${l.symbols} symbols`);
    }
    check(`${label} · no view scrolls`,
      ![...document.querySelectorAll(".view-canvas")].some(
        (c) => c.scrollHeight > c.clientHeight || c.scrollWidth > c.clientWidth));

    // Legends now have a fixed height with hidden overflow. That overflow is a backstop,
    // not a design: if a legend grows in some state - a longer residual note, a narrower
    // window - its last row would vanish without anything else noticing. So it is
    // measured here, in every state, instead of trusted.
    const clipped = ["a", "b", "c", "d"].filter((v) => {
      const el = document.getElementById(`view-${v}-legend`);
      return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    });
    check(`${label} · no legend is clipped`, clipped.length === 0,
      clipped.length ? `clipped: ${clipped.map((v) => v.toUpperCase()).join(", ")}` : "");

    // The point of the layout: all four coordinated views on one screen. Only asserted
    // at a size the layout supports; below it the page is meant to scroll.
    if (innerWidth >= 760 && innerHeight >= 560) {
      const page = document.documentElement;
      check(`${label} · the dashboard fits the window without a page scroll`,
        page.scrollHeight <= innerHeight + 1,
        `page ${page.scrollHeight}px, window ${innerHeight}px`);
    }
  };

  console.log("%c--- legends and fixed size, in every state ---", "font-weight:bold");

  SelectionStore.clear();
  await wait(600);
  assertAll("empty");

  const country = [...document.querySelectorAll("path.country")]
    .find((p) => (p.querySelector("title") || {}).textContent?.startsWith("Germany"));
  country.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(2000);
  assertAll("selection");

  // The details popup has a capped height inside a map canvas that is itself sized from
  // the window. At laptop height the cap once cut its last lines - the "less than
  // expected" sectors - with nothing on screen to show text was missing.
  const popupWhole = (label) => {
    const pop = document.getElementById("view-a-details");
    if (pop.hidden) return;
    check(`${label} · the country popup shows all of its lines`,
      pop.scrollHeight <= pop.clientHeight + 1,
      `content ${pop.scrollHeight}px, box ${pop.clientHeight}px`);
  };
  popupWhole("selection");

  SelectionStore.setYearRange([2022, 2024]);
  await wait(2000);
  assertAll("residual");
  popupWhole("residual");

  SelectionStore.clear();
  await wait(700);
  assertAll("cleared");

  const passed = results.filter(Boolean).length;
  console.log(`%c${passed}/${results.length} legend checks passed`,
    `font-weight:bold;color:${passed === results.length ? "green" : "red"}`);
  return { passed, total: results.length };
}
