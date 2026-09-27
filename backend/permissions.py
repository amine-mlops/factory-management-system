"""RBAC — a server-side mirror of frontend/src/lib/access.ts and guard.ts.

Deny by default: every route declares the (resource, action) it needs via
`require()`. Tenant, user and roles come only from the verified JWT plus the
database — never from a body, header or query string sent by the browser.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

from fastapi import Depends, HTTPException

ACTIONS = ["view", "read_records", "update_status", "manage", "configure", "query_ai"]
RESOURCES = [
    "dashboard", "triage", "manufacturing", "inventory", "procurement", "warehousing", "distribution",
    "transportation", "crm", "it", "knowledge", "data", "team", "settings",
]
MODULES = ["procurement", "inventory", "transportation", "warehousing", "manufacturing", "distribution", "crm", "it"]
MODULE_LABELS = {
    "manufacturing": "Manufacturing", "inventory": "Inventory", "procurement": "Procurement", "warehousing": "Warehousing",
    "distribution": "Distribution", "transportation": "Transportation", "crm": "Customer Service", "it": "IT Services",
}
IMPLEMENTED_MODULES = ["transportation", "procurement", "inventory"]
RESOURCE_LABELS = {
    **MODULE_LABELS, "dashboard": "Company overview", "triage": "Autonomous triage", "knowledge": "Knowledge base",
    "data": "Data & pipelines", "team": "Team & access", "settings": "Company settings",
}


def _g(resource: str, actions: list[str], scope: str = "tenant") -> dict:
    return {"resource": resource, "actions": actions, "scope": scope}


ROLES: dict[str, dict] = {
    "owner": {"label": "Owner", "grants": [_g(r, ACTIONS) for r in RESOURCES]},
    "admin": {"label": "Admin", "grants": [_g(r, ACTIONS) for r in RESOURCES]},
    "data_architect": {"label": "Data Architect", "grants": [
        _g("data", ["view", "configure", "query_ai"]), _g("knowledge", ["view", "configure"]), _g("inventory", ["view", "configure"])]},
    "procurement_manager": {"label": "Procurement", "grants": [
        _g("procurement", ["view", "read_records", "manage", "query_ai"]), _g("knowledge", ["view"])]},
    "inventory_planner": {"label": "Inventory Planner", "grants": [
        _g("dashboard", ["view"]), _g("inventory", ["view", "read_records", "manage", "query_ai"]),
        _g("warehousing", ["view", "read_records"]), _g("knowledge", ["view"])]},
    "truck_driver": {"label": "Driver", "grants": [
        _g("transportation", ["view", "read_records", "update_status", "query_ai"], "assigned")]},
    "transportation_manager": {"label": "Transportation Manager", "grants": [
        _g("dashboard", ["view"]), _g("transportation", ["view", "read_records", "update_status", "manage", "query_ai"]),
        _g("knowledge", ["view"])]},
    "warehouse_operator": {"label": "Warehouse Operator", "grants": [
        _g("warehousing", ["view", "read_records", "update_status"]), _g("inventory", ["view", "read_records", "query_ai"])]},
    "manufacturing_engineer": {"label": "Manufacturing Engineer", "grants": [
        _g("dashboard", ["view"]), _g("manufacturing", ["view", "read_records", "manage", "query_ai"]),
        _g("triage", ["view", "manage"]), _g("knowledge", ["view"])]},
    "distribution_lead": {"label": "Distribution Lead", "grants": [
        _g("dashboard", ["view"]), _g("distribution", ["view", "read_records", "manage"]),
        _g("transportation", ["view", "read_records"]), _g("warehousing", ["view", "read_records"])]},
    "customer_service": {"label": "Customer Service Agent", "grants": [
        _g("crm", ["view", "read_records", "update_status", "query_ai"]), _g("knowledge", ["view"])]},
    "it_security": {"label": "IT / Security", "grants": [
        _g("dashboard", ["view"]), _g("it", ["view", "read_records", "manage"]), _g("data", ["view", "configure", "query_ai"])]},
}

# AGENTS.md role names are accepted on input only.
ROLE_ALIASES = {"executive": "owner", "driver": "truck_driver", "procurement": "procurement_manager"}


def normalize_role(role: str) -> str | None:
    r = ROLE_ALIASES.get(role, role)
    return r if r in ROLES else None


def role_label(role: str) -> str:
    return ROLES.get(role, {}).get("label", role)


@dataclass
class Principal:
    user_id: str
    user_name: str
    email: str
    tenant_id: str
    roles: list[str]
    grants: dict[str, dict] = field(default_factory=dict)
    enabled_modules: list[str] = field(default_factory=list)

    def can(self, resource: str, action: str) -> bool:
        return action in self.grants.get(resource, {}).get("actions", set())

    def scope(self, resource: str) -> str | None:
        return self.grants.get(resource, {}).get("scope")

    @property
    def owner_like(self) -> bool:
        return "owner" in self.roles or "admin" in self.roles

    @property
    def actor(self) -> str:
        return self.email.split("@")[0] or self.user_name

    def readable_modules(self) -> set[str]:
        return {m for m in MODULES if self.can(m, "read_records")}

    def grant_list(self) -> list[dict]:
        return [{"resource": r, "actions": sorted(g["actions"], key=ACTIONS.index), "scope": g["scope"]}
                for r, g in self.grants.items()]


def available(resource: str, enabled: list[str]) -> bool:
    if resource in MODULES:
        return resource in enabled
    if resource == "triage":
        return "manufacturing" in enabled
    return True


def effective_grants(roles: list[str], explicit: list[str], enabled_modules: list[str]) -> dict[str, dict]:
    """Union of role grants + explicit member grants, intersected with the company's enabled modules."""
    contributing = [g for r in roles for g in ROLES.get(r, {}).get("grants", [])]
    contributing += [_g(m, ["view", "read_records"]) for m in explicit if m in MODULES]
    out: dict[str, dict] = {}
    for g in contributing:
        if not available(g["resource"], enabled_modules):
            continue
        cur = out.get(g["resource"])
        if cur is None:
            out[g["resource"]] = {"actions": set(g["actions"]), "scope": g["scope"]}
        else:
            cur["actions"].update(g["actions"])
            if g["scope"] == "tenant":
                cur["scope"] = "tenant"
    return out


def denial_reason(p: Principal, resource: str, missing: list[str], label: str | None = None) -> str:
    name = (label or RESOURCE_LABELS.get(resource, resource)).split(" · ")[0]
    if not available(resource, p.enabled_modules):
        return f"{name} is not enabled for this company"
    return f"{' + '.join(role_label(r) for r in p.roles) or 'No role'} lacks {' + '.join(missing)} on {name}"


# ---------------------------------------------------------------- route dependency


def require(resource: str, *actions: str, any_of: list[tuple[str, str]] | None = None) -> Callable[..., Principal]:
    """FastAPI dependency: the caller needs every `action` on `resource` (or any pair in `any_of`)."""
    from .auth import current_principal  # local import avoids a cycle

    def dep(p: Principal = Depends(current_principal)) -> Principal:
        if any_of:
            ok = any(p.can(r, a) for r, a in any_of)
            missing = [f"{a} on {r}" for r, a in any_of]
            reason = f"{' + '.join(role_label(r) for r in p.roles) or 'No role'} lacks any of: {', '.join(missing)}"
        else:
            miss = [a for a in actions if not p.can(resource, a)]
            ok = not miss
            reason = denial_reason(p, resource, miss) if miss else ""
        if not ok:
            forbid(p, resource or (any_of or [("dashboard", "")])[0][0], reason)
        return p

    return dep


def forbid(p: Principal, resource: str, reason: str, query: str = "") -> None:
    """Log a security event and raise the 403 described in MASTER_SPEC §4."""
    from . import security_log

    inc = security_log.record_incident(p, resource, RESOURCE_LABELS.get(resource, resource), query, "api", reason)
    raise HTTPException(403, detail={"decision": "denied", "stage": "api", "resource": resource, "reason": reason, "incidentId": inc})


# ---------------------------------------------------------------- pre-retrieval gate (port of guard.ts)

GATE_RULES: list[tuple[str, str, re.Pattern]] = [
    ("cross_tenant", "Another tenant (Borealis Foods)", re.compile(r"\bborealis\b|other (company|tenant)", re.I)),
    ("crm", "CRM · customer accounts & margins", re.compile(r"\b(crm|customers?|margins?|accounts?|cases?|churn)\b", re.I)),
    ("procurement", "Procurement · quotations & supplier pricing", re.compile(
        r"\b(procure\w*|purchase|po|suppliers?|pricing|prices?|contracts?|quot\w*|rfq\w*|award\w*|sla|slas|vendor\w*)\b", re.I)),
    ("inventory", "Inventory · lots, expiry & stock", re.compile(
        r"\b(inventory|stock|spares?|reorder|lots?|batch(es)?|shelf[- ]?life|fefo|perishabl\w*|markdowns?|dairy|yogurt|milk|salmon|"
        r"expir(?:y|es|ed|ing|e)(?![- ](?:scans?|feeds?|checks?|rules?|pipelines?|agent)))\b", re.I)),
    ("manufacturing", "Manufacturing · lines & machinery", re.compile(
        r"\b(manufactur\w*|oee|pumps?|turbines?|compressors?|triage|cavitation)\b", re.I)),
    ("settings", "Company settings · payroll & admin", re.compile(r"\b(salary|salaries|payroll|admin\w*)\b", re.I)),
    ("data", "Data & pipelines · sources, lineage, security log", re.compile(
        r"\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|tms|wms|erp|s3|"
        r"datasets?|incidents?|denied|security|scans?|feeds?|validation|rejected)\b", re.I)),
    ("transportation", "Transportation · shipments", re.compile(
        r"\b(routes?|delivery|deliveries|shipments?|loads?|stops?|etas?|handling|brief\w*|shift|driver|dispatch|trucks?|"
        r"trk-\d+|transit|spoil\w*)\b", re.I)),
]
TECHNICAL = re.compile(
    r"\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|feeds?|scans?|"
    r"validation|freshness|datasets?|rejected)\b", re.I)
BUSINESS = ["transportation", "procurement", "inventory", "manufacturing", "warehousing", "distribution", "crm", "it"]


def required_actions(resource: str) -> list[str]:
    if resource == "data":
        return ["view", "query_ai"]
    if resource == "settings":
        return ["manage"]
    if resource in ("dashboard", "knowledge", "team", "triage"):
        return ["view"]
    return ["query_ai", "read_records"]


@dataclass
class GateDecision:
    allowed: bool
    resource: str
    label: str
    reason: str
    metadata_only: bool = False
    targets: list[str] = field(default_factory=list)


def _classify(query: str, p: Principal, context: str) -> GateDecision:
    hits = [(r, label) for r, label, pat in GATE_RULES if pat.search(query)]
    targets = hits or [(context if context in RESOURCES else "dashboard", RESOURCE_LABELS.get(context, context))]
    primary = targets[0]
    if any(r == "cross_tenant" for r, _ in targets):
        return GateDecision(False, "cross_tenant", "Another tenant (Borealis Foods)",
                            f"Cross-tenant request — caller is bound to {p.tenant_id}")
    for r, label in targets:
        missing = [a for a in required_actions(r) if not p.can(r, a)]
        if missing:
            return GateDecision(False, r, label, denial_reason(p, r, missing, label))
    return GateDecision(True, primary[0], primary[1], "Authorized", targets=[r for r, _ in targets])


def authorize_query(query: str, p: Principal, context: str) -> GateDecision:
    """Pre-retrieval gate: runs before any SQL, retrieval or model call."""
    d = _classify(query, p, context)
    if (not d.allowed and d.resource in BUSINESS and TECHNICAL.search(query)
            and p.can("data", "view") and p.can("data", "query_ai")):
        name = d.label.split(" · ")[0]
        return GateDecision(True, "data", "Data & pipelines · metadata only",
                            f"Metadata only — {name} records stay filtered at retrieval", metadata_only=True, targets=["data"])
    return d
