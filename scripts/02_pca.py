"""
Phase 3 - Feature scaling and PCA.

Standardises the 127-column feature matrix and reduces it to 20 principal components,
following docs/proposal.md verbatim: "The one-hot encoded space is reduced by PCA to 20
components and then by t-SNE to 2D". PCA here is static offline denoising and is never
re-run on a selection (CLAUDE.md sec.5b) - the technique integrated in the interactive
flow is t-SNE, via the local re-projection of analytics 6.2.

Writes:
    data/processed/pca_components.csv.gz   3,414 x 20   input to t-SNE (phase 4)
    data/processed/pca_loadings.csv        127 x 20     how to read each component
    data/processed/pca_summary.csv         20 rows      explained variance per component
    data/processed/scaling_params.csv      127 rows     mean and scale, for reproducibility

Run:
    .venv/Scripts/python scripts/02_pca.py
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

N_COMPONENTS = 20  # fixed by the approved proposal; not a tuned hyper-parameter
RANDOM_STATE = 42  # PCA's solver is deterministic given a seed - phase 4 reuses this


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


def load():
    matrix_path = PROC / "features_matrix.csv.gz"
    if not matrix_path.is_file():
        raise SystemExit("features_matrix.csv.gz not found - run scripts/01_preprocess.py")
    return pd.read_csv(matrix_path), pd.read_csv(PROC / "feature_blocks.csv")


# --------------------------------------------------------------------------------------

def standardise(matrix, blocks):
    """Zero mean, unit variance per column.

    CLAUDE.md sec.4 requires this: the one-hot matrix has wildly non-uniform column
    variance because some categories are far rarer than others, and PCA maximises
    variance, so without scaling the common categories would simply out-shout the rest.

    Scaling has a cost that is worth stating plainly, because it shapes everything
    downstream: it also equalises the rare categories *upward*. A category present in
    one incident out of 3,414 gets variance 1, exactly like one present in 1,800 - and
    that single incident lands about 58 standard deviations from every other point on
    that axis. Section 2 below measures how far that distortion actually propagates.
    """
    rule("1. STANDARDISATION")

    features = [c for c in matrix.columns if c != "incident_id"]
    scaler = StandardScaler()
    scaled = scaler.fit_transform(matrix[features].to_numpy(dtype="float64"))

    print(f"  {len(features)} columns scaled to mean 0, variance 1")
    print(f"  verification: max |mean| = {np.abs(scaled.mean(axis=0)).max():.2e}, "
          f"std range = {scaled.std(axis=0).min():.4f}-{scaled.std(axis=0).max():.4f}")

    # How extreme did the rare categories become?
    indicator_cols = set(blocks["column"])
    frequencies = matrix[features].apply(
        lambda col: col.sum() if col.name in indicator_cols else np.nan)
    peak = pd.Series(scaled.max(axis=0), index=features)

    rare = frequencies[frequencies <= 34].sort_values()  # under 1% of the corpus
    print(f"\n  indicators active in <=34 incidents (<1%): {len(rare)} of {len(indicator_cols)}")
    print(f"  {'indicator':44s} {'rows':>5s} {'peak z':>8s}")
    for name in rare.index[:6]:
        print(f"  {name[:44]:44s} {int(frequencies[name]):5d} {peak[name]:8.2f}")

    print(f"\n  largest standardised value anywhere: {scaled.max():.2f}")
    print("  (a common category peaks near 1.0 - see section 2 for whether this matters)")

    params = pd.DataFrame({
        "column": features,
        "mean": scaler.mean_,
        "scale": scaler.scale_,
        "n_active": [frequencies[f] for f in features],
    })
    return scaled, features, params


# --------------------------------------------------------------------------------------

def run_pca(scaled, features):
    rule("2. PCA")

    # Full PCA first: the explained-variance curve over all components is what tells us
    # whether 20 is a reasonable cut, and it costs nothing at this size.
    full = PCA(random_state=RANDOM_STATE).fit(scaled)
    cumulative = np.cumsum(full.explained_variance_ratio_)

    model = PCA(n_components=N_COMPONENTS, random_state=RANDOM_STATE)
    components = model.fit_transform(scaled)

    retained = model.explained_variance_ratio_.sum()
    print(f"  {scaled.shape[1]} columns -> {N_COMPONENTS} components")
    print(f"  variance retained by 20 components: {retained:.1%}")

    print("\n  per component:")
    print(f"  {'PC':>4s} {'variance':>9s} {'cumulative':>11s}")
    for i, ratio in enumerate(model.explained_variance_ratio_, start=1):
        marker = ""
        if i in (1, 2, 5, 10, 20):
            marker = "  <-"
        print(f"  {i:4d} {ratio:9.2%} {cumulative[i - 1]:11.1%}{marker}")

    print("\n  components needed to reach a given share of variance:")
    for target in (0.5, 0.8, 0.9, 0.95):
        needed = int(np.searchsorted(cumulative, target) + 1)
        note = "" if needed <= N_COMPONENTS else "   (more than the 20 we keep)"
        print(f"    {target:4.0%}  ->  {needed:3d} components{note}")

    return model, components, cumulative


def report_loadings(model, components, features, blocks, matrix):
    """What each of the first components is actually made of.

    This is the diagnostic that matters: if the leading components were dominated by
    categories active in a handful of incidents, the embedding would be describing
    coding rarities rather than threat shape.
    """
    rule("3. WHAT THE COMPONENTS MEAN")

    labels = dict(zip(blocks["column"], blocks["label"]))
    counts = {c: int(matrix[c].sum()) for c in blocks["column"]}

    loadings = pd.DataFrame(model.components_.T, index=features,
                            columns=[f"PC{i}" for i in range(1, N_COMPONENTS + 1)])

    for pc in ["PC1", "PC2", "PC3"]:
        top = loadings[pc].abs().sort_values(ascending=False).head(5)
        print(f"\n  {pc} ({model.explained_variance_ratio_[int(pc[2:]) - 1]:.1%} of variance) "
              f"- strongest contributors:")
        for name in top.index:
            n = counts.get(name, "-")
            sign = "+" if loadings.loc[name, pc] > 0 else "-"
            print(f"    {sign} {abs(loadings.loc[name, pc]):.3f}  {labels.get(name, name)[:46]:46s} "
                  f"n={n}")

    # Do rare features dominate the leading components? Compare the mean absolute
    # loading of rare vs common indicators across the first five.
    rare = [c for c in blocks["column"] if counts[c] <= 34]
    common = [c for c in blocks["column"] if counts[c] > 341]  # >10% of the corpus
    lead = [f"PC{i}" for i in range(1, 6)]
    rare_weight = loadings.loc[rare, lead].abs().to_numpy().mean()
    common_weight = loadings.loc[common, lead].abs().to_numpy().mean()

    print(f"\n  mean |loading| across PC1-PC5:")
    print(f"    rare indicators   (<=34 incidents, n={len(rare):3d}): {rare_weight:.4f}")
    print(f"    common indicators (>341 incidents, n={len(common):3d}): {common_weight:.4f}")
    verdict = ("rare categories do NOT dominate the leading components"
               if rare_weight < common_weight else
               "WARNING: rare categories outweigh common ones - review the scaling")
    print(f"    -> {verdict}")

    # PC1's top contributors are all "Not available" indicators, which is worth
    # quantifying rather than eyeballing: if the leading axis is really documentation
    # completeness, then View B's clusters risk separating well-reported incidents from
    # poorly-reported ones, and an analyst could easily read that as two threat profiles.
    nullish = [c for c in blocks.loc[blocks["is_nullish"], "column"]]
    incompleteness = matrix[nullish].sum(axis=1)
    print(f"\n  documentation check - {len(nullish)} of {len(blocks)} indicators are "
          f"'Not available'/'none'/'Unknown'")
    print(f"  nullish indicators active per incident: mean {incompleteness.mean():.2f}, "
          f"range {int(incompleteness.min())}-{int(incompleteness.max())}")
    print(f"  {'component':>10s} {'r with incompleteness':>23s}")
    for i in range(1, 6):
        r = float(np.corrcoef(components[:, i - 1], incompleteness)[0, 1])
        flag = "  <-- STRONG" if abs(r) > 0.7 else ("  <- moderate" if abs(r) > 0.4 else "")
        print(f"  {'PC' + str(i):>10s} {r:>+23.3f}{flag}")
    r1 = float(np.corrcoef(components[:, 0], incompleteness)[0, 1])
    print(f"\n  incompleteness alone explains {r1 ** 2:.1%} of PC1's variance"
          f" ({model.explained_variance_ratio_[0]:.1%} of the corpus).")
    print("  Recorded, not silently accepted: phase 4 must check whether the t-SNE")
    print("  embedding visibly separates on this axis before View B is built on it.")

    return loadings


def verify(components, matrix, model):
    rule("4. VERIFICATION")
    checks = []

    def check(label, ok, detail=""):
        checks.append(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")

    check("3,414 rows preserved", len(components) == len(matrix), f"got {len(components)}")
    check(f"{N_COMPONENTS} components", components.shape[1] == N_COMPONENTS,
          f"got {components.shape[1]}")
    check("no NaN or infinite values", bool(np.isfinite(components).all()))
    check("components are uncorrelated",
          bool(np.abs(np.corrcoef(components.T) - np.eye(N_COMPONENTS)).max() < 1e-6),
          f"max off-diagonal {np.abs(np.corrcoef(components.T) - np.eye(N_COMPONENTS)).max():.2e}")
    check("variance strictly decreasing",
          bool((np.diff(model.explained_variance_ratio_) <= 0).all()))

    print(f"\n  {sum(checks)}/{len(checks)} checks passed")
    if not all(checks):
        raise SystemExit("verification failed - artifacts NOT written")


# --------------------------------------------------------------------------------------

def main():
    matrix, blocks = load()
    scaled, features, params = standardise(matrix, blocks)
    model, components, cumulative = run_pca(scaled, features)
    loadings = report_loadings(model, components, features, blocks, matrix)
    verify(components, matrix, model)

    rule("5. ARTIFACTS WRITTEN")
    pcs = pd.DataFrame(components, columns=[f"PC{i}" for i in range(1, N_COMPONENTS + 1)])
    pcs.insert(0, "incident_id", matrix["incident_id"].to_numpy())

    summary = pd.DataFrame({
        "component": [f"PC{i}" for i in range(1, N_COMPONENTS + 1)],
        "explained_variance_ratio": model.explained_variance_ratio_,
        "cumulative": np.cumsum(model.explained_variance_ratio_),
    })

    for filename, frame, compress, index in [
        ("pca_components.csv.gz", pcs, True, False),
        ("pca_loadings.csv", loadings, False, True),
        ("pca_summary.csv", summary, False, False),
        ("scaling_params.csv", params, False, False),
    ]:
        path = PROC / filename
        frame.to_csv(path, index=index, compression="gzip" if compress else None)
        print(f"  {filename:26s} {path.stat().st_size / 1024:8.1f} KB  "
              f"{frame.shape[0]:5d} x {frame.shape[1]}")

    rule(f"PHASE 3 COMPLETE - {N_COMPONENTS} components retaining "
         f"{model.explained_variance_ratio_.sum():.1%} of variance")


if __name__ == "__main__":
    main()
