# Phase 0 — Data verification report

Written in English because it feeds directly into the final written report.
Reproduce every figure below with:

```bash
python scripts/00_verify_data.py
```

`docs/proposal.md` is the approved contract and is **deliberately left unedited**. Where a
verified figure diverges from it, the divergence is recorded here and stated openly in the
final report, rather than silently absorbed into the code.

---

## 0. What the proposal actually claims

Grepped, not assumed. `docs/proposal.md` states **only**:

> "**Index AS:** ~68,000 (3,414 tuples × ~20 dimensions). While the global table contains
> 85 columns, only ~20 carry analytical content (the rest are metadata, identifiers, or
> empty). These 20 dimensions are one-hot encoded downstream into a larger binary feature
> matrix used for the projection."

It contains **no "82"**, **no "48.7%"** and **no "four entirely empty columns"**. Those three
figures originate from a preliminary manual pass, not from the approved document. This is
consistent with CLAUDE.md §5b, which records that the proposal deliberately avoids
committing to a one-hot dimension count.

Consequence: only two approved claims are at stake — the `~20` / `~68,000` pair, and the
word *"empty"*.

---

## 1. Files and join integrity

| Table | Rows | Cols | Unique `incident_id` | vs proposal |
|---|---|---|---|---|
| `global` | 3,414 | 85 | 3,414 | OK |
| `dyadic` | 4,296 | 57 | 2,957 | OK |
| `attribution` | 5,217 | 18 | 3,322 | OK |
| `receiver` | 12,180 | 6 | 3,322 | OK |

Join against `global` on `incident_id`:

| Table | Matched | Orphans (absent from `global`) | `global` rows absent here |
|---|---|---|---|
| `dyadic` | 2,846 | **111** | 568 |
| `attribution` | 3,322 | 0 | 92 |
| `receiver` | 3,322 | 0 | 92 |

**Constraint for Phase 2:** every join must be a **left join from `global`**. An inner join
would silently drop 568 incidents and break the 3,414-tuple count the AS index rests on.
The 111 `dyadic` orphans are dropped by that left join, which is the intended behaviour —
`global` is the declared unit of analysis.

---

## 2. The "empty columns" claim

**No column in `global` is entirely null.** Lowest non-null rate: `economic_impact`, 51.8%.
The claim of four entirely empty columns is false.

However, non-null rate is the wrong instrument: EuRepoC writes the literal string
`"Not available"` instead of leaving cells blank. Measured by *informative* rows (at least
one atom that is not `Not available` / `none` / `Unknown` / `Not attributed` / `No`),
**12 columns are effectively empty**:

| Column | Informative rows |
|---|---|
| `casualties` | constant — `"Not available"` in all 3,414 rows |
| `evidence_for_sanctions_indicator` | 0.2% |
| `physical_effects_spatial` | 0.4% |
| `physical_effects_temporal` | 0.4% |
| `attribution_legal_reference_subcode` | 0.4% |
| `legal_response_subtype` | 0.6% |
| `user_interaction` | 1.0% |
| `attribution_legal_reference` | 1.8% |
| `zero_days_subcode` | 2.5% |
| `economic_impact` | 2.8% |
| `zero_days` | 2.9% |
| `attributing_company` | 4.7% |

`economic_impact` is the clearest case: 51.8% non-null, but 1,673 of those rows read
`"Not available"` — only 94 rows (2.8%) carry an actual figure.

**Divergence from the proposal:** the word *"empty"* should be read as *"effectively
constant"*. The substance of the proposal's argument is unaffected — in fact strengthened,
since the count rises from 4 to 12.

---

## 3. `incident_type` — 7 atomic categories (View C is safe)

49 distinct raw combined strings; 50.9% of rows contain a `;`. Exploded into atoms:

| Category | Rows | Share |
|---|---|---|
| Hijacking with Misuse | 1,800 | 52.7% |
| Disruption | 1,475 | 43.2% |
| Data theft | 1,261 | 36.9% |
| Ransomware | 502 | 14.7% |
| Data theft & Doxing | 414 | 12.1% |
| Hijacking without Misuse | 365 | 10.7% |
| Not available | 4 | 0.1% |

**7 ≤ 12**, so CLAUDE.md §2's palette constraint is satisfied and **no regrouping into
families is required** — the CIC-IDS2017-style mapping is not needed.

**Independent confirmation:** the `dyadic` release ships EuRepoC's own one-hot encoding of
this variable as 7 columns, whose names match our exploded atoms exactly. Our explode is
therefore verified against the publisher's own encoding, not just internally consistent.

**Source data-entry artifact (worth one line in the report):** 16 of the 49 combined
strings repeat an atom within a single row — `"Disruption;Disruption"`,
`"Hijacking without Misuse"` four times over, and similar — affecting 23 rows. The cause is
EuRepoC concatenating per-receiver values. The explode de-duplicates per row so the
indicators stay strictly binary.

**View C is built on the exploded atoms, never on the 49 combined strings.**

---

## 4. Final column selection

All 85 columns of `global` are classified; none left unaccounted.

### 4.1 Retained — 14 one-hot blocks (125 indicator columns)

| Column | Block prefix | Atoms | Informative | Rationale |
|---|---|---|---|---|
| `il_breach_indicator` | `ilaw_` | 20 | 54.8% | International-law dimension; the proposal's "ilaw" block |
| `mitre_impact` | `impact_` | 14 | 42.5% | Technique taxonomy — core to incident shape |
| `cyber_conflict_issue` | `issue_` | 13 | 46.7% | Geopolitical motive; prime View D contrast feature |
| `offline_conflict_issue` | `issue_` | 12 | 28.1% | Links cyber activity to offline conflict |
| `receiver_category` | `target_` | 12 | 97.7% | **Sector axis of the §6.1 z-score** — mandatory |
| `mitre_initial_access` | `access_` | 10 | 14.8% | The proposal's "access" block; sparse but categorical |
| `incident_type` | `type_` | 7 | 99.9% | Drives View C |
| `initiator_category` | `init_` | 7 | 65.8% | Actor type |
| `functional_impact` | `impact_` | 6 | 56.9% | Operational consequence |
| `intelligence_impact` | `impact_` | 6 | 57.3% | Intelligence consequence |
| `disruption` | — | 6 | 42.9% | Intensity component |
| `state_responsibility_actor` | `init_` | 4 | 32.0% | State involvement — key for attribution analysis |
| `data_theft` | — | 4 | 48.9% | Intensity component |
| `hijacking` | — | 4 | 63.3% | Intensity component |
| **Total** | | **125** | | |

### 4.2 Retained — 4 ordinal severity variables (kept numeric)

`weighted_intensity`, `impact_indicator_score`, `affected_entities_value`,
`affected_third_countries_value`.

Kept numeric rather than one-hot because their categories are **ordered**; one-hot encoding
would discard that ordering.

Two deliberate choices here:

- `unweighted_intensity` is **dropped** in favour of `weighted_intensity` — measured
  correlation **r = 0.967**, effectively duplicates. View B colours on the weighted variant
  per the proposal.
- The binned twins `impact_indicator_label` and `affected_entities` are **dropped** in favour
  of the numeric `impact_indicator_score` / `affected_entities_value`. Keeping both would
  double-count the same variable and inflate its weight in the distance metric.

`affected_entities_value` ranges 0–1,000,000 and is heavily skewed; Phase 2 applies `log1p`
before standardisation. This matches View B's size encoding, which CLAUDE.md §5 already
mandates as `log1p` on perceptual grounds (area ratios are badly estimated by human
observers).

### 4.3 Excluded, by reason

| # | Reason |
|---|---|
| 11 | Degenerate — modal value covers >90% of rows |
| 10 | High-cardinality subcategory (parent category kept instead) |
| 9 | Free text / entity name |
| 7 | Timestamp / date |
| 7 | Geography — drives the map, not the feature matrix |
| 5 | Binned duplicate of a retained ordinal |
| 5 | Attribution metadata — documentation quality, not incident shape |
| 4 | Identifier |
| 4 | Redundant with a retained column |
| 3 | Count of downstream records, not a property of the incident |
| 2 | Source URL |

Two exclusion groups deserve comment:

- **Degenerate columns** (`zero_days`, `target_multiplier`, `physical_effects_spatial`,
  `physical_effects_temporal`, and 7 others). A column whose modal value covers >90% of rows
  contributes almost no discriminative power to a distance-based projection while still
  adding dimensions that dilute it — the curse of dimensionality. All four appeared in the
  preliminary 17-column pass and are dropped here.
- **Attribution metadata** (`attribution_type`, `attribution_basis`, `source_disclosure`, …)
  describes *how well an incident was documented*, not *what the incident was*. Mixing it
  into the feature matrix would let documentation quality distort the t-SNE geometry.
  Attribution is analysed separately, as View A's dedicated layer — which is where the
  proposal already puts it.

---

## 5. One-hot dimension count

| Candidate set | One-hot | + ordinal | Feature matrix |
|---|---|---|---|
| (a) Preliminary 17-column pass | 138 | — | 138 |
| **(b) Recommended — 14 blocks** | **125** | **4** | **129** |
| (c) Narrowed to approach 82 | 80 | 4 | 84 |

The preliminary pass reproduces at **exactly 138**, confirming that the "82" figure is wrong
by a wide margin. `il_breach_indicator` alone contributes 20.

Set (c) reaches 80 by dropping `il_breach_indicator` (20), `cyber_conflict_issue` (13) and
`offline_conflict_issue` (12).

**Recommendation: (b), 125 one-hot columns.** Since the proposal never states 82, there is
no approved figure to reconcile against. Set (c) would delete the entire `ilaw_` and `issue_`
blocks that CLAUDE.md §4 names explicitly as part of the intended selection, and all three
columns are genuinely informative (54.8%, 46.7%, 28.1%). Narrowing the analysis to match a
number that does not appear in the contract would trade real analytical content for nothing.

Per CLAUDE.md §5b, this count is recorded **here only** — not in code comments, logs, or the
proposal — and it is a measured value, not a design target.

---

## 6. AS index

```
3,414 tuples × 18 raw analytical columns = 61,452
```

where 18 = 14 one-hot blocks + 4 ordinal variables, counted **pre-one-hot** as CLAUDE.md §2
requires.

| | Dimensions | AS index |
|---|---|---|
| Proposal declares | ~20 | ~68,000 |
| **Verified** | **18** | **61,452** |
| Course range | | 10,000 – 50,000 |

`18` falls inside the proposal's own `~20` hedge. The index remains **above** the 10,000–50,000
range, so the deliberate "braves" justification (course slide: *"contained in the range
10,000–50,000, and more for the braves…"*) stands unchanged in kind. The corrected figure is
**61,452**, and that is the number to defend at the oral exam.

---

## 7. Non-attribution rate

`number_attributions` has a **minimum of 1** — no incident has zero attribution records — so
"non-attribution" cannot mean "no attribution row". Candidate definitions measured:

| Definition | Rows | Rate |
|---|---|---|
| `attribution_source_url == "Not available"` | 1,661 | **48.65%** |
| `initiator_country` contains `"Not attributed"` **or** `"Unknown"` | 1,771 | **51.87%** |
| `initiator_country` contains `"Not attributed"` | 932 | 27.30% |
| `attribution_type == "Not available"` | 828 | 24.25% |
| `state_responsibility_actor == "Not available"` | 2,321 | 67.98% |

**The proposal's 48.7% traces to `attribution_source_url`** — that is, whether a source
*link* backing the attribution exists. It is a documentation-quality metric, not a measure of
whether anyone was blamed. Built on it, View A's attribution layer would be colouring
countries by citation hygiene.

**Recommended definition: no named initiator state** — `initiator_country` containing
`"Not attributed"` or `"Unknown"` — giving **51.87%**. It is substantive, matches what a CSIRT
analyst means by "unattributed", and is defensible at the oral exam. It also lands close
enough in magnitude that the proposal's narrative is unaffected.

---

## 8. Summary of divergences from `docs/proposal.md`

| Proposal | Verified | Action |
|---|---|---|
| "or empty" | 0 entirely empty; 12 effectively constant | Read as "effectively constant"; state in report |
| ~20 dimensions | 18 | Within the "~" hedge; no edit needed |
| ~68,000 AS index | **61,452** | Corrected figure; still above range, "braves" case intact |
| (82 one-hot — not in proposal) | **125** | No approved figure existed; 125 adopted |
| (48.7% — not in proposal) | **51.87%** under the recommended definition | Redefined substantively |
| 3,414 / 4,296 / 5,217 / 12,180 rows | All confirmed exactly | No change |

**`docs/proposal.md` is unmodified.**
