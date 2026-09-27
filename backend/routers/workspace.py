"""Workspace snapshot, company profile, modules and the caller's grants."""
import uuid

from fastapi import APIRouter, Depends, HTTPException

from .. import db, snapshot
from ..auth import TokenUser, current_principal, current_user, issue_token
from ..permissions import IMPLEMENTED_MODULES, MODULE_LABELS, MODULES, Principal, require
from ..schemas import CreateCompanyRequest, ModulesRequest, ProfilePatch, dump
from ..security_log import audit_event

router = APIRouter(tags=["workspace"])


@router.get("/workspace")
def workspace(p: Principal = Depends(current_principal)) -> dict:
    return snapshot.build(p)


@router.post("/workspaces", status_code=201)
def create_company(body: CreateCompanyRequest, u: TokenUser = Depends(current_user)) -> dict:
    from demo.seed import CONNECTORS, GOLD_DATASETS

    tid = f"tnt_{uuid.uuid4().hex[:8]}"
    modules = [m for m in body.enabled_modules if m in MODULES]
    db.insert("companies", {"id": tid, "name": body.name.strip(), "industry": body.industry, "size": body.size, "locations": body.locations,
                            "context": body.context, "enabled_modules": modules, "created_at": db.now_iso(), "origin": "setup"})
    db.insert("memberships", {"tenant_id": tid, "user_id": u.id, "roles": ["owner"], "grants": [], "status": "active"})
    for c in CONNECTORS:
        db.insert("sources", {**c, "tenant_id": tid, "connected": False, "health": "disconnected", "warning": None})
    for (gid, name, srcs, mods, task, fresh, q, tone, ver, as_of, stale) in GOLD_DATASETS:
        db.insert("gold_datasets", {"tenant_id": tid, "id": gid, "name": name, "sources": srcs, "modules": mods, "task": task,
                                    "freshness": fresh, "quality": q, "tone": tone, "version": ver, "as_of": as_of, "stale": stale})
    audit_event(None, "Workspace launched", f"{len(modules)} modules", "nv", "settings", tenant_id=tid, actor=u.email.split("@")[0])
    return {"tenant": dump(snapshot.tenant_model(snapshot.company(tid))), **issue_token({"id": u.id, "name": u.name, "email": u.email}, tid)}


@router.get("/workspaces/current")
def current_company(p: Principal = Depends(current_principal)) -> dict:
    return dump(snapshot.tenant_model(snapshot.company(p.tenant_id)))


@router.patch("/workspaces/current")
def patch_company(body: ProfilePatch, p: Principal = Depends(require("settings", "manage"))) -> dict:
    changes = body.model_dump(exclude_none=True)
    if changes:
        db.update("companies", changes, {"id": p.tenant_id})
        audit_event(p, "Company profile updated", ", ".join(sorted(changes)), "info", "settings")
    return dump(snapshot.tenant_model(snapshot.company(p.tenant_id)))


def _modules(tenant: str) -> list[dict]:
    enabled = snapshot.company(tenant)["enabled_modules"] or []
    return [{"id": m, "label": MODULE_LABELS[m], "enabled": m in enabled, "implemented": m in IMPLEMENTED_MODULES} for m in MODULES]


@router.get("/modules")
def modules(p: Principal = Depends(current_principal)) -> list[dict]:
    return _modules(p.tenant_id)


@router.put("/modules")
def set_modules(body: ModulesRequest, p: Principal = Depends(require("settings", "manage"))) -> list[dict]:
    bad = [m for m in body.enabled_modules if m not in MODULES]
    if bad:
        raise HTTPException(422, detail=f"Unknown modules: {', '.join(bad)}")
    before = set(snapshot.company(p.tenant_id)["enabled_modules"] or [])
    after = [m for m in MODULES if m in body.enabled_modules]
    db.update("companies", {"enabled_modules": after}, {"id": p.tenant_id})
    added, removed = sorted(set(after) - before), sorted(before - set(after))
    audit_event(p, "Modules updated", " · ".join([*(f"+ {m}" for m in added), *(f"− {m}" for m in removed)]) or "no change", "info", "settings")
    return _modules(p.tenant_id)


@router.get("/roles/grants")
def grants(p: Principal = Depends(current_principal)) -> list[dict]:
    return p.grant_list()
