"""GET /health (public) — also served at the root."""
from fastapi import APIRouter

from .. import llm, rag_engine
from ..config import VERSION

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    # Only the TF-IDF backend ships; RAG_BACKEND=chroma is accepted but falls back (see DECISIONS.md).
    return {"status": "ok", "version": VERSION, "llm": llm.mode(), "rag": "tfidf", "db": "duckdb", "chunks": rag_engine.chunk_count()}
