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
