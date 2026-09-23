"""Cached access to the artifacts in data/processed/.

Every artifact is read once, on first use, and kept in memory: the whole set is under
300 KB, and re-reading gzipped CSVs on each request would add latency for nothing.

This module only reads and reshapes. It computes no analytics - per CLAUDE.md sec.6
none of the three may run before a selection exists, and a module the static endpoints
depend on is exactly where such a computation should not live.
"""

from functools import lru_cache
from pathlib import Path

import pandas as pd

PROC = Path(__file__).resolve().parent.parent.parent / "data" / "processed"
RAW = PROC.parent / "raw"

REQUIRED = [
    "features_matrix.csv.gz",
    "feature_blocks.csv",
    "incidents_meta.csv.gz",
    "incident_receiver.csv.gz",
    "contingency_country_sector.csv.gz",
    "country_codes.csv",
    "tsne_global.csv.gz",
]


def missing_artifacts():
    """Which artifacts are absent - so /api/health can report it instead of crashing."""
    return [name for name in REQUIRED if not (PROC / name).is_file()]


def _read(name, **kwargs):
    path = PROC / name
    if not path.is_file():
        raise FileNotFoundError(
            f"{name} not found. Run the pipeline: scripts/01_preprocess.py, "
            f"02_pca.py, 03_tsne_global.py")
    return pd.read_csv(path, **kwargs)


@lru_cache(maxsize=1)
def incidents():
    """One row per incident: t-SNE position plus everything View B and C need.

    Joined here rather than in the endpoint so the merge happens once per process.
    """
    meta = _read("incidents_meta.csv.gz")
    tsne = _read("tsne_global.csv.gz")
    frame = meta.merge(tsne, on="incident_id", how="left")

    # Which countries each incident targeted, so a map click can resolve to a set of
    # incidents on the client without a round trip. 249 incidents are located only on
    # regions or organisations and get an empty list: they are unreachable by map
    # selection by construction, which phase 11 has to account for.
    long = incident_receiver()
    per_incident = (long.dropna(subset=["country_code"])
                    .groupby("incident_id")["country_code"]
                    .apply(lambda codes: sorted(set(codes))))
    frame["countries"] = frame["incident_id"].map(per_incident)
    frame["countries"] = frame["countries"].apply(
        lambda value: value if isinstance(value, list) else [])

    # Incident types, so View C can redraw itself on a selection without a round trip.
    # Read from the exploded type_* indicators, which is the same source the global
    # timeline aggregates - the focus series and the context series cannot disagree.
    matrix = feature_matrix()
    blocks = feature_blocks()
    type_columns = blocks[blocks["block"] == "type"]
    names = list(type_columns["atom"])
    values = matrix[list(type_columns["column"])].to_numpy()
    by_id = dict(zip(matrix["incident_id"],
                     ([names[i] for i, on in enumerate(row) if on] for row in values)))
    frame["types"] = frame["incident_id"].map(by_id).apply(
        lambda value: value if isinstance(value, list) else [])

    # year is Int16 upstream but round-trips through CSV as float; restore the integer
    # type so it serialises as 2024 rather than 2024.0. The 92 undated incidents stay
    # null and the JSON layer emits them as None.
    frame["year"] = frame["year"].astype("Int64")
    return frame


@lru_cache(maxsize=1)
def feature_matrix():
    return _read("features_matrix.csv.gz")


@lru_cache(maxsize=1)
def pca_components():
    """The 20 PCA components - the input analytics 6.2 refits t-SNE on."""
    return _read("pca_components.csv.gz")


@lru_cache(maxsize=1)
def feature_blocks():
    return _read("feature_blocks.csv")


# Namibia's ISO 3166-1 alpha-2 code is literally "NA", which pandas parses as a missing
# value by default - silently deleting Namibia from the map. Any frame carrying country
# codes must be read with the default NaN strings disabled, leaving only "" as null.
_CODE_SAFE = {"keep_default_na": False, "na_values": [""]}


@lru_cache(maxsize=1)
def incident_receiver():
    """Long table: one row per (incident, targeted country, sector)."""
    return _read("incident_receiver.csv.gz", **_CODE_SAFE)


@lru_cache(maxsize=1)
def country_codes():
    return _read("country_codes.csv", **_CODE_SAFE)


@lru_cache(maxsize=1)
def timeline():
    """Incidents per year and incident type, for View C.

    Built from the exploded `type_*` indicators, never from the 49 raw combined strings
    (CLAUDE.md sec.5). One incident can carry several types, so the yearly totals across
    types deliberately exceed the incident count - the stacked area shows type-incidence,
    not a partition of incidents.
    """
    blocks = feature_blocks()
    type_columns = blocks[blocks["block"] == "type"]
    matrix = feature_matrix()
    years = incidents()[["incident_id", "year"]]

    joined = matrix[["incident_id"] + list(type_columns["column"])].merge(
        years, on="incident_id")
    joined = joined[joined["year"].notna()]          # the 92 undated incidents drop out

    rows = []
    for _, entry in type_columns.iterrows():
        by_year = joined.groupby("year")[entry["column"]].sum()
        for year, count in by_year.items():
            if count:
                rows.append({"year": int(year), "type": entry["atom"],
                             "column": entry["column"], "count": int(count)})
    return pd.DataFrame(rows).sort_values(["year", "type"]).reset_index(drop=True)


@lru_cache(maxsize=1)
def initiated_counts():
    """Incidents each state is named as the initiator of, keyed by ISO alpha-2.

    Read from the attribution table's initiator_alpha_2, not from the global table's
    free-text initiator_country: the latter is a comma-joined list of names that
    themselves contain commas ("Iran, Islamic Republic of"), and splitting it would be
    guesswork. "Unknown" and "Not attributed" are not two-letter codes and drop out.
    An incident attributed to the same state several times counts once.
    """
    frame = pd.read_csv(RAW / "eurepoc_attribution_dataset_1.3.csv",
                        usecols=["incident_id", "initiator_alpha_2"], **_CODE_SAFE)
    frame = frame[frame["initiator_alpha_2"].str.len() == 2].drop_duplicates()
    return frame["initiator_alpha_2"].value_counts().to_dict()


@lru_cache(maxsize=1)
def country_summary():
    """Per-country totals for View A's entry state.

    Raw counts and shares only. The signed, reliability-weighted residual is analytics
    6.1 and arrives in phase 12, computed on the live selection - there is deliberately
    no precomputed global residual to fall back on.
    """
    long = incident_receiver()
    meta = incidents()[["incident_id", "not_attributed"]]
    joined = long.merge(meta, on="incident_id")

    mappable = joined[joined["country_code"].notna()]
    initiated = initiated_counts()
    rows = []
    for code, group in mappable.groupby("country_code"):
        sectors = group["sector"].value_counts()
        unique_incidents = group["incident_id"].nunique()
        attribution = (group.drop_duplicates("incident_id")["not_attributed"].mean())
        rows.append({
            "code": code,
            "country": group["country"].iloc[0],
            "observations": int(len(group)),
            "incidents": int(unique_incidents),
            "initiated": int(initiated.get(code, 0)),
            "top_sector": sectors.index[0],
            "top_sector_count": int(sectors.iloc[0]),
            "not_attributed_rate": round(float(attribution), 4),
        })
    return pd.DataFrame(rows).sort_values("incidents", ascending=False).reset_index(drop=True)
