"""End-to-end verification for backend/modules/agent_observability.py.

Run with:  python backend/tests/test_agent_observability.py
"""

from __future__ import annotations

import os
import sys

# Make the repo root importable when run as a plain script.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# Ensure no real LLM key is picked up -> exercises the heuristic fallback path.
for var in ("LLM_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "OPENAI_API_KEY"):
    os.environ.pop(var, None)

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.modules.agent_observability import (  # noqa: E402
    ACTIVE_AGENT_RULES,
    DynamicRuleSchema,
    IntentParserError,
    evaluate_dynamic_rule,
    parse_natural_language_rule,
    register_agent_job,
    set_metric_provider,
)

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def test_llm_parse_clean_json():
    print("[1] LLM parser (injected, clean JSON)")
    raw = (
        '{"rule_name": "Dairy Stock Expiry Check", "domain": "inventory", '
        '"filter_key": "category", "filter_value": "Dairy", "metric": "days_in_stock", '
        '"operator": ">", "threshold_value": 2, "cron_schedule": "0 8 * * *", '
        '"action_type": "DISCOUNT_ALERT"}'
    )
    rule = parse_natural_language_rule("Dairy products...", llm_caller=lambda _p: raw)
    check("rule_name", rule.rule_name == "Dairy Stock Expiry Check")
    check("domain", rule.domain == "inventory")
    check("threshold coerced to float", rule.threshold_value == 2.0)


def test_llm_parse_noisy_json():
    print("[2] LLM parser (markdown-wrapped + prose)")
    raw = (
        "Sure! Here is the rule:\n```json\n"
        '{"rule_name":"Cap","domain":"capacity","filter_key":"location",'
        '"filter_value":"Warehouse_B","metric":"occupied_percentage","operator":">=",'
        '"threshold_value":85,"action_type":"CAPACITY_WARNING"}\n'
        "```\nLet me know if you need changes."
    )
    rule = parse_natural_language_rule("...", llm_caller=lambda _p: raw)
    check("domain capacity", rule.domain == "capacity")
    check("default cron applied", rule.cron_schedule == "0 8 * * *")
    check("operator >=", rule.operator == ">=")


def test_llm_failure_hard_error():
    print("[3] LLM failure with allow_fallback=False raises")
    try:
        parse_natural_language_rule(
            "x", allow_fallback=False, llm_caller=lambda _p: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        check("raised IntentParserError", False)
    except IntentParserError:
        check("raised IntentParserError", True)


def test_heuristic_fallback():
    print("[4] Heuristic fallback (no API key)")
    r1 = parse_natural_language_rule("Dairy products shouldn't stay in stock longer than 2 days")
    check("inv domain", r1.domain == "inventory", r1.domain)
    check("inv operator >", r1.operator == ">", r1.operator)
    check("inv threshold 2", r1.threshold_value == 2.0)
    check("inv filter Dairy", r1.filter_value == "Dairy", r1.filter_value)

    r2 = parse_natural_language_rule("Alert me if Warehouse B capacity passes 85%")
    check("cap domain", r2.domain == "capacity", r2.domain)
    check("cap operator >", r2.operator == ">", r2.operator)
    check("cap threshold 85", r2.threshold_value == 85.0)
    check("cap filter Warehouse", r2.filter_value == "Warehouse", r2.filter_value)

    r3 = parse_natural_language_rule("Revenue should be at least 5000")
    check("rev domain", r3.domain == "revenue", r3.domain)
    check("rev operator >=", r3.operator == ">=", r3.operator)


def test_schema_rejects_bad_cron_and_operator():
    print("[5] Schema validation edge cases")
    try:
        DynamicRuleSchema(
            rule_name="x", domain="inventory", filter_key="k", filter_value="v",
            metric="m", operator=">", threshold_value=1, cron_schedule="not a cron",
            action_type="A",
        )
        check("bad cron rejected", False)
    except Exception as e:
        check("bad cron rejected", "cron" in str(e).lower())

    try:
        DynamicRuleSchema(
            rule_name="x", domain="inventory", filter_key="k", filter_value="v",
            metric="m", operator="!=", threshold_value=1, action_type="A",
        )
        check("bad operator rejected", False)
    except Exception:
        check("bad operator rejected", True)


def test_register_and_registry():
    print("[6] register_agent_job + ACTIVE_AGENT_RULES")
    rule = parse_natural_language_rule("Dairy products shouldn't stay in stock longer than 2 days")
    job_id = register_agent_job(rule)
    check("job_id returned", bool(job_id) and job_id.startswith("agent_rule_"))
    check("rule in registry", rule.rule_id in ACTIVE_AGENT_RULES)
    check("registry job_id matches", ACTIVE_AGENT_RULES[rule.rule_id]["job_id"] == job_id)

    # Invalid cron rejected at the scheduler boundary too.
    bad = DynamicRuleSchema.model_construct(
        rule_name="bad", domain="inventory", filter_key="k", filter_value="v",
        metric="m", operator=">", threshold_value=1, cron_schedule="99 99 * * *",
        action_type="A",
    )
    try:
        register_agent_job(bad)
        check("invalid cron rejected by scheduler", False)
    except ValueError:
        check("invalid cron rejected by scheduler", True)


def test_evaluate():
    print("[7] evaluate_dynamic_rule (breach + ok + unknown)")
    rule = parse_natural_language_rule("Warehouse B capacity passes 85%")
    register_agent_job(rule)

    # Force a guaranteed breach.
    set_metric_provider(lambda r: 99.0)
    res = evaluate_dynamic_rule(rule.rule_id)
    check("breach detected", res["breached"] is True, res)
    check("alert payload present", res["alert"] is not None)
    check("status breached", res["status"] == "breached")

    # Force a guaranteed pass.
    set_metric_provider(lambda r: 10.0)
    res2 = evaluate_dynamic_rule(rule.rule_id)
    check("no breach", res2["breached"] is False, res2)
    check("status ok", res2["status"] == "ok")

    # Unknown rule id is non-fatal.
    res3 = evaluate_dynamic_rule("does-not-exist")
    check("unknown rule non-fatal", res3["status"] == "unknown_rule")

    # Restore default provider.
    import backend.modules.agent_observability as mod
    set_metric_provider(mod._default_metric_provider)


def test_routes():
    print("[8] FastAPI routes via TestClient")
    with TestClient(app) as client:
        check("health", client.get("/health").json()["status"] == "ok")

        resp = client.post(
            "/api/agent/rules/create",
            json={"prompt": "Alert me if Warehouse B capacity passes 85%"},
        )
        check("create 201", resp.status_code == 201, resp.text)
        body = resp.json()
        check("returns job_id", bool(body.get("job_id")))
        check("returns rule", body["rule"]["domain"] == "capacity")

        bad = client.post("/api/agent/rules/create", json={"prompt": "hi"})
        check("short prompt 422", bad.status_code == 422, bad.text)

        no_num = client.post("/api/agent/rules/create", json={"prompt": "alert me about dairy"})
        check("unparseable 422", no_num.status_code == 422, no_num.text)

        active = client.get("/api/agent/rules/active")
        check("active 200", active.status_code == 200)
        check("active count >= 1", active.json()["count"] >= 1)
        check("active has next_run_time", active.json()["rules"][0]["next_run_time"] is not None)

        rid = body["rule_id"]
        run = client.post(f"/api/agent/rules/{rid}/run")
        check("manual run 200", run.status_code == 200, run.text)
        check("manual run has observed_value", "observed_value" in run.json())

        check("run unknown 404", client.post("/api/agent/rules/nope/run").status_code == 404)
        check("delete 200", client.delete(f"/api/agent/rules/{rid}").status_code == 200)
        check("delete unknown 404", client.delete("/api/agent/rules/nope").status_code == 404)
        check("registry shrunk", rid not in ACTIVE_AGENT_RULES)


if __name__ == "__main__":
    for fn in (
        test_llm_parse_clean_json,
        test_llm_parse_noisy_json,
        test_llm_failure_hard_error,
        test_heuristic_fallback,
        test_schema_rejects_bad_cron_and_operator,
        test_register_and_registry,
        test_evaluate,
        test_routes,
    ):
        fn()
    print(f"\n=== {PASS} passed, {FAIL} failed ===")
    sys.exit(1 if FAIL else 0)
