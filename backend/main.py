"""FastAPI app: /api/chat (RBAC-aware agent) and /api/audit/run (rule engine)."""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import agent
from permissions import ForbiddenTopic
from rag_engine import RagEngine
from schemas import AuditRequest, AuditResponse, ChatRequest, ChatResponse
from sql_engine import EngineUnavailable

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("SUPPLY_DB_PATH", REPO_ROOT / "demo" / "supply_chain.duckdb"))
DOCS_DIR = Path(os.environ.get("SUPPLY_DOCS_DIR", REPO_ROOT / "demo" / "docs"))
RULES_PATH = Path(os.environ.get("SUPPLY_RULES_PATH", REPO_ROOT / "demo" / "rules.json"))

rag = RagEngine(DOCS_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    rag.index()  # index demo/docs/*.pdf at startup; empty is fine
    yield


app = FastAPI(title="Supply Chain Guardian API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    try:
        return agent.handle(req.message, req.role, DB_PATH, rag, RULES_PATH)
    except ForbiddenTopic as e:
        raise HTTPException(status_code=403, detail=str(e))
    except EngineUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/audit/run", response_model=AuditResponse)
def audit(req: AuditRequest):
    try:
        return agent.run_audit(DB_PATH, RULES_PATH)
    except EngineUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok", "db_path": str(DB_PATH),
            "rag_chunks": len(rag.chunks)}
