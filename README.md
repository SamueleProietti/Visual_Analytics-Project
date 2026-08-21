# Threat-Shape

Visual analytics tool for threat-intelligence analysts, built on the EuRepoC dataset.
Sapienza University of Rome — Visual Analytics course, Prof. Giuseppe Santucci.

See `CLAUDE.md` for the full project specification and hard constraints.
See `docs/proposal.md` for the approved 1-page proposal.
See `docs/phase0_report.md` for the verified data figures.
See `docs/roadmap.md` for the phase-by-phase build plan and current progress.

## Getting started

The four raw EuRepoC CSVs are **not** in the repository (they are gitignored). Place them
in `data/raw/` with the filenames EuRepoC ships them under:

```
data/raw/eurepoc_global_dataset_1_3.csv
data/raw/eurepoc_dyadic_dataset_0_1.csv
data/raw/eurepoc_attribution_dataset_1.3.csv
data/raw/eurepoc_receiver_dataset_1.3.csv
```

Create the environment and install the backend dependencies:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

On macOS or Linux use `.venv/bin/python` in place of `.venv/Scripts/python` throughout.

## Running

```bash
.venv/Scripts/python -m uvicorn backend.app.main:app --reload
```

Then open <http://127.0.0.1:8000>. Interactive API docs are at `/docs`.

The page shows `backend ok · all 4 datasets present` when the stack is wired correctly.

## Verifying the data

Re-derives every figure quoted in `docs/phase0_report.md` from the raw CSVs:

```bash
.venv/Scripts/python scripts/00_verify_data.py
```

## Key figures (verified in phase 0)

| | |
|---|---|
| Incidents (tuples) | 3,414 |
| Raw analytical columns | 18 — 14 one-hot blocks + 4 ordinal |
| **AS index** | **61,452** |
| One-hot feature width | 125 |
| `incident_type` categories | 7 (exploded from 49 combined strings) |
