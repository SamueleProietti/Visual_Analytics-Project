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
    incidents: int = Field(description="Incidents in which the country is a receiver")
    initiated: int = Field(description="Incidents in which the country is the named initiator")
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


class SelectionRequest(BaseModel):
    """The selection an analytic runs on.

    incident_ids is required and must be non-empty: the analytics endpoints refuse to
    compute a "global" default, which is the rule in CLAUDE.md sec.6 expressed in the
    API contract rather than left to the caller's good manners.
    """

    incident_ids: list[int] = Field(min_length=1,
                                    description="Ids of the currently selected incidents")
    country_code: str | None = Field(
        default=None, description="When set, also return that country's sector breakdown")
    comparison_ids: list[int] | None = Field(
        default=None,
        description="Group B for a direct A-vs-B contrast. Omitted, group B is the "
                    "complement of the selection (the vs-rest mode).")


class CountryResidual(BaseModel):
    """Standardized deviation of one country within the current selection."""

    code: str
    country: str
    observed: int
    expected: float
    z: float = Field(description="(observed - expected) / sqrt(expected)")
    reliable: bool = Field(description="False when expected < 5: shown with a badge, not hidden")


class SectorResidual(BaseModel):
    """Standardized deviation of one sector within one country."""

    sector: str
    observed: int
    expected: float
    z: float
    reliable: bool


class ResidualsResponse(BaseModel):
    """Payload of POST /api/residuals - analytics 6.1."""

    countries: list[CountryResidual]
    sectors: list[SectorResidual] = Field(
        default_factory=list, description="Only when country_code was supplied")
    n_incidents: int
    n_observations: int
    summary: dict


class ProjectedPoint(BaseModel):
    """One incident in the locally refitted layout."""

    incident_id: int
    x: float
    y: float


class ReprojectResponse(BaseModel):
    """Payload of POST /api/reproject - analytics 6.2.

    `ok` false is a real answer, not an error: below the minimum subset size the
    refusal IS the result, because an embedding of a dozen points looks exactly as
    confident as one of a thousand and the analyst cannot tell them apart by eye.
    """

    ok: bool
    reason: str = ""
    n: int
    minimum: int
    perplexity: float | None = None
    trustworthiness: float | None = Field(
        default=None,
        description="How much of each point's real neighbourhood survived the projection")
    points: list[ProjectedPoint] = Field(default_factory=list)


class ContrastFeature(BaseModel):
    """One indicator's separation between the two groups.

    `difference` and `z` are deliberately different quantities: the bar length shows the
    raw gap in percentage points, the ranking uses z, which weighs how many incidents
    that gap rests on. A large difference over few incidents draws a long bar and sits
    low in the list.
    """

    column: str
    label: str
    difference: float = Field(description="p(A) - p(B), signed, in [-1, 1]")
    z: float = Field(description="Two-proportion z-test statistic")
    n_selection: int
    n_comparison: int
    reliable: bool = Field(
        description="False when the normal approximation does not hold; shown flagged")
    is_nullish: bool = Field(
        description="True for 'Not available'-style indicators - a documentation signal")


class ContrastResponse(BaseModel):
    """Payload of POST /api/contrast - analytics 6.3."""

    ok: bool
    reason: str = ""
    mode: str = Field(description="'vs-rest' or 'a-vs-b'")
    n_a: int
    n_b: int
    n_reliable: int = 0
    n_features: int = 0
    features: list[ContrastFeature] = Field(default_factory=list)
