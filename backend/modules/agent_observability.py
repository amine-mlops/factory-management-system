"""Agent Observability — intent-driven, multi-tenant observability engine.

This module turns a user's plain-English monitoring wish into a live background
job:

    "Dairy products shouldn't stay in stock longer than 2 days"
        -> DynamicRuleSchema(domain="inventory", metric="days_in_stock",
                             operator=">", threshold_value=2.0, ...)
        -> APScheduler CronTrigger job that audits the DB and raises alerts.

Three layers live here:

  1. ``DynamicRuleSchema``      — the validated contract for a rule.
  2. ``parse_natural_language_rule`` — LLM intent parser (OpenAI/OpenRouter/NVIDIA
                                 NIM compatible), with a deterministic regex
                                 fallback so the service degrades gracefully
                                 when no API key is configured.
  3. ``register_agent_job`` / ``evaluate_dynamic_rule`` — APScheduler plumbing and
                                 the rule-audit execution path.

Plus a FastAPI ``router`` exposing the create/list endpoints.

Environment variables (all optional; sensible defaults shown):
    LLM_API_KEY / OPENROUTER_API_KEY / NVIDIA_API_KEY / OPENAI_API_KEY
    LLM_BASE_URL   (default: https://openrouter.ai/api/v1)
                   NVIDIA NIM example: https://integrate.api.nvidia.com/v1
    LLM_MODEL      (default: openai/gpt-4o-mini)
    LLM_TIMEOUT    (default: 30, seconds)
"""

from __future__ import annotations

import json
import logging
import operator as _op
import os
import random
import re
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Literal, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger("agent_observability")

# --------------------------------------------------------------------------- #
# 1. STRUCTURED OUTPUT SCHEMA
# --------------------------------------------------------------------------- #

#: Domains the platform knows how to audit. Keeping this closed makes the
#: downstream routing (which table / service to query) safe and exhaustive.
DomainLiteral = Literal["inventory", "procurement", "revenue", "capacity"]

#: Comparison operators we allow on a metric. Arbitrary Python expressions are
#: deliberately NOT allowed — these map to a fixed, safe operator table below.
OperatorLiteral = Literal[">", "<", "==", ">=", "<="]


class DynamicRuleSchema(BaseModel):
    """A single, fully-resolved observability rule.

    Produced by the intent parser and consumed by the scheduler. Every field the
    LLM must decide is required (no silent defaults), except ``cron_schedule``
    which sensibly defaults to a daily 08:00 sweep.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    rule_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Short human-readable name, e.g. 'Dairy Stock Expiry Check'.",
    )
    domain: DomainLiteral = Field(
        ..., description="Business domain the rule audits."
    )
    filter_key: str = Field(
        ...,
        min_length=1,
        description="Field to filter on, e.g. 'category', 'location', 'department'.",
    )
    filter_value: str = Field(
        ...,
        min_length=1,
        description="Value to filter for, e.g. 'Dairy', 'Warehouse_B'.",
    )
    metric: str = Field(
        ...,
        min_length=1,
        description="Metric being measured, e.g. 'days_in_stock', 'occupied_percentage'.",
    )
    operator: OperatorLiteral = Field(
        ..., description="Comparison operator applied between metric and threshold."
    )
    threshold_value: float = Field(
        ..., description="Numeric threshold the metric is compared against."
    )
    cron_schedule: str = Field(
        default="0 8 * * *",
        description="Standard 5-field crontab expression (daily 08:00 by default).",
    )
    action_type: str = Field(
        ...,
        min_length=1,
        description="Alert/action identifier, e.g. 'DISCOUNT_ALERT', 'CAPACITY_WARNING'.",
    )

    # Populated by the scheduler; not required from the LLM. Kept optional so the
    # parser output can round-trip straight into ``register_agent_job``.
    rule_id: Optional[str] = Field(
        default=None, description="Server-assigned unique rule identifier."
    )

    @field_validator("cron_schedule")
    @classmethod
    def _validate_cron(cls, value: str) -> str:
        """Reject malformed crontabs at parse time rather than at schedule time."""
        value = (value or "").strip()
        if not value:
            raise ValueError("cron_schedule must not be empty")
        if len(value.split()) != 5:
            raise ValueError(
                "cron_schedule must be a standard 5-field crontab expression "
                "(minute hour day-of-month month day-of-week)"
            )
        try:
            # Authoritative check — same code path the scheduler will use.
            CronTrigger.from_crontab(value)
        except (ValueError, TypeError) as exc:  # pragma: no cover - defensive
            raise ValueError(f"invalid cron_schedule {value!r}: {exc}") from exc
        return value


class RulePromptRequest(BaseModel):
    """Body for ``POST /api/agent/rules/create``."""

    prompt: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="Natural-language monitoring rule, e.g. 'Alert me if Warehouse B "
        "capacity passes 85%'.",
    )


# --------------------------------------------------------------------------- #
# 2. INTENT PARSER ENGINE
# --------------------------------------------------------------------------- #


class IntentParserError(RuntimeError):
    """Raised when a prompt cannot be turned into a valid :class:`DynamicRuleSchema`."""


#: System contract handed to the LLM. Kept terse and explicit: small/quantised
#: models (e.g. NVIDIA NIM endpoints) follow a flat "return only JSON, these exact
#: keys" instruction far more reliably than prose.
_PARSER_SYSTEM_PROMPT = """You are an intent parser for a factory SaaS observability platform.
Convert the user's plain-English monitoring rule into a single JSON object with
EXACTLY these keys and value constraints:

- rule_name: string, short descriptive name (e.g. "Dairy Stock Expiry Check")
- domain: one of "inventory" | "procurement" | "revenue" | "capacity"
- filter_key: string, the field to filter on (e.g. "category", "location", "department")
- filter_value: string, the value to filter for (e.g. "Dairy", "Warehouse_B")
- metric: string, the measured metric (e.g. "days_in_stock", "occupied_percentage", "daily_revenue")
- operator: one of ">" | "<" | "==" | ">=" | "<="
- threshold_value: number (no units, no quotes)
- cron_schedule: string, a standard 5-field crontab (default "0 8 * * *")
- action_type: string, an action identifier (e.g. "DISCOUNT_ALERT", "CAPACITY_WARNING", "REVENUE_DROP")

Mapping guidance:
- "shouldn't stay longer than 2 days" / "more than" / "exceeds" / "passes" -> ">"
- "less than" / "below" / "under" -> "<"
- "at least" / "reaches" -> ">="  ; "at most" / "no more than" -> "<="
- "is" / "equals" -> "=="
- Warehouses/locations -> domain "capacity" or "inventory"; supplier/vendor spend -> "procurement";
  sales/margin -> "revenue"; stock levels -> "inventory".
- When no time is stated, use cron_schedule "0 8 * * *".

Return ONLY the JSON object. No markdown, no prose, no code fences."""


def _get_llm_settings() -> Dict[str, str]:
    """Resolve LLM connection settings from the environment.

    Supports OpenRouter (default), NVIDIA NIM (OpenAI-compatible), and plain
    OpenAI by simply changing ``LLM_BASE_URL``.
    """
    api_key = (
        os.getenv("LLM_API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or os.getenv("NVIDIA_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    return {
        "api_key": api_key,
        "base_url": os.getenv("LLM_BASE_URL")
        or os.getenv("OPENROUTER_BASE_URL")
        or "https://openrouter.ai/api/v1",
        "model": os.getenv("LLM_MODEL") or "openai/gpt-4o-mini",
        "timeout": os.getenv("LLM_TIMEOUT", "30"),
    }


def _extract_json_object(text: str) -> str:
    """Pull the first balanced JSON object out of a noisy LLM response.

    Handles the common failure modes: markdown fences, leading prose, and
    trailing commentary.
    """
    if not text:
        raise IntentParserError("LLM returned an empty response")
    # Strip markdown code fences if present.
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    # Grab the outermost {...} span.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise IntentParserError(f"No JSON object found in LLM response: {text[:200]!r}")
    return text[start : end + 1]


def _call_llm(prompt: str) -> str:
    """Send the prompt to the configured chat-completions endpoint.

    Imported lazily so the module still imports (and the heuristic fallback still
    works) in environments without the ``openai`` package installed.
    """
    settings = _get_llm_settings()
    if not settings["api_key"]:
        raise IntentParserError("No LLM API key configured")

    try:
        from openai import OpenAI  # noqa: PLC0415 - lazy import by design
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise IntentParserError("openai package is not installed") from exc

    client = OpenAI(
        api_key=settings["api_key"],
        base_url=settings["base_url"],
        timeout=float(settings["timeout"]),
    )
    response = client.chat.completions.create(
        model=settings["model"],
        temperature=0.0,  # deterministic extraction
        messages=[
            {"role": "system", "content": _PARSER_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content if response.choices else None
    if not content:
        raise IntentParserError("LLM returned no choices/content")
    return content


# -- Deterministic fallback parser ------------------------------------------ #
# Used when no API key is configured, or (optionally) when the LLM call fails.
# It is intentionally conservative: it extracts the well-known patterns and
# defaults everything else, so the platform never hard-fails on a missing key.

_DOMAIN_KEYWORDS = {
    "inventory": ("stock", "inventory", "shelf", "expir", "sku", "warehouse stock"),
    "procurement": ("supplier", "vendor", "purchase", "procurement", "po ", "lead time"),
    "revenue": ("revenue", "sales", "margin", "profit", "turnover", "price"),
    "capacity": ("capacity", "occupan", "utilisation", "utilization", "load", "throughput"),
}

_OPERATOR_PATTERNS = (
    (r"(greater than or equal|at least|reaches|or more)", ">="),
    (r"(less than or equal|at most|no more than)", "<="),
    (r"(longer than|more than|greater than|exceed|pass(?:es)?|above|over|>)\s*", ">"),
    (r"(shorter than|less than|below|under|fewer than|<)\s*", "<"),
    (r"(equals?|is exactly|==)", "=="),
)

_METRIC_BY_DOMAIN = {
    "inventory": "days_in_stock",
    "procurement": "supplier_lead_time_days",
    "revenue": "daily_revenue",
    "capacity": "occupied_percentage",
}

_ACTION_BY_DOMAIN = {
    "inventory": "DISCOUNT_ALERT",
    "procurement": "PROCUREMENT_ALERT",
    "revenue": "REVENUE_DROP",
    "capacity": "CAPACITY_WARNING",
}


def _heuristic_parse(prompt: str) -> DynamicRuleSchema:
    """Best-effort, dependency-free extraction of a rule from a prompt."""
    lowered = prompt.lower()

    # Domain: first keyword hit wins; default to inventory.
    domain: str = "inventory"
    for candidate, keywords in _DOMAIN_KEYWORDS.items():
        if any(kw in lowered for kw in keywords):
            domain = candidate
            break

    # Operator: match against the ordered pattern table.
    operator_symbol = ">"
    for pattern, symbol in _OPERATOR_PATTERNS:
        if re.search(pattern, lowered):
            operator_symbol = symbol
            break

    # Threshold: first standalone number (handles "85%", "2 days", ">= 3.5").
    number_match = re.search(r"(\d+(?:\.\d+)?)", lowered)
    if not number_match:
        raise IntentParserError(
            "Could not find a numeric threshold in the prompt; please state a value "
            "such as '...longer than 2 days' or '...passes 85%'."
        )
    threshold = float(number_match.group(1))

    # Filter value: capture the first meaningful Capitalised word (a category or
    # location). Skip filler words that commonly start a sentence.
    filter_key = "location" if domain in ("capacity", "inventory") else "department"
    filter_value = "ALL"
    _STOPWORDS = {"alert", "if", "when", "please", "notify", "tell", "let"}
    for cap_match in re.finditer(r"\b([A-Z][A-Za-z0-9_]+)\b", prompt):
        candidate = cap_match.group(1)
        if candidate.lower() not in _STOPWORDS:
            filter_value = candidate
            break

    # If the prompt names a category-ish word right before "products", use it.
    cat_match = re.search(r"([A-Za-z]+)\s+products?", lowered)
    if cat_match:
        filter_key = "category"
        filter_value = cat_match.group(1).capitalize()

    return DynamicRuleSchema(
        rule_name=f"{filter_value} {domain.capitalize()} Rule".strip(),
        domain=domain,  # type: ignore[arg-type]
        filter_key=filter_key,
        filter_value=filter_value,
        metric=_METRIC_BY_DOMAIN[domain],
        operator=operator_symbol,  # type: ignore[arg-type]
        threshold_value=threshold,
        cron_schedule="0 8 * * *",
        action_type=_ACTION_BY_DOMAIN[domain],
    )


def parse_natural_language_rule(
    prompt: str,
    *,
    allow_fallback: bool = True,
    llm_caller: Optional[Callable[[str], str]] = None,
) -> DynamicRuleSchema:
    """Turn a natural-language monitoring rule into a :class:`DynamicRuleSchema`.

    Parameters
    ----------
    prompt:
        The user's plain-English rule.
    allow_fallback:
        When ``True`` (default) and the LLM is unavailable or fails to produce a
        valid schema, fall back to the deterministic regex parser. Set to
        ``False`` to make LLM failures hard errors.
    llm_caller:
        Optional injection point for testing (a callable ``prompt -> raw text``).

    Raises
    ------
    IntentParserError
        If the prompt is empty, or parsing fails and fallback is disallowed.
    """
    if not prompt or not prompt.strip():
        raise IntentParserError("prompt must be a non-empty string")

    prompt = prompt.strip()
    caller = llm_caller or _call_llm
    llm_error: Optional[Exception] = None

    try:
        raw = caller(prompt)
        data = json.loads(_extract_json_object(raw))
        rule = DynamicRuleSchema.model_validate(data)
        logger.info("Parsed rule via LLM: %s", rule.rule_name)
        return rule
    except Exception as exc:  # noqa: BLE001 - we deliberately catch and degrade
        llm_error = exc
        logger.warning("LLM intent parse failed (%s)", exc)

    if not allow_fallback:
        raise IntentParserError(f"LLM intent parsing failed: {llm_error}") from llm_error

    logger.info("Falling back to heuristic intent parser")
    try:
        return _heuristic_parse(prompt)
    except IntentParserError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise IntentParserError(
            f"Could not parse rule from prompt (LLM error: {llm_error}; heuristic error: {exc})"
        ) from exc


# --------------------------------------------------------------------------- #
# 3. DYNAMIC SCHEDULER
# --------------------------------------------------------------------------- #

#: In-memory registry of live rules. Keyed by ``rule_id``.
#:   {rule_id: {"rule": DynamicRuleSchema, "job_id": str, "created_at": datetime,
#              "last_run": datetime | None, "last_value": float | None,
#              "last_breached": bool | None, "run_count": int, "breach_count": int}}
ACTIVE_AGENT_RULES: Dict[str, Dict[str, Any]] = {}

#: Rolling buffer of the most recent threshold breaches (newest last).
ALERT_HISTORY: deque = deque(maxlen=500)

_REGISTRY_LOCK = threading.Lock()
_SCHEDULER_LOCK = threading.Lock()
_scheduler: Optional[BackgroundScheduler] = None

#: Safe operator table — the only thing ``operator`` can ever reach.
_OPERATOR_FUNCS: Dict[str, Callable[[float, float], bool]] = {
    ">": _op.gt,
    "<": _op.lt,
    "==": _op.eq,
    ">=": _op.ge,
    "<=": _op.le,
}

#: Pluggable metric source. Default is a simulation; override via
#: :func:`set_metric_provider` to wire in a real DB audit.
_metric_provider: Callable[[DynamicRuleSchema], float] = None  # type: ignore[assignment]

#: Pluggable action dispatcher. Default just logs the alert.
_action_dispatcher: Callable[[DynamicRuleSchema, float], None] = None  # type: ignore[assignment]


def _default_metric_provider(rule: DynamicRuleSchema) -> float:
    """Simulate a database audit result for a rule.

    Produces a value clustered around the threshold so that, in a demo, breaches
    occur realistically. Replace with a real query via :func:`set_metric_provider`.
    """
    # Wide-ish spread around the threshold => some runs breach, some don't.
    value = rule.threshold_value * random.uniform(0.6, 1.4)
    if rule.metric.endswith("percentage"):
        value = min(value, 100.0)
    return round(value, 2)


def _default_action_dispatcher(rule: DynamicRuleSchema, observed: float) -> None:
    """Log a breach. Replace via :func:`set_action_dispatcher` to email/Slack/page."""
    logger.warning(
        "ALERT[%s] %s | %s.%s %s %s %s (observed=%s)",
        rule.action_type,
        rule.rule_name,
        rule.filter_key,
        rule.filter_value,
        rule.metric,
        rule.operator,
        rule.threshold_value,
        observed,
    )


_metric_provider = _default_metric_provider
_action_dispatcher = _default_action_dispatcher


def set_metric_provider(provider: Callable[[DynamicRuleSchema], float]) -> None:
    """Install a real metric source (e.g. a DB audit) for rule evaluation."""
    global _metric_provider
    if not callable(provider):
        raise TypeError("metric provider must be callable")
    _metric_provider = provider


def set_action_dispatcher(dispatcher: Callable[[DynamicRuleSchema, float], None]) -> None:
    """Install a real alert sink (email, Slack, PagerDuty, ...)."""
    global _action_dispatcher
    if not callable(dispatcher):
        raise TypeError("action dispatcher must be callable")
    _action_dispatcher = dispatcher


def get_scheduler() -> BackgroundScheduler:
    """Return the process-wide scheduler, starting it on first use (thread-safe)."""
    global _scheduler
    with _SCHEDULER_LOCK:
        if _scheduler is None:
            _scheduler = BackgroundScheduler(
                job_defaults={
                    "coalesce": True,  # collapse missed runs into one
                    "max_instances": 1,  # never overlap a rule with itself
                    "misfire_grace_time": 3600,
                }
            )
            logger.info("Starting BackgroundScheduler")
            _scheduler.start()
        return _scheduler


def start_scheduler() -> None:
    """Explicitly start the scheduler (call from FastAPI startup). Idempotent."""
    get_scheduler()


def shutdown_scheduler(wait: bool = False) -> None:
    """Stop the scheduler and clear the registry (call from FastAPI shutdown)."""
    global _scheduler
    with _SCHEDULER_LOCK:
        if _scheduler is not None:
            logger.info("Shutting down BackgroundScheduler")
            _scheduler.shutdown(wait=wait)
            _scheduler = None
    with _REGISTRY_LOCK:
        ACTIVE_AGENT_RULES.clear()


def register_agent_job(rule: DynamicRuleSchema) -> str:
    """Register ``rule`` as a recurring background Cron job.

    Returns the APScheduler ``job_id``. The rule is also recorded in
    :data:`ACTIVE_AGENT_RULES` under its ``rule_id``.

    Raises
    ------
    ValueError
        If ``rule.cron_schedule`` is not a valid crontab expression.
    RuntimeError
        If the scheduler refuses the job.
    """
    # Validate the trigger up-front so callers get a clear error (schema also
    # validates this, but a rule can be constructed via model_construct).
    try:
        trigger = CronTrigger.from_crontab(rule.cron_schedule)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid cron_schedule {rule.cron_schedule!r}: {exc}") from exc

    rule_id = rule.rule_id or uuid.uuid4().hex
    rule.rule_id = rule_id
    job_id = f"agent_rule_{rule_id[:12]}"

    scheduler = get_scheduler()
    try:
        job = scheduler.add_job(
            evaluate_dynamic_rule,
            trigger=trigger,
            args=[rule_id],
            id=job_id,
            name=rule.rule_name,
            replace_existing=True,  # idempotent re-registration of the same rule_id
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean runtime error
        raise RuntimeError(f"Failed to register agent job: {exc}") from exc

    with _REGISTRY_LOCK:
        ACTIVE_AGENT_RULES[rule_id] = {
            "rule": rule,
            "job_id": job.id,
            "created_at": datetime.now(timezone.utc),
            "last_run": None,
            "last_value": None,
            "last_breached": None,
            "run_count": 0,
            "breach_count": 0,
        }

    logger.info(
        "Registered job %s for rule '%s' (cron=%s)", job.id, rule.rule_name, rule.cron_schedule
    )
    return job.id


def evaluate_dynamic_rule(rule_id: str) -> Dict[str, Any]:
    """Execute a rule's audit and raise an alert if the threshold is breached.

    This is the function APScheduler calls. It is also safe to call manually
    (see the ``/rules/{rule_id}/run`` endpoint) — it never raises for an unknown
    rule_id, it returns a diagnostic payload instead, so a bad job can't crash the
    scheduler's executor thread.
    """
    with _REGISTRY_LOCK:
        entry = ACTIVE_AGENT_RULES.get(rule_id)
        if entry is None:
            logger.error("evaluate_dynamic_rule called for unknown rule_id=%s", rule_id)
            return {"rule_id": rule_id, "status": "unknown_rule", "breached": None}
        rule: DynamicRuleSchema = entry["rule"]

    # --- 1. Query the (simulated or real) metric --------------------------- #
    try:
        observed = float(_metric_provider(rule))
    except Exception as exc:  # noqa: BLE001 - a data error must not kill the job
        logger.exception("Metric provider failed for rule %s", rule_id)
        return {"rule_id": rule_id, "status": "error", "error": str(exc), "breached": False}

    # --- 2. Compare against the threshold ---------------------------------- #
    compare = _OPERATOR_FUNCS.get(rule.operator)
    if compare is None:  # defensive: should be impossible given the Literal
        logger.error("Unknown operator %r on rule %s", rule.operator, rule_id)
        return {"rule_id": rule_id, "status": "error", "error": "unknown operator"}

    breached = bool(compare(observed, rule.threshold_value))

    # --- 3. Dispatch the alert --------------------------------------------- #
    alert: Optional[Dict[str, Any]] = None
    if breached:
        alert = {
            "rule_id": rule_id,
            "rule_name": rule.rule_name,
            "domain": rule.domain,
            "filter": {rule.filter_key: rule.filter_value},
            "metric": rule.metric,
            "operator": rule.operator,
            "threshold": rule.threshold_value,
            "observed": observed,
            "action_type": rule.action_type,
            "triggered_at": datetime.now(timezone.utc).isoformat(),
        }
        with _REGISTRY_LOCK:
            ALERT_HISTORY.append(alert)
        try:
            _action_dispatcher(rule, observed)
        except Exception:  # noqa: BLE001 - alerting failures are logged, not fatal
            logger.exception("Action dispatcher failed for rule %s", rule_id)

    # --- 4. Update bookkeeping --------------------------------------------- #
    with _REGISTRY_LOCK:
        current = ACTIVE_AGENT_RULES.get(rule_id)
        if current is not None:
            current["last_run"] = datetime.now(timezone.utc)
            current["last_value"] = observed
            current["last_breached"] = breached
            current["run_count"] += 1
            if breached:
                current["breach_count"] += 1

    logger.info(
        "Evaluated rule %s: %s %s %s -> %s (breached=%s)",
        rule_id,
        rule.metric,
        rule.operator,
        rule.threshold_value,
        observed,
        breached,
    )
    return {
        "rule_id": rule_id,
        "status": "breached" if breached else "ok",
        "observed_value": observed,
        "threshold": rule.threshold_value,
        "breached": breached,
        "alert": alert,
    }


def list_active_rules() -> list:
    """Serialise the registry, enriching each entry with live job metadata."""
    scheduler = get_scheduler()
    with _REGISTRY_LOCK:
        snapshot = list(ACTIVE_AGENT_RULES.items())

    out = []
    for rule_id, entry in snapshot:
        rule: DynamicRuleSchema = entry["rule"]
        job = scheduler.get_job(entry["job_id"])
        out.append(
            {
                "rule_id": rule_id,
                "job_id": entry["job_id"],
                "rule": rule.model_dump(mode="json"),
                "created_at": entry["created_at"].isoformat(),
                "run_count": entry["run_count"],
                "breach_count": entry["breach_count"],
                "last_run": entry["last_run"].isoformat() if entry["last_run"] else None,
                "last_value": entry["last_value"],
                "next_run_time": job.next_run_time.isoformat()
                if job is not None and job.next_run_time
                else None,
            }
        )
    return out


def remove_agent_job(rule_id: str) -> bool:
    """Remove a live rule and its scheduled job. Returns ``True`` if it existed."""
    with _REGISTRY_LOCK:
        entry = ACTIVE_AGENT_RULES.pop(rule_id, None)
    if entry is None:
        return False
    try:
        get_scheduler().remove_job(entry["job_id"])
    except Exception:  # noqa: BLE001 - job may already be gone
        logger.warning("Could not remove job %s (already gone?)", entry["job_id"])
    logger.info("Removed rule %s", rule_id)
    return True


# --------------------------------------------------------------------------- #
# 4. FASTAPI ROUTES
# --------------------------------------------------------------------------- #

router = APIRouter(prefix="/api/agent", tags=["Agent Observability"])

#: Starlette renamed HTTP_422_UNPROCESSABLE_ENTITY -> ..._CONTENT; support both.
_HTTP_422 = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)


@router.post(
    "/rules/create",
    status_code=status.HTTP_201_CREATED,
    summary="Parse a natural-language rule and start monitoring it",
)
def create_agent_rule(payload: RulePromptRequest) -> Dict[str, Any]:
    """Parse intent -> validate -> register a cron job -> return the live rule."""
    # 1. Intent parsing (LLM, with heuristic fallback).
    try:
        rule = parse_natural_language_rule(payload.prompt)
    except IntentParserError as exc:
        raise HTTPException(
            status_code=_HTTP_422,
            detail=f"Could not understand the rule: {exc}",
        ) from exc

    # 2. Schedule it.
    try:
        job_id = register_agent_job(rule)
    except ValueError as exc:  # invalid cron
        raise HTTPException(
            status_code=_HTTP_422,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:  # scheduler failure
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return {
        "status": "active",
        "job_id": job_id,
        "rule_id": rule.rule_id,
        "rule": rule.model_dump(mode="json"),
    }


@router.get(
    "/rules/active",
    summary="List all registered and active agent rules",
)
def get_active_agent_rules() -> Dict[str, Any]:
    """Return every rule currently monitored, with schedule + run metadata."""
    rules = list_active_rules()
    return {"count": len(rules), "rules": rules}


@router.post(
    "/rules/{rule_id}/run",
    summary="Manually trigger a rule audit (useful for testing)",
)
def run_agent_rule(rule_id: str) -> Dict[str, Any]:
    """Run a rule's audit immediately, out-of-band from its cron schedule."""
    if rule_id not in ACTIVE_AGENT_RULES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown rule_id {rule_id}"
        )
    return evaluate_dynamic_rule(rule_id)


@router.delete(
    "/rules/{rule_id}",
    summary="Stop monitoring a rule and unschedule its job",
)
def delete_agent_rule(rule_id: str) -> Dict[str, Any]:
    """Remove a rule from the registry and cancel its cron job."""
    if not remove_agent_job(rule_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown rule_id {rule_id}"
        )
    return {"status": "removed", "rule_id": rule_id}
