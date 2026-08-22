"""
Inspection tool for the cached artifacts in data/processed/.

The preprocessing script checks its own invariants, which is necessary but not
sufficient: in phase 2 all 23 checks passed while the disruption block carried two
phantom indicators, because phantom columns are just as binary and just as complete as
real ones. The bug surfaced only by decoding an incident back into readable labels and
reading them. This tool exists to make that kind of looking easy.

Usage:
    python scripts/inspect_data.py                    overview of every artifact
    python scripts/inspect_data.py --incident 1       decode one incident to labels
    python scripts/inspect_data.py --block disrupt    every indicator in one block
    python scripts/inspect_data.py --country Italy    one country's sector profile
    python scripts/inspect_data.py --pca              explained variance, PC1/PC2 extremes
    python scripts/inspect_data.py --audit            recompute from raw CSVs and compare
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


def load():
    """Load every artifact, with a clear message if preprocessing has not been run."""
    needed = ["features_matrix.csv.gz", "feature_blocks.csv", "incidents_meta.csv.gz",
              "incident_receiver.csv.gz", "contingency_country_sector.csv.gz"]
    missing = [n for n in needed if not (PROC / n).is_file()]
    if missing:
        raise SystemExit(
            f"missing artifacts: {', '.join(missing)}\n"
            f"run:  python scripts/01_preprocess.py")

    return {
        "matrix": pd.read_csv(PROC / "features_matrix.csv.gz"),
        "blocks": pd.read_csv(PROC / "feature_blocks.csv"),
        "meta": pd.read_csv(PROC / "incidents_meta.csv.gz"),
        "long": pd.read_csv(PROC / "incident_receiver.csv.gz"),
        "contingency": pd.read_csv(PROC / "contingency_country_sector.csv.gz", index_col=0),
    }


# --------------------------------------------------------------------------------------

def overview(art):
    matrix, blocks, meta, long, cont = (art["matrix"], art["blocks"], art["meta"],
                                        art["long"], art["contingency"])

    rule("ARTIFACTS")
    for name, frame in [("features_matrix", matrix), ("feature_blocks", blocks),
                        ("incidents_meta", meta), ("incident_receiver", long),
                        ("contingency", cont)]:
        print(f"  {name:22s} {frame.shape[0]:6d} rows x {frame.shape[1]:3d} cols")

    rule("FEATURE MATRIX - 14 blocks")
    indicators = matrix[list(blocks["column"])]
    print(f"  {'block':12s} {'cols':>5s} {'mean active/incident':>21s}   most / least common")
    for prefix in blocks["block"].unique():
        cols = list(blocks.loc[blocks["block"] == prefix, "column"])
        sums = indicators[cols].sum().sort_values()
        density = indicators[cols].sum(axis=1).mean()
        top = blocks.loc[blocks["column"] == sums.index[-1], "atom"].iloc[0]
        bottom = blocks.loc[blocks["column"] == sums.index[0], "atom"].iloc[0]
        print(f"  {prefix:12s} {len(cols):5d} {density:21.2f}   "
              f"{top[:26]:26s} / {bottom[:24]}")

    print(f"\n  one-hot total: {len(blocks)}   matrix width: {matrix.shape[1] - 1}")
    print(f"  indicators never 1: {int((indicators.sum() == 0).sum())}   "
          f"always 1: {int((indicators.sum() == len(matrix)).sum())}")

    rule("ORDINAL VARIABLES")
    ordinals = [c for c in matrix.columns
                if c != "incident_id" and c not in set(blocks["column"])]
    print(matrix[ordinals].describe().loc[["mean", "std", "min", "50%", "max"]]
          .round(2).to_string())
    print("\n  affected_entities_value is log1p-transformed: 13.82 = log1p(1,000,000)")

    rule("INCIDENT METADATA")
    print(f"  incidents           : {len(meta)}")
    print(f"  with a parseable year: {int(meta['year'].notna().sum())} "
          f"({meta['year'].notna().mean():.1%})")
    print(f"  year range          : {int(meta['year'].min())}-{int(meta['year'].max())}")
    print(f"  not attributed      : {int(meta['not_attributed'].sum())} "
          f"({meta['not_attributed'].mean():.2%})")

    rule("COUNTRY x SECTOR")
    print(f"  {cont.shape[0]} countries x {cont.shape[1]} sectors, "
          f"{int(cont.to_numpy().sum()):,} observations")
    print("\n  top 10 targeted countries:")
    for country, n in cont.sum(axis=1).nlargest(10).items():
        print(f"    {int(n):6d}  {country}")
    print("\n  sectors:")
    for sector, n in cont.sum(axis=0).sort_values(ascending=False).items():
        print(f"    {int(n):6d}  {sector[:66]}")


# --------------------------------------------------------------------------------------

def show_incident(art, incident_id):
    """Decode one incident back into readable labels - the check that found the bug."""
    matrix, blocks, meta, long = art["matrix"], art["blocks"], art["meta"], art["long"]

    if incident_id not in set(matrix["incident_id"]):
        ids = matrix["incident_id"]
        raise SystemExit(
            f"incident {incident_id} not found. ids run {ids.min()}-{ids.max()} "
            f"(not contiguous).\ntry one of: "
            f"{', '.join(str(i) for i in ids.head(6))}")

    row = matrix.loc[matrix["incident_id"] == incident_id].iloc[0]
    info = meta.loc[meta["incident_id"] == incident_id].iloc[0]

    rule(f"INCIDENT {incident_id}")
    # year is Int16 in the artifact but round-trips through CSV as a float; print it as
    # an integer, or "not available" for the 92 undated incidents.
    year = "not available" if pd.isna(info["year"]) else int(info["year"])
    print(f"  name  : {str(info['name'])[:70]}")
    print(f"  year  : {year}     intensity: {info['weighted_intensity']}")
    print(f"  actor : {str(info['initiator_country'])[:60]}"
          f"   {'[NOT ATTRIBUTED]' if info['not_attributed'] else ''}")

    targets = long[long["incident_id"] == incident_id]
    print(f"\n  targets ({len(targets)}):")
    for _, t in targets.head(8).iterrows():
        print(f"    {str(t['country'])[:28]:28s} {str(t['sector'])[:44]}")
    if len(targets) > 8:
        print(f"    ... and {len(targets) - 8} more")

    print("\n  active indicators, by block:")
    for prefix in blocks["block"].unique():
        block = blocks[blocks["block"] == prefix]
        active = [b for _, b in block.iterrows() if row[b["column"]] == 1]
        labels = ", ".join(b["atom"][:40] for b in active)
        print(f"    {prefix:11s} {len(active)}  {labels[:64]}")

    total = int(row[list(blocks["column"])].sum())
    print(f"\n  total active: {total} of {len(blocks)} indicators")


def show_block(art, prefix):
    """Every indicator in one block, with its frequency."""
    matrix, blocks = art["matrix"], art["blocks"]
    block = blocks[blocks["block"] == prefix]
    if block.empty:
        raise SystemExit(f"no block '{prefix}'. available: "
                         f"{', '.join(blocks['block'].unique())}")

    rule(f"BLOCK '{prefix}'  (source column: {block['source_column'].iloc[0]})")
    counts = matrix[list(block["column"])].sum().sort_values(ascending=False)
    for column, n in counts.items():
        atom = block.loc[block["column"] == column, "atom"].iloc[0]
        nullish = block.loc[block["column"] == column, "is_nullish"].iloc[0]
        print(f"  {int(n):5d} ({n / len(matrix):5.1%}) {'[nullish]' if nullish else '         '} "
              f"{atom[:56]}")

    # A block whose categories are mutually exclusive should average 1.0. Higher means
    # genuinely multi-valued (incident_type, receiver_category); much higher would hint
    # at a splitting bug like the one phase 2 found.
    density = matrix[list(block["column"])].sum(axis=1).mean()
    print(f"\n  mean active per incident: {density:.3f}"
          f"   ({'multi-valued' if density > 1.05 else 'mutually exclusive'})")


def show_country(art, name):
    """One country's sector profile against the global share."""
    cont = art["contingency"]
    matches = [c for c in cont.index if name.lower() in str(c).lower()]
    if not matches:
        raise SystemExit(f"no country matching '{name}'")
    if len(matches) > 1:
        print(f"  matches: {', '.join(matches[:10])}")
    country = matches[0]

    rule(f"COUNTRY: {country}")
    row = cont.loc[country]
    total = row.sum()
    world = cont.sum(axis=0) / cont.to_numpy().sum()
    print(f"  {int(total)} observations\n")
    print(f"  {'sector':50s} {'n':>5s} {'share':>7s} {'world':>7s}")
    for sector in row.sort_values(ascending=False).index:
        if row[sector] == 0:
            continue
        print(f"  {sector[:50]:50s} {int(row[sector]):5d} "
              f"{row[sector] / total:7.1%} {world[sector]:7.1%}")
    print("\n  NOTE: raw shares only. The signed, reliability-weighted comparison is")
    print("  analytics 6.1, which arrives in phase 12 and runs on the live selection.")


# --------------------------------------------------------------------------------------

def show_pca(art):
    """Explained variance, and the incidents sitting at each end of PC1 and PC2.

    Reading the extremes is the cheapest way to find out what a component actually
    encodes: a component that separates well-documented from badly-documented incidents
    looks exactly like a component that separates two threat profiles, until you read
    the records at its ends.
    """
    if not (PROC / "pca_components.csv.gz").is_file():
        raise SystemExit("pca_components.csv.gz not found - run scripts/02_pca.py")

    pcs = pd.read_csv(PROC / "pca_components.csv.gz")
    summary = pd.read_csv(PROC / "pca_summary.csv")
    meta, matrix, blocks = art["meta"], art["matrix"], art["blocks"]

    rule("PCA - EXPLAINED VARIANCE")
    for _, row in summary.iterrows():
        bar = "#" * max(1, int(row["explained_variance_ratio"] * 200))
        print(f"  {row['component']:>5s} {row['explained_variance_ratio']:6.2%} "
              f"{row['cumulative']:7.1%}  {bar}")
    print(f"\n  20 components retain {summary['cumulative'].iloc[-1]:.1%} of the variance.")

    # Incompleteness index: how many "Not available"-style indicators each incident has.
    nullish = [c for c in blocks.loc[blocks["is_nullish"], "column"]]
    incompleteness = matrix[nullish].sum(axis=1)
    joined = pcs.merge(meta[["incident_id", "name", "year"]], on="incident_id")
    joined["nullish"] = incompleteness.to_numpy()

    for pc in ("PC1", "PC2"):
        r = float(np.corrcoef(joined[pc], joined["nullish"])[0, 1])
        rule(f"{pc} EXTREMES   (correlation with incompleteness: r = {r:+.3f})")
        for end, frame in (("most negative", joined.nsmallest(4, pc)),
                           ("most positive", joined.nlargest(4, pc))):
            print(f"\n  {end}:")
            for _, row in frame.iterrows():
                year = "----" if pd.isna(row["year"]) else int(row["year"])
                print(f"    {row[pc]:+7.2f}  nullish={int(row['nullish']):2d}  "
                      f"{year}  {str(row['name'])[:44]}")
        print(f"\n  mean nullish count: {joined.nsmallest(200, pc)['nullish'].mean():.1f} "
              f"at the negative end vs {joined.nlargest(200, pc)['nullish'].mean():.1f} "
              f"at the positive end (200 incidents each)")


def audit(art):
    """Recompute key figures straight from the raw CSVs and compare to the artifacts.

    Independent of 01_preprocess.py's own checks: those confirm the output is internally
    consistent, this confirms it still matches the source data.
    """
    rule("AUDIT - artifacts vs raw CSVs")
    g = pd.read_csv(RAW / "eurepoc_global_dataset_1_3.csv", low_memory=False)
    matrix, blocks, meta, long = art["matrix"], art["blocks"], art["meta"], art["long"]

    results = []

    def compare(label, expected, actual):
        ok = expected == actual
        results.append(ok)
        print(f"  [{'OK  ' if ok else 'FAIL'}] {label:46s} raw={expected}  artifact={actual}")

    compare("incident count", len(g), len(matrix))
    compare("incident ids identical", True, set(g.incident_id) == set(matrix.incident_id))

    # Spot-check three blocks against a fresh explode of the raw column.
    from eurepoc_atoms import atom_counts
    for source, prefix in [("incident_type", "type"), ("disruption", "disrupt"),
                           ("receiver_category", "target")]:
        raw_counts = atom_counts(g[source].fillna("Not available").astype(str))
        block = blocks[blocks["block"] == prefix]
        compare(f"'{prefix}' category count", len(raw_counts), len(block))
        for atom, n in list(raw_counts.most_common())[:2]:
            column = block.loc[block["atom"] == atom, "column"]
            if not column.empty:
                compare(f"  '{atom[:30]}' rows", n, int(matrix[column.iloc[0]].sum()))

    # Non-attribution, recomputed from the raw column using the phase-0 definition.
    initiator = g["initiator_country"].fillna("").astype(str)
    raw_na = int(initiator.apply(
        lambda v: any(p.strip() in ("Not attributed", "Unknown") for p in v.split(";"))).sum())
    compare("not-attributed count", raw_na, int(meta["not_attributed"].sum()))

    compare("country/sector covers all incidents", len(g), long.incident_id.nunique())

    print(f"\n  {sum(results)}/{len(results)} comparisons matched")
    if not all(results):
        raise SystemExit("AUDIT FAILED - artifacts are stale, re-run 01_preprocess.py")
    print("  artifacts are consistent with the raw CSVs")


# --------------------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--incident", type=int, help="decode one incident into labels")
    parser.add_argument("--block", type=str, help="list every indicator in one block")
    parser.add_argument("--country", type=str, help="one country's sector profile")
    parser.add_argument("--pca", action="store_true",
                        help="explained variance and what PC1/PC2 encode")
    parser.add_argument("--audit", action="store_true",
                        help="recompute from the raw CSVs and compare")
    args = parser.parse_args()

    art = load()
    if args.incident is not None:
        show_incident(art, args.incident)
    elif args.block:
        show_block(art, args.block)
    elif args.country:
        show_country(art, args.country)
    elif args.pca:
        show_pca(art)
    elif args.audit:
        audit(art)
    else:
        overview(art)


if __name__ == "__main__":
    main()
