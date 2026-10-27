"""
The two layouts of View B, compared against the data they are pictures of.

View B can draw the corpus in two ways: PCA to 20 components followed by t-SNE, and t-SNE
straight from the 127 standardised columns. This script measures what the PCA stage
costs, and whether the finding made with it survives without it.

Every comparison is made against the 127 columns, never between two pictures alone. A
projection can be wrong in two ways, and both are measured:

    trustworthiness   false neighbours: close in the picture, far in the data
    continuity        lost neighbours:  close in the data, far in the picture

Sections:
    1. fidelity of each layout
    2. does the result depend on the perplexity?
    3. does it depend on the number of components kept?
    4. how the points move between the two t-SNE layouts
    5. how the clusters move
    6. do the clusters exist in the 127 columns?
    7. insight 1, the two groups of incidents against Russia, in each layout

Run:
    .venv/Scripts/python scripts/10_compare_layouts.py
"""

import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN, HDBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE, trustworthiness
from sklearn.metrics import (adjusted_mutual_info_score, adjusted_rand_score,
                             silhouette_score)
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
sys.path.insert(0, str(ROOT))
from backend.app import analytics  # noqa: E402  - the tool's own contrast, not a copy

K = 20
SEED = 42


def rule(title):
    print("\n" + "=" * 88)
    print(title)
    print("=" * 88)


def knn(points, k=K):
    return NearestNeighbors(n_neighbors=k + 1).fit(points).kneighbors(
        points, return_distance=False)[:, 1:]


def spacing(points):
    """Median distance to the fifth neighbour: the unit a radius is expressed in, so the
    same clustering rule means the same thing on layouts of different extent."""
    return float(np.median(NearestNeighbors(n_neighbors=6).fit(points)
                           .kneighbors(points)[0][:, 5]))


def cluster(points):
    return DBSCAN(eps=spacing(points) * 1.8, min_samples=10).fit_predict(points)


def main():
    matrix = pd.read_csv(PROC / "features_matrix.csv.gz")
    blocks = pd.read_csv(PROC / "feature_blocks.csv")
    meta = pd.read_csv(PROC / "incidents_meta.csv.gz").set_index("incident_id")
    ids = matrix["incident_id"].to_numpy()
    features = [c for c in matrix.columns if c != "incident_id"]
    X = StandardScaler().fit_transform(matrix[features].to_numpy(dtype="float64"))

    def stored(name):
        return (pd.read_csv(PROC / name).set_index("incident_id")
                .loc[ids][["x", "y"]].to_numpy())

    layouts = {"PCA 20 + t-SNE": stored("tsne_global.csv.gz"),
               "t-SNE only": stored("tsne_direct.csv.gz")}
    staged, direct = layouts["PCA 20 + t-SNE"], layouts["t-SNE only"]
    true_nn = knn(X)
    near = {name: knn(xy) for name, xy in layouts.items()}

    # ------------------------------------------------------------------ 1
    rule("1. FIDELITY TO THE 127 COLUMNS")
    print(f"  {'layout':16s} {'trustworthiness':>16s} {'continuity':>11s} "
          f"{'true neighbours kept':>21s}")
    for name, xy in layouts.items():
        kept = np.mean([len(set(true_nn[i]) & set(near[name][i])) / K
                        for i in range(len(ids))])
        # Continuity is trustworthiness with the two spaces swapped.
        print(f"  {name:16s} {trustworthiness(X, xy, n_neighbors=K):16.4f} "
              f"{trustworthiness(xy, X, n_neighbors=K):11.4f} {kept:20.1%}")

    # ------------------------------------------------------------------ 2
    rule("2. DOES IT DEPEND ON THE PERPLEXITY?")
    components = PCA(n_components=20, random_state=SEED).fit_transform(X)
    print(f"  {'perplexity':>10s} {'PCA 20 + t-SNE':>16s} {'t-SNE only':>12s} {'gap':>8s}")
    for perplexity in (5, 15, 30, 50, 100):
        scores = []
        for source in (components, X):
            xy = TSNE(perplexity=perplexity, random_state=SEED).fit_transform(source)
            scores.append(trustworthiness(X, xy, n_neighbors=K))
        print(f"  {perplexity:10d} {scores[0]:16.4f} {scores[1]:12.4f} "
              f"{scores[1] - scores[0]:+8.4f}", flush=True)

    # ------------------------------------------------------------------ 3
    rule("3. DOES IT DEPEND ON HOW MANY COMPONENTS ARE KEPT?")
    cumulative = np.cumsum(PCA(random_state=SEED).fit(X).explained_variance_ratio_)
    for n in (20, 40, 60, 90):
        reduced = PCA(n_components=n, random_state=SEED).fit_transform(X)
        xy = TSNE(random_state=SEED).fit_transform(reduced)
        print(f"  PCA {n:3d} ({cumulative[n - 1]:5.1%} of the variance) then t-SNE: "
              f"{trustworthiness(X, xy, n_neighbors=K):.4f}", flush=True)
    print(f"  no PCA, 127 columns                       : "
          f"{trustworthiness(X, direct, n_neighbors=K):.4f}")

    # ------------------------------------------------------------------ 4
    rule("4. HOW THE POINTS MOVE BETWEEN THE TWO t-SNE LAYOUTS")
    shared = np.array([len(set(near["PCA 20 + t-SNE"][i]) & set(near["t-SNE only"][i])) / K
                       for i in range(len(ids))])
    print(f"  neighbours in common (k={K}): mean {shared.mean():.1%}, "
          f"median {np.median(shared):.1%}")
    for lo, hi in ((0, .2), (.2, .4), (.4, .6), (.6, .8), (.8, 1.01)):
        print(f"    {int(lo * 100):3d}-{min(100, int(hi * 100)):3d}% in common: "
              f"{((shared >= lo) & (shared < hi)).mean():6.1%} of the incidents")
    rare_columns = [c for c in blocks["column"] if matrix[c].sum() <= 34]
    rare = matrix[rare_columns].to_numpy().sum(axis=1)
    nullish = matrix[list(blocks[blocks["is_nullish"]]["column"])].to_numpy().sum(axis=1)
    year = meta.loc[ids, "year"].to_numpy(dtype="float64")
    print("\n  what goes with a change of neighbourhood (Spearman, share in common against):")
    for label, values in (("active rare indicators (<1% of the corpus)", rare),
                          ("'not available' fields", nullish), ("year", year)):
        ok = ~np.isnan(values.astype("float64"))
        r = pd.Series(shared[ok]).corr(pd.Series(values[ok].astype("float64")),
                                       method="spearman")
        print(f"    {label:44s} {r:+.2f}")

    # ------------------------------------------------------------------ 5
    rule("5. HOW THE CLUSTERS MOVE")
    found = {name: cluster(xy) for name, xy in layouts.items()}
    for name, labels in found.items():
        n = len(set(labels)) - (1 if -1 in labels else 0)
        print(f"  {name:16s} {n:3d} clusters, {np.mean(labels == -1):5.1%} of the "
              f"incidents outside any")
    a, b = found["PCA 20 + t-SNE"], found["t-SNE only"]
    both = (a != -1) & (b != -1)
    print(f"\n  agreement of the two partitions: adjusted Rand index "
          f"{adjusted_rand_score(a[both], b[both]):.3f}, adjusted mutual information "
          f"{adjusted_mutual_info_score(a[both], b[both]):.3f}")

    def fate(source, target):
        intact = split = dissolved = 0
        for c in sorted(set(source) - {-1}):
            members = target[source == c]
            placed = members[members != -1]
            if len(placed) < 0.5 * len(members):
                dissolved += 1
            elif pd.Series(placed).value_counts(normalize=True).iloc[0] >= 0.8:
                intact += 1
            else:
                split += 1
        return intact, split, dissolved

    for label, (i, s, d) in (("PCA 20 + t-SNE clusters, seen in t-SNE only", fate(a, b)),
                             ("t-SNE only clusters, seen in PCA 20 + t-SNE", fate(b, a))):
        print(f"  {label}: {i} stay whole (80% together), {s} split, {d} dissolve")

    # ------------------------------------------------------------------ 6
    rule("6. DO THE CLUSTERS EXIST IN THE 127 COLUMNS?")
    reference = HDBSCAN(min_cluster_size=15).fit_predict(X)
    centres = KMeans(n_clusters=40, n_init=5, random_state=0).fit_predict(X)
    print(f"  reference A: HDBSCAN on the 127 columns, {len(set(reference)) - 1} clusters, "
          f"{np.mean(reference == -1):.0%} left as noise")
    print("  reference B: k-means with 40 centres on the 127 columns\n")
    print(f"  {'layout':16s} {'ARI with A':>11s} {'AMI with A':>11s} {'AMI with B':>11s} "
          f"{'true neighbours in the same cluster':>37s}")
    for name, labels in found.items():
        m = (labels != -1) & (reference != -1)
        inside = labels != -1
        same = np.mean([(labels[true_nn[j]] == labels[j]).mean()
                        for j in np.where(inside)[0]])
        print(f"  {name:16s} {adjusted_rand_score(reference[m], labels[m]):11.3f} "
              f"{adjusted_mutual_info_score(reference[m], labels[m]):11.3f} "
              f"{adjusted_mutual_info_score(centres[inside], labels[inside]):11.3f} "
              f"{same:36.1%}")

    # ------------------------------------------------------------------ 7
    rule("7. INSIGHT 1 IN EACH LAYOUT: THE TWO GROUPS OF INCIDENTS AGAINST RUSSIA")
    receivers = pd.read_csv(PROC / "incident_receiver.csv.gz",
                            keep_default_na=False, na_values=[""])
    targets = set(receivers.loc[receivers["country_code"] == "RU", "incident_id"])
    ru = np.array([i in targets for i in ids])
    index = np.where(ru)[0]
    print(f"  incidents with Russia as a receiver: {ru.sum()}")

    # eps=5 is the value docs/insights.md was written with, on the staged layout. On the
    # direct one it is rescaled by the spacing of the points, so the rule is the same.
    eps = {"PCA 20 + t-SNE": 5.0, "t-SNE only": 5.0 * spacing(direct) / spacing(staged)}
    groups = {name: DBSCAN(eps=eps[name], min_samples=10).fit_predict(layouts[name][ru])
              for name in eps}
    for name, labels in groups.items():
        sizes = pd.Series(labels[labels != -1]).value_counts().to_dict()
        print(f"  {name:16s} DBSCAN(eps={eps[name]:.2f}): {sizes}")
    print("\n  cross-table (rows: groups in PCA 20 + t-SNE; columns: in t-SNE only; -1: none)")
    print(pd.crosstab(pd.Series(groups["PCA 20 + t-SNE"], name="staged"),
                      pd.Series(groups["t-SNE only"], name="direct")).to_string())

    old = groups["PCA 20 + t-SNE"]
    main_two = np.isin(old, pd.Series(old[old != -1]).value_counts().index[:2])
    print("\n  separation of the two original groups (silhouette, -1 to 1):")
    for name, xy in layouts.items():
        print(f"    in {name:16s} {silhouette_score(xy[ru][main_two], old[main_two]):+.3f}")
    print(f"    in the 127 columns   {silhouette_score(X[ru][main_two], old[main_two]):+.3f}")

    print("\n  each group against the other Russian incidents, by the tool's own contrast:")
    intensity = matrix["weighted_intensity"].to_numpy()
    for name, labels in groups.items():
        for c in pd.Series(labels[labels != -1]).value_counts().index[:2]:
            members = set(ids[index[labels == c]].tolist())
            others = set(ids[index[labels != c]].tolist())
            result = analytics.contrastive_z(members, others)
            best = [f for f in result.get("features", []) if f["reliable"]][:2]
            text = " | ".join(f"{f['label'][:36]} {f['difference'] * 100:+.1f}pp "
                              f"z {f['z']:.1f}" for f in best)
            print(f"    {name:16s} n={len(members):3d}  mean intensity "
                  f"{np.nanmean(intensity[index[labels == c]]):.2f}  {text}")


if __name__ == "__main__":
    main()
