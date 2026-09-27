"""OpenAI-compatible chat client (NVIDIA NIM by default) with a deterministic fallback switch.

Every caller must catch `LLMUnavailable` and use its deterministic path, so the
demo keeps working with no key and no network.
"""
from __future__ import annotations

import json
import logging
import re

import httpx

from .config import get_settings

log = logging.getLogger("nexus.llm")


class LLMUnavailable(Exception):
    """No key, timeout, HTTP error or unusable response."""


def enabled() -> bool:
    return bool(get_settings().llm_api_key.strip())


def mode() -> str:
    return "nim" if enabled() else "deterministic"


def chat(messages: list[dict], json_mode: bool = False) -> str:
    s = get_settings()
    if not enabled():
        raise LLMUnavailable("LLM_API_KEY not set")
    body: dict = {"model": s.llm_model, "messages": messages, "temperature": 0.1, "max_tokens": 700}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        r = httpx.post(f"{s.llm_base_url.rstrip('/')}/chat/completions", json=body, timeout=s.llm_timeout_seconds,
                       headers={"Authorization": f"Bearer {s.llm_api_key}"})
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        log.warning("LLM call failed: %s", type(exc).__name__)
        raise LLMUnavailable(str(exc)) from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMUnavailable("empty completion")
    return content


def chat_json(messages: list[dict]) -> dict:
    raw = chat(messages, json_mode=True)
    m = re.search(r"\{.*\}", raw, re.S)
    try:
        return json.loads(m.group(0) if m else raw)
    except ValueError as exc:
        raise LLMUnavailable("model did not return JSON") from exc


def extract_sql(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.+?)```", text, re.S | re.I)
    return (m.group(1) if m else text).strip().rstrip(";")
