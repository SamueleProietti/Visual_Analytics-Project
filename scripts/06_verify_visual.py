"""
Phase 16 - verify the visual encodings.

CLAUDE.md sec.2 puts a price on three visual rules:

    missing legends                    2 points
    non-standard colour encodings      2 points
    unjustified scrollable views       2 points

The colour rule is the one usually claimed rather than checked. "Okabe-Ito is
colour-vision-deficiency safe" is true of the palette in the abstract, but what matters
is whether the seven colours WE picked stay distinguishable from each other under the
common deficiencies. That is measurable, so this script measures it: each palette is
pushed through simulations of protanopia, deuteranopia and tritanopia, and every pair of
colours is compared in CIE Lab.

Three kinds of palette, three different rules - and using the wrong rule marks correct
design as broken:

  categorical  every pair must stay distinguishable; the colours carry identity
  sequential   lightness must stay monotone; the ramp carries order, not identity
  divergent    lightness must be V-shaped, and the two ENDS must stay far apart; a
               divergent scale runs dark-light-dark by design

Run:
    .venv/Scripts/python scripts/06_verify_visual.py
"""

import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "frontend" / "js"
HTML = ROOT / "frontend" / "index.html"

# Delta E below this is "the same colour" for practical purposes on screen. 10 is a
# deliberately modest bar: it asks that bands be tellable apart, not that they be
# maximally separated.
MIN_DELTA_E = 10.0

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


# --------------------------------------------------------------------------------------
# colour science
# --------------------------------------------------------------------------------------

def hex_to_rgb(value):
    value = value.lstrip("#")
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], dtype=float) / 255.0


def srgb_to_linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def linear_to_lab(linear):
    """Linear sRGB -> CIE Lab under D65, so distances approximate what the eye sees."""
    matrix = np.array([[0.4124, 0.3576, 0.1805],
                       [0.2126, 0.7152, 0.0722],
                       [0.0193, 0.1192, 0.9505]])
    xyz = matrix @ linear
    white = np.array([0.95047, 1.0, 1.08883])
    ratio = xyz / white
    f = np.where(ratio > 0.008856, np.cbrt(ratio), 7.787 * ratio + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


# Viénot, Brettel & Mollon (1999) dichromat simulation, applied in linear RGB.
DEFICIENCIES = {
    "normal": np.eye(3),
    "protanopia": np.array([[0.0, 2.02344, -2.52581],
                            [0.0, 1.0, 0.0],
                            [0.0, 0.0, 1.0]]),
    "deuteranopia": np.array([[1.0, 0.0, 0.0],
                              [0.494207, 0.0, 1.24827],
                              [0.0, 0.0, 1.0]]),
    "tritanopia": np.array([[1.0, 0.0, 0.0],
                            [0.0, 1.0, 0.0],
                            [-0.395913, 0.801109, 0.0]]),
}


def simulate(hex_colour, deficiency):
    linear = srgb_to_linear(hex_to_rgb(hex_colour))
    return linear_to_lab(np.clip(DEFICIENCIES[deficiency] @ linear, 0, 1))


def min_pair_distance(colours, deficiency):
    """Smallest Delta E between any two colours of a palette, under one deficiency."""
    labs = [simulate(c, deficiency) for c in colours]
    worst, pair = float("inf"), None
    for i in range(len(labs)):
        for j in range(i + 1, len(labs)):
            distance = float(np.linalg.norm(labs[i] - labs[j]))
            if distance < worst:
                worst, pair = distance, (colours[i], colours[j])
    return worst, pair


def lightness_monotone(colours, deficiency):
    """Does a SEQUENTIAL ramp still run light-to-dark once the hues collapse?

    This is what keeps a sequential scale readable for a dichromat: hue may be lost,
    lightness order must not be.
    """
    lightness = [simulate(c, deficiency)[0] for c in colours]
    increasing = all(b >= a - 1.5 for a, b in zip(lightness, lightness[1:]))
    decreasing = all(b <= a + 1.5 for a, b in zip(lightness, lightness[1:]))
    return increasing or decreasing


def divergent_readable(colours, deficiency):
    """A divergent ramp must be V-shaped in lightness, not monotone.

    The first version of this check applied the sequential rule here and failed View A's
    residual scale on all three deficiencies - wrongly. A divergent scale runs dark at
    one end, light through the neutral middle, dark again at the other: that is the whole
    point, and measuring it as if it should climb steadily marks correct design as a
    fault. What actually has to hold is that each HALF keeps its order, and that the two
    ends stay far apart, so a dichromat can still tell "well above" from "well below".
    """
    lightness = [simulate(c, deficiency)[0] for c in colours]
    middle = len(lightness) // 2
    rising = all(b >= a - 2.0 for a, b in zip(lightness[:middle + 1],
                                              lightness[1:middle + 1]))
    falling = all(b <= a + 2.0 for a, b in zip(lightness[middle:], lightness[middle + 1:]))
    ends_apart = float(np.linalg.norm(
        simulate(colours[0], deficiency) - simulate(colours[-1], deficiency)))
    return rising and falling and ends_apart >= MIN_DELTA_E, ends_apart


# --------------------------------------------------------------------------------------
# palettes, read from the source so the check cannot drift from the code
# --------------------------------------------------------------------------------------

def extract_palettes():
    def hexes(text):
        return re.findall(r"#[0-9a-fA-F]{6}", text)

    view_a = (JS / "viewA_map.js").read_text(encoding="utf-8")
    view_b = (JS / "viewB_scatter.js").read_text(encoding="utf-8")
    view_c = (JS / "viewC_timeline.js").read_text(encoding="utf-8")
    view_d = (JS / "viewD_contrast.js").read_text(encoding="utf-8")

    def block(text, marker):
        start = text.find(marker)
        return hexes(text[start:text.find("]", start)])

    def layer(text, name):
        """One of View A's LAYERS, keyed by its name rather than its first colour.

        Keyed by name because the earlier version matched on the literal first hex, so
        changing a palette silently broke the extraction and the script went on checking
        a palette the app no longer used. Scanning starts AT the opening bracket, not at
        the layer name, so hexes quoted in the comments above it are not mistaken for
        members of the ramp.
        """
        start = text.index(f"{name}: {{")
        opening = text.index("colours: [", start) + len("colours: [")
        return hexes(text[opening:text.index("]", opening)])

    return {
        "View A - residual (divergent)": (layer(view_a, "residual"), "divergent"),
        "View A - volume (sequential)": (layer(view_a, "volume"), "sequential"),
        "View A - attribution (sequential)": (layer(view_a, "attribution"), "sequential"),
        "View B - intensity (sequential)": (block(view_b, "const COLOURS = ["), "sequential"),
        "View C - incident type (categorical)": (
            hexes(view_c[view_c.find("const PALETTE"):view_c.find("};", view_c.find("const PALETTE"))]),
            "categorical"),
        "View D - contrast (divergent)": (
            [re.search(r'OVER = "(#[0-9a-fA-F]{6})"', view_d).group(1),
             re.search(r'UNDER = "(#[0-9a-fA-F]{6})"', view_d).group(1)], "divergent"),
    }


# --------------------------------------------------------------------------------------

def check_colours():
    rule("1. COLOUR-VISION DEFICIENCY")
    palettes = extract_palettes()

    for name, (colours, kind) in palettes.items():
        if not colours:
            check(f"{name}: palette found in source", False, "no colours extracted")
            continue
        print(f"\n  {name} - {len(colours)} colours, {kind}")

        for deficiency in ("protanopia", "deuteranopia", "tritanopia"):
            if kind == "categorical":
                # Every band must be tellable from every other: they carry identity.
                worst, pair = min_pair_distance(colours, deficiency)
                check(f"  {deficiency}: all bands distinguishable", worst >= MIN_DELTA_E,
                      f"min deltaE {worst:.1f} between {pair[0]} and {pair[1]}")
            elif kind == "divergent":
                # Both ends must remain tellable apart, and each half keep its order.
                ok, ends = divergent_readable(colours, deficiency)
                check(f"  {deficiency}: ends stay opposed, halves keep order", ok,
                      f"end-to-end deltaE {ends:.1f}")
            else:
                # A ramp carries order, not identity: lightness must stay monotone.
                check(f"  {deficiency}: ramp keeps its lightness order",
                      lightness_monotone(colours, deficiency))


def check_divergent_usage():
    rule("2. DIVERGENT SCALES ONLY WHERE A SIGN IS MEANINGFUL")
    # A divergent scale asserts that the data has a meaningful zero and two directions.
    # Used on a plain count it invents a midpoint that does not exist.
    divergent_ok = {
        "viewA_map.js": "residual",      # z: zero = as expected, sign = over/under
        "viewD_contrast.js": "OVER",     # difference in proportion: signed
    }
    for name, marker in divergent_ok.items():
        text = (JS / name).read_text(encoding="utf-8")
        check(f"{name} uses a divergent scale on a signed quantity", marker in text)

    for name in ("viewB_scatter.js", "viewC_timeline.js"):
        text = (JS / name).read_text(encoding="utf-8")
        check(f"{name} declares no divergent scale",
              "RdBu" not in text and "#2166ac" not in text and "#b2182b" not in text)

    palettes = extract_palettes()
    for name in ("View A - volume (sequential)", "View A - attribution (sequential)"):
        colours, _ = palettes[name]
        # A sequential ramp has one light end; a divergent one is light in the MIDDLE.
        # Checking the shape rather than a literal hex means the check survives a palette
        # change and still catches the mistake it exists to catch.
        lightest = max(range(len(colours)), key=lambda i: simulate(colours[i], "normal")[0])
        check(f"{name.split(' - ')[1]} is sequential in shape, not divergent",
              lightest in (0, len(colours) - 1),
              f"lightest of {len(colours)} colours is at index {lightest}")


def signal_colours(colours, kind):
    """The members of a scale that actually assert something.

    A sequential ramp's pale end means "almost none" and makes no claim, so comparing
    pale ends across two ramps would only ever measure "both are nearly white" and would
    fail every honest palette. The dark end is the claim. A divergent scale claims at
    both ends and not in the middle.
    """
    if kind == "sequential":
        return colours[-2:]
    if kind == "divergent":
        return [colours[0], colours[1], colours[-2], colours[-1]]
    return colours


def check_layer_separation():
    rule("3. ONE MEANING PER COLOUR WHERE THE MEANINGS SHARE PIXELS")
    palettes = extract_palettes()

    # View A's three layers are the strictest case in the tool and the one the per-scale
    # checks cannot see: each palette passed its own rule while volume and residual were
    # both blue, and attribution and residual were both dark red. They paint the SAME
    # COUNTRIES, swapped by the toggle - so if two of them look alike, the analyst cannot
    # tell which question the map is currently answering, and no legend repairs that
    # because the colour is read first.
    #
    # The bar is MIN_DELTA_E rather than something higher because a higher one is not
    # reachable: searching every ColorBrewer combination put the ceiling at about 12.
    # Four quantitative scales on one screen genuinely over-subscribe the hue space.
    layers = [(name, palettes[f"View A - {name} ({kind})"])
              for name, kind in [("residual", "divergent"), ("volume", "sequential"),
                                 ("attribution", "sequential")]]

    for i in range(len(layers)):
        for j in range(i + 1, len(layers)):
            (name_a, (colours_a, kind_a)) = layers[i]
            (name_b, (colours_b, kind_b)) = layers[j]
            left = signal_colours(colours_a, kind_a)
            right = signal_colours(colours_b, kind_b)

            worst, detail = float("inf"), ""
            for deficiency in ("protanopia", "deuteranopia", "tritanopia"):
                for one in left:
                    for other in right:
                        distance = float(np.linalg.norm(
                            simulate(one, deficiency) - simulate(other, deficiency)))
                        if distance < worst:
                            worst, detail = distance, f"{one} vs {other} under {deficiency}"
            check(f"View A: {name_a} and {name_b} stay distinct",
                  worst >= MIN_DELTA_E, f"worst deltaE {worst:.1f} - {detail}")

    # The signed axis is the one meaning that appears in two views at once. If View D
    # drifted from View A's residual ends, red would mean "above expected" in one place
    # and something slightly different in the other - the exact inconsistency the course
    # material warns about ("maintain consistence across different graphs").
    residual, _ = palettes["View A - residual (divergent)"]
    contrast, _ = palettes["View D - contrast (divergent)"]
    check("View D's bars use View A's residual endpoints",
          set(contrast) == {residual[0], residual[-1]},
          f"View D {contrast} vs residual ends {[residual[0], residual[-1]]}")


def check_legends():
    rule("4. EVERY VIEW CARRIES A LEGEND")
    html = HTML.read_text(encoding="utf-8")
    for view in ("a", "b", "c", "d"):
        check(f"view-{view} has a legend container", f'id="view-{view}-legend"' in html)

    for name, view in [("viewA_map.js", "A"), ("viewB_scatter.js", "B"),
                       ("viewC_timeline.js", "C"), ("viewD_contrast.js", "D")]:
        text = (JS / name).read_text(encoding="utf-8")
        check(f"View {view} populates its legend", "renderLegend" in text)


def css_block(css, selector):
    """Body of the first rule whose selector is exactly `selector`."""
    match = re.search(r"(?m)^" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


def check_fixed_size():
    rule("5. VIEWS ARE FIXED-SIZE AND DO NOT SCROLL")
    css = (ROOT / "frontend" / "css" / "style.css").read_text(encoding="utf-8")

    # The canvases are no longer a fixed pixel height: the dashboard is sized from the
    # window so all four views fit one screen. What "fixed-size" has to mean now is that
    # nothing INSIDE a view can change the size of its chart after the chart is drawn -
    # so the parts around the canvas have fixed heights, and the canvas itself may take
    # the remaining space but can neither grow with its content nor scroll.
    canvas = css_block(css, ".view-canvas")
    check("view canvases take the remaining space and may shrink below their content",
          "flex: 1 1 auto" in canvas and "min-height: 0" in canvas)
    check("view canvases clip rather than scroll", "overflow: hidden" in canvas)
    for selector, token in [(".view-head", "var(--head-h)"), (".view-sub", "var(--sub-h)"),
                            (".view-legend", "var(--legend-h)")]:
        block = css_block(css, selector)
        check(f"{selector} has a fixed height, so it cannot push the chart",
              f"height: {token}" in block and "flex: none" in block)
    check("the dashboard is sized from the window, not from the page content",
          "100vh" in css_block(css, ".app-shell"))
    check("inline svg is display:block (baseline gap caused a scroll in phase 6)",
          ".view-canvas svg { display: block; }" in css)


def main():
    check_colours()
    check_divergent_usage()
    check_layer_separation()
    check_legends()
    check_fixed_size()

    rule(f"RESULT - {sum(results)}/{len(results)} checks passed")
    if not all(results):
        raise SystemExit("visual encoding rules are violated")
    print("  Palettes survive the three common colour-vision deficiencies, divergent")
    print("  scales appear only on signed quantities, no two meanings that share pixels")
    print("  wear the same colour, every view has a legend, and no view scrolls.")


if __name__ == "__main__":
    main()
