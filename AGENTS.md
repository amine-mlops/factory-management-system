# AGENTS.md — Factory Management System

Instructions for AI agents (Hermes project-manager agent + any coding agent) working on this repo.

## What this project is
Factory management system built during a 5-hour hackathon (team of 5, Sep 27, 2026).
Planned architecture (from `requirements.txt` / scaffold):
- **Backend:** FastAPI (`backend/main.py`), domain modules in `backend/modules/` (`crm.py`, `operations.py`, `procurement.py`), RAG engine in `backend/rag_engine.py` (LangChain + ChromaDB + pypdf).
- **Frontend:** Streamlit (`frontend/app.py`).

## Current state (honest snapshot)
- Repo is a **scaffold**: all `.py` files are empty placeholders. Do not assume any behavior from them.
- Dependencies pinned only loosely in `requirements.txt`; `uv.lock` + `pyproject.toml` exist — **use `uv`** for env management (`uv sync`, `uv run`).
- Python **>= 3.14**.

## Conventions
- Backend code goes in `backend/modules/<domain>.py`; keep FastAPI routers co-located with their domain module and register them in `backend/main.py`.
- Frontend is a single Streamlit app for now; split into pages only if it exceeds ~300 lines.
- Every feature change: implement → test → commit separately (one commit per change, imperative message).
- Never commit secrets; `.env` is gitignored, `.env.example` documents required vars.

## Working agreements (hackathon)
- The Hermes agent in Discord acts as project manager: task tracking, status summaries, code review.
- Every task assignment / decision / status change must be posted in Discord or committed here — undocumented work does not exist.

## Maintainer note
Agents should update this file as the project evolves (stack decisions, run/test commands, module ownership per team member).
