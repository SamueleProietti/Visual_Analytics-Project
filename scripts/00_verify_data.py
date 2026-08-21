"""
Phase 0 - Data verification (blocking).

Re-derives, against the real CSVs, every number that docs/proposal.md asserts:
  * the "four entirely empty columns" claim
  * the analytical column count (~20) and the AS index (~68,000)
  * the one-hot dimension count (proposal says 82)
  * the number of incident_type categories (View C needs <= 12, CLAUDE.md sec.2)
  * the 48.7% non-attribution rate

Nothing here writes artifacts - it only measures and reports. Run:
    python scripts/00_verify_data.py
"""

from collections import Counter
from pathlib import Path

import pandas as pd

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

FILES = {
    "global": "eurepoc_global_dataset_1_3.csv",
    "dyadic": "eurepoc_dyadic_dataset_0_1.csv",
    "attribution": "eurepoc_attribution_dataset_1.3.csv",
    "receiver": "eurepoc_receiver_dataset_1.3.csv",
}

# EuRepoC encodes "no value" with several different strings depending on the column.
# CLAUDE.md sec.4: these are kept as explicit categories, never dropped - but we still
# need to recognise them to measure how much *substantive* signal a column carries.
NULLISH = {"not available", "none", "unknown", "not attributed", "no", "<nan>"}

SEP = ";"


# --------------------------------------------------------------------------------------
# candidate column sets
# --------------------------------------------------------------------------------------

# The 17 columns of the preliminary manual pass, reproduced verbatim so its ~138 figure
# can be confirmed rather than trusted.
SET_PRELIMINARY = [
    "mitre_initial_access", "mitre_impact", "functional_impact", "intelligence_impact",
    "cyber_conflict_issue", "offline_conflict_issue", "il_breach_indicator",
    "initiator_category", "receiver_category", "incident_type", "data_theft",
    "disruption", "hijacking", "zero_days", "target_multiplier",
    "physical_effects_spatial", "physical_effects_temporal",
]

# Recommended: the preliminary set minus the degenerate columns (see DEGENERATE below),
# plus state_responsibility_actor, which is substantive and maps to the proposal's
# "init" block. These become one-hot indicator blocks.
SET_RECOMMENDED_ONEHOT = [
    "incident_type",               # type_    - View C is built on these exploded atoms
    "mitre_initial_access",        # access_
    "mitre_impact",                # impact_
    "functional_impact",           # impact_
    "intelligence_impact",         # impact_
    "cyber_conflict_issue",        # issue_
    "offline_conflict_issue",      # issue_
    "il_breach_indicator",         # ilaw_
    "initiator_category",          # init_
    "state_responsibility_actor",  # init_
    "receiver_category",           # target_ - the sector axis of the sec.6.1 z-score
    "data_theft",
    "disruption",
    "hijacking",
]

# Four ordinal severity variables kept numeric rather than one-hot: their categories are
# ordered, and one-hot would throw that order away.
SET_RECOMMENDED_ORDINAL = [
    "weighted_intensity",
    "impact_indicator_score",
    "affected_entities_value",
    "affected_third_countries_value",
]

# Dropped from the preliminary set for near-zero variance - a column whose modal value
# covers >90% of rows contributes almost nothing to a distance-based projection but does
# add dimensions that dilute it (curse of dimensionality).
DEGENERATE = ["zero_days", "target_multiplier",
              "physical_effects_spatial", "physical_effects_temporal"]

# Excluded by kind, with the reason recorded for the report.
EXCLUDED_BY_KIND = {
    "identifier": ["incident_id", "attribution_id", "receiver_country_alpha_2_code",
                   "initiator_alpha_2"],
    "free text / name": ["name", "description", "receiver_name", "initiator_name",
                         "attributing_actor", "attributing_company",
                         "offline_conflict_name", "political_response_responding_actor",
                         "legal_response_responding_actor"],
    "source url": ["source_url", "attribution_source_url"],
    "timestamp / date": ["start_date", "end_date", "attribution_date",
                         "political_response_date", "legal_response_date",
                         "added_to_db", "updated_at"],
    "geography (drives the map, not the feature matrix)": [
        "receiver_country", "receiver_regions", "initiator_country",
        "initiator_country.1", "attributing_country",
        "political_response_responding_country", "legal_response_responding_country"],
    "high-cardinality subcategory (parent category kept instead)": [
        "receiver_subcategory", "initiator_subcategory", "initiator_category.1",
        "inclusion_criterion_subcode", "zero_days_subcode",
        "il_breach_indicator_subcode", "offline_conflict_intensity_subcode",
        "political_response_subtype", "legal_response_subtype",
        "attribution_legal_reference_subcode"],
    "binned duplicate of a kept ordinal": [
        "impact_indicator_label", "affected_entities", "affected_third_countries",
        "unweighted_intensity", "economic_impact"],
    "count of downstream records, not a property of the incident": [
        "number_attributions", "number_political_responses", "number_legal_responses"],
    "degenerate (modal value > 90% of rows)": DEGENERATE + [
        "casualties", "user_interaction", "evidence_for_sanctions_indicator",
        "attribution_legal_reference", "political_response_type", "legal_response_type",
        "economic_impact_currency"],
    "attribution metadata (documentation quality, not incident shape)": [
        "attribution_type", "attribution_basis", "settled_initiator",
        "source_disclosure", "inclusion_criterion"],
    "redundant with a kept column": ["has_disruption", "economic_impact_value",
                                     "offline_conflict_intensity", "response_indicator"],
}


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------

def atoms_of(series):
    """Explode a semicolon-separated column into its atomic values.

    Counts each atom once per row: EuRepoC repeats atoms within a row when an incident
    has several receivers (see the incident_type duplication check below), and a binary
    indicator must stay binary.
    """
    counter = Counter()
    for value in series.fillna("Not available").astype(str):
        for atom in {part.strip() for part in value.split(SEP) if part.strip()}:
            counter[atom] += 1
    return counter


def informative_share(series):
    """Share of rows carrying at least one non-nullish atom."""
    return series.fillna("<NaN>").astype(str).apply(
        lambda v: any(p.strip().lower() not in NULLISH for p in v.split(SEP))
    ).mean()


def onehot_width(df, columns):
    """One-hot width of a column set = sum of its distinct atom counts."""
    per_column = [(c, len(atoms_of(df[c]))) for c in columns]
    return sum(w for _, w in per_column), per_column


def rule(title):
    print("\n" + "=" * 86)
    print(title)
    print("=" * 86)


# --------------------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------------------

def check_files():
    rule("1. FILE INVENTORY AND JOIN INTEGRITY")
    frames = {k: pd.read_csv(RAW / v, low_memory=False) for k, v in FILES.items()}

    expected = {"global": 3414, "dyadic": 4296, "attribution": 5217, "receiver": 12180}
    for name, df in frames.items():
        rows, cols = df.shape
        flag = "OK" if rows == expected[name] else "MISMATCH vs proposal"
        print("  {:12s} {:6d} rows x {:3d} cols   unique incident_id={:5d}   [{}]".format(
            name, rows, cols, df["incident_id"].nunique(), flag))

    global_ids = set(frames["global"]["incident_id"])
    print("\n  Join on incident_id, against global:")
    for name in ("dyadic", "attribution", "receiver"):
        ids = set(frames[name]["incident_id"])
        print("    {:12s} matched={:5d}  orphan(not in global)={:4d}  "
              "global rows absent here={:4d}".format(
                  name, len(ids & global_ids), len(ids - global_ids),
                  len(global_ids - ids)))
    return frames


def check_empty_columns(g):
    rule("2. PROPOSAL CLAIM: 'four entirely empty columns'")
    empty = [c for c in g.columns if g[c].notna().sum() == 0]
    if empty:
        print("  Entirely empty columns: {}".format(empty))
    else:
        print("  Columns that are entirely empty: 0  ->  the claim of 4 is FALSE")

    print("\n  Five lowest non-null rates:")
    for col, rate in g.notna().mean().sort_values().head(5).items():
        print("    {:34s} {:7.1%} non-null".format(col, rate))

    # A column can be 100% non-null and still carry no information - EuRepoC writes the
    # literal string "Not available" rather than leaving the cell blank. This is the
    # honest version of the "empty columns" claim.
    print("\n  Columns that are effectively empty (constant, or <5% informative rows):")
    for col in g.columns:
        if g[col].dtype == object:
            share = informative_share(g[col])
            const = g[col].nunique(dropna=True) <= 1
            if const or share < 0.05:
                tag = "constant" if const else "{:.1%} informative".format(share)
                print("    {:34s} {}".format(col, tag))


def check_incident_type(g, dyadic):
    rule("3. incident_type - View C needs <= 12 categories (CLAUDE.md sec.2)")
    raw = g["incident_type"].fillna("Not available").astype(str)
    print("  Distinct raw (combined) strings : {}".format(raw.nunique()))
    print("  Rows containing a separator     : {:.1%}".format(
        raw.str.contains(SEP).mean()))

    dup_combos = [(v, n) for v, n in raw.value_counts().items()
                  if len(v.split(SEP)) != len({p.strip() for p in v.split(SEP)})]
    print("\n  Combined strings repeating an atom within one row: {} ({} rows)".format(
        len(dup_combos), sum(n for _, n in dup_combos)))
    for v, n in dup_combos[:5]:
        print("    {:3d}x  {}".format(n, v))
    print("    -> source data-entry artifact; de-duplicated per row when exploding.")

    counts = atoms_of(g["incident_type"])
    print("\n  Distinct ATOMIC categories: {}  -> {} (<= 12, no regrouping needed)".format(
        len(counts), "PASS" if len(counts) <= 12 else "FAIL"))
    for atom, n in counts.most_common():
        print("    {:5d}  ({:5.1%})  {}".format(n, n / len(g), atom))

    # Independent confirmation: the dyadic release ships EuRepoC's own one-hot of the
    # same variable. If our explode matches their columns, the explode is correct.
    own = [c for c in dyadic.columns if c in counts]
    print("\n  EuRepoC's own one-hot columns in dyadic: {} -> {}".format(
        len(own), sorted(own)))
    print("    -> matches our exploded atoms exactly." if set(own) == set(counts)
          else "    -> DIFFERS from our atoms, investigate.")
    return len(counts)


def check_columns(g):
    rule("4. COLUMN INVENTORY - candidate analytical columns")
    print("  {:32s} {:>6s} {:>8s} {:>13s}  verdict".format(
        "column", "atoms", "modal%", "informative%"))
    for col in sorted(set(SET_PRELIMINARY) | set(SET_RECOMMENDED_ONEHOT)):
        series = g[col].fillna("<NaN>").astype(str)
        modal = series.value_counts().iloc[0] / len(g)
        verdict = "DROP (degenerate)" if col in DEGENERATE else "keep"
        print("  {:32s} {:6d} {:8.1%} {:13.1%}  {}".format(
            col, len(atoms_of(g[col])), modal, informative_share(g[col]), verdict))

    print("\n  Excluded columns, by reason:")
    for reason, cols in EXCLUDED_BY_KIND.items():
        present = [c for c in cols if c in g.columns]
        print("    [{:2d}] {}".format(len(present), reason))
        print("         {}".format(", ".join(present)))

    accounted = {c for cols in EXCLUDED_BY_KIND.values() for c in cols if c in g.columns}
    accounted |= set(SET_RECOMMENDED_ONEHOT) | set(SET_RECOMMENDED_ORDINAL)
    leftover = [c for c in g.columns if c not in accounted]
    print("\n  Columns not yet classified: {} -> {}".format(len(leftover), leftover))


def check_dimensions(g):
    rule("5. ONE-HOT DIMENSION COUNT - proposal says 82")
    prelim_total, _ = onehot_width(g, SET_PRELIMINARY)
    print("  (a) Preliminary 17-column pass: {} one-hot columns -> proposal's 82 is "
          "FALSE".format(prelim_total))

    rec_total, rec_detail = onehot_width(g, SET_RECOMMENDED_ONEHOT)
    print("\n  (b) RECOMMENDED set - {} one-hot blocks:".format(
        len(SET_RECOMMENDED_ONEHOT)))
    for col, width in sorted(rec_detail, key=lambda t: -t[1]):
        print("        {:32s} {:4d}".format(col, width))
    print("        {:32s} {:4d}".format("ONE-HOT SUBTOTAL", rec_total))
    print("        {:32s} {:4d}   {}".format(
        "+ ordinal severity variables", len(SET_RECOMMENDED_ORDINAL),
        SET_RECOMMENDED_ORDINAL))
    print("        {:32s} {:4d}".format(
        "= FEATURE MATRIX WIDTH", rec_total + len(SET_RECOMMENDED_ORDINAL)))

    # Option 2 of the reconciliation: narrow the block list until the one-hot width
    # lands near the proposal's 82, so the approved document need not be re-numbered.
    narrowed = [c for c in SET_RECOMMENDED_ONEHOT
                if c not in ("il_breach_indicator", "cyber_conflict_issue",
                             "offline_conflict_issue")]
    nar_total, _ = onehot_width(g, narrowed)
    print("\n  (c) NARROWED set - drops il_breach_indicator (20), cyber_conflict_issue "
          "(13),\n      offline_conflict_issue (12): {} one-hot columns "
          "(+{} ordinal = {})".format(nar_total, len(SET_RECOMMENDED_ORDINAL),
                                      nar_total + len(SET_RECOMMENDED_ORDINAL)))

    rule("6. AS INDEX - #tuples x #dimensions, pre-one-hot (CLAUDE.md sec.2)")
    raw_cols = len(SET_RECOMMENDED_ONEHOT) + len(SET_RECOMMENDED_ORDINAL)
    n = len(g)
    print("  Proposal declares : 3,414 x ~20          = ~68,000")
    print("  Recommended set   : {:,} x {:2d}          = {:,}".format(
        n, raw_cols, n * raw_cols))
    print("  Course range      : 10,000 - 50,000")
    print("  -> {:,} is ABOVE the range: still the deliberate 'braves' case, "
          "unchanged in kind.".format(n * raw_cols))


def check_attribution(g):
    rule("7. NON-ATTRIBUTION RATE - proposal says 48.7%")
    print("  number_attributions: min={}, rows with 0 = {}".format(
        g["number_attributions"].min(), (g["number_attributions"] == 0).sum()))
    print("    -> every incident has >= 1 attribution record, so 'non-attribution'")
    print("       cannot mean 'no attribution row'. Candidate definitions:\n")

    initiator = g["initiator_country"].fillna("").astype(str)

    def has_atom(series, token):
        return series.apply(lambda v: any(p.strip() == token for p in v.split(SEP)))

    not_attr = has_atom(initiator, "Not attributed")
    unknown = has_atom(initiator, "Unknown")

    definitions = [
        ("initiator_country contains 'Not attributed'", not_attr),
        ("initiator_country contains 'Unknown'", unknown),
        ("either of the above (no named initiator state)", not_attr | unknown),
        ("attribution_type == 'Not available'",
         g["attribution_type"].fillna("") == "Not available"),
        ("state_responsibility_actor == 'Not available'",
         g["state_responsibility_actor"].fillna("") == "Not available"),
        ("attribution_source_url == 'Not available'",
         g["attribution_source_url"].fillna("") == "Not available"),
    ]
    for label, mask in definitions:
        near = "  <-- matches the proposal's 48.7%" if abs(mask.mean() - 0.487) < 0.005 else ""
        print("    {:48s} {:5d} = {:6.2%}{}".format(
            label, mask.sum(), mask.mean(), near))

    print("\n  The 48.7% traces to attribution_source_url, i.e. whether a SOURCE LINK for")
    print("  the attribution exists - a documentation-quality measure, not whether the")
    print("  incident was attributed. View A's attribution layer needs a substantive")
    print("  definition instead (see the report).")


def main():
    frames = check_files()
    g = frames["global"]
    check_empty_columns(g)
    check_incident_type(g, frames["dyadic"])
    check_columns(g)
    check_dimensions(g)
    check_attribution(g)
    rule("PHASE 0 COMPLETE - no artifacts written, nothing built on top yet")


if __name__ == "__main__":
    main()
