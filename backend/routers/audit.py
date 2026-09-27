"""Audit rules, operational audit runs, security events and the audit trail."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .. import audit_engine, db, snapshot
from ..auth import current_principal
from ..permissions import RESOURCE_LABELS, RESOURCES, Principal, denial_reason, require
from ..schemas import AuditRunRequest, CompileRequest, RouteDenialRequest, RuleActiveRequest, dump
from ..security_log import record_incident

router = APIRouter(prefix="/audit", tags=["audit"])
RULE_EDITORS = [("settings", "manage"), ("inventory", "manage")]


@router.get("/rules")
def rules(p: Principal = Depends(require("", any_of=[("dashboard", "view"), ("data", "view")]))) -> list[dict]:
    return audit_engine.load_rules(p.tenant_id)


@router.post("/rules/compile", status_code=201)
def compile_rule(body: CompileRequest, p: Principal = Depends(require("", any_of=RULE_EDITORS))) -> dict:
    return audit_engine.compile_rule(p, body.text)


@router.patch("/rules/{rule_id}")
def patch_rule(rule_id: str, body: RuleActiveRequest, p: Principal = Depends(require("", any_of=RULE_EDITORS))) -> dict:
    return audit_engine.set_active(p, rule_id, body.active)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, p: Principal = Depends(require("", any_of=RULE_EDITORS))) -> Response:
    audit_engine.delete_rule(p, rule_id)
    return Response(status_code=204)


@router.post("/run")
def run(body: AuditRunRequest | None = None, p: Principal = Depends(require("dashboard", "view"))) -> dict:
    # body.org_id is ignored — the tenant comes from the token.
    out = audit_engine.run(p.tenant_id, "manual", p)
    return {"status": out["status"], "total_rules_evaluated": out["total_rules_evaluated"], "violations": out["violations"], "run_id": out["id"]}


@router.get("/runs")
def runs(limit: int = Query(default=5, ge=1, le=50), p: Principal = Depends(require("dashboard", "view"))) -> list[dict]:
    return audit_engine.latest_runs(p, limit)


@router.get("/security-events")
def security_events(p: Principal = Depends(require("data", "view"))) -> list[dict]:
    return dump(snapshot.incidents(p))


@router.post("/security-events", status_code=201)
def log_route_denial(body: RouteDenialRequest, p: Principal = Depends(current_principal)) -> dict:
    """Route-guard incident — written only if the server agrees the caller lacks access."""
    resource = body.requested_resource
    if resource not in RESOURCES:
        raise HTTPException(422, detail="Unknown resource")
    if resource in p.grants:
        raise HTTPException(409, detail="Caller has access to this resource; no incident recorded")
    reason = denial_reason(p, resource, ["view"])
    iid = record_incident(p, resource, RESOURCE_LABELS.get(resource, resource), body.query or f"#/{resource}", "route", reason)
    return dump(snapshot.incident_model(db.one("SELECT * FROM security_events WHERE id = ?", [iid])))


@router.get("/events")
def events(p: Principal = Depends(current_principal)) -> list[dict]:
    return dump(snapshot.audit(p, limit=200))
