"""Every §7 route answers the owner with 2xx; the snapshot validates against the Workspace model."""
import io

from backend.schemas import Workspace

ALL_MODULES = ["procurement", "inventory", "transportation", "warehousing", "manufacturing", "distribution", "crm", "it"]


def _pdf_bytes() -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    pdf.multi_cell(0, 6, "Reefer pre-trip checklist: verify setpoint, return-air sensor and door seals before loading dairy.")
    return bytes(pdf.output())


def test_workspace_snapshot(client, h):
    r = client.get("/api/workspace", headers=h("owner"))
    assert r.status_code == 200
    ws = Workspace.model_validate(r.json())
    assert len(ws.shipments) == 8 and len(ws.suppliers) == 4 and len(ws.quotations) == 4
    assert len(ws.expiry.lots) >= 15
    assert ws.current_user_id == "usr_owner" and ws.tenant.tenant_id == "tnt_plant_a_demo"
    assert r.json()["previewRoles"] is None and r.json()["stock"] == []
    assert any(c.id == "tms" and c.health == "failed" for c in ws.connectors)


def test_driver_snapshot_projection(client, h):
    ws = client.get("/api/workspace", headers=h("driver")).json()
    assert {s["driverId"] for s in ws["shipments"]} == {"usr_jlee"}
    assert ws["incidents"] == [] and ws["invites"] == [] and ws["suppliers"] == []
    assert any(g["name"] == "gold.shipments_eta" for g in ws["gold"]) and any(c["id"] == "tms" for c in ws["connectors"])
    assert ws["expiry"]["lots"] == [] and ws["expiry"]["actions"] == []
    assert all(d["visibility"] != "Restricted" for d in ws["documents"])


def test_procurement_snapshot_projection(client, h):
    ws = client.get("/api/workspace", headers=h("procurement")).json()
    assert ws["shipments"] == [] and len(ws["quotations"]) == 4
    assert {a["kind"] for a in ws["expiry"]["actions"]} == {"supplier_return"}
    assert set(ws["expiry"]["lots"][0]) <= {"id", "sku", "product", "batch", "qty", "unit", "supplierId", "expiry"}


def test_every_route_answers_the_owner(client, h, tokens):
    H = h("owner")

    def ok(r, *codes):
        assert r.status_code in (codes or (200, 201, 204)), f"{r.request.method} {r.request.url} → {r.status_code} {r.text[:300]}"
        return r

    ok(client.get("/health"))
    ok(client.get("/api/health"))
    assert client.get("/api/health").json()["llm"] == "deterministic"
    ok(client.post("/api/auth/login", json={"email": "operator@nexus-demo.io", "password": "brev-a100"}))
    ok(client.post("/api/auth/demo-login", json={"persona": "owner"}))
    sess = ok(client.get("/api/auth/session", headers=H)).json()
    assert sess["current_company_id"] == "tnt_plant_a_demo" and sess["memberships"][0]["roles"] == ["owner"]
    ok(client.post("/api/auth/company", json={"company_id": "tnt_plant_a_demo"}, headers=H))

    ok(client.get("/api/workspace", headers=H))
    ok(client.get("/api/workspaces/current", headers=H))
    ok(client.patch("/api/workspaces/current", json={"context": "Cold-chain dairy lanes Casablanca ↔ Tangier."}, headers=H))
    ok(client.get("/api/modules", headers=H))
    ok(client.put("/api/modules", json={"enabledModules": ALL_MODULES}, headers=H))
    grants = ok(client.get("/api/roles/grants", headers=H)).json()
    assert {g["resource"] for g in grants} >= {"dashboard", "transportation", "data"}

    inv = ok(client.post("/api/invites", json={"roles": ["customer_service"]}, headers=H)).json()
    assert inv["code"].startswith("ACME-MBR-")
    ok(client.get("/api/invites", headers=H))
    prev = ok(client.get(f"/api/invites/{inv['code']}", headers=H)).json()
    assert prev["companyName"] == "Acme Process Industries" and "crm" in prev["pages"]
    ok(client.post(f"/api/invites/{inv['code']}/accept", headers=H))
    assert client.get(f"/api/invites/{inv['code']}", headers=H).status_code == 404  # used
    ok(client.get("/api/members", headers=H))
    ok(client.get("/api/members?role=truck_driver", headers=H))
    ok(client.put("/api/members/usr_mkim/roles", json={"roles": ["customer_service", "inventory_planner"]}, headers=H))
    assert client.put("/api/members/usr_owner/roles", json={"roles": ["admin"]}, headers=H).status_code == 422
    ok(client.post("/api/access-requests", json={"resource": "crm"}, headers=H))

    doc = ok(client.post("/api/documents/upload", headers=H, data={"category": "SOP / Procedure", "visibility": "Module", "module": "transportation"},
                         files={"file": ("reefer checklist.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")})).json()
    assert doc["status"] == "uploaded"
    docs = ok(client.get("/api/documents/status", headers=H)).json()
    assert next(d for d in docs if d["id"] == doc["id"])["status"] == "indexed"
    assert client.post("/api/documents/upload", headers=H, data={"visibility": "Company"},
                       files={"file": ("x.pdf", io.BytesIO(b"not a pdf"), "application/pdf")}).status_code == 415
    ok(client.patch(f"/api/documents/{doc['id']}", json={"visibility": "Company"}, headers=H))
    ok(client.delete(f"/api/documents/{doc['id']}", headers=H), 204)

    ok(client.post("/api/rag/query", json={"question": "What is our cavitation response procedure?", "module": "knowledge"}, headers=H))
    ok(client.post("/api/chat", json={"message": "What needs my attention today?"}, headers=H))

    ok(client.get("/api/shipments", headers=H))
    ok(client.patch("/api/shipments/SHP-88347/assignment", json={"driverId": "usr_rdiaz"}, headers=H))
    ok(client.patch("/api/shipments/SHP-88347/assignment", json={"driverId": None}, headers=H))
    ok(client.patch("/api/shipments/SHP-88338/status", json={"status": "In transit"}, headers=H))

    ok(client.get("/api/procurement/suppliers", headers=H))
    assert len(ok(client.get("/api/procurement/quotations?rfq=RFQ-2291", headers=H)).json()) == 3
    award = ok(client.post("/api/procurement/quotations/Q-7781/award", headers=H)).json()
    assert award["purchaseOrderDraft"].startswith("PO-")
    assert next(q for q in award["quotations"] if q["id"] == "Q-7781")["status"] == "Awarded"

    ok(client.get("/api/inventory/expiry/lots", headers=H))
    ok(client.get("/api/inventory/expiry/actions", headers=H))
    ok(client.post("/api/inventory/expiry/actions/ACT-1045/decision", json={"decision": "approved"}, headers=H))
    ok(client.get("/api/inventory/expiry/rules", headers=H))
    ok(client.put("/api/inventory/expiry/rules", json={"scanMinutes": 20}, headers=H))
    ok(client.get("/api/inventory/expiry/runs", headers=H))
    ok(client.post("/api/inventory/expiry/scan", headers=H))

    ok(client.get("/api/audit/rules", headers=H))
    rule = ok(client.post("/api/audit/rules/compile", json={"text": "Flag any lot that will expire within 5 days"}, headers=H)).json()
    ok(client.patch(f"/api/audit/rules/{rule['id']}", json={"active": False}, headers=H))
    ok(client.delete(f"/api/audit/rules/{rule['id']}", headers=H), 204)
    ok(client.post("/api/audit/run", json={}, headers=H))
    ok(client.get("/api/audit/runs?limit=3", headers=H))
    ok(client.get("/api/audit/security-events", headers=H))
    assert client.post("/api/audit/security-events", json={"requestedResource": "procurement", "query": "#/procurement"}, headers=H).status_code == 409
    ok(client.get("/api/audit/events", headers=H))

    ok(client.get("/api/sources", headers=H))
    ok(client.post("/api/sources/crm/disconnect", headers=H))
    assert ok(client.post("/api/sources/crm/connect", headers=H)).json()["health"] == "healthy"
    ok(client.get("/api/pipelines", headers=H))

    tri = ok(client.post("/api/triage/infer", json={"preset": "pump_cavitation", "source": "opcua://x"}, headers=H)).json()
    assert tri["asset"]["id"] == "P-204"

    new = ok(client.post("/api/workspaces", json={"name": "Nova Foods", "enabledModules": ["inventory"], "locations": ["Casablanca"]}, headers=H), 201).json()
    assert new["tenant"]["enabledModules"] == ["inventory"]
    nh = {"Authorization": f"Bearer {new['access_token']}"}
    ws2 = ok(client.get("/api/workspace", headers=nh)).json()
    assert ws2["shipments"] == [] and ws2["tenant"]["name"] == "Nova Foods"


def test_route_denial_logged_only_when_denied(client, h):
    r = client.post("/api/audit/security-events", json={"requestedResource": "procurement", "query": "#/procurement"}, headers=h("driver"))
    assert r.status_code == 201 and r.json()["stage"] == "route"


def test_demo_login_disabled_outside_demo_mode(client, monkeypatch):
    from backend.config import get_settings

    monkeypatch.setattr(get_settings(), "demo_mode", False)
    assert client.post("/api/auth/demo-login", json={"persona": "owner"}).status_code == 404
