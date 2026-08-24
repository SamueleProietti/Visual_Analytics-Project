"""On-demand analytics. Nothing here runs without a selection.

Analytics 6.1 lives here; 6.2 and 6.3 join it in phases 13 and 14. Every entry point
takes an explicit set of incident ids and refuses an empty one, so the rule in
CLAUDE.md sec.6 - no computation before a selection exists - is enforced at the layer
that does the computing, not only in the interface that calls it.

WHERE THE RESIDUAL IS COMPUTED, AND WHY IN TWO PLACES

The proposal asks the map to show "how far each country departs from the global
expectation in the sectors it targets or is targeted in". A choropleth paints one
number per country, but a country-sector table holds twelve, so the two cannot be the
same statistic. Measured on the real data:

  * country x sector cells with expected frequency >= 5:  19.2%  (387 of 2,016)
  * countries with at least one reliable cell:            67.3%
  * countries with expected >= 5 on a country-level residual over a typical
    selection (2022-2024):                                72.0%

So the map uses the country-level residual, which is reliable for roughly three
countries in four and answers "which countries are over- or under-represented in this
selection?". The country-sector residuals are computed too, and surfaced in the
details-on-demand panel for the clicked country, answering "and in which sectors?".
Both are Pearson standardized residuals; neither is suppressed when unreliable - low
expected frequencies are flagged, as sec.6.1 requires.
"""

import numpy as np
import pandas as pd

from . import data

# Cochran's conventional threshold for a chi-square cell. Below it the normal
# approximation behind the z-score stops holding, so the number is still computed and
# returned but marked unreliable rather than hidden (CLAUDE.md sec.6.1).
MIN_EXPECTED = 5.0


def _selected_observations(incident_ids):
    """The country/sector rows belonging to the selected incidents."""
    long = data.incident_receiver()
    mappable = long[long["country_code"].notna()]
    return mappable[mappable["incident_id"].isin(incident_ids)]


def country_residuals(incident_ids):
    """Pearson standardized residual per country, for the current selection.

    Expected counts come from each country's share of the WHOLE corpus, scaled to the
    size of the selection: if a country holds 8% of all target records, a selection of
    500 records is expected to contain 40 of them. The residual is

        z = (observed - expected) / sqrt(expected)

    which is the standardized deviation of CLAUDE.md sec.6.1 applied to the country
    margin. A positive z means the country appears more often in this selection than
    its overall weight would predict.
    """
    if not incident_ids:
        raise ValueError("country_residuals requires a non-empty selection")

    long = data.incident_receiver()
    mappable = long[long["country_code"].notna()]
    selected = _selected_observations(incident_ids)

    if selected.empty:
        return []

    # Baseline shares over the entire corpus, not over the complement: the question is
    # "unusual compared with the corpus", and a complement that shrinks as the selection
    # grows would make the baseline move under the analyst's feet.
    share = mappable["country_code"].value_counts() / len(mappable)
    observed = selected["country_code"].value_counts()
    expected = share * len(selected)

    names = (mappable.drop_duplicates("country_code")
             .set_index("country_code")["country"].to_dict())

    rows = []
    for code, exp in expected.items():
        obs = int(observed.get(code, 0))
        if exp <= 0:
            continue
        rows.append({
            "code": code,
            "country": names.get(code, code),
            "observed": obs,
            "expected": round(float(exp), 2),
            "z": round(float((obs - exp) / np.sqrt(exp)), 3),
            "reliable": bool(exp >= MIN_EXPECTED),
        })
    rows.sort(key=lambda r: -abs(r["z"]))
    return rows


def sector_residuals(incident_ids, country_code):
    """Residual per sector within one country - the details-on-demand breakdown.

    Same statistic, one level down: the country's sector mix in the selection against
    the sector mix of the whole corpus. This is the country x sector table of sec.6.1,
    and it is where the "small sample" badge earns its keep - only about one cell in
    five clears an expected frequency of 5.
    """
    if not incident_ids:
        raise ValueError("sector_residuals requires a non-empty selection")

    long = data.incident_receiver()
    mappable = long[long["country_code"].notna()]
    selected = _selected_observations(incident_ids)
    here = selected[selected["country_code"] == country_code]

    if here.empty:
        return []

    share = mappable["sector"].value_counts() / len(mappable)
    observed = here["sector"].value_counts()
    expected = share * len(here)

    rows = []
    for sector, exp in expected.items():
        obs = int(observed.get(sector, 0))
        if exp <= 0 or (obs == 0 and exp < 0.5):
            continue      # a sector this country never touches is not a finding
        rows.append({
            "sector": sector,
            "observed": obs,
            "expected": round(float(exp), 2),
            "z": round(float((obs - exp) / np.sqrt(exp)), 3),
            "reliable": bool(exp >= MIN_EXPECTED),
        })
    rows.sort(key=lambda r: -abs(r["z"]))
    return rows


def residuals_summary(rows):
    """How much of a result can actually be trusted - reported alongside it."""
    reliable = [r for r in rows if r["reliable"]]
    return {
        "countries": len(rows),
        "reliable": len(reliable),
        "unreliable": len(rows) - len(reliable),
        "min_expected": MIN_EXPECTED,
        "max_abs_z": round(max((abs(r["z"]) for r in reliable), default=0.0), 3),
    }


# --------------------------------------------------------------------------------------
# 6.2 - local re-projection
# --------------------------------------------------------------------------------------

# Below this many incidents the local embedding stops being worth showing.
#
# Chosen by measurement. Trustworthiness of a locally refitted t-SNE against the 20-D
# PCA space, at a FIXED k of 4 and averaged over 15 random subsets per size (mean, then
# standard deviation across those subsets):
#
#     n = 10  ->  0.817  +/- 0.055        n =  30  ->  0.937  +/- 0.023
#     n = 12  ->  0.814  +/- 0.049        n =  60  ->  0.960  +/- 0.011
#     n = 15  ->  0.899  +/- 0.045        n = 100  ->  0.970  +/- 0.008
#     n = 20  ->  0.921  +/- 0.033
#
# The mean turns early, between 12 and 15. The spread is what decides the threshold: at
# n=15 the same-sized subset can score anywhere from 0.79 to 0.96 depending on which
# points happen to fall in it, so a good-looking local layout there is as much luck as
# signal. The spread halves by n=25-30 and keeps falling. 30 is therefore where the
# result becomes REPRODUCIBLE, not where it becomes good.
#
# Both k and the number of repetitions matter, and getting them wrong is easy: an
# earlier version of this measurement used one subset per size and let k grow with n,
# which compares quantities that are not comparable and produced a different, wrong
# curve. The predecessor CIC-IDS2017 project used n >= perplexity, which is only
# sklearn's hard floor.
MIN_SUBSET = 30

# Perplexity is the effective neighbour count, so it cannot approach the sample size.
# (n-1)/3 is the standard ceiling; 30 matches the global embedding of phase 4, so a
# local layout of a large selection is directly comparable with it.
PERPLEXITY_CAP = 30.0
PERPLEXITY_FLOOR = 2.0

TSNE_SEED = 42          # same seed as the global embedding: a selection re-projects
TSNE_MAX_ITER = 800     # identically every time it is made


def adapted_perplexity(n):
    """Perplexity for a subset of size n, capped so it stays below the sample size."""
    return float(max(PERPLEXITY_FLOOR, min(PERPLEXITY_CAP, (n - 1) / 3.0)))


def local_reprojection(incident_ids):
    """Analytics 6.2 - refit t-SNE on the selected subset alone.

    Returns either a fresh 2-D layout of just those incidents, or an explicit refusal
    when the subset is too small. Refusing is the point: an embedding of twelve points
    looks exactly as confident as an embedding of twelve hundred, and the analyst has no
    way to tell them apart from the picture.
    """
    if not incident_ids:
        raise ValueError("local_reprojection requires a non-empty selection")

    from sklearn.manifold import TSNE, trustworthiness

    components = data.pca_components()
    subset = components[components["incident_id"].isin(incident_ids)]
    n = len(subset)

    if n < MIN_SUBSET:
        return {
            "ok": False,
            "reason": f"too small to project: {n} incidents, minimum {MIN_SUBSET}",
            "n": n, "minimum": MIN_SUBSET, "points": [],
            "perplexity": None, "trustworthiness": None,
        }

    features = subset.drop(columns=["incident_id"]).to_numpy()
    perplexity = adapted_perplexity(n)

    model = TSNE(n_components=2, perplexity=perplexity, max_iter=TSNE_MAX_ITER,
                 init="pca", random_state=TSNE_SEED)
    embedding = model.fit_transform(features)

    # Reported with the result rather than kept quiet: the analyst should be able to see
    # how faithful this particular local layout is, not just that one was produced.
    neighbours = int(max(1, min(10, n // 3)))
    score = float(trustworthiness(features, embedding, n_neighbors=neighbours))

    ids = subset["incident_id"].to_numpy()
    points = [{"incident_id": int(ids[i]),
               "x": round(float(embedding[i, 0]), 4),
               "y": round(float(embedding[i, 1]), 4)} for i in range(n)]

    return {
        "ok": True, "reason": "", "n": n, "minimum": MIN_SUBSET, "points": points,
        "perplexity": round(perplexity, 2),
        "trustworthiness": round(score, 4),
    }
