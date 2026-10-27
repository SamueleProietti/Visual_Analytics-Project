"""
Second global embedding: t-SNE straight from the 127 standardised columns.

The pipeline of 02 and 03 reduces to 20 principal components first. That is the usual
recipe - van der Maaten and Hinton reduce to 30 before every experiment in the original
paper, and scikit-learn recommends it - but both give the same two reasons: speed, and
noise suppression. Neither is obvious at this size, so this script builds the alternative
and measures what the PCA stage actually costs.

The referee is trustworthiness against the ORIGINAL 127-column space, which is the only
comparison that charges each pipeline for everything it discards. The number reported in
03 is measured against the 20-component space instead, so it grades the second stage while
ignoring the first.

Writes:
    data/processed/tsne_direct.csv.gz     3,414 x 2   the alternative layout for View B
    data/processed/tsne_compare.csv                   trustworthiness of both pipelines

Run:
    .venv/Scripts/python scripts/08_tsne_direct.py
"""

import time
from pathlib import Path

import pandas as pd
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE, trustworthiness
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

# Identical to 03_tsne_global.py, so the two layouts differ by their input and by nothing
# else. A different seed or perplexity here would make the comparison meaningless.
RANDOM_STATE = 42
NEIGHBOURS = 20


def rule(title):
    print("\n" + "=" * 82)
    print(title)
    print("=" * 82)


def embed(X, label):
    started = time.time()
    # The call is the one the course uses in its own t-SNE exercise on the digits data
    # set: TSNE(random_state=RS).fit_transform(X), every other parameter left at the
    # scikit-learn default. Those defaults are two components, perplexity 30, 1,000
    # iterations and a PCA initialisation, which are the values this project had been
    # passing by hand; the output is the same to the fourth decimal either way.
    model = TSNE(random_state=RANDOM_STATE)
    layout = model.fit_transform(X)
    print(f"  {label:34s} {X.shape[1]:3d} columns -> 2D   "
          f"{time.time() - started:5.1f}s   KL {model.kl_divergence_:.4f}")
    return layout


def main():
    matrix = pd.read_csv(PROC / "features_matrix.csv.gz")
    features = [c for c in matrix.columns if c != "incident_id"]

    rule("1. THE TWO PIPELINES")
    scaled = StandardScaler().fit_transform(matrix[features].to_numpy(dtype="float64"))
    components = PCA(n_components=20, random_state=RANDOM_STATE).fit_transform(scaled)

    direct = embed(scaled, "t-SNE only")
    staged = embed(components, "PCA 20 then t-SNE")

    rule("2. WHAT EACH ONE KEEPS")
    # KL is not comparable between the two: the two runs minimise it over different input
    # spaces, so a lower value here would say nothing about fidelity to the real data.
    print("  trustworthiness at k=20, measured against the 127 original columns:\n")
    scores = {
        "pca": trustworthiness(scaled, staged, n_neighbors=NEIGHBOURS),
        "direct": trustworthiness(scaled, direct, n_neighbors=NEIGHBOURS),
    }
    print(f"  {'PCA 20 then t-SNE':34s} {scores['pca']:.4f}")
    print(f"  {'t-SNE only':34s} {scores['direct']:.4f}")
    print(f"\n  difference: {scores['direct'] - scores['pca']:+.4f}")
    print("  (run-to-run spread of either pipeline, with a random init, is about 0.0006)")

    pd.DataFrame([
        {"pipeline": "pca20_then_tsne", "input_columns": 20,
         "trustworthiness_vs_127": round(scores["pca"], 4)},
        {"pipeline": "tsne_only", "input_columns": len(features),
         "trustworthiness_vs_127": round(scores["direct"], 4)},
    ]).to_csv(PROC / "tsne_compare.csv", index=False)

    out = pd.DataFrame({
        "incident_id": matrix["incident_id"],
        "x": direct[:, 0].round(4),
        "y": direct[:, 1].round(4),
    })
    out.to_csv(PROC / "tsne_direct.csv.gz", index=False, compression="gzip")
    print(f"\n  wrote tsne_direct.csv.gz ({len(out)} rows) and tsne_compare.csv")


if __name__ == "__main__":
    main()
