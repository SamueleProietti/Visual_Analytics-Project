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

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from . import analytics, data
from .models import (ContrastResponse, CountrySummary, DatasetStatus, FeatureBlock,
                     HealthResponse,
                     Incident, ReprojectResponse, ResidualsResponse,
                     SelectionRequest, TimelinePoint)

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

# /api/incidents is ~780 KB of JSON and gzips to roughly a quarter of that. The
# frontend fetches it once at startup, so the compression is worth one line.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def no_store_frontend(request, call_next):
    """Stop the browser caching the frontend sources.

    StaticFiles serves css/js with an ETag, and the browser then keeps reusing its copy
    after an edit - which cost a confusing debugging round in phase 5, where the server
    had the new main.js and the page was still running the old one. The API responses
    are already dynamic, so this only targets the static assets.
    """
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
    return response


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

    missing = data.missing_artifacts()
    return HealthResponse(
        status="ok",
        phase=16,
        datasets=datasets,
        data_ready=all(d.present for d in datasets),
        n_incidents=N_INCIDENTS,
        n_raw_analytical_columns=N_RAW_ANALYTICAL_COLUMNS,
        as_index=AS_INDEX,
        artifacts_ready=not missing,
        missing_artifacts=missing,
    )


def _records(frame: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe records.

    JSON has no NaN, and pandas uses it for every kind of missing value, so anything
    absent becomes None here. Without this the response body would contain bare NaN
    tokens, which is invalid JSON and fails in the browser rather than on the server.
    """
    return frame.replace({np.nan: None}).astype(object).where(
        pd.notna(frame), None).to_dict(orient="records")


@app.get("/api/incidents", response_model=list[Incident], tags=["static data"])
def get_incidents() -> list[dict]:
    """Every incident with its global t-SNE position - the payload View B draws.

    Returns the whole corpus in one response: 3,414 records is small, and the frontend
    needs all of them anyway to draw the scatter. Filtering by selection happens on the
    client, so a lasso does not require a round trip.
    """
    columns = ["incident_id", "name", "year", "weighted_intensity",
               "affected_entities_value", "not_attributed", "countries", "types", "x", "y"]
    return _records(data.incidents()[columns])


@app.get("/api/timeline", response_model=list[TimelinePoint], tags=["static data"])
def get_timeline() -> list[dict]:
    """Incident counts per year and type, for View C's stacked area.

    Built from the exploded type atoms, not the 49 raw combined strings. One incident
    can carry several types, so yearly totals across types exceed the incident count:
    the chart shows how often each type occurs, not a partition of incidents.
    """
    return _records(data.timeline()[["year", "type", "count"]])


@app.get("/api/countries", response_model=list[CountrySummary], tags=["static data"])
def get_countries() -> list[dict]:
    """Per-country totals keyed by ISO alpha-2, for View A.

    Counts only - no residual. Analytics 6.1 runs on the live selection from phase 12,
    and CLAUDE.md sec.6 forbids a default global result existing before any interaction.
    """
    return _records(data.country_summary())


@app.get("/api/features", response_model=list[FeatureBlock], tags=["static data"])
def get_features() -> list[dict]:
    """The 123 indicators and their readable labels, for View D's bar captions."""
    columns = ["column", "block", "atom", "label", "is_nullish"]
    return _records(data.feature_blocks()[columns])


@app.post("/api/residuals", response_model=ResidualsResponse, tags=["analytics"])
def post_residuals(request: SelectionRequest) -> ResidualsResponse:
    """Analytics 6.1 — standardized deviation over the current selection.

    A POST, not a GET: the selection can run to thousands of ids, and a URL is the wrong
    place for it. More to the point, there is no parameterless form of this endpoint to
    call by accident - asking for the residual REQUIRES stating what is selected, so no
    default global result can exist (CLAUDE.md sec.6).
    """
    ids = set(request.incident_ids)
    if not ids:
        raise HTTPException(status_code=400, detail="a selection is required")

    try:
        countries = analytics.country_residuals(ids)
        sectors = (analytics.sector_residuals(ids, request.country_code)
                   if request.country_code else [])
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    observations = int(sum(row["observed"] for row in countries))
    return ResidualsResponse(
        countries=countries, sectors=sectors,
        n_incidents=len(ids), n_observations=observations,
        summary=analytics.residuals_summary(countries),
    )


@app.post("/api/reproject", response_model=ReprojectResponse, tags=["analytics"])
def post_reproject(request: SelectionRequest) -> ReprojectResponse:
    """Analytics 6.2 — refit t-SNE on the selected subset alone.

    This is the technique the proposal puts inside the interactive analysis flow: PCA is
    static denoising computed once offline, t-SNE is what re-runs on whatever the analyst
    picked. Takes a couple of seconds on a large selection, which is the honest cost of
    fitting a real embedding rather than filtering a precomputed one.
    """
    ids = set(request.incident_ids)
    if not ids:
        raise HTTPException(status_code=400, detail="a selection is required")
    try:
        return ReprojectResponse(**analytics.local_reprojection(ids))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/contrast", response_model=ContrastResponse, tags=["analytics"])
def post_contrast(request: SelectionRequest) -> ContrastResponse:
    """Analytics 6.3 — which features separate the selection from its comparison.

    Two-proportion z-test per indicator. Supplying comparison_ids switches to the direct
    A-vs-B mode; omitting it contrasts against the complement. As with the other two
    analytics there is no parameterless form: a contrast requires two groups, and one of
    them has to be chosen by the analyst.
    """
    ids = set(request.incident_ids)
    if not ids:
        raise HTTPException(status_code=400, detail="a selection is required")
    comparison = set(request.comparison_ids) if request.comparison_ids else None
    try:
        return ContrastResponse(**analytics.contrastive_z(ids, comparison))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# Mounted last: StaticFiles on "/" is a catch-all, so any route declared after it would
# be shadowed. html=True makes "/" resolve to index.html.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
