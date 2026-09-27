"""Intent-driven autonomous auditing: plain-English policy → structured rule → scheduled evaluation.

The registry lives in `audit_rules` and is mirrored to RULES_PATH (pretty JSON)
on every change. Rules are evaluated as parameterised SQL: field names are
checked against PRAGMA columns, values are always bound parameters, and the
tenant filter is always added.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

from fastapi import HTTPException

from . import db, expiry, llm, sql_engine
from .config import get_settings
from .permissions import Principal
from .security_log import audit_event

log = logging.getLogger("nexus.audit")

RULE_TABLES = {"inventory": "inventory", "shipments": "transportation"}
COMPUTED = {"inventory": {"days_remaining": "date_diff('day', current_date, expiry_date)", "storage_hours": "storage_days * 24"},
            "shipments": {}}
OPS = {"=": "=", "!=": "<>", ">": ">", ">=": ">=", "<": "<", "<=": "<=", "contains": "ILIKE"}
SEVERITIES = ("CRITICAL", "WARNING", "INFO")
RECORD_FIELDS = {"inventory": ["batch_id", "product_name", "category", "warehouse_id", "current_temp", "max_safe_temp", "expiry_date", "days_remaining"],
                 "shipments": ["shipment_id", "batch_id", "customer", "origin", "destination", "vehicle_id", "status"]}


# ---------------------------------------------------------------- registry


def rule_json(r: dict) -> dict:
    return {"id": r["id"], "label": r["label"], "severity": r["severity"], "active": bool(r["active"]), "source": r["source"],
            "text": r["text"], "table": r["table_name"], "conditions": r["conditions"] or [], "created_by": r.get("created_by"),
            "created_at": r.get("created_at"), "version": r.get("version") or 1}


def load_rules(tenant: str) -> list[dict]:
    return [rule_json(r) for r in db.rows("SELECT * FROM audit_rules WHERE tenant_id = ? ORDER BY created_at, id", [tenant])]


def mirror() -> None:
    """Write the registry to RULES_PATH. Demo-tenant rules keep the seed format; others carry tenant_id."""
    from .config import DEMO_TENANT

    out = []
    for r in db.rows("SELECT * FROM audit_rules ORDER BY tenant_id, created_at, id"):
        j = rule_json(r)
        item = {"id": j["id"], "label": j["label"], "severity": j["severity"], "active": j["active"], "source": j["source"],
                "text": j["text"], "table": j["table"], "conditions": j["conditions"]}
        if r["tenant_id"] != DEMO_TENANT:
            item["tenant_id"] = r["tenant_id"]
        out.append(item)
    path = get_settings().rules_file
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_seed_rules() -> int:
    """First start: load RULES_PATH into the DB when the registry is empty."""
    from .config import DEMO_TENANT

    if db.scalar("SELECT count(*) FROM audit_rules") or not get_settings().rules_file.exists():
        return 0
    try:
        items = json.loads(get_settings().rules_file.read_text(encoding="utf-8"))
    except ValueError:
        return 0
    for r in items:
        db.insert("audit_rules", {"id": r["id"], "tenant_id": r.get("tenant_id", DEMO_TENANT), "label": r["label"],
                                  "severity": r["severity"], "active": r.get("active", True), "source": r.get("source", "seed"),
                                  "text": r.get("text", ""), "table_name": r["table"], "conditions": r["conditions"],
                                  "created_by": "system", "created_at": db.now_iso(), "version": 1})
    return len(items)


def get_rule(tenant: str, rule_id: str) -> dict:
    r = db.one("SELECT * FROM audit_rules WHERE id = ? AND tenant_id = ?", [rule_id, tenant])
    if not r:
        raise HTTPException(404, detail="Rule not found")
    return rule_json(r)


# ---------------------------------------------------------------- compile


def columns_for(table: str) -> set[str]:
    return {c["column"] for c in sql_engine.table_info(table)} | set(COMPUTED.get(table, {}))


def validate_rule(rule: dict) -> dict:
    table = rule.get("table")
    if table not in RULE_TABLES:
        raise HTTPException(422, detail=f"Rules can target {', '.join(RULE_TABLES)} only")
    cols = columns_for(table)
    conds = rule.get("conditions") or []
    if not conds:
        raise HTTPException(422, detail="Could not derive any condition from the policy text")
    for c in conds:
        if c.get("field") not in cols or c.get("op") not in OPS:
            raise HTTPException(422, detail=f"Invalid condition {c}")
        if "field_ref" in c and c["field_ref"] not in cols:
            raise HTTPException(422, detail=f"Unknown field_ref {c['field_ref']}")
        if "param" in c and c["param"] not in ("critical_days", "warning_days"):
            raise HTTPException(422, detail=f"Unknown param {c['param']}")
        if not any(k in c for k in ("value", "field_ref", "param")):
            raise HTTPException(422, detail="Each condition needs value, field_ref or param")
    sev = str(rule.get("severity", "WARNING")).upper()
    rule["severity"] = sev if sev in SEVERITIES else "WARNING"
    return rule


CATEGORY_WORDS = {"dairy": "Dairy", "seafood": "Seafood", "fish": "Seafood", "salmon": "Seafood"}


def compile_deterministic(text: str) -> dict:
    t = text.lower()
    conds: list[dict] = []
    parts: list[str] = []
    cat = next((v for k, v in CATEGORY_WORDS.items() if re.search(rf"\b{k}\b", t)), None)
    if cat:
        conds.append({"field": "category", "op": "=", "value": cat})
        parts.append(cat)
    if re.search(r"\bfrozen\b", t):
        conds.append({"field": "storage_class", "op": "=", "value": "Frozen"})
        parts.append("Frozen")
    if re.search(r"\bin[- ]transit\b", t):
        conds.append({"field": "warehouse_id", "op": "=", "value": "WH-TRANSIT"})
        parts.append("in transit")
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*c\b", t)
    if m:
        below = re.search(r"(below|under|less than|colder than)\s+-?\d", t)
        conds.append({"field": "current_temp", "op": "<" if below else ">", "value": float(m.group(1))})
        parts.append(f"{'<' if below else '>'} {float(m.group(1)):g} °C")
    elif re.search(r"exceed\w*\s+(its|their|the)\s+safe", t):
        conds.append({"field": "current_temp", "op": ">", "field_ref": "max_safe_temp"})
        parts.append("above safe max")
    m = re.search(r"(\d+)\s*(h|hours?|hrs?)\b", t)
    if m:
        conds.append({"field": "storage_hours", "op": ">", "value": float(m.group(1))})
        parts.append(f"for > {m.group(1)} h")
    m = re.search(r"expir\w*\s+(within|in)\s+(\d+)\s*days?", t)
    if m:
        conds.append({"field": "days_remaining", "op": "<=", "value": int(m.group(2))})
        parts.append(f"expiring ≤ {m.group(2)} d")
    severity = "CRITICAL" if (re.search(r"critical|°c|temp|spoil", t) or any(c["field"] == "current_temp" for c in conds)) else "WARNING"
    if re.search(r"\bwarning\b|\blow\b", t):
        severity = "WARNING"
    return {"label": " · ".join(parts) or text[:60], "severity": severity, "table": "inventory", "conditions": conds}


def compile_rule(p: Principal, text: str) -> dict:
    text = (text or "").strip()
    if len(text) < 6:
        raise HTTPException(422, detail="Describe the policy in a sentence")
    rule = None
    if llm.enabled():
        try:
            schema = {t: sorted(columns_for(t)) for t in RULE_TABLES}
            rule = llm.chat_json([
                {"role": "system", "content": "Compile the policy into JSON {label, severity (CRITICAL|WARNING|INFO), table, "
                 "conditions:[{field, op in (=,!=,>,>=,<,<=,contains), value|field_ref|param}]}. "
                 f"Tables and columns: {json.dumps(schema)}. Computed: days_remaining, storage_hours (inventory)."},
                {"role": "user", "content": text}])
            rule = validate_rule({k: rule.get(k) for k in ("label", "severity", "table", "conditions")})
        except (llm.LLMUnavailable, HTTPException, AttributeError):
            rule = None
    rule = validate_rule(rule or compile_deterministic(text))
    ids = [r["id"] for r in db.rows("SELECT id FROM audit_rules WHERE id LIKE 'RULE-USR-%'")]
    n = max([int(i.rsplit("-", 1)[-1]) for i in ids if i.rsplit("-", 1)[-1].isdigit()] + [0]) + 1
    rid = f"RULE-USR-{n:03d}"
    db.insert("audit_rules", {"id": rid, "tenant_id": p.tenant_id, "label": rule["label"], "severity": rule["severity"], "active": True,
                              "source": "compiled" if not llm.enabled() else "llm", "text": text, "table_name": rule["table"],
                              "conditions": rule["conditions"], "created_by": p.actor, "created_at": db.now_iso(), "version": 1})
    mirror()
    audit_event(p, "Audit rule compiled", f"{rid} · {rule['severity']} · {rule['label']}", "info", "dashboard")
    return get_rule(p.tenant_id, rid)


def set_active(p: Principal, rule_id: str, active: bool) -> dict:
    r = get_rule(p.tenant_id, rule_id)
    db.execute("UPDATE audit_rules SET active = ?, version = version + 1 WHERE id = ? AND tenant_id = ?", [active, rule_id, p.tenant_id])
    mirror()
    audit_event(p, "Audit rule updated", f"{rule_id} {'activated' if active else 'paused'} · {r['label']}", "info", "dashboard")
    return get_rule(p.tenant_id, rule_id)


def delete_rule(p: Principal, rule_id: str) -> None:
    r = get_rule(p.tenant_id, rule_id)
    db.execute("DELETE FROM audit_rules WHERE id = ? AND tenant_id = ?", [rule_id, p.tenant_id])
    mirror()
    audit_event(p, "Audit rule deleted", f"{rule_id} · {r['label']}", "warn", "dashboard")


# ---------------------------------------------------------------- evaluate / run


def evaluate(tenant: str, rule: dict) -> list[dict]:
    table = rule["table"]
    cols = columns_for(table)
    computed = COMPUTED.get(table, {})
    select_extra = "".join(f", {expr} AS {name}" for name, expr in computed.items())
    where, params = [], [tenant]
    rules = expiry.rules_row(tenant)
    for c in rule["conditions"]:
        field, op = c["field"], OPS[c["op"]]
        if field not in cols:
            raise ValueError(f"unknown field {field}")
        col = f'"{field}"'
        if "field_ref" in c:
            if c["field_ref"] not in cols:
                raise ValueError("unknown field_ref")
            where.append(f'{col} {op} "{c["field_ref"]}"')
        elif "param" in c:
            where.append(f"{col} {op} ?")
            params.append(rules[c["param"]])
        elif c["op"] == "contains":
            where.append(f"CAST({col} AS VARCHAR) ILIKE ?")
            params.append(f"%{c['value']}%")
        elif isinstance(c["value"], str):
            where.append(f"lower(CAST({col} AS VARCHAR)) {op} lower(?)")
            params.append(c["value"])
        else:
            where.append(f"{col} {op} ?")
            params.append(c["value"])
    sql = f"SELECT * FROM (SELECT *{select_extra} FROM {table} WHERE tenant_id = ?) AS t WHERE " + " AND ".join(where)
    out = []
    for row in db.rows(sql, params):
        rec = {k: sql_engine._jsonable(row.get(k)) for k in RECORD_FIELDS[table] if k in row}
        rec["status"] = "BREACHED"
        out.append(rec)
    return out


def visible_violations(p: Principal | None, violations: list[dict]) -> list[dict]:
    if p is None or p.owner_like:
        return violations
    return [v for v in violations if p.can(RULE_TABLES.get(v.get("table", "inventory"), "inventory"), "read_records")]


def run(tenant: str, trigger: str = "manual", p: Principal | None = None) -> dict:
    t0 = time.perf_counter()
    rules = [r for r in load_rules(tenant) if r["active"]]
    violations, exp_ids = [], set()
    for r in rules:
        try:
            recs = evaluate(tenant, r)
        except Exception as exc:  # a broken rule must not stop the run
            log.warning("rule %s failed: %s", r["id"], exc)
            continue
        if r["id"].startswith("RULE-EXP"):
            exp_ids |= {x["batch_id"] for x in recs}
        if recs:
            violations.append({"rule_id": r["id"], "label": r["label"], "severity": r["severity"], "table": r["table"], "affected_records": recs})
    proposals = expiry.propose_actions(tenant, exp_ids) if exp_ids else []
    rid = f"AUD-{int(time.time() * 1000)}"
    db.insert("audit_runs", {"id": rid, "tenant_id": tenant, "kind": "audit", "at": db.now_iso(), "trigger": trigger, "status": "completed",
                             "rules_evaluated": len(rules), "violations": violations, "lots_scanned": None, "rows_rejected": None,
                             "at_risk": sum(len(v["affected_records"]) for v in violations), "rule_version": None, "source_version": None,
                             "duration_ms": max(1, int((time.perf_counter() - t0) * 1000))})
    crit = sum(v["severity"] == "CRITICAL" for v in violations)
    audit_event(p, "Operational audit run", f"{rid} · {len(rules)} rules · {len(violations)} violated ({crit} critical)"
                + (f" · {len(proposals)} expiry proposals" if proposals else ""), "crit" if crit else "nv", "dashboard",
                tenant_id=tenant, actor=None if p else "audit-scheduler")
    return {"id": rid, "status": "completed", "total_rules_evaluated": len(rules), "violations": visible_violations(p, violations)}


def latest_runs(p: Principal, limit: int = 5) -> list[dict]:
    out = []
    for r in db.rows('SELECT * FROM audit_runs WHERE tenant_id = ? AND kind = \'audit\' ORDER BY "at" DESC LIMIT ?', [p.tenant_id, limit]):
        out.append({"id": r["id"], "at": r["at"], "trigger": r["trigger"], "status": r["status"], "total_rules_evaluated": r["rules_evaluated"],
                    "violations": visible_violations(p, r["violations"] or [])})
    return out


# ---------------------------------------------------------------- scheduler


async def scheduler(interval: int) -> None:
    """Every `interval` seconds: run the audit (and a due expiry scan) for every tenant."""
    while True:
        await asyncio.sleep(interval)
        for tenant in [r["id"] for r in db.rows("SELECT id FROM companies")]:
            try:
                await asyncio.to_thread(run, tenant, "schedule")
                if await asyncio.to_thread(expiry.scan_due, tenant):
                    await asyncio.to_thread(expiry.scan, tenant, "schedule")
            except Exception:  # keep the loop alive
                log.exception("scheduled audit failed for %s", tenant)
