"""Shipments: list (scoped), status updates (drivers: own rows only) and assignment."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, snapshot
from ..permissions import Principal, forbid, require
from ..schemas import AssignmentRequest, StatusRequest, dump
from ..security_log import audit_event

router = APIRouter(prefix="/shipments", tags=["transportation"])


def _get(p: Principal, sid: str) -> dict:
    s = db.one("SELECT * FROM shipments WHERE shipment_id = ? AND tenant_id = ?", [sid, p.tenant_id])
    if not s:
        raise HTTPException(404, detail="Shipment not found")
    return s


@router.get("")
def list_shipments(p: Principal = Depends(require("transportation", "read_records"))) -> list[dict]:
    return dump(snapshot.shipments(p))


@router.patch("/{sid}/status")
def set_status(sid: str, body: StatusRequest, p: Principal = Depends(require("transportation", "update_status"))) -> dict:
    s = _get(p, sid)
    if p.scope("transportation") == "assigned" and s["driver_id"] != p.user_id:
        forbid(p, "transportation", f"{sid} is not assigned to {p.user_name}")
    db.update("shipments", {"status": body.status}, {"shipment_id": sid, "tenant_id": p.tenant_id})
    audit_event(p, "Shipment status updated", f"{sid} → {body.status} ({s['customer']})", "nv", "transportation")
    return dump(snapshot.shipment_model(_get(p, sid)))


@router.patch("/{sid}/assignment")
def assign(sid: str, body: AssignmentRequest, p: Principal = Depends(require("transportation", "manage"))) -> dict:
    s = _get(p, sid)
    name = "Unassigned"
    if body.driver_id:
        m = db.one("SELECT u.name, m.roles FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND m.user_id = ? "
                   "AND m.status = 'active'", [p.tenant_id, body.driver_id])
        if not m or "truck_driver" not in (m["roles"] or []):
            raise HTTPException(422, detail="driverId must be an active driver in this company")
        name = m["name"]
    db.update("shipments", {"driver_id": body.driver_id, "driver_name": name}, {"shipment_id": sid, "tenant_id": p.tenant_id})
    audit_event(p, "Shipment assigned", f"{sid} → {name} ({s['customer']})", "info", "transportation")
    return dump(snapshot.shipment_model(_get(p, sid)))
