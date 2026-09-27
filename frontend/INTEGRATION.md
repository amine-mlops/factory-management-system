# Integrating this UI into the Factory Management repository

This repository is a **standalone, export-ready React/Vite frontend**. Its contents are meant to be copied into the original repository's `frontend/` directory. It contains no backend code and does not depend on any backend file. Every feature keeps working on local mock data (`VITE_USE_MOCK=true`), so copying it in cannot break the Python backend.

> **About Streamlit.** The team plan mentions a Streamlit `frontend/app.py`. The approved frontend is this React/Vite app, **not** Streamlit. When you merge, the React build **replaces** `app.py` as the user-facing UI. You can keep `app.py` next to it (for example as `frontend/legacy_app.py`) for internal tooling; the two do not conflict.

## 1. Target layout after copy

```
<original-repo>/
├── backend/
│   ├── modules/crm.py
│   ├── modules/operations.py
│   ├── modules/procurement.py
│   ├── main.py            # FastAPI app (unchanged by this UI)
│   └── rag_engine.py      # RAG service (unchanged by this UI)
├── frontend/              # ← React/Vite app root (this repo's contents)
│   ├── legacy_app.py      # optional: preserved Streamlit app.py
│   ├── package.json  package-lock.json  vite.config.ts  index.html
│   ├── tsconfig*.json  .oxlintrc.json  .env.example
│   ├── public/  (favicon.svg, mock_data.json)
│   ├── scripts/generate-mock.ts
│   ├── src/
│   ├── README.md  INTEGRATION.md
├── .env.example
├── .gitignore
└── requirements.txt
```

## 2. Safe migration checklist

1. In the original repo, create a branch: `git checkout -b feat/react-frontend`.
2. **Preserve the legacy UI:** `git mv frontend/app.py frontend/legacy_app.py` (or move it to `tools/`).
3. Copy this repo's files into `frontend/`. **Do not** copy `node_modules/`, `dist/`, `.env*` (except `.env.example`) or `.git/`.
4. Append to the root `.gitignore`: `frontend/node_modules/`, `frontend/dist/`, `frontend/.env.local`.
5. `cd frontend && npm ci`
6. Create `frontend/.env.local` with `VITE_API_URL=http://localhost:8000` (your FastAPI origin). Leave `VITE_USE_MOCK=true` until the endpoints below exist.
7. Run `npm run check` (typecheck, lint, tests, build), then `npm run dev`.
8. Start FastAPI (`uvicorn backend.main:app --reload --port 8000`), set `VITE_USE_MOCK=false`, and click **Check FastAPI connection** in the Triage rail (it calls `GET /health`).
9. Commit from the original repo.

## 3. Commands

```bash
# development
cd frontend
npm ci
npm run dev                    # http://localhost:5173

# production
npm run build                  # → frontend/dist (static files)
npm run preview                # local check of the build
```

Serve `frontend/dist` from any static host, or from FastAPI:
`app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="ui")`. Mount it **after** the API routers so it doesn't shadow them.

## 4. Environment

| Variable | Example | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | FastAPI origin, with no trailing slash |
| `VITE_USE_MOCK` | `true` | Demo kill switch. `true` = local mock only |

`VITE_*` values are compiled into the public bundle. **Never put secrets in them.**

## 5. FastAPI contract

### Client behavior

`src/lib/api.ts` is the single HTTP client:

- JSON headers and an `AbortController` timeout (8 s by default; 3 s for `/health`).
- A normalized `ApiError` (`timeout | network | http | parse | contract`) that reads FastAPI's `{"detail": ...}`.
- `Authorization: Bearer <token>` is attached only after `setAuthTokenProvider()` is wired to real auth.
- On any failure the UI falls back to mock data and shows a clear notice.

Route names live in one table, `ENDPOINTS`, so renaming a route means changing a single line. Request and response types are in `src/lib/apiContract.ts`.

### Route mapping

| `ENDPOINTS` key | Recommended route | Method | Request → Response | Authorization (server-side) |
|---|---|---|---|---|
| `health` | `/health` | GET | → `{status, version?, gpu?}` | public |
| `auth` | `/auth/login`, `/auth/session`, `/auth/company` | POST / GET / POST | `LoginRequest` → `LoginResponse`; → `SessionResponse`; `SelectCompanyRequest` | verified credentials; the session lists only the caller's memberships |
| `workspaces` | `/workspaces` | POST, GET | `CreateCompanyRequest` → `CompanyDto` | any authenticated user can create; the creator becomes Owner |
| `invites` | `/invites`, `/invites/{code}/accept` | POST | `CreateInviteRequest` → `InviteDto`; `JoinCompanyRequest` → `MembershipDto` | create: Owner of the current company; accept: code valid, unexpired, unused |
| `members` | `/members`, `/members/{id}/roles` | GET, PUT | → `MemberDto[]`; `UpdateMemberRolesRequest` | Owner/Admin; always scoped to the caller's company |
| `roleGrants` | `/roles/grants` | GET | → `GrantDto[]` (the caller's effective grants) | computed server-side; the UI only displays it |
| `modules` | `/modules` | GET, PUT | → `ModuleDto[]` | read: members; write: Owner |
| `documentsUpload` | `/documents/upload` | POST (multipart) | file + ACL → `DocumentDto` | Owner/Admin (or `configure` on the Knowledge Base) |
| `documentsStatus` | `/documents/status` | GET | → `DocumentDto[]` (uploaded → extracting → tagging → indexed) | filtered by the caller's ACL |
| `ragQuery` | `/rag/query` | POST | `RagQueryRequest` → **`RagAnswer`** | see *RAG requirements* below |
| `sources` / `pipelines` | `/sources`, `/pipelines` | GET | → `SourceDto[]` | `configure` on data; **no** business rows |
| `shipments` | `/shipments`, `/shipments/{id}/status` | GET, PATCH | → `ShipmentDto[]`; `UpdateShipmentStatusRequest` | Driver: **assigned rows only** plus `update_status`; managers: tenant scope |
| `inventory` | `/inventory` | GET | → stock positions | `read_records` on inventory (coming soon) |
| — (procurement) | `/procurement/suppliers`, `/procurement/quotations` | GET | → `SupplierDto[]`, `QuotationDto[]` | Procurement role |
| `triageInfer` | `/triage/infer` (alias `/infer`) | POST | `InferenceRequest` → contract in `public/mock_data.json` | Manufacturing `manage`; PLC writes simulated until certified |
| `securityEvents` | `/audit/security-events` | GET | → `SecurityEventDto[]` | Owner / Data Architect / IT-Security |

**Canonical AI answer.** `answer` and `sources` are required; the other fields are optional:

```json
{
  "answer": "Recommendation: award Q-7781 to Hydraflow … [1][2]",
  "sources": [{ "document": "Hydraflow_Quotation_Q-7781.pdf", "page": 1 }],
  "freshness": [{ "source": "gold.shipments_eta@v142", "as_of": "11:04", "stale": true }],
  "decision": { "status": "allowed", "stage": "retrieval" }
}
```

A denied query returns **HTTP 403** with
`{"detail": {"decision": "denied", "stage": "pre-retrieval", "reason": "...", "chunks_retrieved": 0}}`
and the backend writes a server-side security event.

### CORS

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://<your-frontend-host>"],  # explicit list
    allow_credentials=False,          # bearer tokens in headers do not need cookies
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

Set `allow_credentials=True` **only** if you switch to cookie sessions. **Never** combine credentials with a wildcard origin (`"*"`).

## 6. Security boundaries (must be enforced by FastAPI)

The frontend's permission checks, navigation filtering, **View as** persona preview, and simulated pre-retrieval gate are **UX only**.

- **Default deny.** Every endpoint and every retrieval or query must be authorized explicitly.
- **Identity comes from the server.** A FastAPI dependency derives `user_id`, `company_id` (tenant), roles, grants and data scope from the verified token and the server database. **Never trust** a `tenant_id`, role, module grant, scope or filter sent by the client in a body, query string or header.
- **Tenant isolation on every query.** SQL uses `WHERE company_id = :current_company`. The vector store is partitioned or filtered by tenant.
- **Grants have three parts: module + action + data scope.** A Driver reads only shipments where `driver_id = current_user` and may `update_status`. A Transportation Manager manages all shipments. `configure` on a connection is separate from `read_records` on the business data behind it.
- **RAG requirements (`/rag/query`):**
  1. Authorize the requested module (`query_ai` + `read_records`) **before** retrieval. If denied, return 403, retrieve 0 chunks, send nothing to the model, and log a security event.
  2. Store ACL metadata on every chunk: `tenant_id, document_id, source, allowed_modules, allowed_roles, data_scope, created_at/updated_at, index_version`.
  3. Apply the tenant, ACL and scope filters **inside** the vector or SQL query, before ranking and before context is built.
  4. Return citations (`sources[].document/page` or a structured record id) and freshness. If data is missing or not permitted, say so explicitly instead of generating an answer. Mark stale sources as stale; never present them as current.
  5. **Cached answers and generated summaries** must be keyed by tenant, user and a hash of their grants, and invalidated when grants, documents or source versions change.
- **NVIDIA NeMo Guardrails** (architecture target) adds topical and tool-use safety. It **complements** the ACL filtering and never replaces tenant or RBAC enforcement.
- **PLC/SCADA writes** stay simulated until a certified interlock path exists; the UI labels them *simulated*.

## 7. Mapping backend modules to navigation

| Backend | Frontend |
|---|---|
| `backend/modules/crm.py` | **Customer Service / CRM** (*Coming soon* state; UI preview available) |
| `backend/modules/operations.py` | **Transportation** (integrated) and **Manufacturing / Autonomous Triage** (preview) |
| `backend/modules/procurement.py` | **Procurement** (integrated) |
| `backend/main.py` | FastAPI app: auth, workspaces, invites, members, `/health`, routers (backend service) |
| `backend/rag_engine.py` | Serves `/rag/query` and document ingestion; the UI never calls it directly (backend service) |

## 8. Rollback

If anything misbehaves during the demo, set `VITE_USE_MOCK=true` in `frontend/.env.local` and restart `npm run dev` (or rebuild). The app returns to fully local mock data with no backend dependency. At runtime, the Triage rail's `USE_MOCK` switch does the same for inference.

## 9. Perishable Expiry Guard — endpoints for the backend team (not implemented here)

The Inventory workspace currently runs on the local mock store (`src/data/expiry.ts`). Typed contracts are in `src/lib/apiContract.ts`, and route names are in `ENDPOINTS` (`src/lib/api.ts`):

| Method | Path | Notes |
|---|---|---|
| GET | `/inventory/expiry/lots` | Lots with `days_remaining`, `severity`, `value_at_risk`, `source_version`, `as_of`. Requires `inventory:read_records`. |
| GET | `/inventory/expiry/actions` | Agent proposals. Supplier returns (`route: "procurement"`) are also readable with `procurement:read_records`, without other lot data. |
| POST | `/inventory/expiry/actions/{id}/decision` | `{ decision }`. Requires `inventory:manage`; supplier returns also accept `procurement:manage`. External actions must never execute without this human decision. |
| GET/PUT | `/inventory/expiry/rules` | Thresholds and cadence; version every change and audit it. |
| GET | `/inventory/expiry/runs` | Scan history plus validation failures. Metadata only — readable with `inventory:configure` / `data:configure`. |

RAG rules for expiry questions:
- Lot and action records are tagged `modules=[inventory]`; supplier-return actions are tagged `[inventory, procurement]`.
- The shelf-life policy is company-wide.
- Drivers, procurement and data architects must receive **403 before retrieval** for lot-level questions. Data roles may ask about the feed as metadata only.

No backend code, schema or infrastructure is part of this repository.
