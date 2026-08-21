# CLAUDE.md — Threat-Shape

Persistent project context. Read this fully before writing any code.

---

## 1. What this project is

University Visual Analytics project (Sapienza, Prof. Giuseppe Santucci, Fall 2025).
Two-person group. Graded on: running software + 5-6 page scientific-style report +
PowerPoint presentation + live demo. The approved 1-page proposal is
`docs/proposal.md` — it is the contract. Do not silently diverge from it; if an
implementation detail forces a change, flag it before proceeding.

**Threat-Shape** is a visual analytics tool for threat-intelligence analysts, built on
the EuRepoC (European Repository of Cyber Incidents) dataset. It moves the analyst from
counting incidents to understanding the *shape and composition* of a threat profile —
which sectors, techniques and actors define it, and how it compares to another
country's or to the global expectation.

---

## 2. Hard constraints from the course rules

These are graded. Violating them costs points or causes exclusion.

**Exclusion criteria:**
- Missing or wrong 1-page proposal draft (already approved — don't diverge from it)
- Missing dimensionality reduction
- Missing GitHub repository

**Penalties:**
| Penalty | Cost | How we avoid it |
|---|---|---|
| Missing 2 bidirectionally coordinated views | 5 pts | 4 views, all coordinated via shared selection store |
| Missing related work | 5 pts | Report cites the official EuRepoC dashboard explicitly, states differentiation |
| Missing analytics triggered by visual interaction | 5 pts | 3.1/3.2/3.3 fire only on lasso/click/brush, never on menu |
| DR not integrated in the analysis flow | 2 pts | 3.2 re-embeds the selected subset on every interaction |
| Non-standard colour encodings | 2 pts | Divergent scale only where sign is meaningful; check `incident_type` category count stays at or below 12 before committing to the timeline palette |
| Missing legends | 2 pts | Every view has its own legend |
| Scrollable views not justified | 2 pts | Fixed-size views |
| Too strong reuse of existing solutions | 2 pts | Report explicitly names the official EuRepoC dashboard and states why counts alone don't answer the analyst's question |
| Missing insights | 2 pts | Phase 17 is dedicated insight-hunting, documented in `docs/insights.md` |
| Unconvincing intended user | 2 pts | Threat-intelligence analyst at a national CSIRT — justified in proposal |

**AS index constraint:** `#tuples x #dimensions` MUST fall in **10,000-50,000**.
Declared value: 3,414 x ~20 ~ 68,000 — ABOVE the range, deliberately, with a stated
justification (20 raw analytical columns, not the larger one-hot-encoded technical
matrix they expand into — the exact one-hot column count is not claimed as a fixed
number and must not be, until verified in Phase 0). This is a "braves" case per the course slide ("contained in
the range 10,000-50,000, and more for the braves..."). Phase 0 must recount the real
number of analytical columns and the real one-hot dimension count against the actual
CSVs — if the ~20 raw analytical columns don't match what's finalized, fix the draft's numbers before
anything else is built on top of them.

**No menus, dropdowns, or radio buttons to trigger analytics.** Lasso on the
projection, click/ctrl-click on map countries, and timeline brush are the only
triggers. The "switchable attribution-rate layer" on the map is a toggle between two
display modes, not an analytics trigger — keep it a simple two-state control, not a
dropdown with more options than that.

---

## 3. Architecture (proposed — confirm before Phase 1)

- **Backend:** Python + FastAPI. Owns preprocessing, PCA, global t-SNE (precomputed),
  and the three on-demand analytics endpoints (residuals, local re-projection,
  contrastive z-scores).
- **Frontend:** vanilla JavaScript + D3.js v7 via CDN, no build step, consistent with
  the rest of the course's toolset.
- **Data:** the four raw EuRepoC CSVs live outside the repo (gitignored). Scripts in
  `scripts/` produce cached artifacts in `data/`.

```
threat-shape/
├── CLAUDE.md
├── docs/
│   ├── proposal.md          <- the approved 1-pager, verbatim
│   ├── insights.md          <- Phase 17 output
│   └── mockup.excalidraw
├── backend/
│   └── app/
│       ├── main.py          <- FastAPI app + static serving
│       ├── preprocessing.py <- join, explode, one-hot encode
│       ├── analytics.py     <- 3.1 z-score residuals, 3.2 re-projection, 3.3 z-scores
│       └── models.py        <- pydantic schemas for API responses
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js          <- selection store (pub/sub) + bootstrap
│       ├── viewA_map.js
│       ├── viewB_scatter.js
│       ├── viewC_timeline.js
│       └── viewD_contrast.js
├── data/                    <- gitignored: raw CSVs + cached artifacts
└── scripts/
    ├── 00_verify_data.py    <- Phase 0, recount columns/AS index
    ├── 01_preprocess.py     <- Phase 2
    ├── 02_pca.py            <- Phase 3
    └── 03_tsne_global.py    <- Phase 4
```

---

## 4. Data specification

### Source
Four relational CSVs, already present at:
`/mnt/project/eurepoc_global_dataset_1_3.csv` (3,414 rows, 85 cols, unit of analysis)
`/mnt/project/eurepoc_dyadic_dataset_0_1.csv` (4,296 rows, initiator->receiver pairs)
`/mnt/project/eurepoc_attribution_dataset_1_3.csv` (5,217 rows)
`/mnt/project/eurepoc_receiver_dataset_1_3.csv` (12,180 rows)
Join key: `incident_id`.

### Column selection
Of the 85 columns in `global`, exclude identifiers, source URLs, free-text
descriptions, and update metadata. Keep ~20 analytically meaningful columns (type,
access, impact, issue, ilaw, init, target, plus ordinal severity variables). **Recount
this exactly in Phase 0 — do not assume the draft's ~20 figure is correct until
verified against the real files.**

### Encoding
Multi-valued (semicolon-separated) columns are exploded into one binary indicator per
atom. "Not available" / missing is kept as its own explicit category, never dropped
silently — it's treated as an analytical signal (e.g. the 48.7% non-attribution rate
is its own map layer, not a data-quality footnote).

### Scaling
Standardize before PCA (zero mean, unit variance per column) — the binary one-hot
matrix has non-uniform column variance since some categories are far rarer than
others.

---

## 5. The four views

### View A — World choropleth (entry view)
Divergent colour scale on the standardized deviation (z-score, §6.1) for the current
selection's country-sector relationship. Toggle (two-state, not a dropdown) switches
to a sequential scale on non-attribution rate. Clicking a country (or ctrl-clicking
several) drives the shared selection. A details-on-demand panel on click shows: total
incident count, top sector, attribution rate, residual — kept short, not a full
profile dump.

### View B — t-SNE projection
One point per incident. Colour: sequential single-hue on `weighted_intensity`. Size:
`log1p(affected_entities)` — never linear, area is misleading (course material: "human
beings are very bad at estimating area ratios"). Axes and inter-cluster distances are
meaningless and must not be labelled with any implied metric. Lasso selection triggers
§6.2 (local re-projection).

### View C — Stacked area timeline
Incidents by type, 2000-2024. **Verify `incident_type` has <=12 distinct categories
before building this** — if not, group into families the same way the CIC-IDS2017
predecessor project grouped 15 attack labels into 9, and document the mapping.
Brushing a time range restricts all three analytics to that window.

### View D — Contrast panel
Divergent horizontal bar chart. Bar length = magnitude of the standardized difference, colour = sign,
vertical order = |z-score| (reliability), not magnitude. Header states the comparison
mode explicitly: `"<Country>" vs rest of world` or `"<Country A>" vs "<Country B>"` —
never leave the comparison target implicit.

---

## 5b. Dimensionality reduction sequencing (per the approved proposal, verbatim)

"The one-hot encoded space is reduced by PCA to 20 components and then by t-SNE to
2D; t-SNE is the technique integrated in the interactive analysis flow." PCA is static
offline denoising (never re-run on selection). t-SNE is what satisfies the "DR
integrated in the analysis flow" requirement, via §6.2's local re-projection. Do not
state a fixed one-hot dimension count anywhere (code comments, logs, report) until
Phase 0 has measured it on the real data — the proposal deliberately avoids
committing to a number here.

## 6. The analytics (implement in this order: 3.1 is simplest, 3.3 is richest)

### 6.1 Standardized deviation (z-score)
For each country-sector pair, the observed proportion is standardized against the
expected proportion using z = (x-mu)/sigma (course-grounded: VA_06_1, slide 28).
Recomputed on the current
selection (map click(s) + time brush). Flag cells with expected frequency < 5 with a
"small sample" badge instead of displaying an unreliable residual — do not suppress
the cell, mark it as unreliable.

### 6.2 Local re-projection
Refit t-SNE on the selected subset alone (fixed seed, perplexity adapted to n, capped
appropriately for small n). Below a minimum subset size, show a "too small to project"
message rather than an unstable embedding — apply the same `n >= perplexity` logic used
in the predecessor CIC-IDS2017 project for rare classes.

### 6.3 Contrastive z-scores
Same z-score standardization principle as 6.1, applied per feature: the difference in
proportion between the selection and its complement, expressed in standard deviations. When 2+ countries are selected,
switch to a direct A-vs-B contrast instead of vs-rest. Rank output by |z-score|.

**None of these three computations may run before a selection exists.** No default
"global" state on load — the map/scatter start unselected, and the contrast panel
starts empty with a prompt to select something.

---

## 7. Working conventions

- **Build one phase at a time**, per the roadmap in `docs/roadmap.md`. Finish, verify,
  commit, then state which phase is next and stop.
- Recompute and report the AS index whenever the column count changes for any reason.
- Keep `data/` gitignored; commit only code and docs.
- Prefer readable code over clever code — every line has to be defended at the oral
  exam.
- Where a design choice follows from a course-material principle (e.g. area
  perception, opponent colour pairs, t-SNE perplexity), add a one-line code comment
  citing it — it becomes free report material.
- Ask before adding dependencies. Expected stack: pandas, scikit-learn, scipy
  fastapi, uvicorn on the backend; D3 v7 only on the frontend.

## 8. Ask before assuming

- The exact list of ~20 analytical columns and their one-hot expansion — verify in
  Phase 0, do not guess.
- How to group `incident_type` if it exceeds 12 categories.
- What counts as "too small" a subset for local re-projection (a concrete n).
- Anything that would change the AS index or contradict `docs/proposal.md`.
