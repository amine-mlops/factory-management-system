"""Read-only SQL engine: runtime schema recon, heuristic NL->SQL translation,
strict read-only enforcement."""
import re

import duckdb

FORBIDDEN_RE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|copy|attach|detach|pragma|call|"
    r"set|load|export|import|install)\b",
    re.I,
)

SHIPMENT_KEYWORDS = ("shipment", "truck", "vehicle", "delay", "driver", "route",
                     "transit", "origin", "destination")
INVENTORY_KEYWORDS = ("temp", "spoiled", "spoilage", "storage", "batch", "cold",
                      "warehouse", "safe", "degrees", "°")
CATEGORIES = ("dairy", "frozen", "beverage", "produce", "meat")


class EngineUnavailable(Exception):
    """Database missing/unopenable -> surfaced as HTTP 503 by the app."""


class SQLError(ValueError):
    """Query rejected by read-only enforcement."""


def connect(db_path):
    try:
        return duckdb.connect(str(db_path), read_only=True)
    except (duckdb.Error, FileNotFoundError, OSError) as e:
        raise EngineUnavailable(
            f"Supply chain database unavailable at '{db_path}': {e}"
        ) from e


def schema_recon(conn) -> dict:
    """Live schema discovery via PRAGMA table_info."""
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'main'"
        ).fetchall()
    ]
    schema = {}
    for t in tables:
        cols = [
            (r[1], r[2])
            for r in conn.execute(f"PRAGMA table_info('{t}')").fetchall()
        ]
        schema[t] = cols
    return schema


def validate_sql(sql: str) -> str:
    """Reject anything that is not a single, clean, read-only SELECT."""
    s = sql.strip()
    if not s.upper().startswith("SELECT"):
        raise SQLError("Only SELECT statements are permitted.")
    if ";" in s:
        raise SQLError("Multiple statements / ';' are not permitted.")
    if FORBIDDEN_RE.search(s):
        raise SQLError("Write or DDL statements are not permitted (read-only).")
    return s


def _wants(ql: str, keywords) -> bool:
    return any(k in ql for k in keywords)


def translate(question: str, role: str = "executive") -> str:
    """Heuristic NL -> SQL for the two known tables. Never used verbatim from
    the user (no injection surface); we build SQL from extracted filters."""
    ql = question.lower()
    want_ship = _wants(ql, SHIPMENT_KEYWORDS)
    want_inv = _wants(ql, INVENTORY_KEYWORDS)
    if not want_ship and not want_inv:
        want_inv = True  # default to inventory facts

    where, params = [], []

    def match_number(pat):
        m = re.search(pat, ql)
        return float(m.group(1)) if m else None

    if want_ship and want_inv:
        cols = ("i.batch_id, i.product_name, i.category, i.warehouse_id, "
                "i.storage_days, i.current_temp, i.max_safe_temp, "
                "s.shipment_id, s.origin, s.destination, s.vehicle_id, "
                "s.driver_id, s.status")
        base = ("FROM inventory i JOIN shipments s ON i.batch_id = s.batch_id")
        prefix = "i."
    else:
        table = "shipments" if want_ship else "inventory"
        alias = "s" if want_ship else "i"
        cols = "*"
        base = f"FROM {table} {alias}"
        prefix = f"{alias}."

    # category filter
    for cat in CATEGORIES:
        if re.search(rf"\b{cat}\b", ql):
            where.append(f"{prefix}category ILIKE ?")
            params.append(f"%{cat}%")
    # numeric threshold: "over/above/exceeding 4 (degrees|°C)"
    thr = match_number(r"(?:over|above|exceed\w*|greater than)\s+(-?\d+(?:\.\d+)?)")
    if thr is not None and want_inv:
        where.append("i.current_temp > ?" if want_inv and want_ship
                     else "current_temp > ?")
        params.append(thr)
    # shipment status
    m = re.search(r"in transit|delivered|delayed|pending", ql)
    if m and want_ship:
        status_map = {"delayed": "%delay%"}
        pat = status_map.get(m.group(0), f"%{m.group(0)}%")
        col = "s.status" if want_inv else "status"
        where.append(f"{col} ILIKE ?")
        params.append(pat)
    # explicit ids
    m = re.search(r"\b(trk-\d+)\b", ql)
    if m and want_ship:
        col = "s.vehicle_id" if want_inv else "vehicle_id"
        where.append(f"{col} ILIKE ?")
        params.append(f"%{m.group(1)}%")
    m = re.search(r"\b(?:batch\s*#?\s*)?(b-\d+|\d{2,})\b", ql)
    if m and want_inv and re.search(r"batch", ql):
        val = m.group(1)
        col = "i.batch_id" if want_inv and want_ship else "batch_id"
        where.append(f"{col} ILIKE ?")
        params.append(f"%{val if val.startswith('b-') else 'B-' + val}%")

    sql = f"SELECT {cols} {base}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " LIMIT 25"
    return sql


def execute(conn, sql: str, params=None) -> list[dict]:
    cur = conn.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def batch_context(conn, batch_num: str | None, breached_only: bool = True):
    """Hop-1 anomaly lookup: join inventory+shipments for a batch (or the worst
    temperature breach when no batch is identified)."""
    where, params = [], []
    if batch_num:
        like = batch_num if batch_num.upper().startswith("B-") else f"B-{batch_num}"
        where.append("i.batch_id ILIKE ?")
        params.append(f"%{like}%")
    if breached_only:
        where.append("i.current_temp > i.max_safe_temp")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = (
        "SELECT i.batch_id, i.product_name, i.category, i.current_temp, "
        "i.max_safe_temp, i.storage_days, s.shipment_id, s.origin, "
        "s.destination, s.vehicle_id, s.driver_id, s.status "
        "FROM inventory i JOIN shipments s ON i.batch_id = s.batch_id "
        f"{where_sql} "
        "ORDER BY (i.current_temp - i.max_safe_temp) DESC LIMIT 5"
    )
    return execute(conn, sql, params)
