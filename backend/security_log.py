"""Security incidents (denied requests) and the audit trail for every mutation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from . import db

if TYPE_CHECKING:
    from .permissions import Principal


def _clock() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def audit_event(p: "Principal | None", action: str, detail: str, tone: str = "info", resource: str | None = None,
                tenant_id: str | None = None, actor: str | None = None) -> str:
    eid = f"au_{uuid.uuid4().hex[:12]}"
    db.insert("audit_events", {
        "id": eid, "tenant_id": tenant_id or (p.tenant_id if p else None), "time": _clock(), "tone": tone,
        "actor": actor or (p.actor if p else "system"), "action": action, "detail": detail, "resource": resource,
        "at": db.now_iso(),
    })
    return eid


def record_incident(p: "Principal", resource: str, label: str, query: str, stage: str, reason: str) -> str:
    """Write a DENY security event (0 chunks, nothing sent to the model) plus an 'Access denied (403)' audit row."""
    iid = f"inc_{uuid.uuid4().hex[:12]}"
    db.insert("security_events", {
        "id": iid, "tenant_id": p.tenant_id, "at": db.now_iso(), "user_id": p.user_id, "user_name": p.user_name,
        "roles": p.roles, "requested_resource": label or resource, "query": query or "", "decision": "DENY",
        "stage": stage, "reason": reason, "chunks_retrieved": 0, "sent_to_model": False,
    })
    audit_event(p, "Access denied (403)", f"{label or resource} · {stage} · 0 chunks", "crit", "data")
    return iid
