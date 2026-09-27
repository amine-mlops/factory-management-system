"""Pydantic request/response contracts for the Supply Chain Guardian API."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    org_id: str = "org_morocco_logistics"
    role: Literal["executive", "driver"]
    message: str


class ContextItem(BaseModel):
    source: str
    snippet: str


class Diagnostics(BaseModel):
    structured_data: list[dict[str, Any]] = Field(default_factory=list)
    retrieved_context: list[ContextItem] = Field(default_factory=list)
    root_cause_verdict: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    diagnostics: Diagnostics
    citations: list[str] = Field(default_factory=list)


class AuditRequest(BaseModel):
    org_id: str = "org_morocco_logistics"


class AuditResponse(BaseModel):
    status: str
    total_rules_evaluated: int
    violations: list[dict[str, Any]] = Field(default_factory=list)
