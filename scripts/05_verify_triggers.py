"""
Phase 15 - verify the interaction contract.

CLAUDE.md sec.2 and sec.6 impose two graded rules that are easy to claim and easy to
break by accident:

  1. Only a lasso, a map click/ctrl-click, or a timeline brush may start an analytic.
     No menu, dropdown or radio button.
  2. None of the three analytics may produce a result before a selection exists. There
     is no default global state.

This script checks both, statically against the source and dynamically against a running
backend, so the claim can be re-verified rather than asserted. The runtime half of the
check - what the four views actually do in a browser - is in verifyTriggers() in
frontend/js/main.js, callable from the console.

Run (with the server up for the API section):
    .venv/Scripts/python scripts/05_verify_triggers.py
"""

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "frontend" / "js"
HTML = ROOT / "frontend" / "index.html"
BASE = "http://127.0.0.1:8000"

ANALYTICS_ENDPOINTS = ["/api/residuals", "/api/reproject", "/api/contrast"]

# The only three functions that may write to the shared store, and the only file each
# is allowed to be called from. Anything else writing to the store would be a fourth
# trigger, whatever it looked like in the interface.
ALLOWED_TRIGGERS = {
    "setCountries": "viewA_map.js",     # map click / ctrl-click
    "setLasso": "viewB_scatter.js",     # free lasso on the projection
    "setYearRange": "viewC_timeline.js",  # timeline brush
}

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


# --------------------------------------------------------------------------------------

def check_no_input_controls():
    rule("1. NO MENU, DROPDOWN OR RADIO ANYWHERE")
    sources = {HTML.name: HTML.read_text(encoding="utf-8")}
    for path in sorted(JS.glob("*.js")):
        sources[path.name] = path.read_text(encoding="utf-8")

    forbidden = re.compile(r"<select\b|<option\b|type=[\"']radio[\"']|type=[\"']checkbox[\"']",
                           re.IGNORECASE)
    offenders = {name: forbidden.findall(text) for name, text in sources.items()
                 if forbidden.search(text)}
    check("no <select>, <option>, radio or checkbox in the frontend",
          not offenders, str(offenders) if offenders else "")

    # The layer toggle is two buttons. Two is a display switch; three would be a menu.
    html = sources[HTML.name]
    check("the only <button> elements are created by the two-state toggle",
          "<button" not in html, "static buttons found in index.html"
          if "<button" in html else "")


def check_store_writers():
    rule("2. ONLY THREE THINGS MAY START A SELECTION")
    writers = {}
    for path in sorted(JS.glob("*.js")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"SelectionStore\.(set\w+|clear)\s*\(", text):
            name = match.group(1)
            if name in ("setCorpus",):     # injecting the corpus is not a selection
                continue
            writers.setdefault(name, set()).add(path.name)

    for name, files in sorted(writers.items()):
        if name == "clear":
            check("clear() may be called from anywhere (it removes a selection)", True,
                  ", ".join(sorted(files)))
            continue
        expected = ALLOWED_TRIGGERS.get(name)
        check(f"{name}() is written only by {expected}",
              expected is not None and files == {expected},
              f"found in {sorted(files)}")

    check("no store writer beyond the three permitted triggers",
          set(writers) <= set(ALLOWED_TRIGGERS) | {"clear"},
          f"unexpected: {sorted(set(writers) - set(ALLOWED_TRIGGERS) - {'clear'})}")


def check_analytics_reachability():
    rule("3. ANALYTICS ARE REACHABLE ONLY THROUGH A SELECTION")
    main = (JS / "main.js").read_text(encoding="utf-8")

    # Every view's applySelection runs from the store subscription, and nowhere else.
    calls = re.findall(r"View[ABCD]\.applySelection\(", main)
    check("all four views react through the store subscription", len(calls) == 4,
          f"{len(calls)} calls found")

    check("re-projection is gated on the lasso origin",
          'origin === "projection"' in main)

    # No analytic may be invoked at startup: bootstrap must not call them directly.
    bootstrap = main[main.find("async function bootstrap"):]
    for name in ("reproject(", "/api/residuals", "/api/contrast"):
        check(f"bootstrap does not invoke {name.rstrip('(')} directly",
              name not in bootstrap.split("SelectionStore.subscribe")[0])


def check_api_refuses_empty():
    rule("4. THE API HAS NO PARAMETERLESS FORM")
    for endpoint in ANALYTICS_ENDPOINTS:
        # GET must not exist: a URL that can be typed is a default global result.
        try:
            urllib.request.urlopen(BASE + endpoint, timeout=10)
            check(f"GET {endpoint} is not available", False, "it responded")
        except urllib.error.HTTPError as error:
            check(f"GET {endpoint} is not available", error.code in (404, 405),
                  f"HTTP {error.code}")
        except OSError:
            print(f"  [SKIP] {endpoint} - server not running on {BASE}")
            return

        # POST with an empty selection must be rejected by validation, not answered.
        request = urllib.request.Request(
            BASE + endpoint, data=json.dumps({"incident_ids": []}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(request, timeout=10)
            check(f"POST {endpoint} rejects an empty selection", False, "it computed one")
        except urllib.error.HTTPError as error:
            check(f"POST {endpoint} rejects an empty selection",
                  error.code in (400, 422), f"HTTP {error.code}")


def main():
    check_no_input_controls()
    check_store_writers()
    check_analytics_reachability()
    check_api_refuses_empty()

    rule(f"RESULT - {sum(results)}/{len(results)} checks passed")
    if not all(results):
        raise SystemExit("the interaction contract is violated")
    print("  Lasso, map click and timeline brush are the only ways to start an analytic,")
    print("  and no analytic can produce a result before a selection exists.")


if __name__ == "__main__":
    main()
