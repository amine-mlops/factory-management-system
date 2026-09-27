"""Data platform metadata — sources and pipelines, never business rows."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, snapshot
from ..permissions import Principal, require
from ..schemas import dump
from ..security_log import audit_event

router = APIRouter(tags=["data"])


@router.get("/sources")
def sources(p: Principal = Depends(require("data", "view"))) -> list[dict]:
    return dump(snapshot.connectors(p))


def _toggle(p: Principal, sid: str, connect: bool) -> dict:
    from demo.seed import CONNECTORS

    row = db.one("SELECT * FROM sources WHERE id = ? AND tenant_id = ?", [sid, p.tenant_id])
    if not row:
        raise HTTPException(404, detail="Source not found")
    if connect:
        seed = next((c for c in CONNECTORS if c["id"] == sid), None)
        values = {k: v for k, v in (seed or {}).items() if k != "id"} | {"connected": True}
        if seed and "warning" not in seed:
            values["warning"] = None
    else:
        values = {"connected": False, "health": "disconnected", "warning": None}
    db.update("sources", values, {"id": sid, "tenant_id": p.tenant_id})
    audit_event(p, "Source connected" if connect else "Source disconnected", f"{row['kind']} · {row['name']}", "info", "data")
    return dump(snapshot.connector_model(db.one("SELECT * FROM sources WHERE id = ? AND tenant_id = ?", [sid, p.tenant_id])))


@router.post("/sources/{sid}/connect")
def connect(sid: str, p: Principal = Depends(require("data", "configure"))) -> dict:
    return _toggle(p, sid, True)


@router.post("/sources/{sid}/disconnect")
def disconnect(sid: str, p: Principal = Depends(require("data", "configure"))) -> dict:
    return _toggle(p, sid, False)


@router.get("/pipelines")
def pipelines(p: Principal = Depends(require("data", "view"))) -> list[dict]:
    return dump(snapshot.gold(p))
