def test_driver_sees_only_assigned_shipments(client, h):
    r = client.get("/api/shipments", headers=h("driver"))
    assert r.status_code == 200
    rows = r.json()
    assert rows and all(s["driverId"] == "usr_jlee" for s in rows)
    assert {s["id"] for s in rows} == {"SHP-88329", "SHP-88335", "SHP-88341"}


def test_driver_quotations_denied_and_logged(client, h):
    r = client.get("/api/procurement/quotations", headers=h("driver"))
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert detail["decision"] == "denied" and detail["stage"] == "api"
    events = client.get("/api/audit/security-events", headers=h("owner")).json()
    assert any(e["id"] == detail["incidentId"] and e["userId"] == "usr_jlee" for e in events)


def test_driver_cannot_update_other_drivers_shipment(client, h):
    r = client.patch("/api/shipments/SHP-88331/status", json={"status": "Arrived"}, headers=h("driver"))
    assert r.status_code == 403
    own = client.patch("/api/shipments/SHP-88341/status", json={"status": "Loading"}, headers=h("driver"))
    assert own.status_code == 200 and own.json()["status"] == "Loading"


def test_data_architect_no_business_rows(client, h):
    assert client.get("/api/shipments", headers=h("data_architect")).status_code == 403
    assert client.get("/api/sources", headers=h("data_architect")).status_code == 200
    ws = client.get("/api/workspace", headers=h("data_architect")).json()
    assert ws["shipments"] == [] and ws["quotations"] == [] and ws["expiry"]["lots"] == []
    assert ws["expiry"]["runs"] and ws["expiry"]["feed"]["rejected"]


def test_procurement_sees_only_supplier_returns(client, h):
    r = client.get("/api/inventory/expiry/actions", headers=h("procurement"))
    assert r.status_code == 200
    assert r.json() and {a["kind"] for a in r.json()} == {"supplier_return"}
    assert client.get("/api/inventory/expiry/lots", headers=h("procurement")).status_code == 403


def test_request_body_cannot_override_identity(client, h):
    r = client.post("/api/chat", json={"message": "What are our supplier prices?", "org_id": "tnt_plant_a_demo", "role": "executive"},
                    headers=h("driver"))
    assert r.status_code == 403


def test_unauthenticated_and_bad_tokens(client):
    assert client.get("/api/workspace").status_code == 401
    assert client.get("/api/workspace", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_login_with_password(client):
    ok = client.post("/api/auth/login", json={"email": "operator@nexus-demo.io", "password": "brev-a100"})
    assert ok.status_code == 200 and ok.json()["token_type"] == "bearer"
    assert client.post("/api/auth/login", json={"email": "operator@nexus-demo.io", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "tess.vos@acme-demo.io", "password": "demo1234"}).status_code == 200


def test_cross_tenant_ids_return_404(client, h):
    # BF-2201 belongs to tnt_borealis (and even uses the same driver id)
    assert client.patch("/api/shipments/BF-2201/status", json={"status": "Arrived"}, headers=h("owner")).status_code == 404
    assert client.post("/api/auth/company", json={"company_id": "tnt_borealis"}, headers=h("owner")).status_code == 403
