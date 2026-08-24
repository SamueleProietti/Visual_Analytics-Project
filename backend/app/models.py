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

    artifacts_ready: bool = Field(
        default=False, description="True when every processed artifact is on disk")
    missing_artifacts: list[str] = Field(default_factory=list)


class Incident(BaseModel):
    """One incident: its t-SNE position plus the attributes View B encodes.

    `x`/`y` are the precomputed global embedding. They carry no units and inter-cluster
    distances are not meaningful (CLAUDE.md sec.5) - the frontend must never label the
    axes with an implied metric.
    """

    incident_id: int
    name: str
    year: int | None = Field(description="None for the 92 incidents with no parseable date")
    weighted_intensity: float | None = Field(description="View B colour")
    affected_entities_value: float | None = Field(description="View B size, before log1p")
    not_attributed: int = Field(description="1 when no initiator state is named")
    countries: list[str] = Field(
        description="ISO alpha-2 of every targeted country; empty when the incident is "
                    "located only on a region or an organisation")
    types: list[str] = Field(
        description="Exploded incident_type atoms; an incident can carry several")
    x: float
    y: float


class TimelinePoint(BaseModel):
    """One (year, incident type) cell of View C's stacked area."""

    year: int
    type: str
    count: int


class CountrySummary(BaseModel):
    """Per-country totals for View A's entry state.

    Counts only: the signed residual is analytics 6.1, computed on the live selection
    from phase 12 onward. There is deliberately no precomputed global residual here.
    """

    code: str = Field(description="ISO 3166-1 alpha-2")
    country: str
    observations: int
    incidents: int
    top_sector: str
    top_sector_count: int
    not_attributed_rate: float


class FeatureBlock(BaseModel):
    """One binary indicator: its column name and the label View D puts on the bar."""

    column: str
    block: str
    atom: str
    label: str
    is_nullish: bool
