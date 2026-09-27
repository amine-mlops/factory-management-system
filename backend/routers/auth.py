"""/api/auth/* — login, demo personas, session and company switch."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import TokenUser, current_user, first_company, issue_token, verify_password
from ..config import get_settings
from ..permissions import normalize_role
from ..schemas import DemoLoginRequest, LoginRequest, SelectCompanyRequest
from ..security_log import audit_event

router = APIRouter(prefix="/auth", tags=["auth"])
PERSONAS = {"owner": "usr_owner", "driver": "usr_jlee", "procurement": "usr_tvos", "data_architect": "usr_pshah"}


@router.post("/login")
def login(body: LoginRequest) -> dict:
    user = db.one("SELECT * FROM users WHERE lower(email) = lower(?)", [body.email.strip()])
    if not user or not verify_password(body.password, user["password_hash"], user["salt"]):
        raise HTTPException(401, detail="Invalid email or password")
    cid = first_company(user["id"])
    if cid:
        audit_event(None, "Sign-in", "Password sign-in", "nv", "team", tenant_id=cid, actor=user["email"].split("@")[0])
    return issue_token(user, cid)


@router.post("/demo-login")
def demo_login(body: DemoLoginRequest) -> dict:
    if not get_settings().demo_mode:
        raise HTTPException(404, detail="Not Found")
    user = db.one("SELECT * FROM users WHERE id = ?", [PERSONAS[body.persona]])
    if not user:
        raise HTTPException(404, detail="Demo persona not seeded")
    return issue_token(user, first_company(user["id"]))


@router.get("/session")
def session(u: TokenUser = Depends(current_user)) -> dict:
    ms = db.rows("SELECT m.tenant_id, c.name, m.roles FROM memberships m JOIN companies c ON c.id = m.tenant_id "
                 "WHERE m.user_id = ? AND m.status = 'active' ORDER BY c.name", [u.id])
    return {"user": {"id": u.id, "name": u.name, "email": u.email},
            "memberships": [{"company_id": m["tenant_id"], "company_name": m["name"], "roles": [normalize_role(r) or r for r in m["roles"] or []]} for m in ms],
            "current_company_id": u.company_id}


@router.post("/company")
def select_company(body: SelectCompanyRequest, u: TokenUser = Depends(current_user)) -> dict:
    ok = db.scalar("SELECT count(*) FROM memberships WHERE user_id = ? AND tenant_id = ? AND status = 'active'", [u.id, body.company_id])
    if not ok:
        raise HTTPException(403, detail={"decision": "denied", "stage": "api", "reason": "Not a member of this company"})
    return issue_token({"id": u.id, "name": u.name, "email": u.email}, body.company_id)
