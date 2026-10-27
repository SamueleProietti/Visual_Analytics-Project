"""On-demand analytics. Nothing here runs without a selection.

Both analytics live here: the standardized deviation and the contrastive z-scores. Every
entry point takes an explicit set of incident ids and refuses an empty one, so the rule
that no computation runs before a selection exists is enforced at the layer that does the
computing, not only in the interface that calls it.

The projection computes nothing on demand. Its two global embeddings are built offline by
scripts/03 and scripts/08; a lasso selects incidents, and the other views answer that
selection. That is all the gesture does.

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
expected frequencies are flagged, marked rather than hidden.
"""

import numpy as np
import pandas as pd

from . import data

# Cochran's conventional threshold for a chi-square cell. Below it the normal
# approximation behind the z-score stops holding, so the number is still computed and
# returned but marked unreliable rather than hidden.
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

    which is the standardized deviation applied to the country
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
    the sector mix of the whole corpus. This is the country x sector table of the standardized deviation,
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
# Contrastive z-scores
# --------------------------------------------------------------------------------------

# A two-proportion z-test needs enough expected successes AND failures in both groups
# for the normal approximation to hold. The conventional rule is n*p >= 5 and
# n*(1-p) >= 5 on each side; features that fail it are returned with a flag rather than
# dropped, the same treatment the standardized deviation gives a thin cell.
MIN_GROUP = 20          # below this a group is too small to contrast at all
MIN_SUCCESSES = 5.0


def contrastive_z(selection_ids, comparison_ids=None):
    """Contrastive z-scores - which features separate the selection from its comparison.

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

    comparison_ids is the direct A-vs-B mode (two countries selected). Left
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
    too_small = n_a < MIN_GROUP or n_b < MIN_GROUP
    reason = (f"groups too small to contrast: {n_a} vs {n_b}, minimum {MIN_GROUP}"
              if too_small else "")
    if n_a == 0 or n_b == 0:
        return {
            "ok": False, "reason": reason,
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

        # Reliability on the same footing as the standardized deviation: enough
        # expected successes and failures on both sides for the normal
        # approximation to mean anything.
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
    # still returned and still shown, flagged: marked, not
    # suppressed. They simply do not get to occupy the positions the eye reads first.
    features.sort(key=lambda f: (not f["reliable"], -abs(f["z"])))

    # Below MIN_GROUP the contrast is still refused - ok is False and the reason says
    # why - but the counts travel with the refusal. View D draws them as raw rates on
    # its fixed indicators, which is a description of a small group and not a test on
    # it; nothing may read these z as findings.
    reliable = [f for f in features if f["reliable"]]
    return {
        "ok": not too_small, "reason": reason, "mode": mode,
        "n_a": n_a, "n_b": n_b, "features": features,
        "n_reliable": len(reliable),
        "n_features": len(features),
    }
