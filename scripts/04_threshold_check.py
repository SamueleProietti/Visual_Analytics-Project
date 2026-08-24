"""
Reproduce the measurement behind MIN_SUBSET, the minimum subset size for analytics 6.2.

Kept as a script rather than a one-liner because the result is only meaningful if two
things are held right, and both are easy to get wrong:

  * k must be FIXED across sizes. Trustworthiness asks how many of a point's k nearest
    neighbours in 2-D were really its neighbours in 20-D. Letting k grow with n compares
    "4 neighbours out of 12" against "10 out of 100", which are different questions.
  * one subset per size is not enough. The spread between random subsets of the same
    size is the whole point: it is what separates "this layout is good" from "this
    layout got lucky".

Run:
    .venv/Scripts/python scripts/04_threshold_check.py
"""

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.manifold import TSNE, trustworthiness

warnings.filterwarnings("ignore")

PROC = Path(__file__).resolve().parent.parent / "data" / "processed"

K = 4                # fixed; must stay below n/2, which is why n starts at 10
REPS = 15
SIZES = [10, 12, 15, 20, 25, 30, 40, 60, 100, 200, 500]


def perplexity_for(n):
    """Same rule the endpoint uses, so the measurement matches the real behaviour."""
    return max(2.0, min(30.0, (n - 1) / 3.0))


def main():
    path = PROC / "pca_components.csv.gz"
    if not path.is_file():
        raise SystemExit("pca_components.csv.gz not found - run scripts/02_pca.py")
    X = pd.read_csv(path).drop(columns=["incident_id"]).to_numpy()

    print(f"trustworthiness of a locally refitted t-SNE, k={K} fixed, "
          f"{REPS} random subsets per size\n")
    print(f"{'n':>5} {'mean':>7} {'std':>7} {'min':>7} {'max':>7}   spread")

    results = []
    for n in SIZES:
        rng = np.random.default_rng(n)     # per-size seed: reproducible, independent
        scores = []
        for _ in range(REPS):
            subset = X[rng.choice(len(X), n, replace=False)]
            embedding = TSNE(n_components=2, perplexity=perplexity_for(n),
                             max_iter=800, init="pca",
                             random_state=42).fit_transform(subset)
            scores.append(trustworthiness(subset, embedding, n_neighbors=K))
        scores = np.array(scores)
        results.append((n, scores.mean(), scores.std()))
        print(f"{n:5d} {scores.mean():7.3f} {scores.std():7.3f} "
              f"{scores.min():7.3f} {scores.max():7.3f}   {'#' * int(scores.std() * 100)}")

    print("\nReading it: the mean turns early, between 12 and 15, but the spread is what")
    print("matters. Where the standard deviation is still ~0.045 a good local layout is")
    print("as much luck as signal; it halves by 25-30. MIN_SUBSET = 30 is the point at")
    print("which the result becomes reproducible, not the point at which it becomes good.")


if __name__ == "__main__":
    main()
