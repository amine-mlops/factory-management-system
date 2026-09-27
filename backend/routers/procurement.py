"""Suppliers, quotations and awards."""
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, snapshot
from ..permissions import Principal, require
from ..schemas import dump
from ..security_log import audit_event

router = APIRouter(prefix="/procurement", tags=["procurement"])


@router.get("/suppliers")
def suppliers(p: Principal = Depends(require("procurement", "read_records"))) -> list[dict]:
    return dump(snapshot.suppliers(p))


@router.get("/quotations")
def quotations(rfq: str | None = Query(default=None), p: Principal = Depends(require("procurement", "read_records"))) -> list[dict]:
    return dump(snapshot.quotations(p, rfq))


@router.post("/quotations/{qid}/award")
def award(qid: str, p: Principal = Depends(require("procurement", "manage"))) -> dict:
    q = db.one("SELECT * FROM quotations WHERE quote_id = ? AND tenant_id = ?", [qid, p.tenant_id])
    if not q:
        raise HTTPException(404, detail="Quotation not found")
    db.execute("UPDATE quotations SET status = 'Received' WHERE tenant_id = ? AND rfq = ? AND item = ? AND quote_id <> ? AND status = 'Awarded'",
               [p.tenant_id, q["rfq"], q["item"], qid])
    db.execute("UPDATE quotations SET status = 'Awarded' WHERE quote_id = ? AND tenant_id = ?", [qid, p.tenant_id])
    po = f"PO-{q['rfq'].split('-')[-1]}-{qid.split('-')[-1]}"
    supplier = db.scalar("SELECT name FROM suppliers WHERE supplier_id = ? AND tenant_id = ?", [q["supplier_id"], p.tenant_id]) or q["supplier_id"]
    audit_event(p, "Quotation awarded", f"{qid} ({supplier}) for {q['rfq']} · draft {po}", "nv", "procurement")
    return {"quotations": dump(snapshot.quotations(p)), "purchaseOrderDraft": po}
