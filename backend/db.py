"""DuckDB connection (one per process, guarded by a lock), schema DDL and helpers.

JSON columns are stored as VARCHAR holding JSON text and decoded by `rows()` so
the demo never depends on loading a DuckDB extension.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb

from .config import get_settings

LOCK = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None
_conn_path: Path | None = None

JSON_COLUMNS = {
    "locations", "enabled_modules", "roles", "grants", "modules", "sources", "last_run", "last_success",
    "conditions", "violations", "history", "policy", "feed_sources",
}

DDL = [
    # ---------------------------------------------------------------- application
    """CREATE TABLE IF NOT EXISTS companies(id VARCHAR PRIMARY KEY, name VARCHAR, industry VARCHAR, size VARCHAR,
        locations VARCHAR, context VARCHAR, enabled_modules VARCHAR, created_at VARCHAR, origin VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS users(id VARCHAR PRIMARY KEY, email VARCHAR UNIQUE, name VARCHAR, password_hash VARCHAR,
        salt VARCHAR, created_at VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS memberships(tenant_id VARCHAR, user_id VARCHAR, roles VARCHAR, grants VARCHAR,
        status VARCHAR, PRIMARY KEY(tenant_id, user_id))""",
    """CREATE TABLE IF NOT EXISTS invites(code VARCHAR PRIMARY KEY, tenant_id VARCHAR, roles VARCHAR, created_by VARCHAR,
        created_at VARCHAR, expires_at VARCHAR, seat_user_id VARCHAR, used_by VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS documents(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, name VARCHAR, size_kb INTEGER,
        category VARCHAR, visibility VARCHAR, module VARCHAR, status VARCHAR, progress INTEGER, chunks INTEGER,
        path VARCHAR, index_version VARCHAR, updated_at VARCHAR, error VARCHAR, classification VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS chunks(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, document_id VARCHAR, page INTEGER,
        text VARCHAR, visibility VARCHAR, modules VARCHAR, roles VARCHAR, classification VARCHAR, updated_at VARCHAR,
        source VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS audit_events(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, time VARCHAR, tone VARCHAR,
        actor VARCHAR, action VARCHAR, detail VARCHAR, resource VARCHAR, "at" VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS security_events(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, "at" VARCHAR, user_id VARCHAR,
        user_name VARCHAR, roles VARCHAR, requested_resource VARCHAR, query VARCHAR, decision VARCHAR, stage VARCHAR,
        reason VARCHAR, chunks_retrieved INTEGER, sent_to_model BOOLEAN)""",
    """CREATE TABLE IF NOT EXISTS access_requests(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, user_id VARCHAR,
        resource VARCHAR, created_at VARCHAR, status VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS sources(id VARCHAR, tenant_id VARCHAR, kind VARCHAR, name VARCHAR, detail VARCHAR,
        connected BOOLEAN, freshness VARCHAR, sla VARCHAR, quality DOUBLE, errors INTEGER, health VARCHAR,
        warning VARCHAR, rows_per_day VARCHAR, last_run VARCHAR, last_success VARCHAR, PRIMARY KEY(tenant_id, id))""",
    """CREATE TABLE IF NOT EXISTS gold_datasets(id VARCHAR, tenant_id VARCHAR, name VARCHAR, sources VARCHAR,
        modules VARCHAR, task VARCHAR, freshness VARCHAR, quality DOUBLE, tone VARCHAR, version VARCHAR,
        as_of VARCHAR, stale BOOLEAN, PRIMARY KEY(tenant_id, id))""",
    # ---------------------------------------------------------------- gold (Text-to-SQL surface)
    """CREATE TABLE IF NOT EXISTS inventory(tenant_id VARCHAR, batch_id VARCHAR PRIMARY KEY, sku VARCHAR,
        product_name VARCHAR, category VARCHAR, warehouse_id VARCHAR, qty DOUBLE, unit VARCHAR, unit_value DOUBLE,
        expiry_date DATE, storage_days INTEGER, current_temp DOUBLE, max_safe_temp DOUBLE, storage_class VARCHAR,
        supplier_id VARCHAR, valuation_estimated BOOLEAN, lot_batch VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS shipments(tenant_id VARCHAR, shipment_id VARCHAR PRIMARY KEY, batch_id VARCHAR,
        customer VARCHAR, origin VARCHAR, destination VARCHAR, address VARCHAR, delivery_window VARCHAR, eta VARCHAR,
        eta_as_of VARCHAR, eta_stale BOOLEAN, vehicle_id VARCHAR, driver_id VARCHAR, driver_name VARCHAR,
        pallets INTEGER, weight_kg DOUBLE, handling VARCHAR, status VARCHAR, stop_order INTEGER, vehicle_desc VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS telemetry(tenant_id VARCHAR, vehicle_id VARCHAR, batch_id VARCHAR, ts VARCHAR,
        temp_c DOUBLE, event VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS suppliers(tenant_id VARCHAR, supplier_id VARCHAR PRIMARY KEY, name VARCHAR,
        category VARCHAR, otif DOUBLE, rating VARCHAR, contract VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS quotations(tenant_id VARCHAR, quote_id VARCHAR PRIMARY KEY, rfq VARCHAR,
        supplier_id VARCHAR, item VARCHAR, qty DOUBLE, unit_price DOUBLE, currency VARCHAR, lead_time_days INTEGER,
        valid_until VARCHAR, terms VARCHAR, status VARCHAR, document VARCHAR, page INTEGER)""",
    # ---------------------------------------------------------------- audit & expiry
    """CREATE TABLE IF NOT EXISTS audit_rules(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, label VARCHAR, severity VARCHAR,
        active BOOLEAN, source VARCHAR, text VARCHAR, table_name VARCHAR, conditions VARCHAR, created_by VARCHAR,
        created_at VARCHAR, version INTEGER)""",
    """CREATE TABLE IF NOT EXISTS audit_runs(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, kind VARCHAR, "at" VARCHAR,
        trigger VARCHAR, status VARCHAR, rules_evaluated INTEGER, violations VARCHAR, lots_scanned INTEGER,
        rows_rejected INTEGER, at_risk INTEGER, rule_version INTEGER, source_version VARCHAR, duration_ms INTEGER)""",
    """CREATE TABLE IF NOT EXISTS expiry_rules(tenant_id VARCHAR PRIMARY KEY, version INTEGER, critical_days INTEGER,
        warning_days INTEGER, scan_minutes INTEGER, markdown_max_pct DOUBLE, min_confidence DOUBLE,
        updated_at VARCHAR, updated_by VARCHAR, history VARCHAR, feed_dataset VARCHAR, feed_version VARCHAR,
        feed_as_of VARCHAR, feed_stale BOOLEAN, feed_sources VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS expiry_actions(id VARCHAR PRIMARY KEY, tenant_id VARCHAR, kind VARCHAR, lot_id VARCHAR,
        title VARCHAR, rationale VARCHAR, value_protected DOUBLE, confidence DOUBLE, external BOOLEAN, route VARCHAR,
        status VARCHAR, decided_by VARCHAR, decided_at VARCHAR, policy VARCHAR, created_at VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS feed_checks(tenant_id VARCHAR, id VARCHAR, name VARCHAR, status VARCHAR,
        detail VARCHAR, PRIMARY KEY(tenant_id, id))""",
    """CREATE TABLE IF NOT EXISTS feed_rejected(tenant_id VARCHAR, row_ref VARCHAR, field VARCHAR, value VARCHAR,
        error VARCHAR)""",
]

ALL_TABLES = [
    "companies", "users", "memberships", "invites", "documents", "chunks", "audit_events", "security_events",
    "access_requests", "sources", "gold_datasets", "inventory", "shipments", "telemetry", "suppliers", "quotations",
    "audit_rules", "audit_runs", "expiry_rules", "expiry_actions", "feed_checks", "feed_rejected",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def connect(path: Path | None = None) -> duckdb.DuckDBPyConnection:
    """Return the process-wide connection, (re)opening it if the configured path changed."""
    global _conn, _conn_path
    target = Path(path) if path else get_settings().db_file
    with LOCK:
        if _conn is None or _conn_path != target:
            if _conn is not None:
                _conn.close()
            target.parent.mkdir(parents=True, exist_ok=True)
            _conn = duckdb.connect(str(target))
            _conn_path = target
        return _conn


def close() -> None:
    global _conn, _conn_path
    with LOCK:
        if _conn is not None:
            _conn.close()
        _conn, _conn_path = None, None


def init_schema(conn: duckdb.DuckDBPyConnection | None = None) -> None:
    conn = conn or connect()
    with LOCK:
        for stmt in DDL:
            conn.execute(stmt)


def drop_all(conn: duckdb.DuckDBPyConnection) -> None:
    with LOCK:
        for t in ALL_TABLES:
            conn.execute(f"DROP TABLE IF EXISTS {t}")


def _decode(col: str, value: Any) -> Any:
    if col in JSON_COLUMNS and isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def rows(sql: str, params: Iterable[Any] | None = None, decode: bool = True) -> list[dict[str, Any]]:
    """Run a parameterised query and return dict rows (JSON columns decoded)."""
    conn = connect()
    with LOCK:
        cur = conn.execute(sql, list(params or []))
        cols = [d[0] for d in cur.description] if cur.description else []
        data = cur.fetchall() if cols else []
    return [{c: (_decode(c, v) if decode else v) for c, v in zip(cols, r)} for r in data]


def one(sql: str, params: Iterable[Any] | None = None) -> dict[str, Any] | None:
    r = rows(sql, params)
    return r[0] if r else None


def scalar(sql: str, params: Iterable[Any] | None = None) -> Any:
    conn = connect()
    with LOCK:
        r = conn.execute(sql, list(params or [])).fetchone()
    return r[0] if r else None


def execute(sql: str, params: Iterable[Any] | None = None) -> None:
    conn = connect()
    with LOCK:
        conn.execute(sql, list(params or []))


def _encode(v: Any) -> Any:
    return json.dumps(v) if isinstance(v, (list, dict)) else v


def insert(table: str, record: dict[str, Any], replace: bool = False) -> None:
    """Insert one row; list/dict values are stored as JSON text. Column names come from code, never from input."""
    cols = list(record)
    sql = f"INSERT {'OR REPLACE ' if replace else ''}INTO {table} ({', '.join(f'"{c}"' for c in cols)}) VALUES ({', '.join('?' for _ in cols)})"
    execute(sql, [_encode(record[c]) for c in cols])


def update(table: str, values: dict[str, Any], where: dict[str, Any]) -> None:
    sets = ", ".join(f'"{c}" = ?' for c in values)
    conds = " AND ".join(f'"{c}" = ?' for c in where)
    execute(f"UPDATE {table} SET {sets} WHERE {conds}", [_encode(v) for v in values.values()] + list(where.values()))


def is_empty() -> bool:
    return (scalar("SELECT count(*) FROM companies") or 0) == 0
