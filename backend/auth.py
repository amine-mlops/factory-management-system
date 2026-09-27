"""JWT (HS256) sessions, PBKDF2 password hashing and the identity dependencies."""
from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import get_settings
from .permissions import Principal, effective_grants

PBKDF2_ROUNDS = 200_000
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()
    return digest, salt


def verify_password(password: str, digest: str, salt: str) -> bool:
    return hmac.compare_digest(hash_password(password, salt)[0], digest)


def issue_token(user: dict, company_id: str | None) -> dict:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_ttl_minutes)
    token = jwt.encode({"sub": user["id"], "cid": company_id, "exp": exp}, s.secret, algorithm="HS256")
    return {
        "access_token": token, "token_type": "bearer", "expires_in": s.jwt_ttl_minutes * 60,
        "user": {"id": user["id"], "name": user["name"], "email": user["email"]},
    }


def first_company(user_id: str) -> str | None:
    return db.scalar("SELECT tenant_id FROM memberships WHERE user_id = ? AND status = 'active' ORDER BY tenant_id", [user_id])


@dataclass
class TokenUser:
    id: str
    name: str
    email: str
    company_id: str | None


def _unauthorized(msg: str = "Not authenticated") -> HTTPException:
    return HTTPException(401, detail=msg, headers={"WWW-Authenticate": "Bearer"})


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> TokenUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        claims = jwt.decode(creds.credentials, get_settings().secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid token")
    user = db.one("SELECT id, name, email FROM users WHERE id = ?", [claims["sub"]])
    if not user:
        raise _unauthorized("Unknown user")
    return TokenUser(user["id"], user["name"], user["email"], claims.get("cid"))


def load_principal(user_id: str, tenant_id: str) -> Principal | None:
    m = db.one(
        "SELECT m.roles, m.grants, u.name, u.email, c.enabled_modules FROM memberships m "
        "JOIN users u ON u.id = m.user_id JOIN companies c ON c.id = m.tenant_id "
        "WHERE m.tenant_id = ? AND m.user_id = ? AND m.status = 'active'", [tenant_id, user_id])
    if not m:
        return None
    enabled = m["enabled_modules"] or []
    return Principal(user_id=user_id, user_name=m["name"], email=m["email"], tenant_id=tenant_id, roles=m["roles"] or [],
                     grants=effective_grants(m["roles"] or [], m["grants"] or [], enabled), enabled_modules=enabled)


def current_principal(u: TokenUser = Depends(current_user)) -> Principal:
    """Tenant + roles come only from the verified token's `cid` and the membership table."""
    if not u.company_id:
        raise HTTPException(403, detail={"decision": "denied", "stage": "api", "reason": "No company selected"})
    p = load_principal(u.id, u.company_id)
    if p is None:
        raise HTTPException(403, detail={"decision": "denied", "stage": "api", "reason": "Not a member of this company"})
    return p
