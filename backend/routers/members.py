"""Members, roles, invitations and access requests."""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, snapshot
from ..auth import TokenUser, current_principal, current_user, issue_token
from ..permissions import RESOURCES, Principal, effective_grants, forbid, normalize_role, role_label
from ..schemas import AccessRequestBody, RolesRequest, dump
from ..security_log import audit_event

router = APIRouter(tags=["members"])
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DRIVER_SEATS = ["usr_jlee", "usr_rdiaz"]


def _roles(raw: list[str]) -> list[str]:
    roles = []
    for r in raw:
        n = normalize_role(r)
        if not n:
            raise HTTPException(422, detail=f"Unknown role: {r}")
        if n not in roles:
            roles.append(n)
    return roles


# ---------------------------------------------------------------- members

@router.get("/members")
def list_members(role: str | None = Query(default=None), p: Principal = Depends(current_principal)) -> list[dict]:
    wanted = normalize_role(role) if role else None
    if not p.can("team", "view") and not (wanted == "truck_driver" and p.can("transportation", "manage")):
        forbid(p, "team", f"{' + '.join(role_label(r) for r in p.roles)} lacks view on Team & access")
    return dump(snapshot.members(p.tenant_id, wanted))


@router.put("/members/{user_id}/roles")
def set_member_roles(user_id: str, body: RolesRequest, p: Principal = Depends(current_principal)) -> dict:
    if not p.can("team", "manage"):
        forbid(p, "team", f"{' + '.join(role_label(r) for r in p.roles)} lacks manage on Team & access")
    roles = _roles(body.roles)
    m = db.one("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?", [p.tenant_id, user_id])
    if not m:
        raise HTTPException(404, detail="Member not found")
    if user_id == p.user_id and "owner" in (m["roles"] or []) and "owner" not in roles:
        raise HTTPException(422, detail="The owner cannot remove their own Owner role")
    db.update("memberships", {"roles": roles}, {"tenant_id": p.tenant_id, "user_id": user_id})
    name = db.scalar("SELECT name FROM users WHERE id = ?", [user_id])
    audit_event(p, "Role changed", f"{name}: {' + '.join(role_label(r) for r in roles) or 'no roles'}", "info", "team")
    return dump(next(x for x in snapshot.members(p.tenant_id) if x.user_id == user_id))


# ---------------------------------------------------------------- invites

@router.post("/invites", status_code=201)
def create_invite(body: RolesRequest, p: Principal = Depends(current_principal)) -> dict:
    if not p.can("team", "manage"):
        forbid(p, "team", f"{' + '.join(role_label(r) for r in p.roles)} lacks manage on Team & access")
    roles = _roles(body.roles)
    if not roles:
        raise HTTPException(422, detail="Pick at least one role")
    c = snapshot.company(p.tenant_id)
    prefix = "".join(ch for ch in c["name"] if ch.isalpha())[:4].upper() or "NXS"
    tag = "DRV" if "truck_driver" in roles else "PRC" if "procurement_manager" in roles else "MBR"
    code = f"{prefix}-{tag}-{''.join(secrets.choice(CODE_ALPHABET) for _ in range(4))}"
    seat = None
    if "truck_driver" in roles:
        claimed = {r["seat_user_id"] for r in db.rows("SELECT seat_user_id FROM invites WHERE tenant_id = ? AND used_by IS NULL", [p.tenant_id])}
        active = {r["user_id"] for r in db.rows("SELECT user_id FROM memberships WHERE tenant_id = ? AND status = 'active'", [p.tenant_id])}
        seat = next((u for u in DRIVER_SEATS if u not in claimed and u not in active), None)
    now = datetime.now(timezone.utc)
    db.insert("invites", {"code": code, "tenant_id": p.tenant_id, "roles": roles, "created_by": p.user_name, "created_at": db.now_iso(),
                          "expires_at": (now + timedelta(days=14)).isoformat(), "seat_user_id": seat, "used_by": None})
    audit_event(p, "Invite created", f"{code} → {' + '.join(role_label(r) for r in roles)}", "info", "team")
    return dump(snapshot.invite_model(db.one("SELECT * FROM invites WHERE code = ?", [code])))


@router.get("/invites")
def list_invites(p: Principal = Depends(current_principal)) -> list[dict]:
    if not p.can("team", "manage"):
        forbid(p, "team", f"{' + '.join(role_label(r) for r in p.roles)} lacks manage on Team & access")
    return dump(snapshot.invites(p) if p.owner_like else [snapshot.invite_model(i) for i in db.rows(
        "SELECT * FROM invites WHERE tenant_id = ? ORDER BY created_at DESC", [p.tenant_id])])


def _valid_invite(code: str) -> dict:
    inv = db.one("SELECT * FROM invites WHERE upper(code) = upper(?)", [code.strip()])
    if not inv or inv["used_by"]:
        raise HTTPException(404, detail="Invite not found, already used or expired")
    try:
        expired = datetime.fromisoformat(inv["expires_at"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
    except (AttributeError, ValueError):
        expired = False
    if expired:
        raise HTTPException(404, detail="Invite not found, already used or expired")
    return inv


@router.get("/invites/{code}")
def preview_invite(code: str, u: TokenUser = Depends(current_user)) -> dict:
    inv = _valid_invite(code)
    c = snapshot.company(inv["tenant_id"])
    pages = [r for r in RESOURCES if r in effective_grants(inv["roles"], [], c["enabled_modules"] or [])]
    return {"code": inv["code"], "companyName": c["name"], "roles": inv["roles"], "invitedBy": inv["created_by"], "pages": pages}


@router.post("/invites/{code}/accept")
def accept_invite(code: str, u: TokenUser = Depends(current_user)) -> dict:
    inv = _valid_invite(code)
    tid = inv["tenant_id"]
    existing = db.one("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?", [tid, u.id])
    roles = list(dict.fromkeys([*(existing["roles"] if existing else []), *inv["roles"]]))
    db.insert("memberships", {"tenant_id": tid, "user_id": u.id, "roles": roles, "grants": existing["grants"] if existing else [],
                              "status": "active"}, replace=True)
    if inv["seat_user_id"]:  # a driver invite takes over the free seat's assigned deliveries
        db.execute("UPDATE shipments SET driver_id = ?, driver_name = ? WHERE tenant_id = ? AND driver_id = ?", [u.id, u.name, tid, inv["seat_user_id"]])
    db.update("invites", {"used_by": u.email}, {"code": inv["code"]})
    audit_event(None, "Invite accepted", f"{inv['code']} → {' + '.join(role_label(r) for r in inv['roles'])}", "nv", "team",
                tenant_id=tid, actor=u.email.split("@")[0])
    c = snapshot.company(tid)
    return {"company_id": tid, "company_name": c["name"], "roles": roles,
            "access_token": issue_token({"id": u.id, "name": u.name, "email": u.email}, tid)["access_token"]}


# ---------------------------------------------------------------- access requests

@router.post("/access-requests", status_code=201)
def request_access(body: AccessRequestBody, p: Principal = Depends(current_principal)) -> dict:
    if body.resource not in RESOURCES:
        raise HTTPException(422, detail="Unknown resource")
    rid = f"ar_{uuid.uuid4().hex[:10]}"
    db.insert("access_requests", {"id": rid, "tenant_id": p.tenant_id, "user_id": p.user_id, "resource": body.resource,
                                  "created_at": db.now_iso(), "status": "pending"})
    audit_event(p, "Access requested", f"{p.user_name} requested access to {body.resource}", "info", "team")
    return {"id": rid, "status": "pending"}
