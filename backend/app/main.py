"""Threat-Shape — FastAPI application and static frontend host.

Phase 1 scope: a working skeleton that proves the frontend and backend talk to each
other. It serves the D3 frontend and exposes a single /api/health endpoint. The three
analytics endpoints (/api/residuals, /api/reproject, /api/contrast) arrive in phases
12-14 and, per CLAUDE.md sec.6, none of them may compute anything before a selection
exists.

Run from the repository root:
    .venv/Scripts/python -m uvicorn backend.app.main:app --reload      # Windows
    .venv/bin/python     -m uvicorn backend.app.main:app --reload      # macOS / Linux

Then open http://127.0.0.1:8000
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .models import DatasetStatus, HealthResponse

# backend/app/main.py -> backend/app -> backend -> repository root
ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND = ROOT / "frontend"
RAW = ROOT / "data" / "raw"

# Filenames as shipped by EuRepoC. Note the inconsistent separators in the release
# itself (1_3 vs 1.3) - kept verbatim rather than renamed, so the raw data stays
# byte-identical to the download and the verification script stays reproducible.
RAW_FILES = {
    "global": "eurepoc_global_dataset_1_3.csv",
    "dyadic": "eurepoc_dyadic_dataset_0_1.csv",
    "attribution": "eurepoc_attribution_dataset_1.3.csv",
    "receiver": "eurepoc_receiver_dataset_1.3.csv",
}

# Verified in Phase 0 against the real CSVs; see docs/phase0_report.md sec.6.
# Hard-coded deliberately: these are measured constants, and re-deriving them would
# mean parsing 20 MB of CSV on every health check.
N_INCIDENTS = 3414
N_RAW_ANALYTICAL_COLUMNS = 18  # 14 one-hot blocks + 4 ordinal severity variables
AS_INDEX = N_INCIDENTS * N_RAW_ANALYTICAL_COLUMNS  # 61,452

app = FastAPI(
    title="Threat-Shape API",
    description=(
        "Visual analytics over the EuRepoC cyber-incident corpus. "
        "Sapienza University of Rome, Visual Analytics course."
    ),
    version="0.1.0",
)


@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Report backend liveness and whether the raw data is in place.

    Static facts only - this endpoint must never trigger an analytics computation.
    """
    datasets = []
    for name, filename in RAW_FILES.items():
        path = RAW / filename
        present = path.is_file()
        datasets.append(
            DatasetStatus(
                name=name,
                filename=filename,
                present=present,
                size_mb=round(path.stat().st_size / 1_048_576, 2) if present else None,
            )
        )

    return HealthResponse(
        status="ok",
        phase=1,
        datasets=datasets,
        data_ready=all(d.present for d in datasets),
        n_incidents=N_INCIDENTS,
        n_raw_analytical_columns=N_RAW_ANALYTICAL_COLUMNS,
        as_index=AS_INDEX,
    )


# Mounted last: StaticFiles on "/" is a catch-all, so any route declared after it would
# be shadowed. html=True makes "/" resolve to index.html.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
