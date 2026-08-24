/* Shared selection store — the coordination hub for the four views.
 *
 * Phase 10 scope: the store and its pub/sub only. No view publishes to it and no view
 * subscribes yet; phase 11 wires them up. Building it as a separate step is deliberate,
 * because this is where the graded rule of CLAUDE.md sec.6 is enforced structurally:
 *
 *   "None of these three computations may run before a selection exists."
 *
 * With one authority on what is selected, "does a selection exist?" has exactly one
 * answer, and isEmpty() is the guard every analytic checks. Had each view kept its own
 * selection, that rule would depend on four separate pieces of discipline.
 *
 * THREE INDEPENDENT SOURCES, COMBINED BY INTERSECTION:
 *   countries  <- View A, click / ctrl-click
 *   lasso      <- View B, free lasso over the projection
 *   yearRange  <- View C, timeline brush
 *
 * Intersection, not union, because the proposal describes the brush as *restricting*
 * every computation to its window: an analyst who lassoes a cluster and then brushes
 * 2022-2024 means "these incidents, in those years", not "either".
 */

"use strict";

const SelectionStore = (() => {
  const subscribers = new Set();

  /** null means "this source is not filtering", which is different from "empty". */
  let state = {
    countries: [],      // ISO alpha-2 codes, [] = no country filter
    lasso: null,        // Set of incident_id, null = no lasso
    yearRange: null,    // [from, to] inclusive, null = no time filter
  };

  let incidents = [];   // the corpus, injected once at startup

  // ---------------------------------------------------------------------------------

  function setCorpus(all) {
    incidents = all || [];
  }

  function getState() {
    // A copy, so a subscriber cannot mutate the store by holding on to what it got.
    return {
      countries: [...state.countries],
      lasso: state.lasso ? new Set(state.lasso) : null,
      yearRange: state.yearRange ? [...state.yearRange] : null,
    };
  }

  /** True when nothing is selected anywhere. The guard for every analytic. */
  function isEmpty() {
    return state.countries.length === 0 && state.lasso === null
      && state.yearRange === null;
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);   // caller keeps the unsubscribe handle
  }

  function notify(origin) {
    const snapshot = resolve();
    for (const fn of subscribers) {
      // One failing subscriber must not stop the others from updating, or a bug in one
      // view would silently freeze the other three.
      try {
        fn(snapshot, origin);
      } catch (error) {
        console.error("[selection] subscriber failed:", error);
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // mutations - each names its origin, so a view can ignore echoes of its own action

  function setCountries(codes, { additive = false } = {}) {
    const next = additive ? new Set(state.countries) : new Set();
    for (const code of codes) {
      additive && next.has(code) ? next.delete(code) : next.add(code);
    }
    state.countries = [...next];
    notify("map");
  }

  function setLasso(incidentIds) {
    state.lasso = incidentIds && incidentIds.size ? new Set(incidentIds) : null;
    notify("projection");
  }

  function setYearRange(range) {
    state.yearRange = range ? [Math.min(...range), Math.max(...range)] : null;
    notify("timeline");
  }

  function clear() {
    state = { countries: [], lasso: null, yearRange: null };
    notify("clear");
  }

  // ---------------------------------------------------------------------------------

  /**
   * Apply the three filters and describe the result.
   *
   * Returns the selected incidents, their complement, and a comparison mode written out
   * in full - View D must never leave the comparison target implicit (CLAUDE.md sec.5).
   */
  function resolve() {
    if (isEmpty()) {
      return {
        empty: true, ids: new Set(), selected: [], complement: incidents,
        mode: "no selection", sources: [],
      };
    }

    const countrySet = new Set(state.countries);
    const selected = incidents.filter((incident) => {
      if (countrySet.size
          && !(incident.countries || []).some((c) => countrySet.has(c))) return false;
      if (state.lasso && !state.lasso.has(incident.incident_id)) return false;
      if (state.yearRange) {
        // Undated incidents cannot satisfy a time window. There are 92 of them, and
        // they drop out of any brushed selection by construction.
        if (incident.year == null) return false;
        if (incident.year < state.yearRange[0]
            || incident.year > state.yearRange[1]) return false;
      }
      return true;
    });

    const ids = new Set(selected.map((d) => d.incident_id));
    const complement = incidents.filter((d) => !ids.has(d.incident_id));

    return {
      empty: false, ids, selected, complement,
      mode: describeMode(), sources: activeSources(),
    };
  }

  /**
   * Resolve while ignoring one source — the geographic residual needs this.
   *
   * Asking "which countries are over-represented in this selection?" is circular when
   * the selection was DEFINED by picking countries: select Italy and Italy is 100% of
   * the selection against an expected 3%, giving a meaningless z of +23. Measured, not
   * theorised - it is what the first run of phase 12 produced.
   *
   * So the map computes its residual over the selection MINUS the country filter: the
   * lasso and the brush set the context, and the map answers "inside that context,
   * which countries deviate?". The clicked country stays highlighted as the focus, but
   * it no longer defines the very question being asked about it.
   */
  function resolveIgnoring(source) {
    const saved = { ...state };
    if (source === "countries") state = { ...state, countries: [] };
    if (source === "lasso") state = { ...state, lasso: null };
    if (source === "yearRange") state = { ...state, yearRange: null };
    const result = resolve();
    state = saved;
    return result;
  }

  function activeSources() {
    const sources = [];
    if (state.countries.length) sources.push("map");
    if (state.lasso) sources.push("projection");
    if (state.yearRange) sources.push("timeline");
    return sources;
  }

  /** The comparison, spelled out. Phase 14 puts this straight into View D's header. */
  function describeMode() {
    const parts = [];
    if (state.countries.length === 1) {
      parts.push(state.countries[0]);
    } else if (state.countries.length === 2) {
      // Two countries switch the contrast from vs-rest to a direct A-vs-B (sec.6.3).
      return `"${state.countries[0]}" vs "${state.countries[1]}"`
        + timeSuffix() + lassoSuffix();
    } else if (state.countries.length > 2) {
      parts.push(`${state.countries.length} countries`);
    }
    if (state.lasso) parts.push(`${state.lasso.size} lassoed incidents`);
    const subject = parts.length ? parts.join(" + ") : "time window";
    return `"${subject}"${timeSuffix()} vs rest of world`;
  }

  function timeSuffix() {
    return state.yearRange ? ` (${state.yearRange[0]}–${state.yearRange[1]})` : "";
  }

  function lassoSuffix() {
    return state.lasso ? ` within ${state.lasso.size} lassoed incidents` : "";
  }

  return {
    setCorpus, subscribe, getState, isEmpty, resolve, resolveIgnoring,
    setCountries, setLasso, setYearRange, clear,
    // Exposed for the phase-10 tests; the views use the methods above.
    _subscriberCount: () => subscribers.size,
  };
})();
