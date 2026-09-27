"""Agent orchestrator: gate → intent → tools → (two-hop) synthesis → canonical answer.

Always returns the canonical AI answer (MASTER_SPEC §7.5). Denials raise HTTP 403
*before* any SQL, retrieval or model call and are written to the security log.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException

from . import audit_engine, db, expiry, llm, rag_engine, snapshot, sql_engine
from .permissions import Principal, authorize_query, forbid
from .security_log import record_incident

INTENTS = ("root_cause", "compile_rule", "analytics", "briefing", "docs", "metadata")
METADATA_GAP = "Business records are not included — your access covers pipeline metadata."
FILTERED_GAP = "Some sources are outside your access and were excluded before retrieval."

RE_RULE = re.compile(r"\b(flag|alert me|create a rule|whenever)\b", re.I)
RE_WHY = re.compile(r"\b(why|cause|root[- ]cause|spoil\w*|what happened)\b", re.I)
RE_BRIEF = re.compile(r"what needs my attention|\bbrief\w*\b|\battention\b", re.I)
RE_ANALYTICS = re.compile(r"\b(how many|list|show|top|average|count|compare)\b|\bwhich\s+(lots?|shipments?|quotations?|suppliers?|batch\w*|deliver\w*|datasets?)\b", re.I)
RE_BATCH = re.compile(r"\bB-\d+\b", re.I)
RE_BATCH_NUM = re.compile(r"\bbatch\s*#?\s*(\d+)\b", re.I)
RE_SHIP = re.compile(r"\bSH[P]?-\d+\b", re.I)
RE_TRUCK = re.compile(r"\bTRK-\d+\b", re.I)


# ---------------------------------------------------------------- helpers

def hhmm(ts: str | None) -> str:
    if not ts:
        return "—"
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%H:%M")
    except ValueError:
        return ts


def entities(message: str) -> dict:
    out = {}
    if m := RE_BATCH.search(message):
        out["batch"] = m.group(0).upper()
    elif m := RE_BATCH_NUM.search(message):
        out["batch"] = f"B-{m.group(1)}"
    if m := RE_SHIP.search(message):
        out["shipment"] = m.group(0).upper()
    if m := RE_TRUCK.search(message):
        out["vehicle"] = m.group(0).upper()
    return out


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def eta_freshness(tenant: str) -> dict:
    g = db.one("SELECT version, as_of, stale FROM gold_datasets WHERE tenant_id = ? AND name = 'gold.shipments_eta'", [tenant]) or {}
    return {"source": f"gold.shipments_eta@{g.get('version', '?')}", "as_of": g.get("as_of", "—"), "stale": bool(g.get("stale"))}


def canonical(answer: str, sources: list[dict], freshness: list[dict], intent: str, *, sql: str | None = None,
              structured: list | None = None, context: list | None = None, verdict: str | None = None, trace: dict | None = None,
              gaps: list[str] | None = None, resource: str = "", label: str = "") -> dict:
    gaps = list(dict.fromkeys(gaps or []))
    text = " ".join([answer, *gaps]).strip()
    return {
        "answer": text,
        "sources": sources,
        "freshness": freshness,
        "decision": {"status": "allowed", "stage": "retrieval", "resource": resource, "resourceLabel": label},
        "gaps": gaps,
        "diagnostics": {
            "intent": intent, "sql": sql, "structured_data": structured or [], "retrieved_context": context or [],
            "root_cause_verdict": verdict, "trace": trace or {"candidates": 0, "afterTenant": 0, "afterPermission": 0, "afterScope": 0},
        },
    }


def pdf_sources(hits: list[dict], start: int = 1) -> tuple[list[dict], list[dict], list[dict]]:
    sources = [{"document": h["document"], "page": h["page"]} for h in hits]
    fresh = [{"source": f"{h['document']} · p.{h['page']}", "as_of": hhmm(h["updated_at"]), "stale": False} for h in hits]
    ctx = [{"source": h["document"], "page": h["page"], "snippet": h["text"][:320]} for h in hits]
    return sources, fresh, ctx


def filtered_gap(trace: dict) -> list[str]:
    return [FILTERED_GAP] if trace.get("afterScope", 0) < trace.get("afterTenant", 0) else []


# ---------------------------------------------------------------- intent

def classify(message: str, gate_resource: str) -> str:
    if RE_RULE.search(message):
        return "compile_rule"
    if gate_resource == "data":
        return "metadata"
    if llm.enabled():
        try:
            j = llm.chat_json([{"role": "system", "content": "Classify the supply-chain question. Reply JSON {\"intent\": one of "
                                "root_cause, analytics, briefing, docs}. root_cause = why something failed/spoiled for a batch, "
                                "shipment or vehicle id."}, {"role": "user", "content": message}])
            if j.get("intent") in ("root_cause", "analytics", "briefing", "docs"):
                return j["intent"]
        except llm.LLMUnavailable:
            pass
    if RE_WHY.search(message) and (entities(message) or re.search(r"spoil", message, re.I)):
        return "root_cause"
    if RE_BRIEF.search(message):
        return "briefing"
    if RE_ANALYTICS.search(message):
        return "analytics"
    return "docs"


# ---------------------------------------------------------------- intents

def root_cause(p: Principal, message: str, gate) -> dict:
    ent = entities(message)
    where, params = [], []
    for key, col in (("batch", "s.batch_id"), ("shipment", "s.shipment_id"), ("vehicle", "s.vehicle_id")):
        if key in ent:
            where.append(f"{col} = ?")
            params.append(ent[key])
    if not where:
        where.append("i.current_temp > i.max_safe_temp")
    sql = ("SELECT s.shipment_id, s.batch_id, i.product_name, i.category, s.origin, s.destination, s.vehicle_id, s.status, "
           "i.current_temp, i.max_safe_temp, t.ts, t.temp_c, t.event "
           "FROM shipments s JOIN inventory i ON i.batch_id = s.batch_id "
           "LEFT JOIN telemetry t ON t.vehicle_id = s.vehicle_id AND t.batch_id = s.batch_id AND t.temp_c > i.max_safe_temp "
           f"WHERE {' AND '.join(where)} ORDER BY t.ts NULLS LAST, i.current_temp - i.max_safe_temp DESC LIMIT 1")
    try:
        res = sql_engine.run(p, sql, params)
    except sql_engine.SQLRejected:
        return docs(p, message, gate, extra_gaps=["Structured records for this question are outside your access."])
    if not res["rows"]:
        return docs(p, message, gate, extra_gaps=["No matching shipment record was found in your permitted data."])
    r = res["rows"][0]
    spike = f"{hhmm(r['ts'])} UTC" if r.get("ts") else None
    temp = r["temp_c"] if r.get("temp_c") is not None else r["current_temp"]
    row = {"table": "shipments", "shipment_id": r["shipment_id"], "batch_id": r["batch_id"], "product_name": r["product_name"],
           "vehicle_id": r["vehicle_id"], "origin": r["origin"], "destination": r["destination"], "status": r["status"],
           "telemetry_spike": spike, "recorded_temp": temp, "max_safe_temp": r["max_safe_temp"], "event": r.get("event")}

    # Hop 2 — documented cause, with the caller's filters applied before ranking.
    ret = rag_engine.retrieve(p, f"{r['vehicle_id']} {r['product_name']} maintenance compressor incident", k=3, boost=[r["vehicle_id"]])
    hits = ret.chunks
    top = hits[0] if hits else None
    cause, verdict = "", ""
    vehicle = r["vehicle_id"]
    if top:
        picked = [s for s in sentences(top["text"]) if vehicle.lower() in s.lower() or re.search(r"compressor|belt|maintenance|backorder", s, re.I)]
        cause = f"The {top['document']} (p.{top['page']}) records: " + " ".join(picked[:3] or sentences(top["text"])[:2]).rstrip(".")
        low = top["text"].lower()
        if "deferred maintenance" in low or "belt" in low:
            verdict = f"Mechanical equipment failure resulting from deferred maintenance on {vehicle} refrigeration unit."
        elif "compressor" in low:
            verdict = f"Refrigeration compressor failure on {vehicle}."
    if not verdict:
        verdict = f"Temperature excursion confirmed on {vehicle}; no documented cause was found in your permitted sources."
        cause = cause or "No maintenance record for this vehicle is available to you"

    sources = [{"document": "shipments_table", "page": 0}]
    fresh = [{"source": "gold.telemetry@live", "as_of": hhmm(r.get("ts")) if r.get("ts") else "—", "stale": False}]
    ctx: list[dict] = []
    if top:
        s2, f2, ctx = pdf_sources([top])
        sources += s2
        fresh += f2
    answer = None
    if llm.enabled():
        try:
            answer = llm.chat([
                {"role": "system", "content": "You are a supply-chain root-cause analyst. Use ONLY the facts given. Cite as [n] where "
                 "[1] is the structured record and [2] the document. Two or three sentences, end with 'Verdict: …'."},
                {"role": "user", "content": f"Question: {message}\n[1] {row}\n[2] {ctx[0]['snippet'] if ctx else 'none'}\nVerdict hint: {verdict}"}])
        except llm.LLMUnavailable:
            answer = None
    if not answer:
        spike_txt = f"at {spike}" if spike else "while in transit"
        answer = (f"Batch {r['batch_id']} ({r['product_name']}) spoiled in transit {r['origin']}→{r['destination']}: the reefer on {vehicle} "
                  f"reached {temp:g} °C {spike_txt} (max {r['max_safe_temp']:g} °C) [1]. {cause}{' [2]' if top else ''}. Verdict: {verdict}")
    return canonical(answer, sources, fresh, "root_cause", sql=res["sql"], structured=[row], context=ctx, verdict=verdict,
                     trace=ret.trace, gaps=filtered_gap(ret.trace), resource=gate.resource, label=gate.label)


def docs(p: Principal, message: str, gate, extra_gaps: list[str] | None = None) -> dict:
    ret = rag_engine.retrieve(p, message, k=3)
    hits = ret.chunks[:3]
    sources, fresh, ctx = pdf_sources(hits)
    answer = None
    if hits and llm.enabled():
        try:
            answer = llm.chat([{"role": "system", "content": "Answer ONLY from the numbered sources; cite as [n]. Be brief."},
                               {"role": "user", "content": message + "\n" + "\n".join(f"[{i}] {h['text']}" for i, h in enumerate(hits, 1))}])
        except llm.LLMUnavailable:
            answer = None
    if not answer:
        answer = " ".join(f"{h['text'].rstrip('.')} [{i}]." for i, h in enumerate(hits, 1)) if hits else \
            "No permitted document in your knowledge base answers this question."
    return canonical(answer, sources, fresh, "docs", context=ctx, trace=ret.trace,
                     gaps=(extra_gaps or []) + filtered_gap(ret.trace), resource=gate.resource, label=gate.label)


def _summarize_rows(table: str, rows: list[dict]) -> str:
    key = {"shipments": ("shipment_id", "status"), "inventory": ("batch_id", "days_remaining"), "quotations": ("quote_id", "unit_price"),
           "suppliers": ("name", "otif"), "gold_datasets": ("name", "stale"), "sources": ("id", "health"), "telemetry": ("vehicle_id", "temp_c"),
           "audit_runs": ("id", "status")}.get(table)
    if not rows:
        return "No matching records in your permitted data"
    def fmt(v):
        return f"{v:,.2f}".rstrip("0").rstrip(".") if isinstance(v, float) else v

    if key and key[0] in rows[0]:
        items = [f"{r.get(key[0])} ({key[1].replace('_', ' ')} {fmt(r.get(key[1]))})" if key[1] in r else str(r.get(key[0])) for r in rows[:5]]
        more = f" and {len(rows) - 5} more" if len(rows) > 5 else ""
        return f"{len(rows)} record{'s' if len(rows) != 1 else ''} from {table}: " + ", ".join(items) + more
    return f"{len(rows)} record{'s' if len(rows) != 1 else ''} from {table}"


RE_ACTIONS = re.compile(r"\b(returns?|mitigations?|proposals?|proposed|actions?)\b", re.I)


def expiry_actions_answer(p: Principal, message: str, gate) -> dict | None:
    """Expiry Guard proposals, RBAC-projected (procurement only ever sees supplier returns)."""
    st = expiry.state_for(p)
    acts = [a for a in st["actions"] if a["status"] == "proposed"]
    if re.search(r"return", message, re.I):
        acts = [a for a in acts if a["kind"] == "supplier_return"]
    if not st["actions"]:
        return None
    lots = {l["id"]: l for l in st["lots"]}
    lines = [f"{a['id']} {expiry.ACTION_LABELS[a['kind']]} — {a['title']} (protects USD {a['valueProtected']:,.0f}, confidence "
             f"{a['confidence']:.0%}{', external: needs human approval' if a['external'] else ''})" for a in acts[:5]]
    answer = (f"{len(acts)} proposed: " + "; ".join(lines) + " [1].") if acts else "No open proposals match [1]."
    policy = {(pp["document"], pp["page"]) for a in acts[:5] for pp in a["policy"]}
    sources = [{"document": "expiry_actions", "page": 0}] + [{"document": d, "page": pg} for d, pg in sorted(policy)]
    fresh = [{"source": f"{st['feed']['dataset']}@{st['feed']['version']}", "as_of": hhmm(st["feed"]["asOf"]), "stale": st["feed"]["stale"]}]
    fresh += [{"source": f"{d} · p.{pg}", "as_of": "—", "stale": False} for d, pg in sorted(policy)]
    data = [{"table": "expiry_actions", **{k: a[k] for k in ("id", "kind", "lotId", "status", "valueProtected", "confidence")},
             "product": lots.get(a["lotId"], {}).get("product")} for a in acts]
    return canonical(answer, sources, fresh, "analytics", structured=data, resource=gate.resource, label=gate.label)


def analytics(p: Principal, message: str, gate) -> dict:
    if RE_ACTIONS.search(message) and (p.can("inventory", "read_records") or p.can("procurement", "read_records")):
        out = expiry_actions_answer(p, message, gate)
        if out:
            return out
    try:
        res = sql_engine.query(p, message)
    except sql_engine.SQLRejected as exc:
        return docs(p, message, gate, extra_gaps=[f"Structured query not run: {exc}."])
    table = res["table"]
    sources = [{"document": f"{table}_table", "page": 0}]
    fresh = [eta_freshness(p.tenant_id) if table == "shipments" else {"source": f"gold.{table}@live", "as_of": datetime.now(timezone.utc).strftime("%H:%M"), "stale": False}]
    answer = _summarize_rows(table, res["rows"]) + " [1]."
    if table == "inventory" and re.search(r"expir|should we do|lots?", message, re.I):
        ids = {r.get("batch_id") for r in res["rows"]}
        acts = [a for a in expiry.state_for(p)["actions"] if a["status"] == "proposed" and a["lotId"] in ids]
        if acts:
            answer += " Proposed mitigations (human approval required): " + "; ".join(f"{a['lotId']}: {a['title']}" for a in acts[:4]) + " [1]."
    ret = rag_engine.retrieve(p, message, k=2)
    ctx: list[dict] = []
    if ret.chunks:
        s2, f2, ctx = pdf_sources(ret.chunks)
        answer += " Related guidance: " + " ".join(f"{h['text'].rstrip('.')} [{i}]." for i, h in enumerate(ret.chunks, 2))
        sources += s2
        fresh += f2
    gaps = []
    if table == "shipments" and fresh[0]["stale"]:
        gaps.append(f"ETAs come from {fresh[0]['source']} (as of {fresh[0]['as_of']}) and are stale — the TMS refresh failed.")
    return canonical(answer, sources, fresh, "analytics", sql=res["sql"], structured=res["rows"][:50], context=ctx, trace=ret.trace,
                     gaps=gaps + filtered_gap(ret.trace), resource=gate.resource, label=gate.label)


def briefing(p: Principal, message: str, gate) -> dict:
    parts, sources, fresh, data = [], [], [], []
    n = 0
    ships = snapshot.shipments(p)
    if ships:
        n += 1
        delayed = [s for s in ships if s.status == "Delayed"]
        unassigned = [s for s in ships if not s.driver_id]
        scope = "assigned" if p.scope("transportation") == "assigned" else "tenant"
        parts.append(f"{len(ships)} {scope} deliveries — {len(delayed)} delayed ({', '.join(s.id for s in delayed) or 'none'})"
                     + (f", {len(unassigned)} unassigned" if unassigned else "") + f" [{n}].")
        sources.append({"document": "shipments_table", "page": 0})
        fresh.append(eta_freshness(p.tenant_id))
        data.append({"table": "shipments", "total": len(ships), "delayed": len(delayed), "unassigned": len(unassigned)})
        nxt = [s for s in ships if s.status not in ("Delivered", "Arrived")][:3]
        if nxt:
            parts.append("Next: " + "; ".join(f"{s.id} {s.customer} window {s.window}, ETA {s.eta} — {s.handling}" for s in nxt) + f" [{n}].")
    quotes = snapshot.quotations(p)
    if quotes:
        n += 1
        open_q = [q for q in quotes if q.status != "Awarded"]
        rfqs = sorted({q.rfq for q in open_q})
        parts.append(f"{len(open_q)} open quotations across {', '.join(rfqs) or 'no RFQs'} [{n}].")
        sources.append({"document": "quotations_table", "page": 0})
        fresh.append({"source": "gold.quotations@live", "as_of": "—", "stale": False})
        data.append({"table": "quotations", "open": len(open_q), "rfqs": rfqs})
    ex = expiry.summary(p)
    if ex:
        n += 1
        parts.append(f"{ex['atRisk']} lots at risk of expiry ({ex['critical']} critical, {ex['expired']} expired), "
                     f"USD {ex['valueAtRisk']:,.0f} at risk; {ex['proposed']} mitigations awaiting approval [{n}].")
        sources.append({"document": "inventory_table", "page": 0})
        fresh.append({"source": "gold.lot_expiry", "as_of": "—", "stale": False})
        data.append({"table": "inventory", "at_risk": ex["atRisk"], "critical": ex["critical"], "value_at_risk": ex["valueAtRisk"]})
    if p.can("dashboard", "view"):
        runs = audit_engine.latest_runs(p, 1)
        if runs and runs[0]["violations"]:
            n += 1
            crit = [v for v in runs[0]["violations"] if v["severity"] == "CRITICAL"]
            parts.append(f"Last operational audit: {len(runs[0]['violations'])} rules violated ({len(crit)} critical: "
                         f"{', '.join(v['label'] for v in crit) or 'none'}) [{n}].")
            sources.append({"document": "audit_runs_table", "page": 0})
            fresh.append({"source": "audit_runs", "as_of": hhmm(runs[0]["at"]), "stale": False})
    inc = snapshot.incidents(p)
    if inc:
        n += 1
        parts.append(f"{len(inc)} access denials logged; latest: {inc[0].user_name} → {inc[0].requested_resource} [{n}].")
        sources.append({"document": "security_events", "page": 0})
        fresh.append({"source": "security_events", "as_of": hhmm(inc[0].at), "stale": False})
    answer = " ".join(parts) or "Nothing in your permitted scope needs attention right now."
    gaps = [f"ETAs come from {f['source']} (as of {f['as_of']}) and are stale — the TMS refresh failed."
            for f in fresh if f["source"].startswith("gold.shipments_eta") and f["stale"]]
    return canonical(answer, sources, fresh, "briefing", structured=data, gaps=gaps, resource=gate.resource, label=gate.label)


def metadata(p: Principal, message: str, gate) -> dict:
    """Pipeline metadata answers — never business rows."""
    m = message.lower()
    parts, sources, fresh, data = [], [], [], []
    if re.search(r"expir|lot|scan|reject|validation|feed|quarantin", m):
        f = expiry.feed(p.tenant_id)
        runs = expiry.runs(p.tenant_id, 1)
        failing = [c for c in f["checks"] if c["status"] != "pass"]
        rej = f["rejected"]
        if runs:
            r = runs[0]
            parts.append(f"The last Expiry Guard scan {r['id']} ({hhmm(r['at'])}) finished {r['status'].upper()}: {r['rowsRejected']} rows "
                         f"were rejected by validation [1].")
        for c in failing:
            parts.append(f"Check \"{c['name']}\" {'FAILED' if c['status'] == 'fail' else 'WARNING'}: {c['detail']} [2].")
        if rej:
            parts.append("Rejected rows: " + "; ".join(f"{x['row']} {x['field']}='{x['value']}' — {x['error']}" for x in rej)
                         + f". They stay quarantined in Silver and are excluded from {f['dataset']}@{f['version']} [2].")
        sources += [{"document": "audit_runs_table", "page": 0}, {"document": f"{f['dataset']}#checks", "page": 0}]
        fresh += [{"source": "audit_runs", "as_of": hhmm(runs[0]["at"]) if runs else "—", "stale": False},
                  {"source": f"{f['dataset']}@{f['version']}", "as_of": hhmm(f["asOf"]), "stale": f["stale"]}]
        data += [{"table": "feed_checks", **c} for c in failing] + [{"table": "feed_rejected", **x} for x in rej]
    elif re.search(r"incident|denied|security|blocked", m):
        inc = snapshot.incidents(p)
        parts.append(f"{len(inc)} access denials are logged" + (f"; latest {inc[0].user_name} → {inc[0].requested_resource} "
                     f"({inc[0].stage}: {inc[0].reason})" if inc else "") + " [1].")
        sources.append({"document": "security_events", "page": 0})
        fresh.append({"source": "security_events", "as_of": hhmm(inc[0].at) if inc else "—", "stale": False})
        data += [{"table": "security_events", "id": i.id, "stage": i.stage, "resource": i.requested_resource} for i in inc[:10]]
    else:
        srcs = snapshot.connectors(p)
        bad = [s for s in srcs if s.health not in ("healthy",)]
        if re.search(r"tms|wms|erp|s3|crm|scada", m):
            ids = re.findall(r"tms|wms|erp|s3|crm|scada", m)
            bad = [s for s in srcs if s.id in ids] or bad
        elif re.search(r"stale|dataset|gold", m) and not re.search(r"source|connector|refresh|fail|pipeline", m):
            bad = []
        for s in bad:
            lr = s.last_run
            parts.append(f"{s.kind} ({s.name}): last run {lr.at} {lr.status.upper()}" + (f" — {lr.error}" if lr.error else "")
                         + f"; last good {s.last_success.version} at {s.last_success.at}" + (f". Next step: {lr.action}" if lr.action else "") + " [1].")
        stale = [g for g in snapshot.gold(p) if g.stale]
        if stale or re.search(r"stale|dataset|gold", m):
            parts.append(("Stale datasets: " + ", ".join(f"{g.name}@{g.version} (as of {g.as_of})" for g in stale)) if stale
                         else "No Gold dataset is stale.")
            parts[-1] += " [2]."
        sources += [{"document": "sources", "page": 0}, {"document": "gold_datasets", "page": 0}]
        fresh += [{"source": "sources", "as_of": "—", "stale": False}, {"source": "gold_datasets", "as_of": "—", "stale": bool(stale)}]
        data += [{"table": "sources", "id": s.id, "health": s.health} for s in bad] + [{"table": "gold_datasets", "name": g.name, "stale": g.stale} for g in stale]
    gaps = []
    if gate.metadata_only or not (p.owner_like or p.readable_modules()):
        gaps.append(METADATA_GAP)
    answer = ("Metadata only — " if gaps else "") + (" ".join(parts) or "No pipeline issues found.")
    return canonical(answer, sources, fresh, "metadata", structured=data, gaps=gaps, resource=gate.resource, label=gate.label)


def compile_rule(p: Principal, message: str, gate) -> dict:
    if not (p.can("settings", "manage") or p.can("inventory", "manage")):
        forbid(p, "settings", f"{' + '.join(p.roles)} lacks manage on Settings or Inventory (rule compilation)", message)
    rule = audit_engine.compile_rule(p, message)
    conds = "; ".join(f"{c['field']} {c['op']} {c.get('value', c.get('field_ref', c.get('param')))}" for c in rule["conditions"])
    answer = (f"Saved rule {rule['id']} ({rule['severity']}): {rule['label']} — {rule['table']} where {conds}. "
              f"It is active and runs on the next operational audit [1].")
    return canonical(answer, [{"document": "rules.json", "page": 0}], [{"source": "audit_rules", "as_of": hhmm(rule["created_at"]), "stale": False}],
                     "compile_rule", structured=[rule], resource=gate.resource, label=gate.label)


HANDLERS = {"root_cause": root_cause, "docs": docs, "analytics": analytics, "briefing": briefing, "metadata": metadata, "compile_rule": compile_rule}


def answer(p: Principal, message: str, context: str = "dashboard") -> dict:
    gate = authorize_query(message, p, context)
    if not gate.allowed:
        inc = record_incident(p, gate.resource, gate.label, message, "pre-retrieval", gate.reason)
        raise HTTPException(403, detail={"decision": "denied", "stage": "pre-retrieval", "resource": gate.resource,
                                         "resourceLabel": gate.label, "reason": gate.reason, "chunks_retrieved": 0, "incidentId": inc})
    intent = classify(message, gate.resource)
    return HANDLERS[intent](p, message, gate)


def chat(p: Principal, message: str, context: str = "dashboard") -> dict:
    """AGENTS.md /api/chat shape plus every canonical field."""
    a = answer(p, message, context)
    d = a["diagnostics"]
    return {"response": a["answer"], "diagnostics": d, "citations": list(dict.fromkeys(s["document"] for s in a["sources"])), **a}
