# NEXUS // Factory Operations Cockpit — frontend

React + Vite + TypeScript + Tailwind CSS frontend for **NEXUS**, a multi-tenant factory-management workspace. It is built to be copied into the original repository's `frontend/` directory (see [INTEGRATION.md](INTEGRATION.md)) and talks to a **FastAPI** backend. With `VITE_USE_MOCK=true` (the default) every screen runs on local mock data, so the demo cannot break.

> **Honest status.** This repo contains UI only. Anything backend-side (auth, tenant isolation, RAG, NVIDIA NIM, NeMo Guardrails, PLC/SCADA writes) is either **simulated in the demo** or an **architecture target**, and the UI labels it that way. Hiding a page or button in the browser is **not** security. The FastAPI backend has to enforce every permission.

---

## What's in the demo

| Area | Status in this build |
|---|---|
| Login → choose/join/create company → role-scoped workspace | Full flow, local mock store |
| **Transportation** (Driver + Dispatch views, status updates, cited shift briefing) | Integrated module (FastAPI prototype) |
| **Procurement** (suppliers, quotation comparison, award, cited AI comparison) | Integrated module (FastAPI prototype) |
| Inventory, Warehousing, Manufacturing, Distribution, Customer Service/CRM, IT | "Coming soon" state, with an optional UI preview on mock data |
| Autonomous Triage cockpit (turbines/pumps/compressors) | Architecture preview on mock data |
| Data & Pipelines monitor, security incident log | Architecture preview on mock data |

### Primary acceptance path (≈ 90 s)

1. **Owner** signs in (`operator@nexus-demo.io` / `brev-a100`) → **Set up your company** → enable **Transportation + Procurement** (all 8 modules stay visible; six are marked *Coming soon*) → **Add demo PDFs** and watch *Uploaded → Extracted & chunked → ACL metadata tagged → Indexed · RAG-ready* → **Generate code** for *Driver* and *Procurement* → **Launch workspace**.
2. Sign out, then sign in as `jordan.lee@acme-demo.io` → **Join a company** → paste the driver code. The Driver sees **Transportation only**: their assigned stops, load and handling notes, **stale-ETA badges** (the TMS refresh failed; the last good snapshot is kept and flagged), shift tasks, **Mark …** status buttons, and an **AI shift briefing** with numbered citations and freshness times.
3. In the briefing, click the negative test **"Show executive CRM margins"**. The result is **403 · PRE-RETRIEVAL ACCESS DENIED**: 0 restricted chunks retrieved, nothing sent to the model, and a security incident is recorded. Typing `#/procurement` into the URL shows **Access restricted** and records a route incident.
4. Sign out, sign in as `sam.ortiz@acme-demo.io` → join with the procurement code. This user sees suppliers and quotations, plus an **AI quotation comparison** that cites `Hydraflow_Quotation_Q-7781.pdf p.1`, `Crestline_Quotation_CQ-5520.pdf p.2` and `Procurement_Policy_2026.pdf p.4/p.6`.
5. Sign back in as the Owner → **Your companies**. The owner-only **View as** switcher offers *Owner / Driver / Procurement / Data Architect*. Under **Data Architect**, the Pipeline monitor's **Security incident log** already lists the Driver's denied requests. Other companies' records are removed by the tenant filter before retrieval, and the assistant's filter trace shows this (try "List Borealis Foods deliveries").

Faster path: on the company-choice screen, **Skip — open the pre-configured demo company** loads every module plus seeded members (Driver Jordan Lee, Data Architect Priya Shah, and others).

---

## Rebuild highlights (role-adaptive workspaces)

- **One role-aware model** (`src/lib/insights.ts`) feeds every dashboard, the supply-chain system map, alerts and the assistant. Blocks a role may not read arrive as `null` — nothing is hidden with CSS.
- **Tabbed workspaces** with WAI-ARIA tabs and URL state (`#/view/tab`):
  - Overview: Overview · Live Operations · AI Briefing · Security
  - Transportation: Today · Deliveries · AI Briefing · Exceptions (driver or dispatch variant)
  - Procurement: Overview · Suppliers · Quotations · AI Comparison
  - Inventory — Perishable Expiry Guard: Overview · At-Risk Lots · Agent Actions · Rules & Audit
  - Knowledge: Documents · Ingestion Status · Ask Company
  - Team & Access: Members · Invitations · Roles & Permissions · Audit
  - Settings: Company Profile · Enabled Modules · Integrations · Security
  - Data & Pipelines (Data Architect): Sources · Pipeline Health · Security Incidents
- **Supply-chain system map** (`src/components/map/SystemMap.tsx`): hub and 8 nodes with health, broken-flow markers, legend, freshness, keyboard-operable details drawer. There is an executive projection and a technical (lineage/diagnostics) projection.
- **Docked assistant** (`src/components/assistant/AssistantDock.tsx`):
  - Available on every authenticated page; docks beside the page on wide screens and opens as a sheet on small ones.
  - Knows tenant, role and module; offers quick prompts, including red negative tests.
  - Shows loading, empty, error and 403 states; history is stored per tenant + user + grants.
- **Perishable Expiry Guard** (`src/data/expiry.ts`, `src/lib/expiry.ts`, `src/views/Inventory.tsx`):
  - A simulated autonomous agent that scans lot expiry on a schedule, scores risk, and proposes FEFO, dispatch, markdown, quarantine, donation and supplier-return actions.
  - Every action requires human approval; external actions are only "queued" in the demo store.
  - Data Architects get lineage, checks, runs and redacted event metadata. Procurement sees supplier returns only. Drivers are denied.
- **Product story** cards on Login, the workspace chooser and the Admin overview ("Why it matters"), with live, role-visible proof points.
- **Design system**: generated with the UI/UX Pro Max skill pack (installed under `.claude/skills/`) and curated in `design-system/nexus-ops-cockpit/`. Three-layer tokens live in `src/index.css`.

Everything outside Transportation and Procurement's FastAPI contract runs on the local mock store and is labelled *simulated*, *sample data* or *architecture target*. **Frontend checks are UX only — they are not a security boundary.**

## Architecture

```
┌──────────────────────┐   Bearer token    ┌──────────────────────────────────────────────┐
│ React cockpit (this) │ ────────────────► │ FastAPI + SQLite (backend team)              │
│ role-aware UX only   │ ◄──── JSON ────── │  • verified identity → tenant, user, roles   │
└──────────────────────┘                   │  • default-deny authZ: tenant+action+scope   │
                                           │  • /rag/query: ACL filter BEFORE retrieval   │
                                           └──────┬───────────────────────┬───────────────┘
                                                  │                       │
                     Operational records          │                       │  PDFs / documents
     raw ingestion → validation & cleaning →      │                       │  upload → extraction & validation →
     curated Gold tables → permission-scoped      │                       │  permission-tagged chunks → authorized retrieval
     queries                                      ▼                       ▼
                                  ┌───────────────────────────┐   ┌──────────────────────────────────┐
                                  │ NVIDIA NIM on NVIDIA Brev │   │ NVIDIA NeMo Guardrails           │
                                  │ embeddings + LLM          │   │ topical + tool-safety rails      │
                                  │ (architecture target)     │   │ (architecture target; adds to    │
                                  └───────────────────────────┘   │  the ACL check, does not replace │
                                                                  │  it)                             │
                                                                  └──────────────────────────────────┘
Autonomous Triage (preview):
High-frequency sensor telemetry → Neural anomaly engine on NVIDIA Brev GPU → Physics & ISO standards gate
→ Action generator → PLC/SCADA command + CMMS maintenance ticket   (all simulated in demo)
```

- **Authorization comes first.** Metadata ACL filtering (tenant → role/module → data scope) runs **before** vector search and before any context is built. NeMo Guardrails adds topical boundaries and safe tool use on top of that; it does not replace tenant isolation or RBAC.
- **Documents and Gold tables are separate things.** PDF chunks carry ACL metadata (tenant, document, source, allowed modules/roles, scope, timestamps, index version). Gold tables are the curated operational-record layer. They are two data paths that are both authorized.
- **Pipeline failures stay visible.** A failed refresh keeps the last successful dataset version and flags it **STALE** everywhere, including inside AI answers. Stale data is never presented as current.

## Setup & run

Requires Node 20+ (tested with Node 22).

```bash
npm install
cp .env.example .env.local   # optional; defaults are VITE_USE_MOCK=true, VITE_API_URL=http://localhost:8000
npm run dev                  # http://localhost:5173
```

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) and production build to `dist/` |
| `npm run typecheck` | TypeScript project build, no emit |
| `npm run lint` | oxlint (React, TypeScript, jsx-a11y rules) |
| `npm test` | Vitest unit tests (API client, fallback, permissions, pre-retrieval gate, RAG filtering, invites) |
| `npm run check` | typecheck + lint + test + build |
| `npm run preview` | Serve the production build |
| `npm run mock:generate` | Regenerate `public/mock_data.json` from the in-code presets |

## Mock / live toggle

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCK` | `true` | `true`: every call is served from local mock data. `false`: call FastAPI; on any error or timeout, fall back to mock data and show a notice |
| `VITE_API_URL` | `http://localhost:8000` | FastAPI origin |

All HTTP goes through one typed client, `src/lib/api.ts`. It provides JSON headers, an `AbortController` timeout (8 s by default), a normalized `ApiError` (reads FastAPI's `{"detail": …}`), and an optional `Authorization: Bearer` hook (`setAuthTokenProvider`). No tokens are stored or invented in this repo. The Triage cockpit's `USE_MOCK` switch and **Check FastAPI connection** (`GET /health`) show the current mode. Workspace flows (companies, invites, documents, shipments, quotations) run on a local mock store (`src/lib/mockDb.ts`, backed by `localStorage`) until the backend endpoints exist.

## Contracts

- **AI answer (canonical):** `{ answer: string, sources: [{ document: string, page: number }], freshness?: [...], decision?: {...} }`. The assistant panel shows this JSON under *FastAPI /rag/query response shape*.
- **Triage inference:** `public/mock_data.json` is the locked reference payload. Its top-level keys are `telemetry`, `input`, `asset`, `signals`, `spectrum`, `detections`, `diagnosis`, `summary`, `standards_validation`, `mitigation_command`, `maintenance_ticket`, `impact` and `actions`. The legacy keys (`telemetry`, `input`, `detections`, `summary`, `actions`) are kept for compatibility. Reference values: 38 ms latency on NVIDIA A100-80GB via Brev.
- **All request/response types:** `src/lib/apiContract.ts`. The route mapping table is in [INTEGRATION.md](INTEGRATION.md).

## Permission model (UX mirror of the backend rule)

A permission is a **grant** of the form **module + actions + data scope**. Actions are `view`, `read_records`, `update_status`, `manage`, `configure` and `query_ai`; scope is `tenant` or `assigned`. A user's effective access is the union of their role grants and any explicit grants, limited to the modules the company has enabled. Users can hold several roles and belong to several companies.

- **Driver:** Transportation `view, read_records, update_status, query_ai`, scope **assigned**.
- **Procurement:** Procurement `view, read_records, manage, query_ai`, plus Inventory read and Knowledge Base.
- **Owner/Admin:** everything, including the persona preview.
- **Data Architect (optional preview):** `configure` on Data & Pipelines. It does **not** include `read_records` on business modules, because configuring a connection and reading the data that flows through it are separate permissions.

The code is in `src/lib/access.ts`, `src/lib/guard.ts` (pre-retrieval gate) and `src/lib/rag.ts` (tenant → permission → scope filtering, citations, gaps, stale notices). Every one of these is a **client-side simulation of rules the FastAPI backend must enforce**.

## Project structure

```
public/mock_data.json         locked triage inference payload
src/lib/api.ts                typed FastAPI client (timeout, errors, bearer hook, /health)
src/lib/apiContract.ts        request/response types for the prototype backend
src/lib/access.ts             tenant/user/role/grant types + effective permissions (UX only)
src/lib/guard.ts              pre-retrieval authorization gate (simulated) + incident records
src/lib/rag.ts                permission-tagged chunks, filtered retrieval, cited answers
src/lib/mockDb.ts             local mock of companies / invites / memberships
src/lib/workspace.ts          workspace model, demo data, invite codes, document lifecycle
src/lib/inference.ts          triage inference (mock / live / fallback)
src/views/                    Login, WorkspaceChoice, Onboarding, Logistics (Transportation/Inventory),
                              Procurement, ComingSoon, WorkspacePages, Dashboard, TriageView, ModuleView
src/components/               shell (top bar, sidebar, palette), workspace panels, triage cockpit, UI primitives
```

## Accessibility & presentation

The dark command-center palette uses NVIDIA green `#76b900` only for compute and system state, and amber/red only for warnings and critical states. The layout is tuned for 1080p at 125 % zoom and falls back to tablet and mobile widths with a navigation drawer. The UI uses semantic landmarks, labelled controls, visible focus rings, `aria-live` status regions, keyboard access (⌘/Ctrl-K opens the command palette), and `prefers-reduced-motion` support.
