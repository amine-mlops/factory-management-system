import json

POLICY = "Flag any dairy batch in transit over 4°C for more than 12h"


def test_compile_rule_saved_and_mirrored(client, h, rules_path):
    r = client.post("/api/audit/rules/compile", json={"text": POLICY}, headers=h("owner"))
    assert r.status_code == 201, r.text
    rule = r.json()
    assert rule["id"].startswith("RULE-USR-") and rule["active"] and rule["table"] == "inventory"
    fields = {c["field"] for c in rule["conditions"]}
    assert {"category", "warehouse_id", "current_temp", "storage_hours"} <= fields
    on_disk = json.loads(rules_path.read_text())
    assert any(x["id"] == rule["id"] for x in on_disk)
    assert client.get("/api/audit/rules", headers=h("owner")).json()[-1]["id"] == rule["id"]


def test_audit_run_flags_b104(client, h):
    r = client.post("/api/audit/run", json={"org_id": "org_morocco_logistics"}, headers=h("owner"))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "completed" and body["total_rules_evaluated"] >= 3
    cold = next(v for v in body["violations"] if v["rule_id"] == "RULE-COLD-01")
    assert cold["severity"] == "CRITICAL"
    rec = next(x for x in cold["affected_records"] if x["batch_id"] == "B-104")
    assert rec["status"] == "BREACHED" and rec["current_temp"] == 8.2 and rec["max_safe_temp"] == 4.0
    assert all(x["batch_id"] != "B-101" for x in cold["affected_records"])
    latest = client.get("/api/audit/runs?limit=1", headers=h("owner")).json()[0]
    assert any(v["rule_id"] == "RULE-COLD-01" for v in latest["violations"])


def test_compiled_rule_matches_b104(client, h):
    body = client.post("/api/audit/run", json={}, headers=h("owner")).json()
    usr = [v for v in body["violations"] if v["rule_id"].startswith("RULE-USR-")]
    assert usr and any(x["batch_id"] == "B-104" for x in usr[0]["affected_records"])


def test_expiry_scan_partial(client, h):
    r = client.post("/api/inventory/expiry/scan", headers=h("owner"))
    assert r.status_code == 200
    run = r.json()
    assert run["status"] == "partial" and run["rowsRejected"] == 2 and run["lotsScanned"] == 15


def test_expiry_rules_validation(client, h):
    bad = client.put("/api/inventory/expiry/rules", json={"criticalDays": 30, "warningDays": 10}, headers=h("owner"))
    assert bad.status_code == 422
    ok = client.put("/api/inventory/expiry/rules", json={"warningDays": 28}, headers=h("owner"))
    assert ok.status_code == 200 and ok.json()["warningDays"] == 28
    ws = client.get("/api/workspace", headers=h("owner")).json()
    assert ws["expiry"]["ruleHistory"][0]["change"].startswith("Warning window")


def test_decision_hand_off_is_simulated(client, h):
    r = client.post("/api/inventory/expiry/actions/ACT-1047/decision", json={"decision": "approved"}, headers=h("procurement"))
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["decidedBy"] == "tess.vos"
    events = client.get("/api/audit/events", headers=h("owner")).json()
    assert any("hand-off queued (simulated)" in e["detail"] for e in events)
    # procurement cannot decide inventory-routed actions
    assert client.post("/api/inventory/expiry/actions/ACT-1041/decision", json={"decision": "approved"}, headers=h("procurement")).status_code == 403


def test_driver_cannot_compile_or_see_violations(client, h):
    assert client.post("/api/audit/rules/compile", json={"text": POLICY}, headers=h("driver")).status_code == 403
    assert client.post("/api/audit/run", json={}, headers=h("driver")).status_code == 403
