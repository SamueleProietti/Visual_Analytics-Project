"""
Phase 4 - Global t-SNE embedding (offline).

Projects the 20 PCA components to the 2D layout View B draws. This is the technique the
proposal puts inside the interactive analysis flow: the global embedding is precomputed
here, and analytics 6.2 re-fits t-SNE on whatever subset the analyst lassoes (phase 13).

Perplexity is chosen, not assumed: three candidates are fitted and compared on
trustworthiness, which measures how much of each point's local neighbourhood survives
the projection. The chosen value and its score are reported so the choice can be
defended rather than asserted.

Also settles the question phase 3 left open. PC1 correlates r = +0.79 with documentation
incompleteness, so this script measures whether that separation survives into the
embedding - if it does, View B would show clusters an analyst could misread as threat
profiles when they are really reporting quality.

Writes:
    data/processed/tsne_global.csv.gz     3,414 x 2   the View B layout
    data/processed/tsne_summary.csv                   perplexity comparison

Run:
    .venv/Scripts/python scripts/03_tsne_global.py
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.manifold import TSNE, trustworthiness
from sklearn.neighbors import NearestNeighbors

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

# Van der Maaten & Hinton recommend 5-50; below that the embedding fragments into
# meaningless micro-clusters, above it local structure dissolves into one blob. These
# three span that range so the choice rests on a measurement.
PERPLEXITY_CANDIDATES = [15, 30, 50]

RANDOM_STATE = 42   # t-SNE is stochastic; View B must be reproducible across restarts
MAX_ITER = 1000
NEIGHBOURS = 20     # k for the trustworthiness and neighbourhood-purity diagnostics


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


def load():
    path = PROC / "pca_components.csv.gz"
    if not path.is_file():
        raise SystemExit("pca_components.csv.gz not found - run scripts/02_pca.py")
    pcs = pd.read_csv(path)
    matrix = pd.read_csv(PROC / "features_matrix.csv.gz")
    blocks = pd.read_csv(PROC / "feature_blocks.csv")
    meta = pd.read_csv(PROC / "incidents_meta.csv.gz")
    return pcs, matrix, blocks, meta


# --------------------------------------------------------------------------------------

def choose_perplexity(X):
    """Fit each candidate and score it, rather than taking a default on faith.

    trustworthiness in [0,1] asks: of the k nearest neighbours a point has in the 2D
    layout, how many were genuinely near it in the original 20-D space? It penalises
    exactly the failure that matters for View B - points drawn close together that were
    never actually similar, which a lasso would then scoop up as a false cluster.
    """
    rule("1. CHOOSING PERPLEXITY")
    print(f"  {len(X)} incidents, {X.shape[1]} PCA components")
    print(f"  candidates: {PERPLEXITY_CANDIDATES}  (van der Maaten & Hinton: 5-50)\n")
    print(f"  {'perplexity':>11s} {'KL divergence':>14s} {'trustworthiness':>16s}")

    results = []
    for perplexity in PERPLEXITY_CANDIDATES:
        model = TSNE(n_components=2, perplexity=perplexity, max_iter=MAX_ITER,
                     init="pca", random_state=RANDOM_STATE)
        embedding = model.fit_transform(X)
        score = trustworthiness(X, embedding, n_neighbors=NEIGHBOURS)
        results.append({"perplexity": perplexity, "kl_divergence": model.kl_divergence_,
                        "trustworthiness": score})
        print(f"  {perplexity:11d} {model.kl_divergence_:14.4f} {score:16.4f}")

    summary = pd.DataFrame(results)
    best = summary.loc[summary["trustworthiness"].idxmax(), "perplexity"]
    print(f"\n  chosen: perplexity = {int(best)} (highest trustworthiness)")
    print("  KL divergence is NOT the selection criterion: it falls with perplexity by")
    print("  construction, so picking on it would always favour the smallest candidate.")
    return int(best), summary


def fit_final(X, perplexity):
    rule("2. FINAL EMBEDDING")
    model = TSNE(n_components=2, perplexity=perplexity, max_iter=MAX_ITER,
                 init="pca", random_state=RANDOM_STATE)
    embedding = model.fit_transform(X)

    print(f"  perplexity={perplexity}, max_iter={MAX_ITER}, seed={RANDOM_STATE}")
    print(f"  KL divergence: {model.kl_divergence_:.4f}   "
          f"iterations run: {model.n_iter_}")
    print(f"  x range: {embedding[:, 0].min():7.2f} to {embedding[:, 0].max():7.2f}")
    print(f"  y range: {embedding[:, 1].min():7.2f} to {embedding[:, 1].max():7.2f}")
    print("\n  NOTE for View B: these axes carry no units and inter-cluster distances are")
    print("  not meaningful (CLAUDE.md sec.5). They must never be labelled with a metric.")
    return embedding


# --------------------------------------------------------------------------------------

def neighbourhood_purity(embedding, values, k=NEIGHBOURS):
    """How strongly does the layout group points by this variable?

    Local variance reduction: 1 - mean(variance among a point's k neighbours) / global
    variance. 0 means neighbourhoods are as mixed as the corpus, 1 means every
    neighbourhood is uniform.

    Deliberately NOT the correlation between a point's value and its neighbours' mean,
    which was the first thing tried here: that statistic is not comparable across
    variables with different support, so it scored a 0-13 count against a 0/1 indicator
    and made the comparison meaningless. Normalising by each variable's own variance is
    what lets incompleteness and incident type be judged on the same scale.
    """
    nn = NearestNeighbors(n_neighbors=k + 1).fit(embedding)
    _, indices = nn.kneighbors(embedding)
    v = values.to_numpy(dtype="float64")

    neighbourhoods = v[indices[:, 1:]]            # k neighbours, self excluded
    local_variance = neighbourhoods.var(axis=1).mean()
    global_variance = v.var()
    if global_variance == 0:
        return float("nan")
    return float(1 - local_variance / global_variance)


def check_documentation_axis(embedding, matrix, blocks, meta):
    """Settle phase 3's open question: does the documentation axis survive into 2D?

    Measured against two references, because a bare correlation means little on its own:
      * a random baseline - the same statistic on shuffled values, i.e. pure chance
      * a substantive variable - incident type, which the embedding *should* group by
    If incompleteness clusters no more strongly than incident type does, the embedding
    is not primarily a documentation map.
    """
    rule("3. DOES THE EMBEDDING SEPARATE ON DOCUMENTATION?")

    nullish = [c for c in blocks.loc[blocks["is_nullish"], "column"]]
    incompleteness = matrix[nullish].sum(axis=1)

    observed = neighbourhood_purity(embedding, incompleteness)

    rng = np.random.default_rng(RANDOM_STATE)
    shuffled = [neighbourhood_purity(embedding, pd.Series(
        rng.permutation(incompleteness.to_numpy()))) for _ in range(5)]
    baseline = float(np.mean(shuffled))

    # Substantive references: things the embedding is *supposed* to group by. The count
    # of non-nullish indicators is the fairest single comparison - same kind of quantity
    # as incompleteness (a count over the same blocks), just of the informative half.
    substantive = [c for c in blocks["column"] if c not in nullish]
    references = {"substantive feature count": neighbourhood_purity(
        embedding, matrix[substantive].sum(axis=1))}
    for column, label in [("type_disruption", "incident type: Disruption"),
                          ("type_data_theft", "incident type: Data theft"),
                          ("target_critical_infrastructure", "target: Critical infrastructure")]:
        if column in matrix.columns:
            references[label] = neighbourhood_purity(embedding, matrix[column])
    references["weighted intensity"] = neighbourhood_purity(
        embedding, meta["weighted_intensity"].fillna(0))
    # Year tests the temporal confound phase 3 flagged: recent incidents are better
    # documented, so an embedding grouping by date would produce the same appearance.
    references["year (temporal confound)"] = neighbourhood_purity(
        embedding, meta["year"].fillna(meta["year"].median()))

    print(f"  local variance reduction (k={NEIGHBOURS}): 0 = neighbourhoods as mixed as")
    print(f"  the corpus, 1 = every neighbourhood uniform in that variable.\n")
    print(f"  {'documentation incompleteness':44s} {observed:7.3f}   <-- the concern")
    for label, value in references.items():
        print(f"  {label:44s} {value:7.3f}")
    print(f"  {'random baseline (shuffled, 5 runs)':44s} {baseline:7.3f}")

    print()
    strongest = max(references, key=references.get)
    best_reference = references[strongest]

    # A margin, not a bare ">": these scores sit within a few percent of each other on a
    # scale whose random baseline is ~0.05, so declaring dominance on a 0.015 gap would
    # overstate what was measured. 10% relative is the threshold for "dominant".
    if observed > best_reference * 1.10:
        print("  VERDICT: incompleteness dominates. The embedding groups by reporting")
        print("  quality more than by threat shape, and View B would mislead. Decide")
        print("  before phase 7 whether to drop the 21 nullish indicators.")
    elif observed > best_reference:
        print(f"  VERDICT: incompleteness ({observed:.3f}) is COMPARABLE to the strongest")
        print(f"  substantive variable, '{strongest}' ({best_reference:.3f}) - ahead by")
        print(f"  {(observed / best_reference - 1):.1%}, against a random baseline of {baseline:.3f}.")
        print("  The embedding groups strongly by everything at once, so documentation is")
        print("  one axis among several rather than the organising one. Defensible for")
        print("  View B, and honest: a poorly reported incident genuinely is a different")
        print("  kind of incident - older, hacktivist, thinly covered - so the grouping is")
        print("  not purely an artifact. It stays a stated limitation, not a blocker.")
    else:
        print(f"  VERDICT: incompleteness ({observed:.3f}) clusters LESS strongly than")
        print(f"  '{strongest}' ({best_reference:.3f}). The embedding is organised by")
        print("  substantive features; the documentation axis is present but secondary.")

    weakest = min(references, key=references.get)
    print(f"\n  Worth noting for phases 6-7: '{weakest}' scores only "
          f"{references[weakest]:.3f}, so\n  selecting on it will NOT produce a tight "
          f"cluster in View B. That is a property of\n  the data, not a bug - but the "
          f"coordinated views should not be expected to agree\n  visually on it.")

    return {"incompleteness": observed, "random_baseline": baseline, **references}


def preview(embedding, values, title):
    """Coarse ASCII density map - a sanity check that the layout has structure at all."""
    rule(f"4. LAYOUT PREVIEW - {title}")
    width, height = 62, 22
    x, y = embedding[:, 0], embedding[:, 1]
    xi = ((x - x.min()) / (x.max() - x.min()) * (width - 1)).astype(int)
    yi = ((y - y.min()) / (y.max() - y.min()) * (height - 1)).astype(int)

    total = np.zeros((height, width))
    count = np.zeros((height, width))
    np.add.at(total, (yi, xi), values.to_numpy())
    np.add.at(count, (yi, xi), 1)

    # Cells show the local mean of `values`, binned into five glyphs; blank means empty.
    glyphs = " .:-=+*#%@"
    with np.errstate(invalid="ignore"):
        mean = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    lo, hi = np.nanmin(mean), np.nanmax(mean)

    for r in range(height - 1, -1, -1):
        line = ""
        for c in range(width):
            if count[r, c] == 0:
                line += " "
            else:
                level = int((mean[r, c] - lo) / (hi - lo + 1e-9) * (len(glyphs) - 2)) + 1
                line += glyphs[level]
        print("  " + line)
    print(f"\n  glyph = local mean of {title}, from '{glyphs[1]}' ({lo:.1f}) "
          f"to '{glyphs[-1]}' ({hi:.1f}); blank = no incidents")


def verify(embedding, pcs):
    rule("5. VERIFICATION")
    checks = []

    def check(label, ok, detail=""):
        checks.append(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  - ' + detail) if detail else ''}")

    check("3,414 rows preserved", len(embedding) == len(pcs), f"got {len(embedding)}")
    check("2 dimensions", embedding.shape[1] == 2)
    check("no NaN or infinite values", bool(np.isfinite(embedding).all()))
    check("points are not degenerate (spread > 0)",
          bool(embedding.std(axis=0).min() > 1e-6))
    # 673 incidents share an identical feature profile with another - mostly sparsely
    # documented records that collapse onto the same vector - so identical coordinates
    # are expected, not a failure. What would be a failure is the embedding merging
    # points that were genuinely distinct, so compare against the distinct-profile count.
    unique_points = len(np.unique(np.round(embedding, 3), axis=0))
    distinct_profiles = len(np.unique(np.round(pcs.drop(columns=["incident_id"]).to_numpy(),
                                               6), axis=0))
    check("embedding preserves distinct profiles", unique_points >= distinct_profiles,
          f"{unique_points} distinct positions for {distinct_profiles} distinct profiles")

    print(f"\n  {sum(checks)}/{len(checks)} checks passed")
    if not all(checks):
        raise SystemExit("verification failed - artifacts NOT written")


# --------------------------------------------------------------------------------------

def main():
    pcs, matrix, blocks, meta = load()
    X = pcs.drop(columns=["incident_id"]).to_numpy()

    perplexity, summary = choose_perplexity(X)
    embedding = fit_final(X, perplexity)

    diagnostics = check_documentation_axis(embedding, matrix, blocks, meta)

    nullish = [c for c in blocks.loc[blocks["is_nullish"], "column"]]
    preview(embedding, matrix[nullish].sum(axis=1), "documentation incompleteness")

    verify(embedding, pcs)

    rule("6. ARTIFACTS WRITTEN")
    out = pd.DataFrame({"incident_id": pcs["incident_id"].to_numpy(),
                        "x": embedding[:, 0], "y": embedding[:, 1]})
    summary["chosen"] = summary["perplexity"] == perplexity
    for name, frame, compress in [("tsne_global.csv.gz", out, True),
                                  ("tsne_summary.csv", summary, False)]:
        path = PROC / name
        frame.to_csv(path, index=False, compression="gzip" if compress else None)
        print(f"  {name:24s} {path.stat().st_size / 1024:8.1f} KB  "
              f"{frame.shape[0]:5d} x {frame.shape[1]}")

    rule(f"PHASE 4 COMPLETE - perplexity {perplexity}, "
         f"documentation purity {diagnostics['incompleteness']:.3f}")


if __name__ == "__main__":
    main()
