# NEXUS — Supply Chain Copilot

A modular, multi-tenant copilot for industrial supply chains. It combines:

- **Text-to-SQL** over a DuckDB gold layer.
- **Role-scoped RAG** over company PDFs.
- **Intent-driven autonomous auditing**: a plain-English policy becomes a rule and then a scheduled evaluation. This includes the Perishable Expiry Guard.
- **Two-hop root-cause reasoning**: SQL finds the anomaly, RAG finds the documented cause.
- **Strict RBAC** across structured and unstructured data.

The single source of truth is [`MASTER_SPEC.md`](MASTER_SPEC.md). Choices it leaves open are logged in [`DECISIONS.md`](DECISIONS.md), and the team operating spec is [`AGENTS.md`](AGENTS.md).

## Setup (fresh machine)

Requires Python 3.11+ and Node 20+. It works fully offline: with no LLM key, every feature runs on deterministic fallbacks.

```bash
make setup   # .venv + pip install -r requirements.txt + npm ci; creates .env and frontend/.env.local (live mode)
make seed    # python -m demo.seed --reset → demo/supply_chain.duckdb, demo/docs/*.pdf, demo/rules.json
make dev     # FastAPI on :8000 + Vite on :5173 (proxy /api → :8000)
```

Open <http://localhost:5173> and click **Enter demo workspace**.

| Target | What it does |
|---|---|
| `make api` | `uvicorn backend.main:app --reload --port 8000` |
| `make web` | Vite dev server (`frontend/`) |
| `make test` | `pytest -q`, then `cd frontend && npm run check` (typecheck, lint, tests, build) |

- **Port 8000 taken?** Run `make dev PORT=8011`. The Vite proxy follows `NEXUS_API_PROXY`.
- **Offline UI only?** Set `VITE_USE_MOCK=true` in `frontend/.env.local`. Every screen then runs on local mock data with no backend.
- **Optional LLM** (any OpenAI-compatible endpoint, NVIDIA NIM by default): set `LLM_API_KEY` in `.env`. Timeouts and errors fall back to the deterministic path.

## Docker

```bash
docker compose up --build        # → http://localhost:8080  (click "Enter demo workspace")
```

- **`api`** (root `Dockerfile`, python:3.12-slim, non-root): seeds the demo company into the `nexus-data` volume on first start. That volume holds `/data`: the DuckDB file, the PDFs, `rules.json` and uploads.
- **`web`** (`frontend/Dockerfile`): the SPA built in live mode and served by nginx, which proxies `/api` to `api`. The API is also published on `127.0.0.1:8000` for curl.
- **Configuration:** set `JWT_SECRET`, `LLM_API_KEY`, `DEMO_MODE`, `WEB_PORT` or `API_PORT` in the shell or in `.env`, e.g. `WEB_PORT=9090 API_PORT=8012 docker compose up -d`.
- **Reset the demo data:** `docker compose down -v`.

## Demo personas

Every demo password is `demo1234`, except the owner's.

| Persona | User id | Email | Password | Roles |
|---|---|---|---|---|
| Owner | `usr_owner` | operator@nexus-demo.io | `brev-a100` | owner |
| Driver | `usr_jlee` | jordan.lee@acme-demo.io | `demo1234` | truck_driver |
| Driver (DRV-02) | `usr_rdiaz` | rafa.diaz@acme-demo.io | `demo1234` | truck_driver |
| Procurement | `usr_tvos` | tess.vos@acme-demo.io | `demo1234` | procurement_manager |
| Data Architect | `usr_pshah` | priya.shah@acme-demo.io | `demo1234` | data_architect |
| Customer Service | `usr_mkim` | mina.kim@acme-demo.io | `demo1234` | customer_service |

With `DEMO_MODE=true`, the owner's **View as** menu signs in as the Owner, Driver, Procurement or Data Architect persona through `POST /api/auth/demo-login`. FastAPI authorizes each request for that real user.

## Golden-path script (≈ 3 minutes)

1. **Overview.** The system map renders from `GET /api/workspace`: Transportation is critical (the TMS refresh failed, so ETAs are stale), Procurement is a warning, and Inventory is critical.
2. **Owner chat.** Ask *"Why did Batch #104 spoil during transit from Casablanca to Tangier?"*
   - The answer cites `shipments_table` and `workshop_log.pdf` p.1.
   - **Diagnostics** shows 8.2 °C at 14:15 UTC on TRK-88.
   - Verdict: *mechanical equipment failure resulting from deferred maintenance on the TRK-88 refrigeration unit.*
3. **Compliance tab** (`#/dashboard/compliance`).
   - Compile *"Flag any dairy batch in transit over 4°C for more than 12h"*. It becomes `RULE-USR-001` and is written to `demo/rules.json`.
   - Click **Run operational audit**. The red CRITICAL banner appears (B-104 `BREACHED`).
4. **View as → Driver.** Jordan Lee sees only his 3 shipments.
   - The red chip *"Which lots expire…"*, or typing *"supplier prices"*, returns a **403 pre-retrieval** block with 0 chunks and an incident id.
   - Opening `#/procurement` shows Access Denied.
5. **Back to Owner → Overview → Security.** The new incidents appear, via a 15 s poll.
6. **Procurement persona.** Award Q-7781: the status flips and a PO draft is created.
7. **Data Architect.** Data & Pipelines shows sources, the stale-dataset flag and the TMS failure. No business rows are shown.
   - Ask *"Why did the expiry scan reject rows?"* to get a metadata-only answer.

The same checks run headless in `tests/` (`pytest -q`: 53 tests).

## Architecture

```
React 19 + Vite SPA (frontend/)            VITE_USE_MOCK=false → lib/live.ts, snapshot per mutation
  persona switcher · assistant dock · Diagnostics · Compliance tab · anomaly banner
        │  Authorization: Bearer <JWT>          (Vite proxy /api → :8000)
        ▼
FastAPI (backend/main.py) — routers under /api, CORS allow-list, request log (route · status · user · tenant)
  auth.py (JWT HS256, PBKDF2)  →  permissions.py (ROLES ∪ grants ∩ modules · require() · pre-retrieval gate)
        │                                         └─ deny → 403 + security_log.record_incident()
        ▼
agent.py  gate → intent → tools → two-hop synthesis → canonical answer {answer, sources, freshness, decision, diagnostics}
  ├─ sql_engine.py   PRAGMA recon · templates / LLM · sqlglot validator · RBAC rewrite (tenant + driver scope) · 5 s timeout
  ├─ rag_engine.py   pypdf ingest · ACL-tagged chunks · filters (tenant → ACL → classification) BEFORE TF-IDF scoring
  ├─ audit_engine.py rules registry (DB ⇄ demo/rules.json) · compiler · parameterised evaluator · asyncio scheduler
  ├─ expiry.py       Perishable Expiry Guard: lot severity, proposals, rules versioning, scans
  └─ llm.py          OpenAI-compatible client (NVIDIA NIM) → LLMUnavailable → deterministic fallback
        ▼
DuckDB  demo/supply_chain.duckdb — app tables + gold (inventory, shipments, telemetry, suppliers, quotations) + audit/expiry
```

## Repository layout

```
backend/     FastAPI app: config, db, auth, permissions, security_log, llm, sql_engine, rag_engine, agent,
             audit_engine, expiry, snapshot, routers/ (health, auth, workspace, members, documents, assistant,
             transportation, procurement, inventory, audit, data, triage)
demo/        seed.py (idempotent; --reset), rules.json, docs/*.pdf (generated), uploads/ (runtime, gitignored)
tests/       conftest (temp DB + tokens per persona), test_rbac, test_sql_guard, test_rag_filter,
             test_agent_golden, test_audit, test_api_smoke
frontend/    React 19 + Vite + TypeScript + Tailwind UI — see frontend/README.md
```

## Security checklist

- JWT HS256 with `exp`. The secret comes from `.env`. Expired or invalid tokens get 401.
- Tenant, user and roles come only from the token and the database. `org_id`, `role` and filters in bodies are ignored.
- Every route declares its `(resource, action)`. A missing grant returns 403 and writes a security event.
- RAG drops chunks by tenant, then ACL, then classification *before* scoring. SQL allows one allow-listed `SELECT` only, rewritten per tenant and per driver.
- Uploads accept PDFs only (magic bytes checked), ≤ 20 MB, stored under `UPLOADS_DIR/<tenant>/<uuid>.pdf`.
- CORS uses the explicit origins from `CORS_ORIGINS`, with no credentials. `demo-login` returns 404 when `DEMO_MODE=false`.
