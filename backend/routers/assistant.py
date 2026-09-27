"""POST /api/rag/query (the UI's assistant) and POST /api/chat (AGENTS.md contract) — same engine."""
from fastapi import APIRouter, Depends

from .. import agent
from ..auth import current_principal
from ..permissions import Principal
from ..schemas import ChatRequest, RagQueryRequest

router = APIRouter(tags=["assistant"])


@router.post("/rag/query")
def rag_query(body: RagQueryRequest, p: Principal = Depends(current_principal)) -> dict:
    return agent.answer(p, body.question, body.module)


@router.post("/chat")
def chat(body: ChatRequest, p: Principal = Depends(current_principal)) -> dict:
    # body.org_id and body.role are ignored on purpose: tenant and roles come from the token + database.
    return agent.chat(p, body.message, body.module or "dashboard")
