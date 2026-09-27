"""RBAC: executive = full access; driver = restricted to assigned shipments,
blocked from pricing/margin/SLA/contract topics."""
import re

DRIVER_ID = "DRV-02"

_RESTRICTED_RE = re.compile(
    r"\b(pricing|prices?|margin|margins|sla|slas|contracts?|profitability)\b", re.I
)


class ForbiddenTopic(Exception):
    """Raised when a restricted role asks about a blocked topic."""


def check_message(message: str, role: str) -> None:
    """Drivers may not touch pricing/margins/SLA/contracts."""
    if role == "driver" and _RESTRICTED_RE.search(message):
        raise ForbiddenTopic(
            "Driver role is not permitted to access pricing, margin, SLA, or "
            "contract data. Please contact your fleet manager."
        )


def filter_sql(sql: str, role: str) -> str:
    """Drivers: every query touching shipments is scoped to their driver_id
    (wrapped so the filter survives JOINs/GROUP BY)."""
    if role != "driver":
        return sql
    if re.search(r"\bshipments\b", sql, re.I) and "driver_id" not in sql.lower():
        sql = (
            f"SELECT * FROM ({sql.rstrip().rstrip(';')}) AS scoped "
            f"WHERE driver_id = '{DRIVER_ID}'"
        )
    return sql
