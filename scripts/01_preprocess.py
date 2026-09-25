"""
Phase 2 - Preprocessing.

Turns the four raw EuRepoC CSVs into the cached artifacts every later phase reads:

    data/processed/features_matrix.csv.gz    3,414 x 127   the projection input
    data/processed/feature_blocks.csv                      column -> readable label
    data/processed/incidents_meta.csv.gz     3,414 rows    year, intensity, attribution
    data/processed/incident_receiver.csv.gz  long          incident x country x sector
    data/processed/contingency_country_sector.csv.gz       country x sector counts
    data/processed/country_codes.csv                       country -> ISO alpha-2

This script only reshapes data. It computes none of the three analytics: per
CLAUDE.md sec.6 those may not run before a selection exists, and standardisation plus
PCA belong to phase 3.

Run:
    .venv/Scripts/python scripts/01_preprocess.py
"""

import re
from pathlib import Path

import numpy as np
import pandas as pd

from eurepoc_atoms import split_atoms

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"

SEP = ";"

# Values EuRepoC uses for "nothing here". Kept as explicit categories rather than
# dropped (CLAUDE.md sec.4): a missing attribution or an undocumented access vector is
# itself an analytical signal, not a hole to be patched.
NULLISH = {"not available", "none", "unknown", "not attributed", "no"}


# --------------------------------------------------------------------------------------
# column selection - fixed in phase 0, see docs/phase0_report.md sec.4
# --------------------------------------------------------------------------------------

# 14 categorical blocks -> 123 binary indicators. The prefixes are the ones the mockup
# shows on View D's bars ("access: Supply Chain Compromise").
ONEHOT_BLOCKS = {
    "incident_type": "type",
    "mitre_initial_access": "access",
    "mitre_impact": "impact",
    "functional_impact": "fimpact",
    "intelligence_impact": "iimpact",
    "cyber_conflict_issue": "issue",
    "offline_conflict_issue": "oissue",
    "il_breach_indicator": "ilaw",
    "initiator_category": "init",
    "state_responsibility_actor": "stateresp",
    "receiver_category": "target",
    "data_theft": "dtheft",
    "disruption": "disrupt",
    "hijacking": "hijack",
}

# 4 ordinal severity variables, kept numeric so their ordering survives.
ORDINAL_COLUMNS = [
    "weighted_intensity",
    "impact_indicator_score",
    "affected_entities_value",
    "affected_third_countries_value",
]

# affected_entities_value spans 0 to 1,000,000. log1p before anything else: on the raw
# scale a single mass-breach incident would dominate every distance in the projection.
# The same transform drives View B's point size, where CLAUDE.md sec.5 requires it on
# perceptual grounds - human observers estimate area ratios badly.
LOG_SCALED = {"affected_entities_value"}

EXPECTED_INCIDENTS = 3414
EXPECTED_ONEHOT = 123


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------

def rule(title):
    print("\n" + "=" * 86)
    print(title)
    print("=" * 86)


def slugify(prefix, atom):
    """Build a safe, stable column name from a block prefix and a category.

    EuRepoC categories contain spaces, commas, slashes and parenthesised explanations
    up to 120 characters long. Those make unusable CSV headers, so the matrix carries
    slugs and feature_blocks.csv carries the human-readable labels for View D.
    """
    slug = atom.lower()
    slug = re.sub(r"\(.*?\)", "", slug)          # drop parenthesised explanations
    slug = re.sub(r"[^a-z0-9]+", "_", slug)      # everything else becomes an underscore
    slug = re.sub(r"_+", "_", slug).strip("_")
    return f"{prefix}_{slug[:40]}"


def short_label(atom):
    """Readable label for View D's bars: drop the parenthetical, collapse whitespace."""
    label = re.sub(r"\(.*?\)", "", atom)
    label = re.sub(r"\s+", " ", label).strip(" -,;")
    return label or atom


# --------------------------------------------------------------------------------------
# feature matrix
# --------------------------------------------------------------------------------------

def build_feature_matrix(g):
    """Explode the 14 categorical blocks into binary indicators, append the 4 ordinals."""
    rule("1. FEATURE MATRIX")

    # Columns are collected first and concatenated once. Assigning 127 columns one by
    # one into a DataFrame re-allocates the block manager every time, which pandas
    # rightly warns about as fragmentation.
    columns = {"incident_id": g["incident_id"].to_numpy()}
    blocks_meta = []

    for column, prefix in ONEHOT_BLOCKS.items():
        exploded = g[column].apply(split_atoms)
        atoms = sorted({atom for row in exploded for atom in row})

        for atom in atoms:
            name = slugify(prefix, atom)
            # int8, not bool: phase 3 standardises these, and a numeric dtype keeps the
            # matrix homogeneous for scikit-learn without a conversion step.
            columns[name] = exploded.apply(
                lambda row, a=atom: 1 if a in row else 0).astype("int8").to_numpy()
            blocks_meta.append({
                "column": name,
                "block": prefix,
                "source_column": column,
                "atom": atom,
                "label": f"{prefix}: {short_label(atom)}",
                "is_nullish": atom.strip().lower() in NULLISH,
            })

        print(f"  {column:28s} -> {prefix + '_':11s} {len(atoms):3d} indicators")

    n_onehot = len(columns) - 1
    print(f"  {'':28s}    {'':11s} {'-' * 3}")
    print(f"  {'ONE-HOT SUBTOTAL':28s}    {'':11s} {n_onehot:3d}")

    for column in ORDINAL_COLUMNS:
        values = pd.to_numeric(g[column], errors="coerce").fillna(0)
        if column in LOG_SCALED:
            columns[column] = np.log1p(values).astype("float32").to_numpy()
            print(f"  {column:28s} -> ordinal, log1p  (max {values.max():,.0f} -> "
                  f"{np.log1p(values).max():.2f})")
        else:
            columns[column] = values.astype("float32").to_numpy()
            print(f"  {column:28s} -> ordinal         (range {values.min():.0f}-{values.max():.0f})")

    matrix = pd.DataFrame(columns)
    slugs = [c for c in matrix.columns if c != "incident_id"]
    if len(set(slugs)) != len(slugs):
        raise ValueError("slug collision: two categories produced the same column name")

    print(f"\n  matrix shape: {matrix.shape[0]} x {matrix.shape[1] - 1} "
          f"({n_onehot} binary + {len(ORDINAL_COLUMNS)} ordinal)")
    return matrix, pd.DataFrame(blocks_meta)


# --------------------------------------------------------------------------------------
# incident x country x sector
# --------------------------------------------------------------------------------------

def build_incident_receiver(g, receiver):
    """One row per (incident, targeted country, sector) - the base of View A's z-score.

    Two sources, because the normalised `receiver` table covers only 3,322 of the 3,414
    incidents (phase 0 sec.1):
      * primary   - the receiver table, whose country/category are already atomic
      * fallback  - global's semicolon-separated pair, zipped positionally

    The fallback is not a guess: phase 0 checked 300 incidents present in both sources
    and the reconstructed (country, sector) pairs matched the normalised table exactly,
    with country and category always the same length.
    """
    rule("2. INCIDENT x COUNTRY x SECTOR")

    primary = (
        receiver[["incident_id", "country", "category"]]
        .rename(columns={"category": "sector"})
        .assign(source="receiver_table")
    )
    print(f"  from receiver table : {len(primary):6d} rows, "
          f"{primary.incident_id.nunique()} incidents")

    missing_ids = set(g["incident_id"]) - set(receiver["incident_id"])
    rows = []
    for _, row in g[g["incident_id"].isin(missing_ids)].iterrows():
        countries = [p.strip() for p in str(row["receiver_country"]).split(SEP)]
        sectors = [p.strip() for p in str(row["receiver_category"]).split(SEP)]
        if len(countries) != len(sectors):
            # Never observed in phase 0; fail loudly rather than mis-pair silently.
            raise ValueError(f"incident {row['incident_id']}: country/sector length mismatch")
        for country, sector in set(zip(countries, sectors)):
            rows.append({"incident_id": row["incident_id"], "country": country,
                         "sector": sector, "source": "global_fallback"})

    fallback = pd.DataFrame(rows)
    print(f"  from global fallback: {len(fallback):6d} rows, "
          f"{fallback.incident_id.nunique()} incidents")

    long = pd.concat([primary, fallback], ignore_index=True)
    long["country"] = long["country"].fillna("Not available").astype(str).str.strip()
    long["sector"] = long["sector"].fillna("Not available").astype(str).str.strip()

    covered = long.incident_id.nunique()
    print(f"\n  combined: {len(long)} rows covering {covered}/{len(g)} incidents "
          f"({covered / len(g):.1%})")
    print(f"  distinct countries: {long.country.nunique()} · "
          f"distinct sectors: {long.sector.nunique()}")
    return long


def attach_country_codes(long, g):
    """Resolve each targeted country to an ISO 3166-1 alpha-2 code for View A.

    The codes are not guessed from the names: EuRepoC ships
    `receiver_country_alpha_2_code` alongside `receiver_country`, positionally aligned
    on every single row (verified: 100%). So the mapping is read out of the release
    itself rather than reconstructed by string matching, which would have had to guess
    at entries like "Korea, Republic of" or "Taiwan, Province of China".

    Codes that are not two ASCII letters are EuRepoC's own pseudo-codes for supranational
    entities - EUROPE, NATO, MENA, ASIA and 17 others. Those are left unmapped on
    purpose: they are real analytical values, but a choropleth cannot paint them.
    """
    rule("2b. COUNTRY CODES")

    name_to_code = {}
    paired = g[["receiver_country", "receiver_country_alpha_2_code"]].dropna()
    for _, row in paired.iterrows():
        names = [p.strip() for p in str(row["receiver_country"]).split(SEP)]
        codes = [p.strip() for p in str(row["receiver_country_alpha_2_code"]).split(SEP)]
        if len(names) != len(codes):
            raise ValueError("country name/code length mismatch in the raw data")
        for name, code in zip(names, codes):
            if name not in name_to_code and len(code) == 2 and code.isalpha():
                name_to_code[name] = code.upper()

    long = long.copy()
    long["country_code"] = long["country"].map(name_to_code)

    mapped = int(long["country_code"].notna().sum())
    print(f"  names resolved to an ISO code: {len(name_to_code)}")
    print(f"  observations mappable        : {mapped}/{len(long)} ({mapped / len(long):.1%})")
    print(f"  distinct countries on the map: {long['country_code'].nunique()}")

    unmapped = long.loc[long["country_code"].isna(), "country"].value_counts()
    print(f"\n  not paintable ({len(long) - mapped} observations, "
          f"{unmapped.size} distinct values) - top 5:")
    for name, n in unmapped.head(5).items():
        print(f"    {n:5d}  {name}")

    # Incidents whose every target is a region or an organisation can never be reached by
    # clicking the map. Phase 11 needs to know: map selection is not exhaustive.
    orphan = long.groupby("incident_id")["country_code"].apply(lambda s: s.isna().all()).sum()
    print(f"\n  incidents with NO paintable location: {orphan} of "
          f"{long.incident_id.nunique()} - unreachable by map click, by construction")

    # Namibia's ISO code is literally "NA", which pandas reads back as a missing value
    # unless the reader disables its default NaN strings. Caught by noticing the country
    # count drop from 168 to 167 between writing and re-reading. Anything that reads
    # these artifacts must pass keep_default_na=False - see backend/app/data.py.
    dangerous = sorted({c for c in name_to_code.values()
                        if pd.isna(pd.read_csv(pd.io.common.StringIO(f"x\n{c}\n")).iloc[0, 0])})
    if dangerous:
        print(f"\n  WARNING: codes pandas reads as NaN by default: {dangerous}")
        print("  readers must use keep_default_na=False, na_values=[''] on these files.")

    codes = (pd.DataFrame({"country": list(name_to_code), "code": list(name_to_code.values())})
             .sort_values("country").reset_index(drop=True))
    return long, codes


def build_contingency(long):
    """Country x sector counts - the observed table analytics 6.1 standardises.

    Stored for convenience and inspection. The live view recomputes this from the long
    table on the current selection, since sec.6.1 requires the z-score to reflect the
    map clicks and the time brush rather than a precomputed global state.
    """
    rule("3. CONTINGENCY TABLE (country x sector)")
    table = pd.crosstab(long["country"], long["sector"])
    print(f"  shape: {table.shape[0]} countries x {table.shape[1]} sectors")
    print(f"  total observations: {table.to_numpy().sum():,}")

    # Phase 12 will badge cells whose expected frequency is < 5 as unreliable rather
    # than hiding them; this is an early look at how many that will be.
    total = table.to_numpy().sum()
    expected = np.outer(table.sum(axis=1), table.sum(axis=0)) / total
    small = int((expected < 5).sum())
    print(f"  cells with expected frequency < 5: {small:,} of {expected.size:,} "
          f"({small / expected.size:.1%}) -> will carry a 'small sample' badge")

    print("\n  top 8 targeted countries:")
    for country, n in table.sum(axis=1).nlargest(8).items():
        print(f"    {n:6d}  {country}")
    return table


# --------------------------------------------------------------------------------------
# per-incident metadata
# --------------------------------------------------------------------------------------

def build_incidents_meta(g):
    """Per-incident attributes the views need outside the feature matrix.

    Year drives View C and the time brush; weighted_intensity and affected_entities
    drive View B's colour and size; not_attributed drives View A's second layer.
    """
    rule("4. INCIDENT METADATA")

    # EuRepoC writes dates as DD.MM.YYYY, and "Not available" for the 92 incomplete
    # records. dayfirst avoids reading 01.06.2024 as the 6th of January.
    start = pd.to_datetime(g["start_date"], errors="coerce", format="mixed", dayfirst=True)

    # Non-attribution as decided on 2026-08-22: no named initiator state. NOT the
    # proposal's 48.7%, which measured whether a source URL existed. See
    # docs/phase0_report.md sec.7.
    initiator = g["initiator_country"].fillna("").astype(str)
    not_attributed = initiator.apply(
        lambda v: any(p.strip() in ("Not attributed", "Unknown") for p in v.split(SEP))
    )

    meta = pd.DataFrame({
        "incident_id": g["incident_id"],
        "name": g["name"],
        "year": start.dt.year.astype("Int16"),
        "start_date": start.dt.strftime("%Y-%m-%d"),
        "weighted_intensity": pd.to_numeric(g["weighted_intensity"], errors="coerce"),
        "affected_entities_value": pd.to_numeric(g["affected_entities_value"], errors="coerce"),
        "initiator_country": g["initiator_country"],
        "not_attributed": not_attributed.astype("int8"),
    })

    dated = meta["year"].notna().sum()
    print(f"  incidents with a parseable year: {dated}/{len(meta)} "
          f"({dated / len(meta):.1%})")
    print(f"  year range: {int(meta['year'].min())}-{int(meta['year'].max())}")
    print(f"  not attributed: {meta.not_attributed.sum()} = "
          f"{meta.not_attributed.mean():.2%}  (phase-0 decision: 51.87%)")
    print(f"\n  NOTE: the {len(meta) - dated} incidents without a date are the same ones "
          f"absent from the\n  receiver and attribution tables. They carry full analytical "
          f"columns and stay in the\n  matrix, but View C and the time brush cannot show them.")
    return meta


# --------------------------------------------------------------------------------------
# verification
# --------------------------------------------------------------------------------------

def verify(matrix, blocks, long, meta, g):
    """Fail loudly if any phase-0 invariant broke."""
    rule("5. VERIFICATION")
    checks = []

    def check(label, ok, detail=""):
        checks.append(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")

    n_onehot = int((blocks.shape[0]))
    check("3,414 incidents preserved", len(matrix) == EXPECTED_INCIDENTS,
          f"got {len(matrix)}")
    check("123 one-hot indicators", n_onehot == EXPECTED_ONEHOT, f"got {n_onehot}")
    check("matrix width 127", matrix.shape[1] - 1 == EXPECTED_ONEHOT + len(ORDINAL_COLUMNS),
          f"got {matrix.shape[1] - 1}")
    check("incident_id unique", matrix.incident_id.is_unique)
    check("incident_id matches global", set(matrix.incident_id) == set(g.incident_id))

    indicators = matrix[[c for c in blocks["column"]]]
    check("all indicators strictly binary",
          bool(indicators.isin([0, 1]).all().all()),
          f"max value {indicators.to_numpy().max()}")
    check("no nulls anywhere in the matrix", not bool(matrix.isna().any().any()))

    # Every incident must light up at least one indicator per block, otherwise a block
    # silently lost a row - "Not available" is a category, so a row can never be all-zero.
    for prefix in sorted(blocks["block"].unique()):
        cols = blocks.loc[blocks["block"] == prefix, "column"]
        empty = int((matrix[cols].sum(axis=1) == 0).sum())
        check(f"block '{prefix}' covers every incident", empty == 0,
              f"{empty} rows all-zero")

    check("receiver mapping covers every incident",
          long.incident_id.nunique() == EXPECTED_INCIDENTS,
          f"{long.incident_id.nunique()} covered")
    check("metadata rows match matrix rows", len(meta) == len(matrix))

    print(f"\n  {sum(checks)}/{len(checks)} checks passed")
    if not all(checks):
        raise SystemExit("verification failed - artifacts NOT written")


# --------------------------------------------------------------------------------------

def build_initiator_counts(attribution):
    """How many incidents each state is named as the initiator of, by ISO alpha-2.

    Taken from the attribution table's `initiator_alpha_2` rather than the global
    table's free-text `initiator_country`: the latter is a comma-joined list of names
    that themselves contain commas ("Iran, Islamic Republic of"), so splitting it would
    be guesswork. Values that are not two-letter codes - "Unknown", "Not attributed" -
    drop out, and an incident attributed to the same state several times counts once.
    """
    rule("5. INITIATOR COUNTS")
    frame = attribution[["incident_id", "initiator_alpha_2"]]
    frame = frame[frame["initiator_alpha_2"].str.len() == 2].drop_duplicates()
    counts = (frame["initiator_alpha_2"].value_counts()
              .rename_axis("code").reset_index(name="initiated"))
    print(f"  {len(counts)} states named as initiator; "
          f"top: {', '.join(f'{r.code} {r.initiated}' for r in counts.head(4).itertuples())}")
    return counts


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    g = pd.read_csv(RAW / "eurepoc_global_dataset_1_3.csv", low_memory=False)
    receiver = pd.read_csv(RAW / "eurepoc_receiver_dataset_1.3.csv", low_memory=False)
    attribution = pd.read_csv(RAW / "eurepoc_attribution_dataset_1.3.csv",
                              usecols=["incident_id", "initiator_alpha_2"],
                              keep_default_na=False, na_values=[""])

    matrix, blocks = build_feature_matrix(g)
    long = build_incident_receiver(g, receiver)
    long, country_codes = attach_country_codes(long, g)
    contingency = build_contingency(long)
    meta = build_incidents_meta(g)
    initiators = build_initiator_counts(attribution)

    verify(matrix, blocks, long, meta, g)

    rule("6. ARTIFACTS WRITTEN")
    artifacts = [
        ("features_matrix.csv.gz", matrix, True),
        ("feature_blocks.csv", blocks, False),
        ("incidents_meta.csv.gz", meta, True),
        ("incident_receiver.csv.gz", long, True),
        ("contingency_country_sector.csv.gz", contingency, True),
        ("country_codes.csv", country_codes, False),
        ("initiator_counts.csv", initiators, False),
    ]
    for filename, frame, compress in artifacts:
        path = OUT / filename
        frame.to_csv(path, index=filename.startswith("contingency"),
                     compression="gzip" if compress else None)
        print(f"  {filename:36s} {path.stat().st_size / 1024:8.1f} KB  "
              f"{frame.shape[0]:6d} x {frame.shape[1]}")

    rule(f"PHASE 2 COMPLETE - matrix {matrix.shape[0]} x {matrix.shape[1] - 1}, "
         f"AS index unchanged at {EXPECTED_INCIDENTS * 18:,}")


if __name__ == "__main__":
    main()
