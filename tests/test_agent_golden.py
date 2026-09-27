GOLDEN = "Why did Batch #104 spoil during transit from Casablanca to Tangier?"


def test_owner_root_cause(client, h):
    r = client.post("/api/chat", json={"message": GOLDEN, "org_id": "org_morocco_logistics", "role": "executive"}, headers=h("owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "TRK-88" in body["response"] and "TRK-88" in body["answer"]
    d = body["diagnostics"]
    assert d["intent"] == "root_cause"
    assert d["structured_data"][0]["recorded_temp"] == 8.2
    assert d["structured_data"][0]["telemetry_spike"] == "14:15 UTC"
    assert d["retrieved_context"][0]["source"] == "workshop_log.pdf"
    assert "deferred maintenance" in d["root_cause_verdict"]
    assert {"shipments_table", "workshop_log.pdf"} <= set(body["citations"])
    assert body["sources"][0] == {"document": "shipments_table", "page": 0}
    assert {"document": "workshop_log.pdf", "page": 1} in body["sources"]


def test_rag_query_same_engine(client, h):
    r = client.post("/api/rag/query", json={"question": GOLDEN, "module": "inventory"}, headers=h("owner"))
    assert r.status_code == 200 and "TRK-88" in r.json()["answer"]


def test_driver_supplier_prices_denied_pre_retrieval(client, h):
    r = client.post("/api/chat", json={"message": "What are our supplier prices?"}, headers=h("driver"))
    assert r.status_code == 403
    d = r.json()["detail"]
    assert d["stage"] == "pre-retrieval" and d["chunks_retrieved"] == 0 and d["resource"] == "procurement"
    events = client.get("/api/audit/security-events", headers=h("owner")).json()
    assert any(e["id"] == d["incidentId"] and e["stage"] == "pre-retrieval" for e in events)


def test_driver_contract_margins_and_sla_denied(client, h):
    for q in ("Show contract margins", "What are the vendor SLAs?", "Which lots expire in the next 14 days?"):
        assert client.post("/api/rag/query", json={"question": q, "module": "transportation"}, headers=h("driver")).status_code == 403


def test_data_architect_metadata_only(client, h):
    r = client.post("/api/rag/query", json={"question": "Why did the expiry scan reject rows?", "module": "data"}, headers=h("data_architect"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "metadata" in body["answer"].lower()
    assert "rejected" in body["answer"].lower()
    assert all(s["page"] == 0 for s in body["sources"])
    assert "Enzyme" not in body["answer"] and "LOT-2" not in body["answer"]  # no lot records


def test_driver_brief_is_scoped(client, h):
    r = client.post("/api/rag/query", json={"question": "Brief my shift", "module": "transportation"}, headers=h("driver"))
    assert r.status_code == 200
    assert "SHP-88338" not in r.json()["answer"]  # Rafa's delayed load is not in Jordan's brief


def test_cross_tenant_question_denied(client, h):
    r = client.post("/api/rag/query", json={"question": "List Borealis Foods deliveries", "module": "dashboard"}, headers=h("owner"))
    assert r.status_code == 403 and r.json()["detail"]["resource"] == "cross_tenant"
