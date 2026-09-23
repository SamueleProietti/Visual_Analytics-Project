"""
Recompute every figure quoted in docs/insights.md.

Phase 17 is the insight hunt, and an insight that cannot be recomputed is an anecdote.
This script calls the SAME endpoints the interface calls - /api/contrast, /api/reproject,
/api/countries - so the numbers in the document are the numbers the tool shows, not a
parallel analysis written in pandas that happens to agree.

The one thing it does differently is how a selection is MADE. In the interface a cluster
is enclosed with a lasso, which is a gesture and cannot be replayed exactly. Here the
same two clusters are recovered with DBSCAN over the published t-SNE coordinates, which
is deterministic: eps=5, min_samples=10 returns 78 and 37 incidents, the two dense groups
an analyst encloses by hand.

Run with the server up:
    .venv/Scripts/python -m uvicorn backend.app.main:app        # in another terminal
    .venv/Scripts/python scripts/07_insights.py
"""

import json
import sys
import urllib.error
import urllib.request
from collections import Counter

import numpy as np
from sklearn.cluster import DBSCAN

BASE = "http://127.0.0.1:8000"
LINE = "=" * 86


def get(path):
    with urllib.request.urlopen(BASE + path) as response:
        return json.load(response)


def post(path, body):
    request = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def rule(title):
    print(f"\n{LINE}\n{title}\n{LINE}")


def contrast(ids, comparison=None):
    body = {"incident_ids": list(ids)}
    if comparison is not None:
        body["comparison_ids"] = list(comparison)
    return post("/api/contrast", body)


def shares(result):
    """label -> percentage of each group carrying it."""
    out = {}
    for feature in result["features"]:
        out[feature["label"]] = (
            100 * feature["n_selection"] / result["n_a"],
            100 * feature["n_comparison"] / result["n_b"],
            feature["difference"] * 100, feature["z"], feature["reliable"])
    return out


def top(result, n=5):
    return [f for f in result["features"] if f["reliable"]][:n]


def show(features):
    for f in features:
        print(f"    {f['label'][:52]:52s} {f['difference'] * 100:+6.1f}pp  "
              f"z {f['z']:6.2f}")


# ---------------------------------------------------------------------------------

def insight_1_russia(incidents):
    rule("INSIGHT 1 - Russia as a target splits into two operational families")
    russia = [d for d in incidents if "RU" in (d["countries"] or [])]
    print(f"  Russia as receiver: {len(russia)} incidents")

    coords = np.array([[d["x"], d["y"]] for d in russia])
    labels = DBSCAN(eps=5.0, min_samples=10).fit_predict(coords)
    groups = {}
    for label, incident in zip(labels, russia):
        groups.setdefault(int(label), []).append(incident)
    sizes = {k: len(v) for k, v in groups.items() if k != -1}
    print(f"  DBSCAN(eps=5, min_samples=10) clusters: {sizes}")

    for label, members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        if label == -1:
            continue
        others = [d for d in russia if d not in members]
        intensity = [d["weighted_intensity"] for d in members
                     if d["weighted_intensity"] is not None]
        print(f"\n  cluster {label}: n={len(members)}, "
              f"mean weighted intensity {np.mean(intensity):.2f}, "
              f"unattributed {100 * np.mean([d['not_attributed'] for d in members]):.0f}%")
        print("    years:", Counter(d["year"] for d in members).most_common(4))
        print("    types:", Counter(t for d in members for t in d["types"]).most_common(4))
        show(top(contrast([d["incident_id"] for d in members],
                          [d["incident_id"] for d in others])))
        projection = post("/api/reproject",
                          {"incident_ids": [d["incident_id"] for d in members]})
        print(f"    local re-projection: n={projection['n']}, "
              f"perplexity {projection['perplexity']}, "
              f"trustworthiness {projection['trustworthiness']:.3f}")


def insight_2_coverage(incidents):
    rule("INSIGHT 2 - the 2020-2022 coding break dominates any time contrast")
    dated = [d for d in incidents if d["year"] is not None]
    print(f"  {'year':>6s} {'n':>5s} {'ilaw NA':>9s} {'fimpact NA':>11s} "
          f"{'iimpact NA':>11s} {'types/incident':>15s}")
    for year in range(2013, 2025):
        subset = [d for d in dated if d["year"] == year]
        if len(subset) < 20:
            continue
        table = shares(contrast([d["incident_id"] for d in subset]))
        occurrences = sum(len(d["types"] or []) for d in subset)
        print(f"  {year:>6d} {len(subset):>5d} "
              f"{table['ilaw: Not available'][0]:8.1f}% "
              f"{table['fimpact: Not available'][0]:10.1f}% "
              f"{table['iimpact: Not available'][0]:10.1f}% "
              f"{occurrences / len(subset):>15.2f}")

    early = [d["incident_id"] for d in dated if d["year"] <= 2013]
    print(f"\n  what a 2000-2013 brush reports as its strongest features (n={len(early)}):")
    show(top(contrast(early)))
    print("  - every one of them is a coding artefact, not a property of the threat")


def insight_3_attribution(incidents, countries):
    rule("INSIGHT 3 - two attribution regimes, and what drives them")
    big = [c for c in countries if c["incidents"] >= 45]
    low = sorted([c for c in big if c["not_attributed_rate"] < 0.30],
                 key=lambda c: c["not_attributed_rate"])
    high = sorted([c for c in big if c["not_attributed_rate"] > 0.55],
                  key=lambda c: -c["not_attributed_rate"])
    print("  low  (<30% unattributed): "
          + ", ".join(f"{c['code']} {c['not_attributed_rate']:.0%}" for c in low))
    print("  high (>55% unattributed): "
          + ", ".join(f"{c['code']} {c['not_attributed_rate']:.0%}" for c in high))

    def state_affiliated(code):
        ids = [d["incident_id"] for d in incidents if code in (d["countries"] or [])]
        return shares(contrast(ids))["init: State affiliated actor"][0]

    low_share = [state_affiliated(c["code"]) for c in low]
    high_share = [state_affiliated(c["code"]) for c in high]
    print(f"\n  mean share of incidents with a STATE-AFFILIATED initiator:")
    print(f"    low-unattribution group  {np.mean(low_share):.1f}%")
    print(f"    high-unattribution group {np.mean(high_share):.1f}%")
    print("  - attribution tracks WHO ATTACKS, not the victim's forensic capability")


def insight_4_ukraine_russia(incidents):
    rule("INSIGHT 4 - Ukraine and Russia are mirror images, not two sides of one war")
    ua = [d["incident_id"] for d in incidents if "UA" in (d["countries"] or [])]
    ru = [d["incident_id"] for d in incidents
          if "RU" in (d["countries"] or []) and d["incident_id"] not in set(ua)]
    result = contrast(ua, ru)
    print(f"  A-vs-B mode, n={result['n_a']} (UA) vs {result['n_b']} (RU)")
    table = shares(result)
    for label in ["init: Non-state-group", "init: State affiliated actor",
                  "type: Data theft & Doxing", "type: Disruption",
                  "access: Not available"]:
        ua_pct, ru_pct, diff, z, reliable = table[label]
        flag = "" if reliable else "  (fails the validity test)"
        print(f"    {label[:44]:44s} UA {ua_pct:5.1f}%  RU {ru_pct:5.1f}%  "
              f"{diff:+6.1f}pp  z {z:6.2f}{flag}")


def insight_5_italy_germany(incidents):
    rule("INSIGHT 5 - Italy and Germany: a criminal profile against an unattributed one")
    it = [d["incident_id"] for d in incidents if "IT" in (d["countries"] or [])]
    de = [d["incident_id"] for d in incidents
          if "DE" in (d["countries"] or []) and d["incident_id"] not in set(it)]

    print("  Italy vs rest of world:")
    show(top(contrast(it), 4))
    print("\n  Germany vs rest of world:")
    show(top(contrast(de), 4))

    result = contrast(it, de)
    print(f"\n  A-vs-B mode, n={result['n_a']} (IT) vs {result['n_b']} (DE)")
    table = shares(result)
    for label in ["init: Non-state-group", "init: Not attributed",
                  "stateresp: None/Negligent", "target: Corporate Targets",
                  "type: Ransomware"]:
        it_pct, de_pct, diff, z, reliable = table[label]
        flag = "" if reliable else "  (fails the validity test)"
        print(f"    {label[:44]:44s} IT {it_pct:5.1f}%  DE {de_pct:5.1f}%  "
              f"{diff:+6.1f}pp  z {z:6.2f}{flag}")


def main():
    try:
        health = get("/api/health")
    except (urllib.error.URLError, ConnectionError):
        print("The backend is not answering on 127.0.0.1:8000.")
        print("Start it first:  .venv/Scripts/python -m uvicorn backend.app.main:app")
        sys.exit(1)

    rule("PHASE 17 - figures behind docs/insights.md")
    print(f"  corpus: {health['n_incidents']} incidents x "
          f"{health['n_raw_analytical_columns']} analytical columns, "
          f"AS index {health['as_index']:,}")

    incidents = get("/api/incidents")
    countries = get("/api/countries")

    insight_1_russia(incidents)
    insight_2_coverage(incidents)
    insight_3_attribution(incidents, countries)
    insight_4_ukraine_russia(incidents)
    insight_5_italy_germany(incidents)

    rule("END - every figure above is quoted in docs/insights.md")


if __name__ == "__main__":
    main()
