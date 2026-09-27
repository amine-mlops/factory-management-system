"""Text-to-SQL over the DuckDB gold layer: PRAGMA recon → generate → validate → RBAC rewrite → execute.

Only single SELECT statements over allow-listed tables run, read-only, with a
5 s timeout. Every table reference is replaced by a tenant-scoped subquery; for
assigned-scope callers (drivers) `shipments` and `telemetry` only contain their rows.
"""
from __future__ import annotations

import re
import threading
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import sqlglot
from sqlglot import exp

from . import db, llm
from .permissions import Principal

MAX_ROWS = 200
TIMEOUT_SECONDS = 5.0
BUSINESS_TABLES = {"inventory": "inventory", "shipments": "transportation", "telemetry": "transportation",
                   "suppliers": "procurement", "quotations": "procurement"}
FORBIDDEN_WORDS = {"PRAGMA", "ATTACH", "DETACH", "COPY", "INSTALL", "LOAD", "CALL", "EXPORT", "IMPORT", "CREATE", "INSERT",
                   "UPDATE", "DELETE", "DROP", "ALTER", "SET", "RESET", "CHECKPOINT", "VACUUM", "TRUNCATE", "MERGE", "USE"}
FORBIDDEN_FUNCS = re.compile(r"^(read_\w+|glob|\w*_scan|sniff_csv|duckdb_\w+|pragma_\w+|getenv|query|query_table|"
                             r"current_setting|which_secret|load_extension|parquet_\w+|iceberg_\w+|delta_\w+)$", re.I)


class SQLRejected(ValueError):
    """The generated or supplied SQL failed validation."""


# ---------------------------------------------------------------- 1. recon + allow-list

_schema_cache: dict[str, list[dict]] = {}


def table_info(table: str) -> list[dict]:
    if table not in _schema_cache:
        cols = db.rows(f"PRAGMA table_info('{table}')")  # table comes from the fixed allow-list, never from input
        _schema_cache[table] = [{"column": c["name"], "type": c["type"], "notnull": c["notnull"], "pk": c["pk"]} for c in cols]
    return _schema_cache[table]


def allowed_tables(p: Principal) -> list[str]:
    if p.owner_like:
        return ["inventory", "shipments", "telemetry", "suppliers", "quotations", "audit_runs", "gold_datasets", "sources"]
    tables: list[str] = []
    for t, module in BUSINESS_TABLES.items():
        if p.can(module, "read_records"):
            tables.append(t)
    if p.can("data", "view"):
        tables += ["sources", "gold_datasets", "audit_runs"]
    return tables


def schema_prompt(p: Principal) -> str:
    """Compact schema with 3 sample rows per table — samples are already RBAC-scoped."""
    parts = []
    for t in allowed_tables(p):
        cols = ", ".join(f"{c['column']} {c['type']}" for c in table_info(t) if c["column"] != "tenant_id")
        try:
            sample = run(p, f"SELECT * FROM {t} LIMIT 3", [])["rows"]
        except Exception:
            sample = []
        parts.append(f"TABLE {t}({cols})\n  sample: {[{k: v for k, v in r.items() if k != 'tenant_id'} for r in sample]}")
    return "\n".join(parts)


# ---------------------------------------------------------------- 2. validate


def _check_tokens(sql: str) -> None:
    for tok in sqlglot.Dialect.get_or_raise("duckdb").tokenize(sql):
        if tok.token_type.name in ("STRING", "IDENTIFIER"):
            continue
        if tok.text.upper() in FORBIDDEN_WORDS:
            raise SQLRejected(f"'{tok.text.upper()}' is not allowed (read-only SELECT only)")


def validate(sql: str, allowed: list[str]) -> exp.Select:
    try:
        stmts = [s for s in sqlglot.parse(sql, read="duckdb") if s is not None]
    except sqlglot.errors.ParseError as exc:
        raise SQLRejected(f"could not parse SQL: {str(exc).splitlines()[0]}") from exc
    if len(stmts) != 1:
        raise SQLRejected("exactly one statement is allowed")
    tree = stmts[0]
    if not isinstance(tree, exp.Select):
        raise SQLRejected(f"only SELECT is allowed (got {type(tree).__name__.upper()})")
    _check_tokens(sql)
    for node in tree.find_all(exp.Func):
        name = node.name if isinstance(node, exp.Anonymous) else (node.sql_name() if hasattr(node, "sql_name") else type(node).__name__)
        if FORBIDDEN_FUNCS.match(name or "") or isinstance(node, (exp.ReadCSV,)):
            raise SQLRejected(f"function '{name}' is not allowed")
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    for t in tree.find_all(exp.Table):
        if not isinstance(t.this, exp.Identifier):
            raise SQLRejected("table functions are not allowed")
        name = t.name.lower()
        if t.args.get("catalog") or (t.db and t.db.lower() != "main"):
            raise SQLRejected(f"table '{t.sql()}' is outside the allowed schema")
        if name in ctes and not t.db:
            continue
        if name not in allowed:
            raise SQLRejected(f"table '{name}' is not allowed for your role")
    limit = tree.args.get("limit")
    if limit is None:
        tree = tree.limit(MAX_ROWS)
    else:
        try:
            if int(limit.expression.name) > MAX_ROWS:
                tree = tree.limit(MAX_ROWS)
        except (AttributeError, ValueError):
            tree = tree.limit(MAX_ROWS)
    return tree


# ---------------------------------------------------------------- 3. RBAC rewrite


def _lit(v: str) -> exp.Literal:
    return exp.Literal.string(v)


def scoped_source(table: str, p: Principal) -> exp.Select:
    """`SELECT * FROM main.<table> WHERE tenant_id = <tenant> [AND driver scope]` built with escaped literals."""
    base = exp.select("*").from_(exp.table_(table, db="main"))
    cond = exp.EQ(this=exp.column("tenant_id"), expression=_lit(p.tenant_id))
    module = BUSINESS_TABLES.get(table)
    if module and p.scope(module) == "assigned" and not p.owner_like:
        if table == "shipments":
            cond = exp.and_(cond, exp.EQ(this=exp.column("driver_id"), expression=_lit(p.user_id)))
        elif table == "telemetry":
            mine = (exp.select("vehicle_id").from_(exp.table_("shipments", db="main"))
                    .where(exp.and_(exp.EQ(this=exp.column("tenant_id"), expression=_lit(p.tenant_id)),
                                    exp.EQ(this=exp.column("driver_id"), expression=_lit(p.user_id)))))
            cond = exp.and_(cond, exp.In(this=exp.column("vehicle_id"), query=exp.Subquery(this=mine)))
    return base.where(cond)


def rewrite(tree: exp.Select, p: Principal) -> exp.Select:
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    targets = [t for t in tree.find_all(exp.Table) if not (t.name.lower() in ctes and not t.db)]
    for t in targets:
        alias = t.alias or t.name
        t.replace(exp.Subquery(this=scoped_source(t.name.lower(), p), alias=exp.TableAlias(this=exp.to_identifier(alias))))
    return tree


# ---------------------------------------------------------------- 4. execute


def _jsonable(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def execute(sql: str, params: list[Any]) -> dict:
    conn = db.connect()
    with db.LOCK:
        timer = threading.Timer(TIMEOUT_SECONDS, conn.interrupt)
        timer.start()
        try:
            cur = conn.execute(sql, params)
            columns = [d[0] for d in cur.description]
            data = cur.fetchmany(MAX_ROWS)
        finally:
            timer.cancel()
    return {"sql": sql, "columns": columns, "rows": [{c: _jsonable(v) for c, v in zip(columns, r)} for r in data]}


def run(p: Principal, sql: str, params: list[Any] | None = None) -> dict:
    """Validate + rewrite + execute an arbitrary SELECT for this principal."""
    tree = rewrite(validate(sql, allowed_tables(p)), p)
    return execute(tree.sql(dialect="duckdb"), list(params or []))


# ---------------------------------------------------------------- generation (templates / LLM)

TEMPLATES: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"\b(breach\w*|temperature|temp|cold[- ]chain|excursion)", re.I), "inventory",
     "SELECT batch_id, product_name, category, warehouse_id, current_temp, max_safe_temp FROM inventory "
     "WHERE current_temp > max_safe_temp ORDER BY current_temp - max_safe_temp DESC"),
    (re.compile(r"\b(lots?|expir\w*|shelf|fefo)\b", re.I), "inventory",
     "SELECT batch_id, product_name, warehouse_id, qty, unit, expiry_date, date_diff('day', current_date, expiry_date) AS days_remaining "
     "FROM inventory WHERE expiry_date <= current_date + CAST(? AS INTEGER) ORDER BY expiry_date"),
    (re.compile(r"\b(quot\w*|rfq\w*|bids?)\b", re.I), "quotations",
     "SELECT quote_id, rfq, supplier_id, item, qty, unit_price, currency, lead_time_days, status FROM quotations "
     "WHERE (? IS NULL OR rfq = ?) ORDER BY rfq, unit_price"),
    (re.compile(r"\b(suppliers?|vendors?|otif)\b", re.I), "suppliers",
     "SELECT supplier_id, name, category, otif, rating FROM suppliers ORDER BY otif DESC"),
    (re.compile(r"\b(telemetry|readings?|reefer)\b", re.I), "telemetry",
     "SELECT vehicle_id, batch_id, ts, temp_c, event FROM telemetry ORDER BY ts DESC"),
    (re.compile(r"\b(shipments?|deliver\w*|routes?|stops?|loads?|trucks?|dispatch|eta)\b", re.I), "shipments",
     "SELECT shipment_id, customer, destination, delivery_window, eta, status, driver_name, vehicle_id FROM shipments "
     "WHERE (? IS NULL OR status = ?) ORDER BY driver_name, stop_order"),
    (re.compile(r"\b(stale|datasets?|gold|pipelines?)\b", re.I), "gold_datasets",
     "SELECT name, version, as_of, freshness, quality, stale FROM gold_datasets ORDER BY stale DESC, name"),
    (re.compile(r"\b(sources?|connectors?|tms|wms|erp|s3|refresh\w*)\b", re.I), "sources",
     "SELECT id, kind, name, health, freshness, warning FROM sources ORDER BY health, id"),
    (re.compile(r"\b(runs?|audits?|scans?)\b", re.I), "audit_runs",
     'SELECT id, kind, "at", trigger, status, rules_evaluated, rows_rejected, at_risk FROM audit_runs ORDER BY "at" DESC'),
    (re.compile(r"\b(inventory|stock|batch\w*)\b", re.I), "inventory",
     "SELECT batch_id, product_name, category, warehouse_id, qty, unit, current_temp, max_safe_temp FROM inventory ORDER BY batch_id"),
]
STATUS_WORDS = {"delayed": "Delayed", "delivered": "Delivered", "in transit": "In transit", "scheduled": "Scheduled",
                "loading": "Loading", "arrived": "Arrived"}


def template_for(p: Principal, question: str) -> tuple[str, list[Any], str] | None:
    allowed = allowed_tables(p)
    q = question.lower()
    for pattern, table, sql in TEMPLATES:
        if table in allowed and pattern.search(question):
            params: list[Any] = []
            if "CAST(? AS INTEGER)" in sql:
                m = re.search(r"(\d+)\s*days?", q)
                params = [int(m.group(1)) if m else 21]
            elif "rfq = ?" in sql:
                m = re.search(r"\bRFQ-\d+\b", question, re.I)
                params = [m.group(0).upper() if m else None] * 2
            elif "status = ?" in sql:
                status = next((v for k, v in STATUS_WORDS.items() if k in q), None)
                params = [status, status]
            return sql, params, table
    return None


def generate(p: Principal, question: str) -> tuple[str, list[Any], str]:
    """Question → (sql, params, primary table). LLM mode first, deterministic templates otherwise."""
    allowed = allowed_tables(p)
    if not allowed:
        raise SQLRejected("your role has no tables to query")
    if llm.enabled():
        try:
            text = llm.chat([
                {"role": "system", "content": "You write DuckDB SQL. One SELECT. Only these tables. No DDL/DML. LIMIT 200. "
                 "Answer with one ```sql fenced block.\n" + schema_prompt(p)},
                {"role": "user", "content": question}])
            sql = llm.extract_sql(text)
            tree = validate(sql, allowed)
            first = next(tree.find_all(exp.Table)).name.lower()
            return sql, [], first
        except (llm.LLMUnavailable, SQLRejected, StopIteration):
            pass
    t = template_for(p, question)
    if t:
        return t
    table = allowed[0]
    return f"SELECT * FROM {table} LIMIT 20", [], table


def query(p: Principal, question: str) -> dict:
    sql, params, table = generate(p, question)
    out = run(p, sql, params)
    out["table"] = table
    return out
