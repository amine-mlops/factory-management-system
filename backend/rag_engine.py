"""Role-scoped RAG: PDF ingest → ACL-tagged chunks → per-tenant TF-IDF.

Filters run in this order and BEFORE any similarity scoring:
  1. tenant_id == principal.tenant_id
  2. role / module ACL (roles contains '*' or one of the caller's roles; module chunks need `view`)
  3. classification (`financial` needs procurement read_records or owner)
Only the survivors are scored, so a filtered-out chunk can never reach the LLM.
"""
from __future__ import annotations

import json
import math
import re
import threading
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from . import db
from .permissions import Principal

CHUNK_WORDS = 120
OVERLAP_WORDS = 20
TOKEN = re.compile(r"\w+")
STOPWORDS = set("""a an and are as at be by for from has have in into is it its of on or that the their this to was were
will with what which who why how when where does did do our we you your my me i any all can may must not no""".split())

_lock = threading.RLock()
_chunks: list[dict] = []                 # every chunk of every tenant (shared index)
_idf: dict[str, dict[str, float]] = {}   # tenant -> term -> idf
_vecs: dict[str, dict[str, float]] = {}  # chunk id -> tf-idf vector (normalised)


def _stem(t: str) -> str:
    """Tiny suffix stripper so 'quotations' matches 'quotation' (no ML dependencies)."""
    for suf in ("ies", "es", "s"):
        if len(t) > 4 and t.endswith(suf) and not t.endswith("ss"):
            return t[: -len(suf)] + ("y" if suf == "ies" else "")
    return t


def tokenize(text: str) -> list[str]:
    return [_stem(t) for t in TOKEN.findall(text.lower()) if t not in STOPWORDS]


def classification_for(name: str, category: str) -> str:
    return "financial" if category == "Supplier contract" or re.search(r"quot|pric", name, re.I) else "internal"


def acl_for(visibility: str, module: str | None) -> tuple[list[str], list[str]]:
    modules = [module] if visibility == "Module" and module else []
    roles = ["owner", "admin"] if visibility == "Restricted" else ["*"]
    return modules, roles


def split_words(text: str) -> list[str]:
    words = text.split()
    if len(words) <= CHUNK_WORDS:
        return [" ".join(words)] if words else []
    out, step = [], CHUNK_WORDS - OVERLAP_WORDS
    for start in range(0, len(words), step):
        out.append(" ".join(words[start:start + CHUNK_WORDS]))
        if start + CHUNK_WORDS >= len(words):
            break
    return out


def extract_pages(path: Path) -> list[tuple[int, str]]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    return [(i, " ".join((page.extract_text() or "").split())) for i, page in enumerate(reader.pages, start=1)]


_HEADER = re.compile(r"^.{0,120}? - page \d+\s*")


def ingest_document(doc: dict) -> int:
    """(Re)chunk one document row; returns the number of chunks stored."""
    modules, roles = acl_for(doc["visibility"], doc.get("module"))
    cls = doc.get("classification") or classification_for(doc["name"], doc.get("category") or "")
    db.execute("DELETE FROM chunks WHERE document_id = ? AND tenant_id = ?", [doc["id"], doc["tenant_id"]])
    n = 0
    for page, text in extract_pages(Path(doc["path"])):
        body = _HEADER.sub("", text, count=1).strip()  # drop the seeded page header line
        if not body:
            continue
        for part in split_words(body):
            n += 1
            db.insert("chunks", {"id": f"{doc['id']}#p{page}#{n}", "tenant_id": doc["tenant_id"], "document_id": doc["id"],
                                 "page": page, "text": part, "visibility": doc["visibility"], "modules": modules, "roles": roles,
                                 "classification": cls, "updated_at": db.now_iso(), "source": doc["name"]})
    db.update("documents", {"chunks": n, "classification": cls}, {"id": doc["id"]})
    return n


def retag_document(doc: dict) -> None:
    """Metadata-only change (category / visibility / module): re-tag the chunks without re-reading the PDF."""
    modules, roles = acl_for(doc["visibility"], doc.get("module"))
    cls = classification_for(doc["name"], doc.get("category") or "")
    db.execute("UPDATE chunks SET visibility = ?, modules = ?, roles = ?, classification = ? WHERE document_id = ?",
               [doc["visibility"], json.dumps(modules), json.dumps(roles), cls, doc["id"]])
    db.update("documents", {"classification": cls}, {"id": doc["id"]})
    rebuild()


def ingest_all() -> int:
    """Ingest every indexed document that has no chunks yet (start-up + seed), then rebuild the index."""
    pending = db.rows("SELECT d.* FROM documents d WHERE d.status = 'indexed' AND NOT EXISTS "
                      "(SELECT 1 FROM chunks c WHERE c.document_id = d.id)")
    n = 0
    for doc in pending:
        try:
            if Path(doc["path"]).exists():
                n += ingest_document(doc)
        except Exception as exc:  # a corrupt PDF must not stop start-up
            db.update("documents", {"error": str(exc)[:200]}, {"id": doc["id"]})
    rebuild()
    return n


def rebuild() -> None:
    """Rebuild the in-memory per-tenant TF-IDF index from the chunks table."""
    global _chunks, _idf, _vecs
    chunks = db.rows("SELECT c.*, coalesce(d.name, c.source) AS document FROM chunks c LEFT JOIN documents d ON d.id = c.document_id")
    by_tenant: dict[str, list[dict]] = {}
    for c in chunks:
        c["tokens"] = tokenize(c["text"])
        by_tenant.setdefault(c["tenant_id"], []).append(c)
    idf: dict[str, dict[str, float]] = {}
    vecs: dict[str, dict[str, float]] = {}
    for tenant, cs in by_tenant.items():
        df = Counter(t for c in cs for t in set(c["tokens"]))
        n = len(cs)
        idf[tenant] = {t: math.log((1 + n) / (1 + d)) + 1 for t, d in df.items()}
        for c in cs:
            tf = Counter(c["tokens"])
            v = {t: (1 + math.log(k)) * idf[tenant][t] for t, k in tf.items()}
            norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
            vecs[c["id"]] = {t: x / norm for t, x in v.items()}
    with _lock:
        _chunks, _idf, _vecs = chunks, idf, vecs


def chunk_count() -> int:
    return len(_chunks)


# ---------------------------------------------------------------- access checks (shared with the documents list)


def role_ok(p: Principal, roles: list[str]) -> bool:
    return "*" in roles or any(r in p.roles for r in roles)


def modules_ok(p: Principal, modules: list[str], record: bool = False) -> bool:
    if not modules:
        return True
    action = "read_records" if record else "view"
    return any(p.can(m, action) for m in modules)


def classification_ok(p: Principal, cls: str) -> bool:
    return cls != "financial" or p.owner_like or p.can("procurement", "read_records")


def document_visible(p: Principal, doc: dict) -> bool:
    modules, roles = acl_for(doc["visibility"], doc.get("module"))
    cls = doc.get("classification") or classification_for(doc["name"], doc.get("category") or "")
    return p.owner_like or (role_ok(p, roles) and modules_ok(p, modules) and classification_ok(p, cls))


# ---------------------------------------------------------------- retrieval


@dataclass
class Retrieval:
    chunks: list[dict]
    trace: dict


def retrieve(p: Principal, query: str, k: int = 5, boost: list[str] | None = None) -> Retrieval:
    with _lock:
        pool = list(_chunks)
    candidates = len(pool)
    tenant = [c for c in pool if c["tenant_id"] == p.tenant_id]
    permitted = [c for c in tenant if role_ok(p, c["roles"] or []) and modules_ok(p, c["modules"] or [], record=c.get("visibility") == "Record")]
    scoped = [c for c in permitted if classification_ok(p, c["classification"])]
    trace = {"candidates": candidates, "afterTenant": len(tenant), "afterPermission": len(permitted), "afterScope": len(scoped)}

    # Scoring happens only now, over survivors.
    idf = _idf.get(p.tenant_id, {})
    q = Counter(tokenize(query))
    qv = {t: (1 + math.log(n)) * idf.get(t, 0.0) for t, n in q.items()}
    qn = math.sqrt(sum(x * x for x in qv.values())) or 1.0
    boosts = [b.lower() for b in (boost or []) if b]
    scored = []
    for c in scoped:
        v = _vecs.get(c["id"], {})
        score = sum(qv[t] / qn * v.get(t, 0.0) for t in qv)
        if boosts and any(b in c["text"].lower() for b in boosts):
            score *= 2
        if score > 0:
            scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], x[1]["document"], x[1]["page"]))
    hits = [{"id": c["id"], "document": c["document"], "page": c["page"], "text": c["text"], "score": round(s, 4),
             "updated_at": c["updated_at"], "classification": c["classification"]} for s, c in scored[:k]]
    return Retrieval(hits, trace)
