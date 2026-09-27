"""GET /api/workspace — the RBAC-projected Workspace the UI renders (MASTER_SPEC §7.2).

Also holds the row → camelCase mappers the routers reuse.
"""
from __future__ import annotations

from . import db, expiry, rag_engine
from .permissions import MODULES, Principal
from .schemas import (AuditEvent, Connector, GoldDataset, InviteCode, KbDocument, Member, Quotation, SecurityIncident, Shipment,
                      Supplier, Tenant, Workspace, dump)


# ---------------------------------------------------------------- mappers

def tenant_model(c: dict) -> Tenant:
    return Tenant(tenant_id=c["id"], name=c["name"], industry=c["industry"] or "", size=c["size"] or "", locations=c["locations"] or [],
                  context=c["context"] or "", enabled_modules=c["enabled_modules"] or [])


def member_model(m: dict) -> Member:
    return Member(user_id=m["user_id"], name=m["name"], email=m["email"], roles=m["roles"] or [], grants=m["grants"] or [],
                  status=m["status"] if m["status"] in ("active", "invited") else "active")


def document_model(d: dict) -> KbDocument:
    return KbDocument(id=d["id"], name=d["name"], size_kb=d["size_kb"] or 0, category=d["category"] or "", visibility=d["visibility"],
                      module=d["module"], status=d["status"], progress=d["progress"] or 0, chunks=d["chunks"] or 0, error=d.get("error"))


def connector_model(s: dict) -> Connector:
    return Connector(id=s["id"], kind=s["kind"], name=s["name"], detail=s["detail"], connected=bool(s["connected"]), freshness=s["freshness"],
                     sla=s["sla"], quality=s["quality"], errors=s["errors"], health=s["health"], warning=s["warning"],
                     rows_per_day=s["rows_per_day"], last_run=s["last_run"], last_success=s["last_success"])


def gold_model(g: dict) -> GoldDataset:
    return GoldDataset(id=g["id"], name=g["name"], sources=g["sources"] or [], modules=g["modules"] or [], task=g["task"],
                       freshness=g["freshness"], quality=g["quality"], tone=g["tone"], version=g["version"], as_of=g["as_of"], stale=bool(g["stale"]))


def audit_model(a: dict) -> AuditEvent:
    return AuditEvent(id=a["id"], time=a["time"], tone=a["tone"], actor=a["actor"], action=a["action"], detail=a["detail"], resource=a["resource"])


def incident_model(i: dict) -> SecurityIncident:
    return SecurityIncident(id=i["id"], at=i["at"], tenant_id=i["tenant_id"], user_id=i["user_id"], user_name=i["user_name"], roles=i["roles"] or [],
                            requested_resource=i["requested_resource"], query=i["query"] or "", stage=i["stage"], reason=i["reason"])


def invite_model(i: dict) -> InviteCode:
    return InviteCode(code=i["code"], tenant_id=i["tenant_id"], roles=i["roles"] or [], created_by=i["created_by"], created_at=i["created_at"],
                      seat_user_id=i["seat_user_id"], used_by=i["used_by"])


def supplier_model(s: dict) -> Supplier:
    return Supplier(id=s["supplier_id"], name=s["name"], category=s["category"], otif=s["otif"], rating=s["rating"], contract=s["contract"])


def quotation_model(q: dict) -> Quotation:
    return Quotation(id=q["quote_id"], rfq=q["rfq"], supplier_id=q["supplier_id"], item=q["item"], qty=q["qty"], unit_price=q["unit_price"],
                     currency=q["currency"], lead_time_days=q["lead_time_days"], valid_until=q["valid_until"], terms=q["terms"],
                     status=q["status"], document=q["document"], page=q["page"])


def shipment_model(s: dict) -> Shipment:
    vehicle = s["vehicle_id"] or "—"
    if s.get("vehicle_desc"):
        vehicle = f"{vehicle} · {s['vehicle_desc']}"
    return Shipment(id=s["shipment_id"], customer=s["customer"], origin=s["origin"], destination=s["destination"], address=s["address"] or "",
                    window=s["delivery_window"] or "", eta=s["eta"] or "", driver_id=s["driver_id"], driver_name=s["driver_name"] or "Unassigned",
                    vehicle=vehicle, pallets=s["pallets"] or 0, weight_kg=s["weight_kg"] or 0, handling=s["handling"] or "", status=s["status"],
                    stop_order=s["stop_order"] or 0, eta_as_of=s["eta_as_of"], eta_stale=s["eta_stale"], batch_id=s["batch_id"])


# ---------------------------------------------------------------- scoped reads

def members(tenant: str, role: str | None = None) -> list[Member]:
    rows = db.rows("SELECT m.user_id, m.roles, m.grants, m.status, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id "
                   "WHERE m.tenant_id = ? ORDER BY CASE WHEN m.user_id = 'usr_owner' THEN 0 ELSE 1 END, u.name", [tenant])
    out = [member_model(r) for r in rows]
    return [m for m in out if role in m.roles] if role else out


def shipments(p: Principal) -> list[Shipment]:
    if not p.can("transportation", "read_records"):
        return []
    if p.scope("transportation") == "assigned":
        rows = db.rows("SELECT * FROM shipments WHERE tenant_id = ? AND driver_id = ? ORDER BY stop_order", [p.tenant_id, p.user_id])
    else:
        rows = db.rows("SELECT * FROM shipments WHERE tenant_id = ? ORDER BY driver_name, stop_order", [p.tenant_id])
    return [shipment_model(r) for r in rows]


def documents(p: Principal) -> list[KbDocument]:
    rows = db.rows("SELECT * FROM documents WHERE tenant_id = ? ORDER BY id", [p.tenant_id])
    return [document_model(d) for d in rows if rag_engine.document_visible(p, d)]


def gold(p: Principal) -> list[GoldDataset]:
    rows = [gold_model(g) for g in db.rows("SELECT * FROM gold_datasets WHERE tenant_id = ? ORDER BY id", [p.tenant_id])]
    if p.owner_like or "data_architect" in p.roles:
        return rows
    readable = p.readable_modules()
    return [g for g in rows if readable & set(g.modules)]


def connectors(p: Principal) -> list[Connector]:
    rows = db.rows("SELECT * FROM sources WHERE tenant_id = ? ORDER BY rowid", [p.tenant_id])
    if p.owner_like or "data_architect" in p.roles:
        return [connector_model(s) for s in rows]
    # A connector "belongs" to the modules of the Gold datasets it feeds.
    fed = {src for g in gold(p) for src in g.sources}
    return [connector_model(s) for s in rows if s["id"] in fed]


def audit_visible(p: Principal, resource: str | None) -> bool:
    if p.owner_like:
        return True
    if not resource:
        return False
    return p.can(resource, "read_records") if resource in MODULES else p.can(resource, "view")


def audit(p: Principal, limit: int = 60) -> list[AuditEvent]:
    rows = db.rows('SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY "at" DESC LIMIT 400', [p.tenant_id])
    return [audit_model(a) for a in rows if audit_visible(p, a["resource"])][:limit]


def incidents(p: Principal) -> list[SecurityIncident]:
    if not (p.owner_like or "data_architect" in p.roles or p.can("data", "view")):
        return []
    return [incident_model(i) for i in db.rows('SELECT * FROM security_events WHERE tenant_id = ? ORDER BY "at" DESC LIMIT 50', [p.tenant_id])]


def invites(p: Principal) -> list[InviteCode]:
    if not p.owner_like:
        return []
    return [invite_model(i) for i in db.rows("SELECT * FROM invites WHERE tenant_id = ? ORDER BY created_at DESC", [p.tenant_id])]


def suppliers(p: Principal) -> list[Supplier]:
    if not p.can("procurement", "read_records"):
        return []
    return [supplier_model(s) for s in db.rows("SELECT * FROM suppliers WHERE tenant_id = ? ORDER BY rowid", [p.tenant_id])]


def quotations(p: Principal, rfq: str | None = None) -> list[Quotation]:
    if not p.can("procurement", "read_records"):
        return []
    sql, params = "SELECT * FROM quotations WHERE tenant_id = ?", [p.tenant_id]
    if rfq:
        sql, params = sql + " AND rfq = ?", params + [rfq]
    return [quotation_model(q) for q in db.rows(sql + " ORDER BY rowid", params)]


def company(tenant: str) -> dict:
    c = db.one("SELECT * FROM companies WHERE id = ?", [tenant])
    if not c:
        from fastapi import HTTPException

        raise HTTPException(404, detail="Company not found")
    return c


def build(p: Principal) -> dict:
    ws = Workspace(
        tenant=tenant_model(company(p.tenant_id)), members=members(p.tenant_id), current_user_id=p.user_id, documents=documents(p),
        connectors=connectors(p), gold=gold(p), audit=audit(p), incidents=incidents(p), invites=invites(p), suppliers=suppliers(p),
        quotations=quotations(p), shipments=shipments(p), stock=[], expiry=expiry.state_for(p), preview_roles=None, preview_user_id=None,
        origin=company(p.tenant_id).get("origin") or "demo")
    out = dump(ws)
    out["previewRoles"], out["previewUserId"] = None, None  # UX-only fields: always null from the server
    return out
