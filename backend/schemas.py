"""Pydantic v2 models. Resource JSON uses the frontend's camelCase names
(frontend/src/lib/workspace.ts, access.ts, data/*.ts are the source of truth).
The canonical AI answer, /api/chat, /api/audit/run and /api/auth/* keep their own shapes."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def dump(model: BaseModel | list) -> Any:
    if isinstance(model, list):
        return [dump(m) for m in model]
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


# ---------------------------------------------------------------- workspace resources

class Tenant(Camel):
    tenant_id: str
    name: str
    industry: str
    size: str
    locations: list[str]
    context: str
    enabled_modules: list[str]


class Member(Camel):
    user_id: str
    name: str
    email: str
    roles: list[str]
    grants: list[str] = Field(default_factory=list)
    status: Literal["active", "invited"]


class KbDocument(Camel):
    id: str
    name: str
    size_kb: int
    category: str
    visibility: Literal["Company", "Module", "Restricted"]
    module: Optional[str] = None
    status: Literal["uploaded", "extracting", "tagging", "indexed", "failed"]
    progress: int
    chunks: int
    error: Optional[str] = None


class LastRun(BaseModel):
    at: str
    status: Literal["ok", "failed"]
    errorKind: Optional[str] = None
    error: Optional[str] = None
    action: Optional[str] = None


class LastSuccess(BaseModel):
    at: str
    version: str


class Connector(Camel):
    id: str
    kind: str
    name: str
    detail: str
    connected: bool
    freshness: str
    sla: str
    quality: float
    errors: int
    health: Literal["healthy", "stale", "schema_mismatch", "failed", "disconnected"]
    warning: Optional[str] = None
    rows_per_day: str
    last_run: LastRun
    last_success: LastSuccess


class GoldDataset(Camel):
    id: str
    name: str
    sources: list[str]
    modules: list[str]
    task: str
    freshness: str
    quality: float
    tone: str
    version: str
    as_of: str
    stale: bool


class AuditEvent(Camel):
    id: str
    time: str
    tone: str
    actor: str
    action: str
    detail: str
    resource: Optional[str] = None


class SecurityIncident(Camel):
    id: str
    at: str
    tenant_id: str
    user_id: str
    user_name: str
    roles: list[str]
    requested_resource: str
    query: str
    decision: Literal["DENY"] = "DENY"
    stage: Literal["pre-retrieval", "route", "api"]
    reason: str
    chunks_retrieved: Literal[0] = 0
    sent_to_model: Literal[False] = False


class InviteCode(Camel):
    code: str
    tenant_id: str
    roles: list[str]
    created_by: str
    created_at: str
    seat_user_id: Optional[str] = None
    used_by: Optional[str] = None


class Supplier(Camel):
    id: str
    name: str
    category: str
    otif: float
    rating: Literal["Preferred", "Approved", "Probation"]
    contract: str


class Quotation(Camel):
    id: str
    rfq: str
    supplier_id: str
    item: str
    qty: float
    unit_price: float
    currency: str
    lead_time_days: int
    valid_until: str
    terms: str
    status: Literal["Received", "Under review", "Clarification", "Awarded"]
    document: str
    page: int


ShipmentStatus = Literal["Scheduled", "Loading", "In transit", "Arrived", "Delivered", "Delayed"]


class Shipment(Camel):
    id: str
    customer: str
    origin: str
    destination: str
    address: str
    window: str
    eta: str
    driver_id: Optional[str] = None
    driver_name: str
    vehicle: str
    pallets: int
    weight_kg: float
    handling: str
    status: ShipmentStatus
    stop_order: int
    eta_as_of: Optional[str] = None
    eta_stale: Optional[bool] = None
    batch_id: Optional[str] = None


class Lot(Camel):
    id: str
    sku: str
    product: str
    batch: str
    facility: Optional[str] = None
    qty: float
    unit: str
    unit_value: Optional[float] = None
    expiry: str
    storage: Optional[str] = None
    supplier_id: Optional[str] = None
    valuation_estimated: Optional[bool] = None
    days_remaining: Optional[int] = None
    severity: Optional[str] = None
    value_at_risk: Optional[float] = None


class PolicyRef(BaseModel):
    document: str
    page: int


class ExpiryAction(Camel):
    id: str
    kind: Literal["fefo", "dispatch", "markdown", "quarantine", "donation", "supplier_return"]
    lot_id: str
    title: str
    rationale: str
    value_protected: float
    confidence: float
    external: bool
    route: Literal["inventory", "procurement"]
    status: Literal["proposed", "approved", "dismissed"]
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    policy: list[PolicyRef]


class ExpiryRules(Camel):
    version: int
    critical_days: int
    warning_days: int
    scan_minutes: int
    markdown_max_pct: float
    min_confidence: float
    updated_at: str
    updated_by: str


class ExpiryRun(Camel):
    id: str
    at: str
    status: Literal["ok", "partial", "failed"]
    lots_scanned: int
    rows_rejected: int
    at_risk: int
    rule_version: int
    duration_ms: int
    source_version: str
    trigger: Literal["schedule", "manual", "rule change"]


class FeedCheck(BaseModel):
    id: str
    name: str
    status: Literal["pass", "warn", "fail"]
    detail: str


class RejectedRow(BaseModel):
    row: str
    field: str
    value: str
    error: str


class ExpiryFeed(Camel):
    dataset: str
    version: str
    sources: list[str]
    as_of: str
    stale: bool
    checks: list[FeedCheck]
    rejected: list[RejectedRow]


class RuleChange(BaseModel):
    version: int
    at: str
    by: str
    change: str


class ExpiryState(Camel):
    rules: ExpiryRules
    lots: list[Lot]
    actions: list[ExpiryAction]
    runs: list[ExpiryRun]
    feed: ExpiryFeed
    rule_history: list[RuleChange]


class Workspace(Camel):
    tenant: Tenant
    incidents: list[SecurityIncident]
    invites: list[InviteCode]
    suppliers: list[Supplier]
    quotations: list[Quotation]
    members: list[Member]
    current_user_id: str
    documents: list[KbDocument]
    connectors: list[Connector]
    gold: list[GoldDataset]
    audit: list[AuditEvent]
    shipments: list[Shipment]
    stock: list[dict] = Field(default_factory=list)
    expiry: ExpiryState
    preview_roles: Optional[list[str]] = None
    preview_user_id: Optional[str] = None
    origin: Literal["demo", "setup", "join"] = "demo"


# ---------------------------------------------------------------- requests

class LoginRequest(BaseModel):
    email: str
    password: str


class DemoLoginRequest(BaseModel):
    persona: Literal["owner", "driver", "procurement", "data_architect"]


class SelectCompanyRequest(BaseModel):
    company_id: str


class CreateCompanyRequest(Camel):
    name: str = Field(min_length=2, max_length=120)
    industry: str = "Process manufacturing"
    size: str = "200–1,000"
    locations: list[str] = Field(default_factory=list)
    context: str = ""
    enabled_modules: list[str] = Field(default_factory=list)


class ProfilePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    industry: Optional[str] = None
    size: Optional[str] = None
    locations: Optional[list[str]] = None
    context: Optional[str] = None


class ModulesRequest(Camel):
    enabled_modules: list[str]


class RolesRequest(BaseModel):
    roles: list[str]


class AccessRequestBody(BaseModel):
    resource: str


class DocumentPatch(BaseModel):
    category: Optional[str] = None
    visibility: Optional[Literal["Company", "Module", "Restricted"]] = None
    module: Optional[str] = None


class RagQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    module: str = "dashboard"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    org_id: Optional[str] = None  # ignored — tenant comes from the token
    role: Optional[str] = None    # ignored — roles come from the database
    module: Optional[str] = None


class StatusRequest(BaseModel):
    status: ShipmentStatus


class AssignmentRequest(Camel):
    driver_id: Optional[str] = None


class DecisionRequest(BaseModel):
    decision: Literal["approved", "dismissed", "proposed"]


class ExpiryRulesPatch(Camel):
    critical_days: Optional[float] = None
    warning_days: Optional[float] = None
    scan_minutes: Optional[float] = None
    markdown_max_pct: Optional[float] = None
    min_confidence: Optional[float] = None


class CompileRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class RuleActiveRequest(BaseModel):
    active: bool


class AuditRunRequest(BaseModel):
    org_id: Optional[str] = None  # ignored


class RouteDenialRequest(Camel):
    requested_resource: str
    query: str = ""


class TriageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    preset: str = "pump_cavitation"
