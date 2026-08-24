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


# --------------------------------------------------------------------------------------
# 6.3 - contrastive z-scores
# --------------------------------------------------------------------------------------

# A two-proportion z-test needs enough expected successes AND failures in both groups
# for the normal approximation to hold. The conventional rule is n*p >= 5 and
# n*(1-p) >= 5 on each side; features that fail it are returned with a flag rather than
# dropped, the same treatment 6.1 gives a thin contingency cell.
MIN_GROUP = 20          # below this a group is too small to contrast at all
MIN_SUCCESSES = 5.0


def contrastive_z(selection_ids, comparison_ids=None):
    """Analytics 6.3 - which features separate the selection from its comparison.

    For every one of the 123 indicators, the proportion carrying it in group A is
    compared with the proportion in group B using the standard two-proportion z-test:

        p_pool = (x_a + x_b) / (n_a + n_b)
        se     = sqrt(p_pool * (1 - p_pool) * (1/n_a + 1/n_b))
        z      = (p_a - p_b) / se

    Pooling the variance is what makes this safe across groups of wildly different size,
    which is the normal case here - one country against the rest of the corpus is 81
    against 3,333. The z already carries the sample sizes, so a large difference over
    few incidents lands with a small z and sinks in the ranking. That separation is the
    panel's whole purpose: `difference` drives bar length, `z` drives the order.

    comparison_ids is the direct A-vs-B mode (sec.6.3, two countries selected). Left
    None, group B is the complement of the selection - the vs-rest mode.
    """
    if not selection_ids:
        raise ValueError("contrastive_z requires a non-empty selection")

    matrix = data.feature_matrix()
    blocks = data.feature_blocks()
    columns = list(blocks["column"])

    group_a = matrix[matrix["incident_id"].isin(selection_ids)]
    if comparison_ids is None:
        group_b = matrix[~matrix["incident_id"].isin(selection_ids)]
        mode = "vs-rest"
    else:
        group_b = matrix[matrix["incident_id"].isin(comparison_ids)]
        mode = "a-vs-b"

    n_a, n_b = len(group_a), len(group_b)
    if n_a < MIN_GROUP or n_b < MIN_GROUP:
        return {
            "ok": False,
            "reason": f"groups too small to contrast: {n_a} vs {n_b}, minimum {MIN_GROUP}",
            "mode": mode, "n_a": n_a, "n_b": n_b, "features": [],
        }

    counts_a = group_a[columns].sum()
    counts_b = group_b[columns].sum()
    labels = dict(zip(blocks["column"], blocks["label"]))
    nullish = dict(zip(blocks["column"], blocks["is_nullish"]))

    features = []
    for column in columns:
        x_a, x_b = float(counts_a[column]), float(counts_b[column])
        p_a, p_b = x_a / n_a, x_b / n_b
        pooled = (x_a + x_b) / (n_a + n_b)

        se = np.sqrt(pooled * (1 - pooled) * (1 / n_a + 1 / n_b))
        if se == 0:
            continue          # the feature is constant across both groups: no contrast

        # Reliability on the same footing as 6.1: enough expected successes and
        # failures on both sides for the normal approximation to mean anything.
        expected = [n_a * pooled, n_a * (1 - pooled), n_b * pooled, n_b * (1 - pooled)]
        features.append({
            "column": column,
            "label": labels.get(column, column),
            "difference": round(p_a - p_b, 5),
            "z": round(float((p_a - p_b) / se), 3),
            "n_selection": int(x_a),
            "n_comparison": int(x_b),
            "reliable": bool(min(expected) >= MIN_SUCCESSES),
            "is_nullish": bool(nullish.get(column, False)),
        })

    # Reliable features rank first, then by |z| within each group.
    #
    # Sorting on |z| alone put "impact: Endpoint Denial of Service" at the top of an
    # Italy contrast on a 2.3pp difference that fails the validity test, ahead of
    # "target: Critical infrastructure" at 21.7pp. A z computed where the normal
    # approximation does not hold is not a stronger finding than one where it does - it
    # is a number that should not be read as a z at all. The unreliable features are
    # still returned and still shown, flagged, as sec.6.1 requires: marked, not
    # suppressed. They simply do not get to occupy the positions the eye reads first.
    features.sort(key=lambda f: (not f["reliable"], -abs(f["z"])))

    reliable = [f for f in features if f["reliable"]]
    return {
        "ok": True, "reason": "", "mode": mode,
        "n_a": n_a, "n_b": n_b, "features": features,
        "n_reliable": len(reliable),
        "n_features": len(features),
    }
