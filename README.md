# Threat-Shape

Visual analytics tool for threat-intelligence analysts, built on the EuRepoC dataset.
Sapienza University of Rome, Visual Analytics course, Prof. Giuseppe Santucci. 

See `docs/proposal.md` for the approved 1-page proposal.    
See `docs/phase0_report.md` for the verified data figures.    
See `docs/insights.md` for the five findings made with the tool, and how to reproduce them.    
See `data/tables/` for the data as readable, uncompressed tables, and how the 85 EuRepoC columns become the 127 features.

## Getting started

The cached artifacts in `data/processed/` are committed, so the application runs straight
after a clone. To rebuild them from scratch, put the four raw EuRepoC CSVs in `data/raw/`
with the filenames EuRepoC ships them under:

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

## Key figures (verified in phase 0)

| | |
|---|---|
| Incidents (tuples) | 3,414 |
| Raw analytical columns | 18 — 14 one-hot blocks + 4 ordinal |
| **AS index** | **61,452** |
| One-hot feature width | 123 |
| `incident_type` categories | 7 (exploded from 49 combined strings) |
