"""
Draw docs/img/layouts-compared.png: the two layouts of View B side by side.

The incidents against Russia are drawn in colour, with the two groups of insight 1 as
they were found on the staged layout, so the same incidents can be followed from one
panel to the next. Everything else is grey.

This is the one script that needs matplotlib, which the application itself does not use
and requirements.txt does not list:

    python -m pip install matplotlib
    python scripts/11_figure_layouts.py
"""

from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

# The two sign colours of the contrast panel, and the neutral of its comparison dot.
SMALL, LARGE, OTHER, REST = "#2166ac", "#b2182b", "#6b7180", "#d9dce5"

PANELS = [
    ("tsne_direct.csv.gz", "t-SNE only", "trustworthiness 0.962"),
    ("tsne_global.csv.gz", "PCA 20, then t-SNE", "trustworthiness 0.916"),
]


def main():
    ids = pd.read_csv(PROC / "features_matrix.csv.gz", usecols=["incident_id"])["incident_id"]
    receivers = pd.read_csv(PROC / "incident_receiver.csv.gz",
                            keep_default_na=False, na_values=[""])
    russia = ids.isin(set(receivers.loc[receivers["country_code"] == "RU", "incident_id"]))
    russia = russia.to_numpy()

    def layout(name):
        return pd.read_csv(PROC / name).set_index("incident_id").loc[ids][["x", "y"]].to_numpy()

    # The groups as first found, on the staged layout (see 10_compare_layouts.py).
    staged = layout("tsne_global.csv.gz")
    found = DBSCAN(eps=5.0, min_samples=10).fit_predict(staged[russia])
    order = pd.Series(found[found != -1]).value_counts().index
    group = np.full(len(ids), "", dtype=object)
    group[np.where(russia)[0][found == order[0]]] = "large"
    group[np.where(russia)[0][found == order[1]]] = "small"

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9})
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.9), dpi=200)
    for ax, (name, title, note) in zip(axes, PANELS):
        xy = layout(name)
        ax.scatter(*xy[~russia].T, s=3, c=REST, linewidths=0)
        plain = russia & (group == "")
        ax.scatter(*xy[plain].T, s=9, c=OTHER, linewidths=0, label="other incidents against Russia")
        ax.scatter(*xy[group == "large"].T, s=12, c=LARGE, linewidths=0,
                   label="larger group (78 on the staged layout)")
        ax.scatter(*xy[group == "small"].T, s=12, c=SMALL, linewidths=0,
                   label="smaller group (37)")
        ax.set_title(f"{title}\n{note}", fontsize=10, loc="left")
        # A t-SNE plane has no units: no ticks, no axis.
        ax.set_xticks([])
        ax.set_yticks([])
        for side in ax.spines.values():
            side.set_visible(False)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=3, frameon=False, markerscale=1.6)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    out = ROOT / "docs" / "img" / "layouts-compared.png"
    fig.savefig(out)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
