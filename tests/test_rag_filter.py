from backend import rag_engine
from backend.auth import load_principal

T = "tnt_plant_a_demo"


def test_driver_never_gets_financial_or_restricted(client):
    p = load_principal("usr_jlee", T)
    r = rag_engine.retrieve(p, "supplier pricing quotation impeller rebates prices", k=20)
    assert all(c["classification"] != "financial" for c in r.chunks)
    assert all("CONFIDENTIAL" not in c["document"] and "Quotation" not in c["document"] for c in r.chunks)
    assert r.trace["afterPermission"] < r.trace["afterTenant"] < r.trace["candidates"]


def test_owner_gets_confidential_pricing_page(client):
    p = load_principal("usr_owner", T)
    r = rag_engine.retrieve(p, "negotiated unit prices and rebates", k=3)
    assert any(c["document"] == "Supplier_Pricing_2026_CONFIDENTIAL.pdf" and c["page"] == 2 for c in r.chunks)


def test_procurement_gets_quotes_but_not_restricted(client):
    p = load_principal("usr_tvos", T)
    r = rag_engine.retrieve(p, "impeller unit prices rebates quotation", k=20)
    docs = {c["document"] for c in r.chunks}
    assert "Hydraflow_Quotation_Q-7781.pdf" in docs
    assert "Supplier_Pricing_2026_CONFIDENTIAL.pdf" not in docs


def test_cross_tenant_chunks_never_returned(client):
    for uid in ("usr_owner", "usr_jlee", "usr_tvos", "usr_pshah"):
        p = load_principal(uid, T)
        r = rag_engine.retrieve(p, "Borealis Nordfrost TRK-88 compressor drivers break", k=50)
        assert all(not c["id"].startswith("bf-") for c in r.chunks)
        assert all("Borealis" not in c["text"] for c in r.chunks)


def test_filters_run_before_scoring(client, monkeypatch):
    """Scoring must only ever see chunks that survived tenant → ACL → classification."""
    p = load_principal("usr_jlee", T)
    seen = []
    real = rag_engine._vecs.get
    monkeypatch.setattr(rag_engine, "_vecs", type("V", (dict,), {"get": lambda self, k, d=None: (seen.append(k), real(k, d))[1]})(rag_engine._vecs))
    rag_engine.retrieve(p, "prices quotation compressor", k=5)
    assert seen and not any(k.startswith("bf-") or k.startswith("doc_04") or k.startswith("doc_08") for k in seen)
