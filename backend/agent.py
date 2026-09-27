"""Agent orchestration: intent routing (analytical SQL / rule registration /
dual-hop root-cause), RBAC enforcement, audit execution."""
import json
import re
from pathlib import Path

import permissions
import sql_engine
from permissions import ForbiddenTopic
from sql_engine import EngineUnavailable

WHY_RE = re.compile(r"\b(why|diagnose|diagnosis|explain|root cause|spoiled?)\b", re.I)
FLAG_RE = re.compile(r"\b(flag|alert|watch|audit rule|keep an eye|rule)\b", re.I)
TEMP_RE = re.compile(r"(?:over|above|exceed\w*|greater than)\s+(-?\d+(?:\.\d+)?)\s*°?\s*c", re.I)
DUR_RE = re.compile(r"more than\s+(\d+)\s*(?:hours?|h)\b", re.I)
SEVERE_RE = re.compile(r"\b(critical|high)\b", re.I)
CATEGORIES = ("dairy", "frozen", "beverage", "produce", "meat")
BATCH_RE = re.compile(r"#?\s*(b-?(\d{2,}))", re.I)


def _respond(response, structured=None, contexts=None, verdict=None, citations=None):
    return {
        "response": response,
        "diagnostics": {
            "structured_data": structured or [],
            "retrieved_context": contexts or [],
            "root_cause_verdict": verdict,
        },
        "citations": citations or [],
    }


def _parse_rule(message: str):
    """Detect a compliance-rule statement like: 'flag any dairy batch over
    4°C for more than 2 hours as high severity' -> rule dict."""
    m = TEMP_RE.search(message)
    if not (FLAG_RE.search(message) and m):
        return None
    dur = DUR_RE.search(message)
    ml = message.lower()
    category = next((c for c in CATEGORIES if re.search(rf"\b{c}\b", ml)), None)
    severity = "critical" if "critical" in ml else ("high" if SEVERE_RE.search(ml) else "medium")
    threshold = float(m.group(1))
    scope = f"{category or 'all'} batches in transit"
    return {
        "label": f"{scope}: current_temp > {threshold:g}°C"
                 + (f" for more than {dur.group(1)}h" if dur else ""),
        "category": category,
        "metric": "current_temp",
        "comparator": ">",
        "threshold": threshold,
        "duration_hours": float(dur.group(1)) if dur else 0.0,
        "severity": severity,
    }


def _save_rule(rule: dict, rules_path: Path) -> dict:
    rules_path.parent.mkdir(parents=True, exist_ok=True)
    rules = []
    if rules_path.exists():
        try:
            rules = json.loads(rules_path.read_text())
        except Exception:
            rules = []
    nxt = 1 + max(
        [int(r["rule_id"].rsplit("-", 1)[-1]) for r in rules
         if r.get("rule_id", "").startswith("RULE-COLD-")] or [0]
    )
    rule["rule_id"] = f"RULE-COLD-{nxt:02d}"
    rules.append(rule)
    rules_path.write_text(json.dumps(rules, indent=2))
    return rule


def _rule_reply(rule: dict):
    return _respond(
        f"Registered compliance rule {rule['rule_id']}: {rule['label']} "
        f"(severity: {rule['severity']}). It will run on the next audit.",
        structured=[rule],
    )


def _analytical(message: str, role: str, conn):
    schema = sql_engine.schema_recon(conn)
    if not schema:
        return _respond("No tables found in the database.")
    sql = permissions.filter_sql(sql_engine.translate(message, role), role)
    sql = sql_engine.validate_sql(sql)
    rows = sql_engine.execute(conn, sql)
    if not rows:
        body = "No matching records found."
    else:
        sample = rows[:3]
        lines = [" | ".join(str(v) for v in r.values()) for r in sample]
        body = (f"{len(rows)} record(s) found. Columns: "
                f"{', '.join(rows[0].keys())}. Sample:\n" + "\n".join(lines))
        if len(rows) > 3:
            body += f"\n... and {len(rows) - 3} more."
    return _respond(body, structured=rows)


def _dual_hop(message: str, role: str, conn, rag):
    # Hop 1: SQL anomaly (join inventory+shipments on batch)
    m = BATCH_RE.search(message)
    rows = sql_engine.batch_context(conn, m.group(1) if m else None)
    if not rows and m:  # fall back: any breached batch
        rows = sql_engine.batch_context(conn, None)
    if not rows:
        return _respond("No temperature breach found in transit for that batch.")
    top = rows[0]
    # Hop 2: RAG over maintenance/workshop docs for that vehicle
    rag_query = (f"{top['vehicle_id']} {top['origin']} {top['destination']} "
                 "refrigeration compressor failure maintenance workshop deferred")
    contexts = rag.retrieve(rag_query, role)
    verdict = (
        f"Batch {top['batch_id']} ({top['product_name']}, {top['category']}) "
        f"breached cold chain in transit {top['origin']} → {top['destination']} "
        f"on vehicle {top['vehicle_id']}: current_temp {top['current_temp']}°C "
        f"exceeds max_safe_temp {top['max_safe_temp']}°C."
    )
    if contexts:
        verdict += " Root cause: " + contexts[0]["snippet"]
    else:
        verdict += " Root cause undetermined: no workshop documentation matched this vehicle."
    citations = sorted({c["source"] for c in contexts}) + ["SQL:inventory⋈shipments"]
    return _respond(verdict, structured=rows, contexts=contexts,
                    verdict=verdict, citations=citations)


def handle(message: str, role: str, db_path, rag, rules_path: Path) -> dict:
    """Route one chat message. Raises ForbiddenTopic (403) / EngineUnavailable (503)."""
    permissions.check_message(message, role)

    rule = _parse_rule(message)
    if rule:
        return _rule_reply(_save_rule(rule, rules_path))

    conn = sql_engine.connect(db_path)
    try:
        if WHY_RE.search(message):
            return _dual_hop(message, role, conn, rag)
        return _analytical(message, role, conn)
    finally:
        conn.close()


def run_audit(db_path, rules_path: Path) -> dict:
    """Evaluate every rule in rules.json against the live database."""
    rules = []
    if Path(rules_path).exists():
        try:
            rules = json.loads(Path(rules_path).read_text())
        except Exception:
            rules = []
    conn = sql_engine.connect(db_path)
    try:
        violations = []
        for rule in rules:
            where, params = [], []
            cmp_sql = "<" if rule.get("comparator") == "<" else ">"
            params.append(rule["threshold"])
            where.append(f"i.current_temp {cmp_sql} ?")
            where.append("s.status ILIKE '%transit%'")
            if rule.get("category"):
                where.append("LOWER(i.category) LIKE ?")
                params.append(f"%{rule['category'].lower()}%")
            sql = (
                "SELECT i.batch_id, i.product_name, i.category, i.current_temp, "
                "i.max_safe_temp, s.status AS shipment_status "
                "FROM inventory i JOIN shipments s ON i.batch_id = s.batch_id "
                "WHERE " + " AND ".join(where)
            )
            rows = sql_engine.execute(conn, sql, params)
            for r in rows:
                r["status"] = "BREACHED"
            if rows:
                violations.append({
                    "rule_id": rule["rule_id"],
                    "label": rule["label"],
                    "severity": rule["severity"],
                    "affected_records": rows,
                })
        return {"status": "completed",
                "total_rules_evaluated": len(rules),
                "violations": violations}
    finally:
        conn.close()
