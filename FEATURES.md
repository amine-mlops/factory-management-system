# NEXUS — Feature List

A modular, multi-tenant supply-chain copilot. It combines Text-to-SQL, role-scoped document search (RAG), autonomous auditing and two-hop root-cause reasoning, with strict role-based access across all of them. It runs fully offline; an LLM key is optional.

---

## 1. Assistant (chatbot)

| Feature | What it does |
|---|---|
| **Two-hop root-cause analysis** | For "Why did Batch #104 spoil?", **hop 1** (SQL) joins shipments, inventory and telemetry to find the first temperature spike (TRK-88, 8.2 °C at 14:15 UTC). **Hop 2** (document search) finds the documented cause (`workshop_log.pdf` p.1: drive-belt wear, deferred maintenance). It then returns a verdict. |
| **Text-to-SQL analytics** | "List delayed shipments", "Which lots expire in 14 days?", "Compare quotations for RFQ-2291" produce a validated, read-only SQL query and a summary of the rows. |
| **Document Q&A** | Answers from company PDFs with page-exact citations (`document · p.N`). |
| **Briefings** | "What needs my attention?" / "Brief my shift" summarises deliveries, open RFQs, at-risk lots, audit violations and security incidents. Only what the caller's role may see is included. |
| **Pipeline metadata answers** | "Why is the TMS refresh failing?", "Why did the expiry scan reject rows?" are answered from connector health, stale datasets and validation checks. They are **metadata only**; business rows are never shown. |
| **Policy compilation from chat** | "Flag any dairy batch in transit over 4 °C for more than 12h" becomes a saved audit rule. |
| **Expiry proposals** | "Which supplier returns are proposed?" lists Expiry Guard mitigations. Procurement only sees supplier returns. |
| **Canonical answer format** | `answer`, numbered `sources`, `freshness` (stale ETAs flagged), `decision`, `gaps` and `diagnostics` (intent, SQL, structured rows, retrieved snippets, verdict, filter trace). |
| **Diagnostics panel (UI)** | Shows the intent badge, a table of structured rows, snippet citations, a highlighted verdict and the SQL that ran. |
| **"How this answer was filtered"** | Shows chunk counts at each stage: candidates → tenant → role/module → classification. |
| **Two API contracts** | `POST /api/rag/query` (the UI) and `POST /api/chat` (the AGENTS.md shape: `response`, `diagnostics`, `citations`). Both use the same engine. |
| **Works without an API key** | A deterministic keyword router, SQL templates and sentence templates. |
| **Optional LLM mode** | Any OpenAI-compatible endpoint (NVIDIA NIM by default) handles intent, SQL and phrasing. On a timeout or error it automatically falls back to the deterministic path. |

## 2. Security & access control

| Feature | What it does |
|---|---|
| **JWT authentication** | HS256 tokens with expiry. Passwords use PBKDF2-SHA256 (200k rounds, per-user salt). |
| **Identity from the server only** | Tenant, user and roles come from the token plus the database. `org_id`, `role` or filters sent by the browser are ignored. |
| **Deny by default** | Every route declares the `(resource, action)` it needs. A missing grant returns 403 and writes a logged security event. |
| **12 roles** | Owner, Admin, Driver, Procurement, Data Architect, Inventory Planner, Transportation Manager, Warehouse Operator, Manufacturing Engineer, Distribution Lead, Customer Service, IT/Security. |
| **Grants** | Resource + action (`view`, `read_records`, `update_status`, `manage`, `configure`, `query_ai`) + scope (`tenant` or `assigned`). Effective grants are the role grants plus explicit grants, limited to the modules the company has enabled. |
| **Pre-retrieval gate** | The question is classified by topic *before* any search or SQL. A denied question returns 403 with `chunks_retrieved: 0` and an incident id, and nothing is sent to a model. |
| **Cross-tenant protection** | Questions about another company are always denied. Another tenant's records are never returned, and ids from another tenant return 404. |
| **Metadata-only override** | Data roles can ask how a module's *feed* behaves without reading its records. |
| **Security log** | Every denial (API, pre-retrieval or route guard) is recorded with user, roles, resource, query and reason, and is visible to owners and data roles. |
| **Audit trail** | Every mutation is logged: status updates, assignments, awards, decisions, rule changes, invites, role changes, module toggles, document changes, scans and compiled rules. |
| **CORS** | An explicit origin allow-list, no credentials. |

## 3. SQL engine (Text-to-SQL)

- **Schema discovery at runtime** via `PRAGMA table_info`, with 3 sample rows per table that are already filtered for the caller's role.
- **Per-role table allow-list**: owners get every gold table, drivers get shipments and telemetry, procurement gets suppliers and quotations, and data architects get metadata tables only.
- **SQL validator** (sqlglot):
  - Exactly one `SELECT` is allowed (CTEs are fine).
  - Allow-listed tables only.
  - Blocked: DDL/DML, `PRAGMA`, `ATTACH`, `COPY`, `INSTALL`, `LOAD`, `SET` and similar statements; `read_csv`, `read_parquet`, `glob`, `getenv`, `duckdb_*` and similar functions; table functions; other schemas.
  - `LIMIT 200` is added automatically.
- **Role-based query rewrite**: every table is replaced by a copy filtered to the caller's tenant. Drivers only ever see their own shipments and their own vehicles' telemetry.
- **5-second query timeout**, read-only execution, and bound parameters for user-derived values.

## 4. Document search (RAG)

- **PDF ingest**: text is extracted page by page with pypdf, split into chunks of about 120 words with 20 words of overlap, and each chunk keeps its page number.
- **Access metadata on every chunk**: visibility (Company / Module / Restricted), modules, roles and classification (`internal` / `financial`).
- **Filters run before scoring**: tenant, then role/module access, then classification. Only the chunks that survive are scored, so a filtered-out chunk can never reach a model.
- **Pure-Python TF-IDF** per tenant with light stemming. No ML dependencies.
- **Document lifecycle**: upload (PDF only, magic bytes checked, ≤ 20 MB, file name sanitised), then extracting → tagging → indexed in the background. Access changes re-tag the chunks; delete removes the file and its chunks.

## 5. Autonomous auditing (Compliance)

- **Plain-English policy compiled into a structured rule**, e.g. `category = Dairy AND warehouse_id = WH-TRANSIT AND current_temp > 4 AND storage_hours > 12`.
- **Rules registry** in the database, mirrored to `demo/rules.json` on every change. Seeded rules: `RULE-COLD-01`, `RULE-EXP-01`, `RULE-EXP-02`.
- **Rules can be compared** to a value, to another column (e.g. `max_safe_temp`) or to a policy threshold (e.g. `critical_days`).
- **Evaluator** builds parameterised SQL (values are never pasted into the query) and always adds the tenant filter. Affected records are marked `BREACHED`.
- **Operational audit run** (`POST /api/audit/run`) evaluates every active rule, stores the run and filters violations by the caller's role.
- **Scheduler**: a background task runs the audit (and any due expiry scans) for every tenant every `AUDIT_INTERVAL_SECONDS`.
- **Compliance tab (UI)**:
  - "Describe a policy" box.
  - Active-rules table with on/off switches.
  - **Run operational audit** button.
  - Violation cards with a table of the affected records.
- **Global anomaly banner**: a red CRITICAL bar under the top bar, linking to the Compliance tab.

## 6. Perishable Expiry Guard (Inventory)

- **Lot severity**: critical / warning / healthy from the days remaining, plus the value at risk (qty × unit value).
- **Mitigation proposals**:
  - Kinds: first-expired-first-out (FEFO) reallocation, dispatch, markdown, quarantine, donation, supplier return.
  - Each has a confidence score and policy citations.
  - Nothing external is executed: approval only logs "hand-off queued (simulated)".
- **Approve / dismiss / reopen** decisions. Supplier returns go to Procurement.
- **Versioned rules**: critical and warning windows, scan cadence, markdown cap, minimum confidence. Changes are validated, versioned, added to history and audit-logged.
- **Scans**:
  - Manual or scheduled, running the RULE-EXP rules and proposing actions for new at-risk lots.
  - They report `partial` when validation rejected rows.
  - They bump the feed version.
- **Feed health**: validation checks plus quarantined rejected rows (metadata only).
- **Different view per role**:

| Role | Sees |
|---|---|
| Inventory | Everything |
| Data Architect | Rules, runs and feed only |
| Procurement | Supplier returns only, with limited lot fields |

## 7. Business modules

| Module | Features |
|---|---|
| **Transportation** | Shipments list (drivers see only their assigned rows), status updates (drivers only on their own rows), driver assignment (managers), stale-ETA warnings when the TMS feed fails. |
| **Procurement** | Suppliers (OTIF, rating, contract), quotations per RFQ with PDF page citations, awarding a quote (other quotes for the same item go back to Received, and a PO draft is created). |
| **Inventory** | The Perishable Expiry Guard (section 6). |
| **Data & Pipelines** | Source connectors (health, freshness, last run and last good version), connect/disconnect, gold datasets with stale flags, security incidents. No business rows. |
| **Triage preview** | `POST /api/triage/infer` returns the simulated pump-cavitation preset. |
| **Coming soon** | Warehousing, Manufacturing, Distribution, Customer Service and IT are shown as previews. |

## 8. Workspace, team & onboarding

- **Login and companies**: password login, a session listing the companies you belong to, and switching company (a new token each time).
- **Create a company**: the setup wizard creates it, enables modules, uploads the PDFs you picked and generates invites.
- **Company profile and module toggles** (settings `manage`).
- **Invitation codes** (`ACME-DRV-XXXX`): preview the company, roles and pages before joining; codes expire and can be used once. A driver invite can take over a free driver's deliveries.
- **Member role editing**: the owner can't remove their own Owner role. There is also an **access-request** flow.
- **Workspace snapshot** (`GET /api/workspace`): the whole UI state as the caller's role sees it, refreshed every 15 s and after every change.

## 9. Frontend (React 19 + Vite + TypeScript + Tailwind)

- **Two modes**:
  - **Mock mode** (`VITE_USE_MOCK=true`): fully offline on local data.
  - **Live mode** (`VITE_USE_MOCK=false`): everything goes through `lib/live.ts` to FastAPI.
- **"View as" demo personas**: Owner, Driver, Procurement and Data Architect. Switching is a real sign-in as that seeded user, and a "Signed in as demo persona" banner shows with **Back to Owner**.
- **Route guard**: opening a page you don't have access to shows Access Denied and logs a server-checked incident.
- **Operations overview**:
  - A system map with module health: Transportation critical, Procurement warning, Inventory critical.
  - Alerts, the recommended next action, and an AI briefing.
- **Docked assistant** with role- and page-aware suggested prompts, including negative tests that show the 403.
- **Health check** in Settings → Integrations (`GET /api/health`).

## 10. Demo data (golden seed)

- **Company**: "Acme Process Industries" (`tnt_plant_a_demo`) with all 8 modules. A second tenant, "Borealis Foods", exists only for isolation tests.
- **7 users**:

| Login | Password | Role |
|---|---|---|
| operator@nexus-demo.io | `brev-a100` | Owner |
| jordan.lee@acme-demo.io | `demo1234` | Driver |
| rafa.diaz@acme-demo.io | `demo1234` | Driver |
| tess.vos@acme-demo.io | `demo1234` | Procurement |
| priya.shah@acme-demo.io | `demo1234` | Data Architect |
| mina.kim@acme-demo.io | `demo1234` | Customer Service |

  Sam Ortiz is also seeded as a member with no roles (no login in the table above).
- **Records**:
  - 8 shipments (including SH-905, TRK-88, Delayed), 4 suppliers, 4 quotations.
  - 15 lots (including B-104 Greek Yogurt at 8.2 °C).
  - TRK-88 telemetry with a compressor-fault spike at 14:15 UTC.
  - 6 data connectors (TMS failed, S3 schema mismatch) and 8 gold datasets.
  - 7 expiry actions and 3 seeded rules.
- **12 generated PDFs** with page-exact text: workshop log, carrier SOP, driver handbook, quotations, procurement policy, shelf-life/FEFO policy, confidential pricing, spares policy, cavitation SOP, pump manual, ISO vibration limits.
- The seed is **safe to re-run** (`python -m demo.seed --reset` rebuilds it).

## 11. Operations & delivery

- **Docker**: `docker compose up --build` gives you the API (python:3.12-slim, non-root, healthcheck, `/data` volume) plus the web app (nginx serving the frontend and forwarding `/api`) at http://localhost:8080.
- **Makefile**: `setup`, `seed`, `api`, `web`, `dev` (`PORT=` to override), `test`.
- **Configuration** via `.env` / pydantic-settings: API prefix, CORS, JWT, demo mode, paths, scheduler, LLM, RAG backend.
- **Request log**: one line per request with route, status, duration, user and tenant. Tokens and document text are never logged.
- **Tests**:
  - 53 pytest tests: RBAC, SQL guard, RAG filtering, golden agent answers, auditing, API smoke test over every route.
  - The frontend `npm run check`: typecheck, lint with 0 findings, 31 tests, build.
- **Docs**: `README.md` (setup, personas, golden-path script, architecture), `MASTER_SPEC.md`, `DECISIONS.md` (36 logged decisions), `AGENTS.md`.

## 12. Known limits

- **LLM mode is untested**: no key was available. The offline deterministic mode is the verified path.
- **`RAG_BACKEND=chroma`** is accepted but falls back to TF-IDF.
- **The deterministic chatbot** only understands phrasings that match its keywords and SQL templates.
- **Triage** serves only the pump-cavitation preset. Warehousing, Manufacturing, Distribution, CRM and IT are previews.
