# MASTER SPEC — NEXUS Supply Chain Copilot (backend + integration)

> **How to use this file:** paste it whole into your coding agent, attach the frontend repo, and say "Execute MASTER_SPEC.md end to end."
> It is the single source of truth. If it conflicts with anything else, this file wins. The frontend's TypeScript types are the source of truth for JSON shapes (§6).

---

## 0. Instructions to the coding agent

You are a senior full-stack engineer. In **one pass**, build the complete FastAPI backend described here, seed it, test it, and plug the existing React frontend into it.

Work in the phase order of §14. After each phase, run that phase's acceptance checks (§13) and fix failures before moving on. Do not stop to ask questions: when something is ambiguous, choose the simplest option that keeps every contract in this file, and write the decision in `DECISIONS.md`.

Hard rules:
1. **Never trust the browser.** Tenant, user and roles come only from the verified JWT plus the database. Ignore any `org_id`, `role`, `company_id` or filter sent in a body, header or query string.
2. **Deny by default.** Every route declares the `(resource, action)` it needs. A missing grant → HTTP 403 plus a security event.
3. **RAG filters run before ranking.** Drop chunks by tenant → role/module ACL → classification *before* any similarity scoring. Never pass a filtered-out chunk to the LLM.
4. **SQL is read-only and scoped.** Only single `SELECT` statements on allow-listed tables. Driver queries are rewritten so `shipments` only contains the driver's rows.
5. **Works offline.** With no LLM key, every feature still works through deterministic fallbacks (§8.4). The demo must never depend on network access.
6. **No secrets in git.** Put config in `.env` (gitignored) and ship `.env.example`.
7. **Do not break mock mode.** The frontend must still run fully offline with `VITE_USE_MOCK=true`.

---

## 1. Product in one paragraph

NEXUS is a modular, multi-tenant copilot for industrial supply chains. It combines:
- **Text-to-SQL** analytics over a DuckDB gold layer.
- **Role-scoped RAG** over company PDFs (SOPs, maintenance logs, contracts, quotes).
- **Intent-driven autonomous auditing**: plain-English policy → structured rule → scheduled evaluation → anomaly banners and proposed actions (includes the *Perishable Expiry Guard*).
- **Two-hop root-cause reasoning**: SQL finds the anomaly, RAG finds the documented cause, then the two are synthesised into one verdict.
- **Strict RBAC** across both structured and unstructured data.

Personas: Owner (executive), Driver, Procurement, Data Architect.

---

## 2. Target repository structure (monorepo)

```
nexus/
├── AGENTS.md                  # team operating spec (updated version in spec/AGENTS.md)
├── MASTER_SPEC.md             # this file
├── DECISIONS.md               # agent-written log of any choice not covered here
├── .env.example
├── requirements.txt
├── Makefile                   # make setup | seed | api | web | dev | test
├── backend/
│   ├── __init__.py
│   ├── main.py                # app factory, CORS, routers under /api, lifespan (init db → seed if empty → ingest docs → start scheduler)
│   ├── config.py              # pydantic-settings, reads .env
│   ├── db.py                  # DuckDB connection + threading.Lock, schema DDL, helpers
│   ├── schemas.py             # Pydantic v2 models, camelCase aliases (§6)
│   ├── auth.py                # JWT, password hashing, current_user dependency, demo-login
│   ├── permissions.py         # ROLES table, effective grants, require(), data-scope helpers, pre-retrieval gate
│   ├── security_log.py        # record_incident(), audit_event()
│   ├── llm.py                 # OpenAI-compatible client (NVIDIA NIM default) + deterministic fallback switch
│   ├── sql_engine.py          # PRAGMA recon, Text-to-SQL, validator, RBAC rewrite, executor
│   ├── rag_engine.py          # PDF ingest, chunking, ACL metadata, TF-IDF index, filtered retrieval
│   ├── agent.py               # orchestrator: gate → intent → tools → 2-hop synthesis → canonical answer
│   ├── audit_engine.py        # rules registry (demo/rules.json + DB), compiler, evaluator, scheduler
│   ├── expiry.py              # Perishable Expiry Guard: lot scoring, actions, rules, scans
│   ├── snapshot.py            # GET /api/workspace — RBAC-projected Workspace for the UI
│   └── routers/
│       ├── health.py  auth.py  workspace.py  members.py  documents.py  assistant.py
│       ├── transportation.py  procurement.py  inventory.py  audit.py  data.py  triage.py
├── demo/
│   ├── seed.py                # builds demo/supply_chain.duckdb, demo/docs/*.pdf, demo/rules.json (idempotent; --reset)
│   ├── rules.json             # seeded + compiled audit rules
│   ├── docs/                  # generated demo PDFs (§5.4)
│   └── uploads/               # runtime uploads (gitignored)
├── tests/
│   ├── conftest.py            # temp DB, seeded, TestClient, tokens per persona
│   ├── test_rbac.py  test_sql_guard.py  test_rag_filter.py  test_agent_golden.py  test_audit.py  test_api_smoke.py
└── frontend/                  # the existing React 19 + Vite + TypeScript + Tailwind app (this UI repo, copied in)
```

---

## 3. Stack and dependencies

- **Python:** 3.11+.
- **`requirements.txt`:**
  ```
  fastapi>=0.115
  uvicorn[standard]>=0.30
  pydantic>=2.7
  pydantic-settings>=2.3
  duckdb>=1.0
  pypdf>=4.2
  fpdf2>=2.7
  python-multipart>=0.0.9
  PyJWT>=2.8
  httpx>=0.27
  sqlglot>=25.0
  pytest>=8.0
  ```
- **No heavy ML dependencies.** Retrieval is a pure-Python TF-IDF (§8.3). Chroma is optional behind `RAG_BACKEND=chroma`.
- **Passwords:** `hashlib.pbkdf2_hmac('sha256', …, 200_000)` with a per-user salt (stdlib, no bcrypt).
- **Frontend:** unchanged stack (Node 20+, `npm ci`, Vite dev server on :5173).

### `.env.example`
```
API_PREFIX=/api
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
JWT_SECRET=change-me-in-.env            # startup fails if missing and DEMO_MODE=false
JWT_TTL_MINUTES=480
DEMO_MODE=true                           # enables /api/auth/demo-login + seed-on-empty
DB_PATH=demo/supply_chain.duckdb
DOCS_DIR=demo/docs
UPLOADS_DIR=demo/uploads
RULES_PATH=demo/rules.json
AUDIT_SCHEDULER=on
AUDIT_INTERVAL_SECONDS=300
LLM_BASE_URL=https://integrate.api.nvidia.com/v1   # any OpenAI-compatible endpoint (NVIDIA NIM)
LLM_API_KEY=                                        # empty → deterministic mode
LLM_MODEL=meta/llama-3.1-70b-instruct
LLM_TIMEOUT_SECONDS=12
RAG_BACKEND=tfidf                                   # tfidf | chroma
```
Frontend `.env.local`: `VITE_USE_MOCK=false` and `VITE_API_URL=/api`, with the Vite proxy from §11.1.

### Makefile targets
- `setup`: create a venv, `pip install -r requirements.txt`, run `cd frontend && npm ci`.
- `seed`: `python -m demo.seed --reset`.
- `api`: `uvicorn backend.main:app --reload --port 8000`.
- `web`: `cd frontend && npm run dev`.
- `dev`: run `api` and `web` together.
- `test`: `pytest -q`, then `cd frontend && npm run check`.

---

## 4. Roles and RBAC (mirror of `frontend/src/lib/access.ts`)

Role ids are **exactly** the frontend `RoleId` strings, so no mapping layer is needed. For AGENTS.md compatibility, accept these aliases on input only: `executive`→`owner`, `driver`→`truck_driver`, `procurement`→`procurement_manager`.

Actions: `view`, `read_records`, `update_status`, `manage`, `configure`, `query_ai`.
Scopes: `tenant` (all rows in the company) or `assigned` (only rows where `driver_id = user_id`).

Resources: `dashboard`, `triage`, `manufacturing`, `inventory`, `procurement`, `warehousing`, `distribution`, `transportation`, `crm`, `it`, `knowledge`, `data`, `team`, `settings`.

| Role | Grants (resource: actions · scope) |
|---|---|
| `owner`, `admin` | every resource: every action · tenant |
| `truck_driver` | transportation: view, read_records, update_status, query_ai · **assigned** |
| `procurement_manager` | procurement: view, read_records, manage, query_ai · knowledge: view |
| `data_architect` | data: view, configure, query_ai · knowledge: view, configure · inventory: view, configure (**no read_records anywhere**) |
| `transportation_manager` | dashboard: view · transportation: view, read_records, update_status, manage, query_ai · knowledge: view |
| `inventory_planner` | dashboard: view · inventory: view, read_records, manage, query_ai · warehousing: view, read_records · knowledge: view |

Port the remaining preview roles from `access.ts` verbatim.

**Effective grants** = the union of the member's role grants plus explicit per-member grants (`view` and `read_records` at tenant scope), intersected with the company's `enabled_modules` (non-module resources are always available; `triage` also needs `manufacturing` enabled). Actions are unioned; the scope widens to `tenant` if any contributing grant is tenant-wide.

**`permissions.require(resource, action)`** is a FastAPI dependency. It returns a `Principal`:
```
{user_id, user_name, email, tenant_id, roles, grants: {resource: {actions:set, scope}}}
```
On failure it calls `security_log.record_incident(stage='api', …)` and raises `HTTPException(403, detail={"decision":"denied","stage":"api","reason":…})`.

**Pre-retrieval gate** (`permissions.authorize_query(query, principal, context)`) is a direct port of `frontend/src/lib/guard.ts`:
- **Rules**, checked in order; the first match is the primary target, and *every* matched resource must be authorised:
  1. `cross_tenant`: `\bborealis\b|other (company|tenant)` → always deny.
  2. `crm`: `\b(crm|customers?|margins?|accounts?|cases?|churn)\b`.
  3. `procurement`: `\b(procure\w*|purchase|po|suppliers?|pricing|prices?|contracts?|quot\w*|rfq\w*|award\w*|sla|slas|vendor\w*)\b`.
  4. `inventory`: `\b(inventory|stock|spares?|reorder|lots?|batch(es)?|shelf[- ]?life|fefo|perishabl\w*|markdowns?|dairy|yogurt|milk|salmon|expir(?:y|es|ed|ing|e)(?![- ](?:scans?|feeds?|checks?|rules?|pipelines?|agent)))\b` (`batch`, `dairy`, `yogurt`, `milk` and `salmon` are added for the golden dataset).
  5. `manufacturing`: `\b(manufactur\w*|oee|pumps?|turbines?|compressors?|triage|cavitation)\b`.
  6. `settings`: `\b(salary|salaries|payroll|admin\w*)\b`.
  7. `data`: `\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|tms|wms|erp|s3|datasets?|incidents?|denied|security|scans?|feeds?|validation|rejected)\b`.
  8. `transportation`: `\b(routes?|delivery|deliveries|shipments?|loads?|stops?|etas?|handling|brief\w*|shift|driver|dispatch|trucks?|trk-\d+|transit|spoil\w*)\b`.
- **No match** → use the page `context` resource.
- **Required actions:**
  - `data`: `view` + `query_ai`.
  - `settings`: `manage`.
  - `dashboard`, `knowledge`, `team`, `triage`: `view`.
  - Every business module: `query_ai` + `read_records`.
- **Metadata-only override:** if the decision is a deny on a business module, and the query also matches the TECHNICAL regex `\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|feeds?|scans?|validation|freshness|datasets?|rejected)\b`, and the caller has `data` `view` + `query_ai` → allow as `resource='data'`, labelled "metadata only".
- **Deny message:** "`<roles>` lacks `<actions>` on `<Resource>`", or "`<Resource>` is not enabled for this company".

**Golden security checks:**
- A driver asking about supplier pricing, contract margins or vendor SLAs gets **403 pre-retrieval** with `chunks_retrieved: 0`, plus a logged event.
- A driver's SQL is rewritten with `WHERE driver_id = <user>`.

---

## 5. Data model and golden seed (`demo/seed.py`)

One DuckDB file, `DB_PATH`. Every business table has `tenant_id`. Timestamps are ISO-8601 UTC strings.

### 5.1 Application tables
```sql
companies(id PK, name, industry, size, locations JSON, context, enabled_modules JSON, created_at, origin)
users(id PK, email UNIQUE, name, password_hash, salt, created_at)
memberships(tenant_id, user_id, roles JSON, grants JSON, status, PRIMARY KEY(tenant_id,user_id))
invites(code PK, tenant_id, roles JSON, created_by, created_at, expires_at, seat_user_id, used_by)
documents(id PK, tenant_id, name, size_kb, category, visibility, module, status, progress, chunks, path, index_version, updated_at, error)
chunks(id PK, tenant_id, document_id, page, text, visibility, modules JSON, roles JSON, classification, updated_at)
audit_events(id PK, tenant_id, time, tone, actor, action, detail, resource)
security_events(id PK, tenant_id, at, user_id, user_name, roles JSON, requested_resource, query, decision, stage, reason, chunks_retrieved, sent_to_model)
access_requests(id PK, tenant_id, user_id, resource, created_at, status)
sources(id, tenant_id, kind, name, detail, connected, freshness, sla, quality, errors, health, warning, rows_per_day, last_run JSON, last_success JSON, PRIMARY KEY(tenant_id,id))
gold_datasets(id, tenant_id, name, sources JSON, modules JSON, task, freshness, quality, tone, version, as_of, stale, PRIMARY KEY(tenant_id,id))
```

### 5.2 Gold (analytical) tables — the Text-to-SQL surface
```sql
inventory(tenant_id, batch_id PK, sku, product_name, category, warehouse_id, qty, unit, unit_value, expiry_date DATE,
          storage_days, current_temp DOUBLE, max_safe_temp DOUBLE, storage_class, supplier_id, valuation_estimated BOOLEAN)
shipments(tenant_id, shipment_id PK, batch_id, customer, origin, destination, address, delivery_window, eta, eta_as_of, eta_stale BOOLEAN,
          vehicle_id, driver_id, driver_name, pallets, weight_kg, handling, status, stop_order)
telemetry(tenant_id, vehicle_id, batch_id, ts, temp_c DOUBLE, event)
suppliers(tenant_id, supplier_id PK, name, category, otif, rating, contract)
quotations(tenant_id, quote_id PK, rfq, supplier_id, item, qty, unit_price, currency, lead_time_days, valid_until, terms, status, document, page)
```

### 5.3 Audit and expiry tables
```sql
audit_rules(id PK, tenant_id, label, severity, active, source, text, table_name, conditions JSON, created_by, created_at, version)
audit_runs(id PK, tenant_id, at, trigger, status, rules_evaluated, violations JSON, lots_scanned, rows_rejected, at_risk, rule_version, source_version, duration_ms)
expiry_rules(tenant_id PK, version, critical_days, warning_days, scan_minutes, markdown_max_pct, min_confidence, updated_at, updated_by, history JSON)
expiry_actions(id PK, tenant_id, kind, lot_id, title, rationale, value_protected, confidence, external, route, status, decided_by, decided_at, policy JSON)
feed_checks(tenant_id, id, name, status, detail, PRIMARY KEY(tenant_id,id))
feed_rejected(tenant_id, row_ref, field, value, error)
```

### 5.4 Seed content (one demo company, all data)

**Company.**
- Tenant `tnt_plant_a_demo`, "Acme Process Industries", all 8 modules enabled.
- Also accept `org_morocco_logistics` as an alias in AGENTS.md request bodies. It is ignored for authorisation.

**Users.** Every demo password is `demo1234` except the owner's, which matches the frontend demo login.

| user id | email | password | roles |
|---|---|---|---|
| `usr_owner` | operator@nexus-demo.io | `brev-a100` | owner |
| `usr_jlee` | jordan.lee@acme-demo.io | `demo1234` | truck_driver |
| `usr_rdiaz` | rafa.diaz@acme-demo.io | `demo1234` | truck_driver (alias DRV-02) |
| `usr_tvos` | tess.vos@acme-demo.io | `demo1234` | procurement_manager |
| `usr_pshah` | priya.shah@acme-demo.io | `demo1234` | data_architect |
| `usr_mkim` | mina.kim@acme-demo.io | `demo1234` | customer_service |

**Port verbatim from the frontend** so live mode renders exactly like mock mode:
- Shipments from `frontend/src/data/logistics.ts` `SHIPMENTS`: `driverId` → `driver_id`, `window` → `delivery_window`, and `vehicle` "TRK-14 · 18 t" → `vehicle_id` `TRK-14`.
- Suppliers and quotations from `frontend/src/data/procurement.ts`.
- Connectors → `sources`, and `GOLD_DATASETS` → `gold_datasets`, from `frontend/src/lib/workspace.ts`. This includes the failed TMS refresh and the S3 quarantine.
- Lots, actions, rules, checks and rejected rows from `frontend/src/data/expiry.ts` `seedExpiry()`. Store lots in `inventory` with `batch_id`=`id`, `product_name`=`product`, `warehouse_id`=`facility`, and `expiry_date` = today + days.
- Seed audit events and incidents from `workspace.ts`.

**Add the AGENTS.md golden records:**
- `inventory`:
  - B-101 Whole Milk 1L · Dairy · WH-NORTH · storage_days 2 · 3.1 °C (max 4.0)
  - **B-104 Greek Yogurt · Dairy · WH-TRANSIT · 4 days · 8.2 °C (max 4.0)**
  - B-202 Frozen Salmon · Seafood · WH-COAST · 1 day · −18.5 °C (max −18.0)
  - Give each a qty, unit, unit_value and expiry_date so they also appear in the Expiry Guard.
- `shipments`:
  - SH-901 · B-101 · Casablanca → Rabat · TRK-12 · `usr_rdiaz` · Delivered
  - **SH-905 · B-104 · Casablanca → Tangier · TRK-88 · `usr_rdiaz` · Delayed**
- `telemetry` for TRK-88 / B-104:
  - readings every 30 minutes from 10:00 to 18:00 UTC yesterday.
  - 3.5–3.9 °C until 14:00.
  - **spike to 8.2 °C at 14:15 UTC**, event `compressor_fault`.
  - stays above 7.5 °C afterwards.

**Generated PDFs** in `DOCS_DIR`, written with fpdf2. Page numbers matter because citations are page-exact.

| file | visibility / module / classification | pages → text |
|---|---|---|
| `workshop_log.pdf` | module transportation, internal | p1: "Maintenance Incident Report, Casablanca Fleet Depot. Reefer compressor (TRK-88, Thermo King) flagged 09:30 yesterday — severe drive-belt wear; replacement part on backorder. Vehicle cleared for short-run service with deferred maintenance notice." |
| `carrier_sop.pdf` | company, internal | p1: "Dairy must stay at or below 4 °C; any excursion over 12 h is a spoilage event." p2: "Drivers log reefer alarms immediately and divert to the nearest cold store." |
| `Fleet_Driver_Handbook_2026.pdf` | module transportation | p4, p9, p12: text from `frontend/src/lib/rag.ts` `PDF_TEXT` |
| `Hydraflow_Quotation_Q-7781.pdf` | module procurement, **financial** | p1 as in `rag.ts` |
| `Crestline_Quotation_CQ-5520.pdf` | module procurement, **financial** | p2 as in `rag.ts` (p1 is a cover page) |
| `Procurement_Policy_2026.pdf` | module procurement | p4, p6 as in `rag.ts` |
| `Shelf_Life_and_FEFO_Policy_2026.pdf` | company | p2, p3, p5, p6 as in `rag.ts` |
| `Supplier_Pricing_2026_CONFIDENTIAL.pdf` | restricted (owner/admin only), **financial** | p2 as in `rag.ts` |
| `Critical_Spares_Policy_v3.pdf`, `Loop2_Cavitation_Response_SOP.pdf`, `P-204_Pump_OEM_Manual_rev7.pdf`, `ISO-10816-3_Vibration_Limits_Summary.pdf` | as in `workspace.ts` `DEMO_PDFS` | text from `rag.ts` |

Pad missing pages with a one-line header so page numbers line up.

**`demo/rules.json` seed:**
```json
[
  {"id":"RULE-COLD-01","label":"Cold-Chain Dairy Compliance","severity":"CRITICAL","active":true,"source":"seed",
   "text":"Flag any dairy batch whose temperature exceeds its safe maximum",
   "table":"inventory","conditions":[{"field":"category","op":"=","value":"Dairy"},{"field":"current_temp","op":">","field_ref":"max_safe_temp"}]},
  {"id":"RULE-EXP-01","label":"Expiry — critical window","severity":"CRITICAL","active":true,"source":"seed",
   "text":"Flag lots expiring within the critical window","table":"inventory",
   "conditions":[{"field":"days_remaining","op":"<=","param":"critical_days"}]},
  {"id":"RULE-EXP-02","label":"Expiry — warning window","severity":"WARNING","active":true,"source":"seed",
   "text":"Flag lots expiring within the warning window","table":"inventory",
   "conditions":[{"field":"days_remaining","op":"<=","param":"warning_days"},{"field":"days_remaining","op":">","param":"critical_days"}]}
]
```
`days_remaining` is a computed column: `date_diff('day', current_date, expiry_date)`.

---

## 6. JSON conventions and shapes

- **Resource JSON uses the frontend's camelCase field names.** The source of truth is:
  - `frontend/src/lib/workspace.ts`: `Workspace`, `Tenant`, `KbDocument`, `Connector`, `GoldDataset`, `AuditEvent`, `SecurityIncident`, `InviteCode`
  - `frontend/src/lib/access.ts`: `Member`, `RoleId`
  - `frontend/src/data/logistics.ts`: `Shipment`
  - `frontend/src/data/procurement.ts`: `Supplier`, `Quotation`
  - `frontend/src/data/expiry.ts`: `Lot`, `ExpiryAction`, `ExpiryRules`, `ExpiryRun`, `ExpiryFeed`, `ExpiryState`
- Implement these as Pydantic v2 models with `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` and respond `by_alias=True`.
- **Exceptions that keep their own shapes:**
  - The canonical AI answer (§7.5).
  - The AGENTS.md `/api/chat` and `/api/audit/run` payloads (§7.5, §7.8).
  - `/api/auth/*` (§7.1).
- **Errors** use FastAPI's `{"detail": …}`: 401 means unauthenticated, 403 means forbidden (the `detail` object is described in §4), 404, and 422 for validation errors.
- **Shipment status values**: `Scheduled | Loading | In transit | Arrived | Delivered | Delayed`. Normalise AGENTS.md `DELIVERED`/`DELAYED` on seed.

---

## 7. API contract

Everything is served under `API_PREFIX=/api`. `GET /health` is also served at the root. Unless marked **public**, every route requires `Authorization: Bearer <jwt>`.

### 7.1 Auth
| Method | Path | Body → Response | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `{email,password}` → `{access_token, token_type:"bearer", expires_in, user:{id,name,email}}` | Public. Token claims: `sub`, `cid` (current company, the first membership), `exp`. |
| POST | `/api/auth/demo-login` | `{persona: "owner"\|"driver"\|"procurement"\|"data_architect"}` → the login response | **Only when `DEMO_MODE=true`**. Maps to usr_owner / usr_jlee / usr_tvos / usr_pshah. Powers the UI's "View as". |
| GET | `/api/auth/session` | → `{user, memberships:[{company_id, company_name, roles}], current_company_id}` | |
| POST | `/api/auth/company` | `{company_id}` → login response (new token with `cid`) | 403 if the user is not a member. |

### 7.2 Workspace snapshot (the integration accelerator)
| GET | `/api/workspace` | → `Workspace` (camelCase, see §6) projected for the caller | any member |
|---|---|---|---|

Build it in `snapshot.py` from the DB **after RBAC**:
- `tenant`, `members`, `currentUserId` = caller.
- `documents`: filtered by the caller's ACL (owners see everything).
- `connectors` + `gold`:
  - owner / data_architect: all.
  - Other roles: only the entries whose `modules` intersect their readable modules. A driver still gets `tms` + `gold.shipments_eta` so the stale-ETA banner works.
- `audit`: owner sees everything. Others see events whose `resource` they can `read_records` (non-module resources need `view`).
- `incidents`: owner and data_architect; `[]` for everyone else.
- `invites`: owner only.
- `suppliers` / `quotations`: need procurement `read_records`.
- `shipments`: need transportation `read_records`; assigned scope → own rows only.
- `stock`: `[]`.
- `expiry` (`ExpiryState`):
  - Inventory `read_records` → full state.
  - `configure` only (data_architect) → `lots: []`, `actions: []`, with rules, runs, feed and ruleHistory kept.
  - Procurement → `actions` filtered to `supplier_return` and `lots` filtered to those actions' lots, reduced to `{id, sku, product, batch, qty, unit, supplierId, expiry}`.
  - Otherwise → an empty state with default rules.
- `previewRoles: null`, `previewUserId: null`, `origin: "demo"`.

### 7.3 Company, modules, members, invites
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| POST | `/api/workspaces` | `{name, industry, size, locations[], context?, enabledModules[]}` → `{tenant, access_token}`; the creator becomes owner | authenticated |
| GET / PATCH | `/api/workspaces/current` | → `Tenant` / `{name?, industry?, size?, locations?, context?}` → `Tenant` | view / settings `manage` |
| GET / PUT | `/api/modules` | → `[{id,label,enabled,implemented}]` / `{enabledModules[]}` → same | view / settings `manage` |
| GET | `/api/roles/grants` | → `[{resource, actions[], scope}]` for the caller | authenticated |
| POST | `/api/invites` | `{roles[]}` → `InviteCode` (code `<PREFIX>-DRV\|PRC\|MBR-XXXX`; a driver invite claims a free driver seat) | team `manage` |
| GET | `/api/invites` | → `InviteCode[]` | team `manage` |
| GET | `/api/invites/{code}` | → `{code, companyName, roles, invitedBy, pages[]}`; 404 if invalid, used or expired | authenticated |
| POST | `/api/invites/{code}/accept` | → `{company_id, company_name, roles, access_token}` | authenticated |
| GET | `/api/members?role=` | → `Member[]` | team `view`; transportation `manage` may call `?role=truck_driver` |
| PUT | `/api/members/{userId}/roles` | `{roles[]}` → `Member`; the owner cannot demote themselves | team `manage` |
| POST | `/api/access-requests` | `{resource}` → `{id, status:"pending"}` plus an audit event | authenticated |

### 7.4 Documents
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| POST | `/api/documents/upload` | multipart `file` (PDF only, ≤ 20 MB), `category`, `visibility` (`Company\|Module\|Restricted`), `module?` → `KbDocument` (status `uploaded`) | knowledge `configure` or owner |
| GET | `/api/documents/status` | → `KbDocument[]` filtered by ACL; processing moves through `uploaded → extracting → tagging → indexed` in a background task | knowledge `view` |
| PATCH | `/api/documents/{id}` | `{category?, visibility?, module?}` → `KbDocument`; re-tags its chunks | knowledge `configure` |
| DELETE | `/api/documents/{id}` | → 204; removes the file and its chunks | knowledge `configure` |

### 7.5 Assistant (agent)
**POST `/api/rag/query`** (the UI's assistant endpoint). Body: `{question, module}` (`module` = the page context, e.g. `transportation`).

200 response, the canonical AI answer. `answer` and `sources` are required:
```json
{
  "answer": "Batch B-104 (Greek Yogurt) spoiled because the reefer on TRK-88 failed at 14:15 UTC … [1][2]",
  "sources": [{"document":"shipments_table","page":0},{"document":"workshop_log.pdf","page":1}],
  "freshness": [{"source":"gold.shipments@live","as_of":"14:15","stale":false}],
  "decision": {"status":"allowed","stage":"retrieval"},
  "diagnostics": {
    "intent": "root_cause",
    "sql": "SELECT … FROM shipments s JOIN inventory i …",
    "structured_data": [{"table":"shipments","batch_id":"B-104","vehicle_id":"TRK-88","telemetry_spike":"14:15 UTC","recorded_temp":8.2}],
    "retrieved_context": [{"source":"workshop_log.pdf","page":1,"snippet":"TRK-88 compressor … severe drive-belt wear; replacement part on backorder."}],
    "root_cause_verdict": "Mechanical failure from deferred maintenance on the TRK-88 refrigeration unit.",
    "trace": {"candidates":14,"afterTenant":11,"afterPermission":6,"afterScope":6}
  }
}
```
- `sources[].page = 0` means a structured record, not a PDF page.

403 response, returned **before** any retrieval or SQL. The server also writes a security event:
```json
{"detail":{"decision":"denied","stage":"pre-retrieval","resource":"procurement",
           "resourceLabel":"Procurement · quotations & supplier pricing",
           "reason":"Driver lacks query_ai + read_records on Procurement","chunks_retrieved":0,"incidentId":"inc_…"}}
```

**POST `/api/chat`** (the AGENTS.md contract, same engine):
- Body: `{message, org_id?, role?}`. `org_id` and `role` are **ignored** (they come from the token).
- Response: the AGENTS.md shape `{response, diagnostics:{structured_data, retrieved_context, root_cause_verdict}, citations:["shipments_table","workshop_log.pdf"]}` plus all the canonical fields above.

### 7.6 Transportation
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| GET | `/api/shipments` | → `Shipment[]` (assigned scope → own rows only) | transportation `read_records` |
| PATCH | `/api/shipments/{id}/status` | `{status}` → `Shipment`; a driver may only update their own rows (otherwise 403 + event) | transportation `update_status` |
| PATCH | `/api/shipments/{id}/assignment` | `{driverId\|null}` → `Shipment` | transportation `manage` |

### 7.7 Procurement
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| GET | `/api/procurement/suppliers` | → `Supplier[]` | procurement `read_records` |
| GET | `/api/procurement/quotations?rfq=` | → `Quotation[]` (includes `document` + `page`) | procurement `read_records` |
| POST | `/api/procurement/quotations/{id}/award` | → `{quotations: Quotation[], purchaseOrderDraft: "PO-…"}`; other quotes for the same `rfq`+`item` go back to `Received` | procurement `manage` |

### 7.8 Inventory — Perishable Expiry Guard and auditing
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| GET | `/api/inventory/expiry/lots` | → `Lot[]` | inventory `read_records` |
| GET | `/api/inventory/expiry/actions` | → `ExpiryAction[]` (procurement: `supplier_return` only) | inventory `read_records` or procurement `read_records` |
| POST | `/api/inventory/expiry/actions/{id}/decision` | `{decision:"approved"\|"dismissed"\|"proposed"}` → `ExpiryAction`. Nothing external is executed; approving writes "hand-off queued (simulated)" to the audit log | inventory `manage`; for `route=procurement`, procurement `manage` also allowed |
| GET / PUT | `/api/inventory/expiry/rules` | → `ExpiryRules` / `{criticalDays?, warningDays?, scanMinutes?, markdownMaxPct?, minConfidence?}` → `ExpiryRules` | view / inventory `manage` |
| GET | `/api/inventory/expiry/runs` | → `ExpiryRun[]` | inventory `view` (metadata) |
| POST | `/api/inventory/expiry/scan` | → `ExpiryRun` (runs the RULE-EXP-* rules) | inventory `manage` or `configure` |
| GET | `/api/audit/rules` | → `Rule[]` | dashboard `view` or data `view` |
| POST | `/api/audit/rules/compile` | `{text}` → `Rule` saved (active); also written to `rules.json` | settings `manage` or inventory `manage` |
| PATCH / DELETE | `/api/audit/rules/{id}` | `{active}` → `Rule` / 204 | same as compile |
| POST | `/api/audit/run` | `{org_id?}` → AGENTS.md shape: `{status:"completed", total_rules_evaluated, violations:[{rule_id,label,severity,affected_records:[{batch_id,product_name,current_temp,max_safe_temp,status:"BREACHED"}]}]}` | dashboard `view`; violations are RBAC-filtered |
| GET | `/api/audit/runs?limit=` | → the latest runs with violations (the UI anomaly banner reads `[0]`) | dashboard `view` |

**Expiry rules validation** (same as the UI):
- `0 ≤ criticalDays ≤ 60`
- `criticalDays < warningDays ≤ 120`
- `0 ≤ markdownMaxPct ≤ 60`
- `0.30 ≤ minConfidence ≤ 0.95`
- Each change increments `version`, appends to the history and writes an audit event.

**Lot severity:** `days = expiryDate − today`. `critical` if `days ≤ criticalDays`; `warning` if `days ≤ warningDays`; otherwise `healthy`. `valueAtRisk = qty × unitValue` for non-healthy lots.

### 7.9 Security and audit logs
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| GET | `/api/audit/security-events` | → `SecurityIncident[]` (camelCase, newest first) | owner or data `view` |
| POST | `/api/audit/security-events` | `{requestedResource, query}` → `SecurityIncident` **only if the caller really lacks access** (server re-checks), otherwise 409. Used by the UI's route guard | authenticated |
| GET | `/api/audit/events` | → `AuditEvent[]` (owner: everything; others: RBAC-filtered as in the snapshot) | authenticated |

### 7.10 Data platform (metadata only — never business rows)
| Method | Path | Request → Response | Requires |
|---|---|---|---|
| GET | `/api/sources` | → `Connector[]` | data `view` |
| POST | `/api/sources/{id}/connect` and `/disconnect` | → `Connector` | data `configure` |
| GET | `/api/pipelines` | → `GoldDataset[]` | data `view` |

### 7.11 Misc
- `GET /api/health` (public) → `{status:"ok", version, llm:"nim"|"deterministic", rag:"tfidf"|"chroma", db:"duckdb"}`.
- `POST /api/triage/infer` → returns the matching preset from `frontend/public/mock_data.json` by `preset` (P2, simulated). Requires triage `view`.

---

## 8. Engines

### 8.1 `sql_engine.py`
1. **Recon.** For each allowed table, run `PRAGMA table_info('<t>')` and cache `{column, type, notnull, pk}`. Build a compact schema prompt that includes 3 sample rows per table (already scoped to the role).
2. **Allow-list per role.**
   - owner: `inventory`, `shipments`, `telemetry`, `suppliers`, `quotations`, `audit_runs`, `gold_datasets`, `sources`.
   - truck_driver: `shipments`, `telemetry` (both scoped to their vehicles and shipments).
   - procurement_manager: `suppliers`, `quotations`.
   - data_architect: `sources`, `gold_datasets`, `audit_runs` (no business tables).
   - Other roles: the tables of modules where they have `read_records`.
3. **Generate.**
   - LLM mode: a system prompt with the schema and rules ("DuckDB SQL. One SELECT. Only these tables. No DDL/DML. LIMIT 200.") → extract the SQL from a fenced block.
   - Deterministic mode: templates matched by keyword (see §8.4).
4. **Validate** with `sqlglot.parse(sql, read="duckdb")`. Reject unless all of these hold:
   - exactly 1 statement, of type `exp.Select` (CTEs allowed);
   - every table is in the allow-list;
   - no `PRAGMA`, `ATTACH`, `COPY`, `INSTALL`, `LOAD`, `CALL`, `EXPORT`, `CREATE`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`;
   - no `read_csv`, `read_parquet` or `glob` functions.
   - Add `LIMIT 200` if it is missing.
5. **RBAC rewrite** (with sqlglot):
   - Replace every `exp.Table` named `shipments` with `(SELECT * FROM main.shipments WHERE tenant_id = $tenant AND driver_id = $user) AS shipments` for assigned scope. Use `WHERE tenant_id = $tenant` for everyone else.
   - Do the same for `telemetry`, restricted to the driver's vehicles.
   - Always add the tenant filter to every table.
6. **Execute** read-only under the connection lock, with a 5 s timeout. Return `{sql, columns, rows}`.

### 8.2 `llm.py`
- `chat(messages, json_mode=False) -> str` using httpx POST `{LLM_BASE_URL}/chat/completions` with a Bearer key, temperature 0.1 and the configured timeout.
- On a missing key, timeout or error → raise `LLMUnavailable`. Every caller must catch it and use the deterministic path.

### 8.3 `rag_engine.py`
- **Ingest:** use `pypdf` page by page. Split into chunks of ~120 words with 20 words of overlap, keeping the page number. Store rows in `chunks` with metadata:
  - `visibility`, `modules`
  - `roles` (`["*"]`, or `["owner","admin"]` for Restricted)
  - `classification` (`internal` | `financial`; quotations and pricing are financial).
- **Index:** per-tenant, in-memory TF-IDF (tokenise lowercase `\w+`, drop stopwords, sublinear tf, idf over the tenant's chunks). Rebuild on ingest, patch or delete.
- **Retrieve** `(principal, query, topics=None, k=5)`. Filters run in this order and **before** any scoring:
  1. `tenant_id = principal.tenant_id`
  2. role/ACL: `roles` contains `*` or one of the principal's roles; module chunks need `view` on one of their `modules`, record chunks need `read_records`.
  3. classification: `financial` needs procurement `read_records` or owner.
  4. Then cosine-score only the survivors and take the top k.
- Return the chunks plus `trace {candidates, afterTenant, afterPermission, afterScope}` for the UI's "How this answer was filtered".
- `RAG_BACKEND=chroma` (optional): same metadata pre-filter via `where`. The scoring API stays identical.

### 8.4 `agent.py` (orchestrator)

**Pipeline:** `answer(principal, message, context) → Answer`

1. **Gate.** Run `authorize_query`. On deny: record an incident (`stage="pre-retrieval"`) and raise 403 (§7.5).
2. **Intent.**
   - LLM mode: JSON classification.
   - Deterministic keyword router:
     - `root_cause` — why / cause / spoil / root cause / what happened with a batch / shipment / vehicle id
     - `compile_rule` — "flag", "alert me", "create a rule", "whenever"
     - `analytics` — how many, list, show, top, average, which lots / shipments / quotations
     - `briefing` — "what needs my attention", "brief"
     - `docs` — procedure, policy, handling, SOP, anything else
3. **Tools:**
   - `sql_engine.query(principal, question)`
   - `rag_engine.retrieve(principal, query)`
   - `audit_engine.compile(principal, text)`
   - `expiry.summary(principal)`
4. **Root cause (two hops).**
   - **Hop 1 (SQL):** find the entity (`B-\d+`, `SH-\d+`, `TRK-\d+`, or "batch #104" → `B-104`). Join `inventory` + `shipments` + `telemetry`, and select the first reading above `max_safe_temp` (the spike time plus the recorded temperature).
   - **Hop 2 (RAG):** query `"<vehicle_id> <product> maintenance compressor incident"` with the principal's filters.
   - **Synthesis:**
     - LLM mode: send only the permitted rows and snippets, with the instruction "cite as [n]".
     - Deterministic template: `"Batch {batch} ({product}) spoiled in transit {origin}→{destination}: the reefer on {vehicle} reached {temp} °C at {spike} UTC (max {max} °C). {snippet-derived cause}. Verdict: {verdict}."` The verdict comes from the snippet's keywords (`deferred maintenance` / `belt` → "Mechanical equipment failure resulting from deferred maintenance on {vehicle} refrigeration unit").
5. **Other intents:**
   - `docs` → an extractive answer from the top chunks.
   - `analytics` → a one-line summary plus the rows in `diagnostics.structured_data`.
   - `briefing` → deliveries, RFQs, expiry and security counts (RBAC-projected).
   - `compile_rule` → the saved rule as the answer.
6. **Output.** Always return the canonical AI answer (§7.5) with numbered `sources`, `freshness` flags (ETAs stale if `gold.shipments_eta.stale`) and `diagnostics`.
   - Add explicit **gaps** when data was filtered out: "Business records are not included — your access covers pipeline metadata".
   - Never mention filtered content.

### 8.5 `audit_engine.py`
- **Registry:** DB `audit_rules`, mirrored to `RULES_PATH` on every change (pretty JSON). Load the seed rules on first start.
- **Compile** (`text → rule`):
  - LLM mode: JSON schema `{label, severity, table, conditions[{field, op in (=,!=,>,>=,<,<=,contains), value|field_ref|param}]}`, validated against the table columns from PRAGMA.
  - Deterministic mode: regexes for category words (dairy / seafood / frozen), temperature (`(\d+(\.\d+)?)\s*°?C`), duration (`(\d+)\s*h`, mapped to `storage_days*24` or telemetry duration), "in transit" (`warehouse_id='WH-TRANSIT'`), and expiry (`expire within (\d+) days`).
  - Ids are `RULE-USR-###`.
- **Evaluate:** turn the conditions into **parameterised** SQL (no string concatenation of values), with the tenant filter always added. Collect `affected_records`, mapped to the AGENTS.md fields with `status:"BREACHED"`.
- **Run:** evaluate all active rules for the caller's tenant. Store an `audit_runs` row. For RULE-EXP-* rules, also create `expiry_actions` proposals for at-risk lots that have no open action (the same heuristics as `frontend/src/lib/expiry.ts` `proposeFor`).
- **Scheduler:** when `AUDIT_SCHEDULER=on`, an asyncio task started in the lifespan runs `run(tenant, trigger="schedule")` every `AUDIT_INTERVAL_SECONDS` for every tenant.

### 8.6 `security_log.py`
- `record_incident(principal, resource, label, query, stage, reason)` → inserts into `security_events` (`chunks_retrieved=0`, `sent_to_model=false`) and adds an `audit_events` row "Access denied (403)" (tone `crit`, resource `data`).
- `audit_event(principal, action, detail, tone, resource)`.
- Call `audit_event` on every mutation: status update, assignment, award, decision, rules change, invite, role change, module toggle, document change, scan, rule compile.

---

## 9. Security checklist (must be true before demo)
- JWT HS256 with an `exp`; the secret comes from env. Reject expired or invalid tokens with 401.
- CORS: explicit origins from `CORS_ORIGINS`, `allow_credentials=False`, methods `GET, POST, PUT, PATCH, DELETE`, headers `Authorization, Content-Type`.
- Every query is filtered by `tenant_id` from the token. Cross-tenant ids return 404, never another tenant's row.
- Upload: PDFs only (check the magic bytes `%PDF`), size-limited, filename sanitised, stored under `UPLOADS_DIR/<tenant>/<uuid>.pdf`.
- Only the `WHERE` rewrite in §8.1 is dynamic SQL; everything else is parameterised.
- `demo-login` returns 404 when `DEMO_MODE=false`.

---

## 10. Tests (`pytest -q` must be green)
`tests/conftest.py`: seed into a temp DB, create a `TestClient`, and provide `token(persona)` via `/api/auth/demo-login`.

| Test | Asserts |
|---|---|
| `test_rbac.py` | Driver: `/api/shipments` returns only their rows. `/api/procurement/quotations` → 403, and the event is visible to the owner. Driver PATCH on another driver's shipment → 403. Data architect `/api/shipments` → 403, `/api/sources` → 200. Procurement `/api/inventory/expiry/actions` returns only `supplier_return`. |
| `test_sql_guard.py` | "DROP TABLE shipments", multi-statement input, `read_csv`, `PRAGMA` and non-allow-listed tables are rejected. A driver `SELECT * FROM shipments` returns only their rows. Tenant filter present. |
| `test_rag_filter.py` | Driver retrieval never returns financial or restricted chunks (and `afterPermission < afterTenant`). Owner gets `Supplier_Pricing…` p2. Borealis-style cross-tenant chunks are never returned. |
| `test_agent_golden.py` | Owner: "Why did Batch #104 spoil during transit from Casablanca to Tangier?" → the answer contains `TRK-88`; `structured_data[0].recorded_temp == 8.2`; `retrieved_context[0].source == "workshop_log.pdf"`; `citations ⊇ {"shipments_table","workshop_log.pdf"}`. Driver: "What are our supplier prices?" → 403 with stage `pre-retrieval` and `chunks_retrieved 0`. Data architect: "Why did the expiry scan reject rows?" → 200, metadata only. |
| `test_audit.py` | Compiling "Flag any dairy batch in transit over 4°C for more than 12h" → rule saved and present in `rules.json`. `/api/audit/run` → a RULE-COLD-01 violation includes B-104 `BREACHED`. The expiry scan returns `status` `partial` with `rowsRejected 2`. |
| `test_api_smoke.py` | Every route in §7 answers the owner with 2xx (or 204). `/api/workspace` validates against the Pydantic `Workspace` model and has 8 shipments, 4 suppliers, 4 quotations and ≥ 15 lots. |

---

## 11. Frontend integration ("plug it in")

Work only inside `frontend/`. Keep mock mode working. Live mode turns on when `VITE_USE_MOCK=false`.

### 11.1 Wiring
- **`vite.config.ts`:** add `server.proxy = { '/api': 'http://localhost:8000' }`.
- **`.env.local`:** `VITE_USE_MOCK=false` and `VITE_API_URL=/api`.
- **`src/lib/api.ts`:**
  - Replace `ENDPOINTS` with every §7 path, keeping the existing keys and adding new ones.
  - Call `setAuthTokenProvider(() => sessionStorage.getItem('nexus.token'))` at module load.
- **`src/lib/apiContract.ts`:** re-export the camelCase UI types and add `RagAnswer.diagnostics`, `AuditRunResponse`, `Rule` and `SessionResponse`.

### 11.2 New `src/lib/live.ts`
All functions call `apiRequest`, and every mutation resolves to a **fresh snapshot** (`GET /api/workspace`), so the UI's existing reducers stay untouched:
```
login(email, password) · demoLogin(persona) · logout()
session() · selectCompany(id) · snapshot()
createCompany(draft) · updateProfile(patch) · setModules(ids)
createInvite(roles) · previewInvite(code) · acceptInvite(code) · setMemberRoles(userId, roles) · requestAccess(resource)
uploadDocument(file, meta) · patchDocument(id, patch) · deleteDocument(id)
setShipmentStatus(id, status) · assignShipment(id, driverId)
awardQuotation(id)
decideExpiryAction(id, decision) · updateExpiryRules(patch) · runExpiryScan()
compileRule(text) · setRuleActive(id, active) · runAudit() · latestAuditRun()
logRouteDenial(resource, query)
```

### 11.3 App / Shell
- **`App.tsx`** (live mode only):
  - Login calls `live.login`, and `GET /api/auth/session` fills `WorkspaceChoice`.
  - "Open demo company" → `selectCompany` + `snapshot`.
  - Join → `previewInvite` / `acceptInvite`.
  - The setup wizard calls `createCompany`, then `setModules`, `uploadDocument` for each PDF, and `createInvite`.
  - Replace the `mockDb.ts` calls behind `USE_MOCK_DEFAULT` checks.
- **`WorkspaceContext`:** add `live: typeof live | null`.
- **`Shell`:**
  - In live mode, hydrate `ws` from `live.snapshot()`.
  - Poll `snapshot()` every 15 s and after any mutation, so incidents and approvals from other personas appear.
  - The "View as" switcher calls `live.demoLogin(persona)`, then re-snapshots. Show the preview banner text "Signed in as demo persona".
- **Replace these local mutations** with `live` calls when `live` is set; keep the local reducer otherwise:

| Component | Action | live function |
|---|---|---|
| `Transportation.tsx` | `setStatus` | `setShipmentStatus` |
| `Transportation.tsx` | `assign` | `assignShipment` |
| `Procurement.tsx` | `award` | `awardQuotation` |
| `Procurement.tsx` | `decideReturn` | `decideExpiryAction` |
| `Inventory.tsx` | `decide` | `decideExpiryAction` |
| `Inventory.tsx` | `RulesForm.save` | `updateExpiryRules` |
| `Inventory.tsx` | `AgentStatus.scan` | `runExpiryScan` |
| `Team.tsx` | generate invite | `createInvite` |
| `Team.tsx` | `setMembers` role edit | `setMemberRoles` |
| `Settings.tsx` | profile | `updateProfile` |
| `Settings.tsx` | modules | `setModules` |
| `Knowledge.tsx` / `DocumentsPanel.tsx` | upload / patch / delete | document functions |
| `AccessDenied.tsx` | route incident | `logRouteDenial` |
| `DataArchitect.tsx` | connect / disconnect | `sources` endpoints |

- **Assistant** (`src/lib/assistant.ts`):
  - Already posts to `/rag/query` when `useMock=false`. Pass `module: context`.
  - On a 403, read `detail.reason` / `detail.incidentId` when `detail` is an object.
  - Keep `diagnostics` in `AnswerView`.
  - `AnswerBlocks.tsx`: render a **"Diagnostics"** disclosure when present:
    - `intent` badge
    - `structured_data` as a compact mono table
    - `retrieved_context` snippets as citation pills (`document · p.N`)
    - `root_cause_verdict` in an accent-bordered callout
    - `sql` in a terminal block
- **Compliance** (AGENTS.md "Audit.jsx"): add an Admin tab `compliance` → "Compliance" to `AdminHome.tsx`, visible when `dashboard` view is granted. It contains:
  - a textarea "Describe a policy" → `compileRule`
  - the active rules table (label, severity, source, active switch)
  - a **Run operational audit** button → `runAudit()`
  - a violations list: per-rule severity badge plus an affected-records mono table.
- **Global anomaly banner:** in `Shell`, if `latestAuditRun()` has a CRITICAL violation the role can see, show a thin `border-crit-line bg-crit-bg` bar under the top bar, linking to `#/dashboard/compliance`.
- **Health:** Settings → Integrations → "Check GET /health" already exists (it hits `/api/health` through the proxy).

### 11.4 Frontend acceptance (live mode)
Run `make dev`, open http://localhost:5173, and click **Enter demo workspace**. The frontend login then posts `operator@nexus-demo.io` / `brev-a100` to the backend.

1. The Overview map renders from the snapshot: Transportation critical (TMS failed), Procurement warning, Inventory critical.
2. **Chat as owner:** "Why did Batch #104 spoil during transit from Casablanca to Tangier?" → the answer cites `shipments_table` and `workshop_log.pdf`, and the Diagnostics show 8.2 °C at 14:15 UTC and the TRK-88 verdict.
3. **Compliance tab:** compile "Flag any dairy batch in transit over 4°C for more than 12h", then Run audit → the B-104 CRITICAL banner appears.
4. **View as Driver** → only assigned shipments. The dock's red chip "Which lots expire…" or typing "supplier prices" → 403 DeniedBlock. Navigating to `#/procurement` → Access Denied.
5. **Back to Owner** → Overview → Security shows the new incidents within 15 s.
6. **Procurement persona** → awarding Q-7781 updates the status. **Data Architect** → Sources and Pipeline Health, with no business rows.
7. `npm run check` stays green: typecheck, lint with zero findings, tests, build.

---

## 12. Non-functional
- p95 < 1.5 s for non-LLM routes and < 6 s for LLM answers (with a 12 s timeout, falling back to deterministic).
- Log with the stdlib `logging`: one line per request with the route, status, user and tenant. Never log tokens or document text.
- The app starts on a fresh machine with `make setup && make seed && make dev`.

## 13. Acceptance checklist (run after each phase)
- [ ] `python -m demo.seed --reset` creates the DB, 13 PDFs and `rules.json`, and is idempotent.
- [ ] `curl localhost:8000/api/health` → `{"status":"ok",…}`.
- [ ] `pytest -q` is green (all of §10).
- [ ] Every §11.4 step works in the browser, with no console errors other than intentional 403s.
- [ ] `frontend`: `npm run check` is green.
- [ ] `README.md`: setup, the persona credentials table, the golden-path script and the architecture diagram (§1 plus AGENTS.md).

## 14. Build order (≈60 min, parallel by owner)
| Minutes | Phase | Owner (AGENTS.md) |
|---|---|---|
| 0–10 | `config`, `db` DDL, `seed.py` (+ PDFs, rules.json), `schemas.py`, `auth.py`, `permissions.py`, `main.py` + `/health`, `/auth/*` | a56lp28sh58ck |
| 0–10 | Vite proxy, `.env.local`, `live.ts` skeleton, login wiring | khalid_is_somewhere |
| 10–30 | `sql_engine.py` + `snapshot.py` + transportation / procurement / workspace / members routers | a56lp28sh58ck |
| 10–30 | `rag_engine.py` + documents router + ingest on startup | drifter_0 |
| 10–30 | `llm.py`, `agent.py` (gate, intents, two-hop), `audit_engine.py`, `expiry.py` + inventory / audit routers + scheduler | amineelbaydaouy + the_one_and_only_otter |
| 10–30 | Mutation swap table (§11.3), Diagnostics UI, Compliance tab, anomaly banner | khalid_is_somewhere |
| 30–45 | Integration: `/api/workspace` hydration, persona demo-login, golden path end to end, fix contract mismatches **on the backend first** | all |
| 45–55 | `pytest`, `npm run check`, README, screenshots | all |
| 55–60 | Freeze: tag `v1-demo`, 60 s backup video | Hermes / lead |

If time runs out, cut in this order: triage → sources connect/disconnect → document PATCH/DELETE → the scheduler (keep the manual run) → the Chroma option. **Never cut:** the RBAC gate, the SQL guard, RAG pre-filtering, the golden root-cause path, or the 403 demo.
