"""Pydantic response schemas for the Threat-Shape API.

Every endpoint declares its response model here rather than returning loose dicts, so
the API contract is explicit and FastAPI can generate accurate OpenAPI docs at /docs.
"""

from pydantic import BaseModel, Field


class DatasetStatus(BaseModel):
    """Presence and size of one raw EuRepoC CSV."""

    name: str = Field(description="Logical table name: global, dyadic, attribution, receiver")
    filename: str
    present: bool
    size_mb: float | None = Field(default=None, description="None when the file is absent")


class HealthResponse(BaseModel):
    """Payload of GET /api/health.

    Phase 1 uses this as the round-trip proof that frontend and backend talk to each
    other. It reports only static facts verified in Phase 0 - it never triggers an
    analytics computation, per CLAUDE.md sec.6 ("no default global state on load").
    """

    status: str
    phase: int = Field(description="Roadmap phase the backend currently implements")
    datasets: list[DatasetStatus]
    data_ready: bool = Field(description="True when all four raw CSVs are present")

    # Figures established in Phase 0 and recorded in docs/phase0_report.md. Served so
    # the frontend can display them without re-reading the CSVs on every page load.
    n_incidents: int
    n_raw_analytical_columns: int
    as_index: int
