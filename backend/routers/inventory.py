"""Perishable Expiry Guard endpoints."""
from fastapi import APIRouter, Depends

from .. import expiry
from ..auth import current_principal
from ..permissions import Principal, require
from ..schemas import DecisionRequest, ExpiryRulesPatch

router = APIRouter(prefix="/inventory/expiry", tags=["inventory"])


@router.get("/lots")
def lots(p: Principal = Depends(require("inventory", "read_records"))) -> list[dict]:
    r = expiry.rules_row(p.tenant_id)
    return [expiry.lot_json(x, r) for x in expiry.lot_rows(p.tenant_id)]


@router.get("/actions")
def actions(p: Principal = Depends(require("", any_of=[("inventory", "read_records"), ("procurement", "read_records")]))) -> list[dict]:
    rows = [expiry.action_json(a) for a in expiry.action_rows(p.tenant_id)]
    return rows if p.can("inventory", "read_records") else [a for a in rows if a["kind"] == "supplier_return"]


@router.post("/actions/{aid}/decision")
def decide(aid: str, body: DecisionRequest, p: Principal = Depends(require("", any_of=[("inventory", "manage"), ("procurement", "manage")]))) -> dict:
    return expiry.decide(p, aid, body.decision)


@router.get("/rules")
def get_rules(p: Principal = Depends(require("", any_of=[("inventory", "view"), ("procurement", "view"), ("data", "view")]))) -> dict:
    return expiry.rules_json(expiry.rules_row(p.tenant_id))


@router.put("/rules")
def put_rules(body: ExpiryRulesPatch, p: Principal = Depends(require("inventory", "manage"))) -> dict:
    patch = {k: v for k, v in body.model_dump(by_alias=True).items() if v is not None}
    return expiry.update_rules(p, patch)


@router.get("/runs")
def runs(p: Principal = Depends(require("inventory", "view"))) -> list[dict]:
    return expiry.runs(p.tenant_id)


@router.post("/scan")
def scan(p: Principal = Depends(require("", any_of=[("inventory", "manage"), ("inventory", "configure")]))) -> dict:
    return expiry.scan(p.tenant_id, "manual", p)


@router.get("/state")
def state(p: Principal = Depends(current_principal)) -> dict:
    return expiry.state_for(p)
