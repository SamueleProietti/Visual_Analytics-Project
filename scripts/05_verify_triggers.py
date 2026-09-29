"""
Verify the interaction contract.

The course rules impose two graded rules that are easy to claim and easy to
break by accident:

  1. Only a lasso, a map click/ctrl-click, or a timeline brush may start an analytic.
     Controls may exist - the rules bar a menu from being the WAY an analysis starts,
     not from being in the interface - so what is checked is that none of them is
     wired to one.
  2. None of the three analytics may produce a result before a selection exists. There
     is no default global state.

This script checks both, statically against the source and dynamically against a running
backend, so the claim can be re-verified rather than asserted. The runtime half of the
check - what the four views actually do in a browser - is verifyTriggers() in
frontend/js/verify.js, callable from the console.

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

# The runtime verification tool has to write to the store - simulating an interaction is
# its job - so it is excluded from the writer audit. It is excluded BY NAME and the
# exclusion is itself checked below, because an exemption list nobody audits is how a
# real fourth trigger would eventually slip in. This file earned its place on the list by
# being caught: the check first ran clean, then failed once verifyTriggers() was added to
# main.js, which is precisely the violation it exists to detect.
TEST_ONLY_FILES = {"verify.js"}

results = []
skipped = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


# --------------------------------------------------------------------------------------

# Anything the interface builds that a user presses or picks from.
CONTROL = re.compile(r'(?:join|append)\("(?:button|select|input)"\)'
                     r'|<(?:button|select|input|option)\b'
                     r'|type=["\'](?:radio|checkbox)["\']', re.IGNORECASE)

# Starting a computation, or writing the selection the computations run on. Reading the
# store (getState) is not either of those, so it is deliberately absent.
ANALYTIC = re.compile(r"SelectionStore\.(?:set\w+|clear)\s*\("
                      r"|/api/(?:residuals|reproject|contrast)"
                      r"|loadResiduals\(|loadSectors\(|loadContrast\(|reproject\(")


def handler_of(text, site):
    """The click handler attached to the control created at `site`, body only.

    Taken by matching braces from the arrow rather than by counting lines: View A's
    layer toggle sits fourteen lines above loadResiduals(), and a line window would
    have read that function as if the button called it.
    """
    at = text.find('.on("click"', site, site + 800)
    if at < 0:
        return ""
    arrow = text.find("=>", at)
    if arrow < 0:
        return ""
    rest = text[arrow + 2:]
    if not rest.lstrip().startswith("{"):
        return rest.split("\n", 1)[0]
    rest = rest[rest.index("{"):]
    depth = 0
    for i, ch in enumerate(rest):
        depth += (ch == "{") - (ch == "}")
        if depth == 0:
            return rest[:i + 1]
    return rest


def check_controls():
    rule("1. CONTROLS EXIST, AND NONE OF THEM STARTS AN ANALYTIC")
    sources = {HTML.name: HTML.read_text(encoding="utf-8")}
    for path in sorted(JS.glob("*.js")):
        sources[path.name] = path.read_text(encoding="utf-8")

    # The rules ask for a computation triggered by a visual interaction and say a menu
    # selection is not one. They do not ban controls, so this does not hunt for them:
    # it reads what each one is wired to. A control that only changes what is drawn is
    # allowed and earns nothing; a control that starts a computation would cost five
    # points, and that is the only thing worth asserting here.
    sites = [(name, match.start()) for name, body in sources.items()
             for match in CONTROL.finditer(body)]
    print(f"  {len(sites)} control(s) built, by: "
          f"{', '.join(sorted({name for name, _ in sites})) or 'nothing'}")

    wired = sorted({name for name, site in sites
                    if ANALYTIC.search(handler_of(sources[name], site))})
    check("no control is wired to an analytic or to the selection store",
          not wired, f"controls that compute: {wired}")

    html = sources[HTML.name]
    check("no control is hard-coded in index.html (each belongs to the view that owns it)",
          not CONTROL.search(html),
          "static controls found in index.html" if CONTROL.search(html) else "")

    makers = {name for name, _ in sites if name != HTML.name}
    check("controls are built by View A alone", makers == {"viewA_map.js"},
          f"files creating controls: {sorted(makers)}")

    # The inventory is asserted, not just printed. A control that appears without anyone
    # noticing is how a menu would eventually become the way an analysis starts - the
    # same reason the exemption list below is audited rather than trusted.
    view_a = sources["viewA_map.js"]
    classes = set()
    for name, site in sites:
        if name != "viewA_map.js":
            continue
        window = view_a[site:site + 400]
        found = re.search(r'\.attr\("class",\s*(?:\(\w+\)\s*=>\s*)?"([a-z-]+)"', window)
        if found:
            classes.add(found.group(1))
    check("the display controls are the layer toggle and the zoom buttons, and nothing else",
          classes == {"toggle-button", "zoom-button"},
          f"control classes found: {sorted(classes)}")


def check_store_writers():
    rule("2. ONLY THREE THINGS MAY START A SELECTION")
    writers = {}
    for path in sorted(JS.glob("*.js")):
        if path.name in TEST_ONLY_FILES:
            continue
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

    # Audit the exemption itself. A skip list that nobody checks is how a genuine fourth
    # trigger would eventually hide.
    for name in sorted(TEST_ONLY_FILES):
        path = JS / name
        check(f"{name} exists and is marked as a test tool", path.is_file()
              and "TEST tool" in path.read_text(encoding="utf-8"))
    check("only one file is exempt from the writer audit", len(TEST_ONLY_FILES) == 1,
          f"exempt: {sorted(TEST_ONLY_FILES)}")

    # The test tool must not run itself: an automatic check would be a computation
    # happening before a selection exists, which is the very rule under test.
    #
    # Comments are stripped before searching. The first version of this check matched
    # the "await verifyTriggers()" inside the file's own usage comment and failed on a
    # line of documentation - a check that reads prose as code is worse than no check,
    # because it trains you to ignore its output.
    verify_source = (JS / "verify.js").read_text(encoding="utf-8")
    code_only = re.sub(r"/\*.*?\*/", "", verify_source, flags=re.DOTALL)
    code_only = re.sub(r"//.*", "", code_only)

    check("the test tool never registers a startup listener",
          "addEventListener" not in code_only)
    check("the test tool is never self-invoked",
          not re.search(r"^\s*(await\s+)?verifyTriggers\s*\(", code_only, re.MULTILINE))


def check_analytics_reachability():
    rule("3. ANALYTICS ARE REACHABLE ONLY THROUGH A SELECTION")
    main = (JS / "main.js").read_text(encoding="utf-8")

    # Every view's applySelection runs from the store subscription, and nowhere else.
    calls = re.findall(r"View[ABCDE]\.applySelection\(", main)
    check("all five views react through the store subscription", len(calls) == 5,
          f"{len(calls)} calls found")

    # Two conditions, both required. The origin alone once let a plain click in View B
    # (which publishes setLasso(null) from "projection") refit a COUNTRY selection.
    # The condition of the `if` that guards the call: from the last "if (" before
    # ViewB.reproject( up to the brace that opens its body. Not a [^)]* regex - the
    # condition itself contains a call, getState(), and would stop it early.
    call = main.find("ViewB.reproject(")
    opening = main.rfind("if (", 0, call)
    gate_text = main[opening:main.find("{", opening)] if call > 0 and opening >= 0 else ""
    check("re-projection is gated on the lasso origin",
          'origin === "projection"' in gate_text, gate_text)
    check("re-projection also requires a lasso to exist, not just a projection event",
          ".lasso" in gate_text, gate_text)

    # republish() exists for the redraw after a window resize: it re-sends the current
    # selection so the rebuilt views get it back. It is safe only as long as it sets
    # nothing - otherwise it would be a way to produce a selection no interaction made.
    store = (JS / "selectionStore.js").read_text(encoding="utf-8")
    body = store[store.find("function republish"):]
    body = body[:body.find("}") + 1]
    check("republish() re-sends the selection and mutates nothing",
          "notify(" in body and "state" not in body,
          " ".join(body.split()))

    # The local layout belongs to the lasso that produced it. Dismissing the lasso has
    # to dismiss the layout, and the test cannot be on the ORIGIN alone: the dismissing
    # click publishes from "projection" itself, which is how View B once kept a local
    # re-projection on screen after every other view had dropped the lasso.
    scatter = (JS / "viewB_scatter.js").read_text(encoding="utf-8")
    guard = scatter[scatter.find("function applySelection"):]
    guard = guard[:guard.find("restoreGlobal();") + len("restoreGlobal();")]
    check("View B drops the local layout when the lasso is gone",
          "getState().lasso" in guard and "restoreGlobal();" in guard)

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
            # Recorded, not merely printed. A skipped section that still lets the script
            # exit 0 is how a verification suite quietly stops verifying anything.
            skipped.append(f"{endpoint} (server not reachable on {BASE})")
            print(f"  [SKIP] {endpoint} - server not running on {BASE}")
            continue

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
    check_controls()
    check_store_writers()
    check_analytics_reachability()
    check_api_refuses_empty()

    rule(f"RESULT - {sum(results)}/{len(results)} checks passed"
         + (f", {len(skipped)} SKIPPED" if skipped else ""))
    if not all(results):
        raise SystemExit("the interaction contract is violated")

    if skipped:
        for item in skipped:
            print(f"  [SKIPPED] {item}")
        raise SystemExit(
            "\nINCOMPLETE: the API half of the contract was not checked.\n"
            "Start the server and re-run - a partial pass is not a pass.")

    print("  Lasso, map click and timeline brush are the only ways to start an analytic,")
    print("  and no analytic can produce a result before a selection exists.")


if __name__ == "__main__":
    main()
