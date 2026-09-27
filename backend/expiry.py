"""Perishable Expiry Guard — a server-side port of frontend/src/lib/expiry.ts.

Nothing external is ever executed: approving a proposal only writes
"hand-off queued (simulated)" to the audit log.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import HTTPException

from . import db
from .permissions import Principal
from .security_log import audit_event

FEFO_POLICY = "Shelf_Life_and_FEFO_Policy_2026.pdf"
ACTION_LABELS = {"fefo": "FEFO reallocation", "dispatch": "Prioritized dispatch", "markdown": "Controlled markdown",
                 "quarantine": "Quarantine", "donation": "Donation / secondary channel", "supplier_return": "Supplier return"}


def severity_for(days: int, rules: dict) -> str:
    if days <= rules["critical_days"]:
        return "critical"
    if days <= rules["warning_days"]:
        return "warning"
    return "healthy"


# ---------------------------------------------------------------- reads


def rules_row(tenant: str) -> dict:
    r = db.one("SELECT * FROM expiry_rules WHERE tenant_id = ?", [tenant])
    if r:
        return r
    now = db.now_iso()
    r = {"tenant_id": tenant, "version": 1, "critical_days": 7, "warning_days": 21, "scan_minutes": 15, "markdown_max_pct": 30,
         "min_confidence": 0.6, "updated_at": now, "updated_by": "system", "history": [], "feed_dataset": "gold.lot_expiry",
         "feed_version": "v1", "feed_as_of": now, "feed_stale": False, "feed_sources": ["wms", "erp"]}
    db.insert("expiry_rules", r)
    return r


def rules_json(r: dict) -> dict:
    return {"version": r["version"], "criticalDays": r["critical_days"], "warningDays": r["warning_days"], "scanMinutes": r["scan_minutes"],
            "markdownMaxPct": r["markdown_max_pct"], "minConfidence": r["min_confidence"], "updatedAt": r["updated_at"],
            "updatedBy": r["updated_by"]}


def lot_rows(tenant: str) -> list[dict]:
    return db.rows("SELECT *, date_diff('day', current_date, expiry_date) AS days_remaining FROM inventory "
                   "WHERE tenant_id = ? AND expiry_date IS NOT NULL ORDER BY expiry_date, batch_id", [tenant])


def lot_json(row: dict, rules: dict) -> dict:
    days = int(row["days_remaining"])
    sev = severity_for(days, rules)
    value = float(row["qty"] or 0) * float(row["unit_value"] or 0)
    out = {"id": row["batch_id"], "sku": row["sku"], "product": row["product_name"], "batch": row.get("lot_batch") or row["batch_id"],
           "facility": row["warehouse_id"], "qty": row["qty"], "unit": row["unit"], "unitValue": row["unit_value"],
           "expiry": row["expiry_date"].isoformat() if hasattr(row["expiry_date"], "isoformat") else str(row["expiry_date"]),
           "storage": row["storage_class"] or "Ambient", "daysRemaining": days, "severity": sev,
           "valueAtRisk": 0 if sev == "healthy" else value}
    if row.get("supplier_id"):
        out["supplierId"] = row["supplier_id"]
    if row.get("valuation_estimated"):
        out["valuationEstimated"] = True
    return out


def action_json(a: dict) -> dict:
    out = {"id": a["id"], "kind": a["kind"], "lotId": a["lot_id"], "title": a["title"], "rationale": a["rationale"],
           "valueProtected": a["value_protected"], "confidence": a["confidence"], "external": bool(a["external"]), "route": a["route"],
           "status": a["status"], "policy": a["policy"] or []}
    if a.get("decided_by"):
        out["decidedBy"] = a["decided_by"]
    if a.get("decided_at"):
        out["decidedAt"] = a["decided_at"]
    return out


def action_rows(tenant: str) -> list[dict]:
    return db.rows("SELECT * FROM expiry_actions WHERE tenant_id = ? ORDER BY id", [tenant])


def run_json(r: dict) -> dict:
    return {"id": r["id"], "at": r["at"], "status": r["status"], "lotsScanned": r["lots_scanned"] or 0, "rowsRejected": r["rows_rejected"] or 0,
            "atRisk": r["at_risk"] or 0, "ruleVersion": r["rule_version"] or 0, "durationMs": r["duration_ms"] or 0,
            "sourceVersion": r["source_version"] or "", "trigger": r["trigger"]}


def runs(tenant: str, limit: int = 20) -> list[dict]:
    return [run_json(r) for r in db.rows('SELECT * FROM audit_runs WHERE tenant_id = ? AND kind = \'expiry\' ORDER BY "at" DESC LIMIT ?', [tenant, limit])]


def feed(tenant: str, rules: dict | None = None) -> dict:
    r = rules or rules_row(tenant)
    checks = db.rows("SELECT id, name, status, detail FROM feed_checks WHERE tenant_id = ? ORDER BY rowid", [tenant])
    rejected = db.rows("SELECT row_ref AS row, field, value, error FROM feed_rejected WHERE tenant_id = ? ORDER BY rowid", [tenant])
    return {"dataset": r["feed_dataset"], "version": r["feed_version"], "sources": r["feed_sources"] or [], "asOf": r["feed_as_of"],
            "stale": bool(r["feed_stale"]), "checks": checks, "rejected": rejected}


def default_state() -> dict:
    now = db.now_iso()
    return {"rules": {"version": 1, "criticalDays": 7, "warningDays": 21, "scanMinutes": 15, "markdownMaxPct": 30, "minConfidence": 0.6,
                      "updatedAt": now, "updatedBy": "system"},
            "lots": [], "actions": [], "runs": [],
            "feed": {"dataset": "gold.lot_expiry", "version": "—", "sources": [], "asOf": now, "stale": False, "checks": [], "rejected": []},
            "ruleHistory": []}


def state_for(p: Principal) -> dict:
    """RBAC-projected ExpiryState (MASTER_SPEC §7.2)."""
    r = rules_row(p.tenant_id)
    full = {"rules": rules_json(r), "runs": runs(p.tenant_id), "feed": feed(p.tenant_id, r), "ruleHistory": r["history"] or []}
    if p.can("inventory", "read_records"):
        return {**full, "lots": [lot_json(x, r) for x in lot_rows(p.tenant_id)], "actions": [action_json(a) for a in action_rows(p.tenant_id)]}
    if p.can("inventory", "configure") or p.can("data", "configure"):
        return {**full, "lots": [], "actions": []}
    if p.can("procurement", "read_records"):
        acts = [action_json(a) for a in action_rows(p.tenant_id) if a["kind"] == "supplier_return"]
        ids = {a["lotId"] for a in acts}
        lots = [{k: v for k, v in lot_json(x, r).items() if k in ("id", "sku", "product", "batch", "qty", "unit", "supplierId", "expiry")}
                for x in lot_rows(p.tenant_id) if x["batch_id"] in ids]
        return {**default_state(), "rules": rules_json(r), "lots": lots, "actions": acts}
    return default_state()


def summary(p: Principal) -> dict:
    """Counts for briefings (RBAC-projected)."""
    if not p.can("inventory", "read_records"):
        return {}
    r = rules_row(p.tenant_id)
    lots = [lot_json(x, r) for x in lot_rows(p.tenant_id)]
    risky = [l for l in lots if l["severity"] != "healthy"]
    proposed = [a for a in action_rows(p.tenant_id) if a["status"] == "proposed"]
    return {"lots": len(lots), "atRisk": len(risky), "critical": sum(l["severity"] == "critical" for l in risky),
            "expired": sum(l["daysRemaining"] < 0 for l in lots), "valueAtRisk": sum(l["valueAtRisk"] for l in risky),
            "proposed": len(proposed), "risky": risky}


# ---------------------------------------------------------------- mutations


def decide(p: Principal, action_id: str, decision: str) -> dict:
    a = db.one("SELECT * FROM expiry_actions WHERE id = ? AND tenant_id = ?", [action_id, p.tenant_id])
    if not a:
        raise HTTPException(404, detail="Action not found")
    ok = p.can("inventory", "manage") or (a["route"] == "procurement" and p.can("procurement", "manage"))
    if not ok:
        from .permissions import forbid

        forbid(p, "inventory", f"{' + '.join(p.roles)} cannot decide {a['route']} actions")
    decided = decision != "proposed"
    db.update("expiry_actions", {"status": decision, "decided_by": p.actor if decided else None,
                                 "decided_at": db.now_iso() if decided else None}, {"id": action_id})
    resource = "procurement" if a["route"] == "procurement" else "inventory"
    if decision == "approved":
        detail = f"{a['id']} {a['title']}" + (" — hand-off queued (simulated)" if a["external"] else " — hand-off queued (simulated, internal)")
        audit_event(p, "Expiry action approved", detail, "nv", resource)
    else:
        audit_event(p, f"Expiry action {decision}", f"{a['id']} {a['title']}", "info", resource)
    return action_json(db.one("SELECT * FROM expiry_actions WHERE id = ?", [action_id]))


FIELDS = [("criticalDays", "critical_days", "Critical window", lambda v: f"{v:g} d"),
          ("warningDays", "warning_days", "Warning window", lambda v: f"{v:g} d"),
          ("scanMinutes", "scan_minutes", "Scan cadence", lambda v: f"{v:g} min"),
          ("markdownMaxPct", "markdown_max_pct", "Markdown cap", lambda v: f"{v:g}%"),
          ("minConfidence", "min_confidence", "Min. confidence", lambda v: f"{v:.2f}")]


def update_rules(p: Principal, patch: dict) -> dict:
    r = rules_row(p.tenant_id)
    nxt = {col: patch.get(key, r[col]) if patch.get(key) is not None else r[col] for key, col, _, _ in FIELDS}
    crit, warn = nxt["critical_days"], nxt["warning_days"]
    if not float(crit).is_integer() or not 0 <= crit <= 60:
        raise HTTPException(422, detail="Critical window must be a whole number of days between 0 and 60.")
    if not float(warn).is_integer() or not crit < warn <= 120:
        raise HTTPException(422, detail="Warning window must be longer than the critical window and at most 120 days.")
    if not 0 <= nxt["markdown_max_pct"] <= 60:
        raise HTTPException(422, detail="Markdown cap must be between 0% and 60%.")
    if not 0.30 <= nxt["min_confidence"] <= 0.95:
        raise HTTPException(422, detail="Minimum confidence must be between 0.30 and 0.95.")
    if not 1 <= nxt["scan_minutes"] <= 1440:
        raise HTTPException(422, detail="Scan cadence must be between 1 and 1440 minutes.")
    diffs = [f"{label} {fmt(r[col])} → {fmt(nxt[col])}" for _, col, label, fmt in FIELDS if nxt[col] != r[col]]
    if not diffs:
        raise HTTPException(422, detail="No changes to save.")
    version = r["version"] + 1
    now = db.now_iso()
    change = " · ".join(diffs)
    history = [{"version": version, "at": now, "by": p.actor, "change": change}] + (r["history"] or [])
    db.update("expiry_rules", {"critical_days": int(crit), "warning_days": int(warn), "scan_minutes": int(nxt["scan_minutes"]),
                               "markdown_max_pct": nxt["markdown_max_pct"], "min_confidence": nxt["min_confidence"], "version": version,
                               "updated_at": now, "updated_by": p.actor, "history": history}, {"tenant_id": p.tenant_id})
    audit_event(p, "Expiry rules updated", f"v{version}: {change}", "info", "inventory")
    return rules_json(rules_row(p.tenant_id))


def _propose(lot: dict, rules: dict, n: int) -> dict | None:
    """Default mitigation for a newly at-risk lot (same heuristics as the UI's proposeFor)."""
    base = {"id": f"ACT-{2000 + n}", "lot_id": lot["id"], "status": "proposed"}
    days, value, qty, unit, sku = lot["daysRemaining"], lot["qty"] * lot["unitValue"], lot["qty"], lot["unit"], lot["sku"]
    qtys = f"{qty:g}" if isinstance(qty, float) else str(qty)
    if days < 0:
        return {**base, "kind": "quarantine", "title": f"Quarantine {qtys} {unit} of {sku} (expired)", "rationale": "Expired material may not be issued.",
                "value_protected": 0, "confidence": 0.97, "external": False, "route": "inventory", "policy": [{"document": FEFO_POLICY, "page": 3}]}
    if lot.get("supplierId") and days >= 18:
        return {**base, "kind": "supplier_return", "title": f"Return {qtys} {unit} of {sku} to the supplier",
                "rationale": f"{days} days of shelf life remain (policy requires ≥ 18).", "value_protected": round(value * 0.9), "confidence": 0.62,
                "external": True, "route": "procurement", "policy": [{"document": FEFO_POLICY, "page": 5}]}
    if lot["severity"] == "critical":
        cap = rules["markdown_max_pct"]
        return {**base, "kind": "markdown", "title": f"Offer {qtys} {unit} of {sku} at up to {cap:g}% markdown",
                "rationale": f"{days} days left and no scheduled shipment includes this lot.", "value_protected": round(value * (1 - cap / 100)),
                "confidence": 0.66, "external": True, "route": "inventory", "policy": [{"document": FEFO_POLICY, "page": 3}]}
    if lot["severity"] == "warning":
        return {**base, "kind": "fefo", "title": f"FEFO: issue {sku} lot {lot['batch']} first",
                "rationale": f"{days} days left; picking it before newer lots uses it before expiry.", "value_protected": value, "confidence": 0.8,
                "external": False, "route": "inventory", "policy": [{"document": FEFO_POLICY, "page": 2}]}
    return None


def propose_actions(tenant: str, lot_ids: set[str] | None = None) -> list[dict]:
    """Create proposals for at-risk lots that have no open (non-dismissed) action."""
    r = rules_row(tenant)
    existing = action_rows(tenant)
    open_lots = {a["lot_id"] for a in existing if a["status"] != "dismissed"}
    seq = max([int(a["id"].split("-")[-1]) - 2000 for a in existing if a["id"].startswith("ACT-2")] + [len(existing)])
    created = []
    for row in lot_rows(tenant):
        lot = lot_json(row, r)
        if lot["severity"] == "healthy" or lot["id"] in open_lots or (lot_ids is not None and lot["id"] not in lot_ids):
            continue
        a = _propose(lot, r, seq + len(created) + 1)
        if a and a["confidence"] >= r["min_confidence"]:
            db.insert("expiry_actions", {**a, "tenant_id": tenant, "decided_by": None, "decided_at": None, "created_at": db.now_iso()})
            created.append(a)
    return created


def scan(tenant: str, trigger: str = "manual", actor: Principal | None = None) -> dict:
    """One Expiry Guard run: re-classify lots, propose actions, bump the feed version, log the run (RULE-EXP-* rules)."""
    from . import audit_engine

    t0 = time.perf_counter()
    r = rules_row(tenant)
    exp_rules = [x for x in audit_engine.load_rules(tenant) if x["id"].startswith("RULE-EXP") and x["active"]]
    at_risk_ids: set[str] = set()
    for rule in exp_rules:
        at_risk_ids |= {rec["batch_id"] for rec in audit_engine.evaluate(tenant, rule)}
    lots = lot_rows(tenant)
    created = propose_actions(tenant, at_risk_ids)
    rejected = db.scalar("SELECT count(*) FROM feed_rejected WHERE tenant_id = ?", [tenant]) or 0
    version = f"v{int(''.join(ch for ch in (r['feed_version'] or 'v0') if ch.isdigit()) or 0) + 1}"
    now = db.now_iso()
    last = db.scalar("SELECT id FROM audit_runs WHERE tenant_id = ? AND kind = 'expiry' ORDER BY \"at\" DESC LIMIT 1", [tenant])
    num = int("".join(ch for ch in last if ch.isdigit())) + 1 if last else 1000
    while db.scalar("SELECT count(*) FROM audit_runs WHERE id = ?", [f"RUN-{num}"]):
        num += 1
    run = {"id": f"RUN-{num}", "tenant_id": tenant, "kind": "expiry", "at": now, "trigger": trigger, "status": "partial" if rejected else "ok",
           "rules_evaluated": len(exp_rules), "violations": [], "lots_scanned": len(lots), "rows_rejected": rejected,
           "at_risk": len(at_risk_ids), "rule_version": r["version"], "source_version": f"{r['feed_dataset']}@{version}",
           "duration_ms": max(1, int((time.perf_counter() - t0) * 1000))}
    db.insert("audit_runs", run)
    db.update("expiry_rules", {"feed_version": version, "feed_as_of": now}, {"tenant_id": tenant})
    db.execute("UPDATE gold_datasets SET version = ?, as_of = ? WHERE tenant_id = ? AND name = ?",
               [version, datetime.now(timezone.utc).strftime("%H:%M"), tenant, r["feed_dataset"]])
    detail = (f"{run['id']} {run['status']} · {run['lots_scanned']} lots · {run['at_risk']} at risk · {rejected} rows rejected · "
              f"rules v{r['version']}" + (f" · {len(created)} new proposal{'s' if len(created) > 1 else ''}" if created else ""))
    audit_event(actor, "Expiry scan completed", detail, "nv" if run["status"] == "ok" else "warn", "inventory", tenant_id=tenant,
                actor=None if actor else "expiry-guard")
    return run_json(run)


def scan_due(tenant: str) -> bool:
    r = rules_row(tenant)
    last = db.scalar("SELECT \"at\" FROM audit_runs WHERE tenant_id = ? AND kind = 'expiry' ORDER BY \"at\" DESC LIMIT 1", [tenant])
    if not last:
        return True
    at = datetime.fromisoformat(last.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - at).total_seconds() >= r["scan_minutes"] * 60
