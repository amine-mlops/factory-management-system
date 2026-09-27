"""NEXUS Supply Chain Copilot — FastAPI app factory.

Lifespan: init DB → seed if empty → load rules → ingest docs → start the audit scheduler.
Every route lives under API_PREFIX (/api); GET /health is also served at the root.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import jwt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import audit_engine, db, rag_engine
from .config import VERSION, get_settings
from .routers import assistant, audit, auth, data, documents, health, inventory, members, procurement, transportation, triage, workspace

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("nexus.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.secret  # fail fast when DEMO_MODE=false and JWT_SECRET is missing
    db.connect()
    db.init_schema()
    if db.is_empty() and s.demo_mode:
        from demo import seed

        # reset=True also drops pre-spec tables (e.g. the old 7-column inventory) so the new schema applies
        seed.seed(reset=True)
        log.info("empty database seeded with the demo company")
    if s.rag_backend.lower() != "tfidf":
        log.warning("RAG_BACKEND=%s is not installed in this build — using the TF-IDF backend", s.rag_backend)
    audit_engine.load_seed_rules()
    n = rag_engine.ingest_all()
    log.info("RAG index ready: %s chunks (%s newly ingested) · LLM %s", rag_engine.chunk_count(), n,
             "configured" if s.llm_api_key else "deterministic")
    task = asyncio.create_task(audit_engine.scheduler(s.audit_interval_seconds)) if s.scheduler_on else None
    try:
        yield
    finally:
        if task:
            task.cancel()
        db.close()


def _identity(request: Request) -> tuple[str, str]:
    """User + tenant for the access log (read from the token claims; never logs the token itself)."""
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        return "-", "-"
    try:
        c = jwt.decode(h[7:], get_settings().secret, algorithms=["HS256"])
        return c.get("sub", "-"), c.get("cid") or "-"
    except jwt.InvalidTokenError:
        return "invalid-token", "-"


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="NEXUS Supply Chain Copilot API", version=VERSION, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        user, tenant = _identity(request)
        log.info("%s %s %s %.0fms user=%s tenant=%s", request.method, request.url.path, response.status_code,
                 (time.perf_counter() - t0) * 1000, user, tenant)
        return response

    for r in (health, auth, workspace, members, documents, assistant, transportation, procurement, inventory, audit, data, triage):
        app.include_router(r.router, prefix=s.api_prefix)
    app.include_router(health.router)  # GET /health at the root too
    return app


app = create_app()
