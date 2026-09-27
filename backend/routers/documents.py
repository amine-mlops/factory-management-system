"""Knowledge-base documents: upload (PDF only), background processing, ACL patch, delete."""
import re
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile

from .. import db, rag_engine, snapshot
from ..auth import current_principal
from ..config import get_settings
from ..permissions import MODULES, Principal, forbid, require
from ..schemas import DocumentPatch, dump
from ..security_log import audit_event

router = APIRouter(prefix="/documents", tags=["documents"])


def _can_configure(p: Principal) -> Principal:
    if not (p.owner_like or p.can("knowledge", "configure")):
        forbid(p, "knowledge", "Requires configure on the Knowledge base")
    return p


def _process(doc_id: str) -> None:
    """uploaded → extracting → tagging → indexed (or failed)."""
    delay = get_settings().doc_stage_delay_seconds
    try:
        db.update("documents", {"status": "extracting", "progress": 10}, {"id": doc_id})
        time.sleep(delay)
        doc = db.one("SELECT * FROM documents WHERE id = ?", [doc_id])
        if not doc:
            return
        n = rag_engine.ingest_document(doc)
        db.update("documents", {"status": "tagging", "progress": 70, "chunks": n}, {"id": doc_id})
        time.sleep(delay)
        db.update("documents", {"status": "indexed", "progress": 100, "updated_at": db.now_iso()}, {"id": doc_id})
        rag_engine.rebuild()
    except Exception as exc:
        db.update("documents", {"status": "failed", "error": str(exc)[:200]}, {"id": doc_id})


@router.post("/upload", status_code=201)
async def upload(background: BackgroundTasks, file: UploadFile = File(...), category: str = Form("Policy"),
                 visibility: str = Form("Company"), module: str | None = Form(None), p: Principal = Depends(current_principal)) -> dict:
    _can_configure(p)
    if visibility not in ("Company", "Module", "Restricted"):
        raise HTTPException(422, detail="visibility must be Company, Module or Restricted")
    if visibility == "Module" and module not in MODULES:
        raise HTTPException(422, detail="Module visibility needs a valid module")
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, detail=f"PDF larger than {get_settings().max_upload_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, detail="Only PDF files are accepted")
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(file.filename or "document.pdf").name)[:120] or "document.pdf"
    if not safe.lower().endswith(".pdf"):
        safe += ".pdf"
    folder = get_settings().uploads_path / p.tenant_id
    folder.mkdir(parents=True, exist_ok=True)
    doc_id = f"doc_{uuid.uuid4().hex[:10]}"
    path = folder / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(data)
    db.insert("documents", {"id": doc_id, "tenant_id": p.tenant_id, "name": safe, "size_kb": max(1, len(data) // 1024), "category": category[:60],
                            "visibility": visibility, "module": module if visibility == "Module" else None, "status": "uploaded", "progress": 0,
                            "chunks": 0, "path": str(path), "index_version": None, "updated_at": db.now_iso(), "error": None,
                            "classification": rag_engine.classification_for(safe, category)})
    audit_event(p, "Document uploaded", f"{safe} · {visibility}{' · ' + module if module and visibility == 'Module' else ''}", "info", "knowledge")
    if get_settings().doc_stage_delay_seconds > 0:
        threading.Thread(target=_process, args=(doc_id,), daemon=True).start()
    else:
        background.add_task(_process, doc_id)
    return dump(snapshot.document_model(db.one("SELECT * FROM documents WHERE id = ?", [doc_id])))


@router.get("/status")
def status(p: Principal = Depends(require("knowledge", "view"))) -> list[dict]:
    return dump(snapshot.documents(p))


def _own_doc(p: Principal, doc_id: str) -> dict:
    d = db.one("SELECT * FROM documents WHERE id = ? AND tenant_id = ?", [doc_id, p.tenant_id])
    if not d:
        raise HTTPException(404, detail="Document not found")
    return d


@router.patch("/{doc_id}")
def patch(doc_id: str, body: DocumentPatch, p: Principal = Depends(require("knowledge", "configure"))) -> dict:
    d = _own_doc(p, doc_id)
    changes = body.model_dump(exclude_none=True)
    vis = changes.get("visibility", d["visibility"])
    module = changes.get("module", d["module"])
    if vis == "Module" and module not in MODULES:
        raise HTTPException(422, detail="Module visibility needs a valid module")
    changes["module"] = module if vis == "Module" else None
    db.update("documents", {**changes, "updated_at": db.now_iso()}, {"id": doc_id})
    d = _own_doc(p, doc_id)
    rag_engine.retag_document(d)
    audit_event(p, "Document ACL updated", f"{d['name']} · {d['visibility']}{' · ' + d['module'] if d['module'] else ''}", "info", "knowledge")
    return dump(snapshot.document_model(d))


@router.delete("/{doc_id}", status_code=204)
def delete(doc_id: str, p: Principal = Depends(require("knowledge", "configure"))) -> Response:
    d = _own_doc(p, doc_id)
    db.execute("DELETE FROM chunks WHERE document_id = ?", [doc_id])
    db.execute("DELETE FROM documents WHERE id = ?", [doc_id])
    path = Path(d["path"] or "")
    uploads = get_settings().uploads_path.resolve()
    if path.is_file() and uploads in path.resolve().parents:  # never delete the seeded demo PDFs
        path.unlink()
    rag_engine.rebuild()
    audit_event(p, "Document deleted", d["name"], "warn", "knowledge")
    return Response(status_code=204)
