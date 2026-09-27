# AGENTS.md — Autonomous Enterprise Supply Chain Copilot & Diagnostic Engine

Operating spec for the hackathon project (team of 5, Sep 27, 2026, 5 hours).
Hermes (Discord: "Hackathon project lead") acts as project manager; this file is the shared source of truth agents and humans read.

## 1. Executive Summary

Modern enterprises suffer a structural speed deficit vs startups — not from lack of data but fragmentation:
- **Structured telemetry** (ERP, WMS, IoT) locked in relational/analytical DBs.
- **Unstructured context** (carrier notices, maintenance logs, SOPs, contracts) stranded in PDFs/emails.
- **Access barriers**: disruptions (e.g. cold-chain spoilage) wait days for data teams.
- **Compliance drift**: static rules ("dairy ≤ 4°C / 24h") enforced post-mortem via spreadsheets, not proactive triggers.

**Solution**: a unified autonomous intelligence layer pairing:
1. Dynamic **Text-to-SQL** analytics over DuckDB
2. Context-grounded **RAG** over operational logs
3. Strict **RBAC** across both modalities
4. Intent-driven **autonomous auditing** (plain-text policy → persistent rule → cron evaluation)
5. Multi-hop **causal reasoning** (root-cause analysis)

Result: cross-functional teams diagnose failures in seconds with security boundaries preserved.

## 2. Core Functional Pillars

### A. Zero-Overhead Analytical Discovery (Text-to-SQL)
- Connects to analytical gold layers without manual schema mapping.
- Inspects active schemas at runtime (`PRAGMA table_info`), extracting column definitions + constraints.
- Translates operator questions into deterministic, **read-only ANSI SQL** against live tables (inventory, shipments).

### B. Role-Scoped Operational Grounding (Hybrid RAG)
- Ingests SOPs, incident logs, vendor agreements into vector indexes (Chroma/FAISS).
- **Metadata-filtering guardrails BEFORE distance ranking**: a warehouse worker is strictly isolated from executive contract margins and supplier SLAs, even in the same vector store.

### C. Intent-Driven Autonomous Auditing
- Users describe policies conversationally ("Flag any dairy batch in transit over 4°C for >12h").
- Agent compiles plain text → persistent structured rule (`demo/rules.json`).
- Evaluation runner `POST /api/audit/run` executes active rules sequentially against the live DB → real-time anomaly banners.

### D. Dual-Hop Causal Inference (Root-Cause Engine)
- **Hop 1 (Telemetry Detection)**: SQL isolates the metric failure (temp spike 14:15 UTC, truck TRK-88).
- **Hop 2 (Documentation Grounding)**: RAG retrieves incident tickets matching the anomalous entity (workshop notice: TRK-88 compressor belt slipped, repair deferred).
- **Synthesis**: validated causal verdict linking deferred maintenance → spoilage.

## 3. System Architecture

```
React+Vite SPA (persona switcher, copilot chat, compliance dashboard)
        │ HTTP POST /api/chat  [role, org_id]
        ▼
FastAPI Gateway (main.py, permissions.py RBAC)
        ▼
agent.py Orchestrator (intent routing, multi-hop synthesis)
        ├─▶ sql_engine.py  (DuckDB, dynamic PRAGMA, ANSI SQL gen)
        ├─▶ rag_engine.py  (Chroma/FAISS, PDF parsing, role-tagged chunk filter)
        └─▶ rules.json     (policy registry, batch rule evaluator)
```

## 4. Directory Layout & Team Ownership

```
├── backend/
│   ├── main.py            # [Person 1] FastAPI entry, CORS, /chat & /audit routes
│   ├── schemas.py         # [Person 1] Pydantic request/response models
│   ├── permissions.py     # [Person 1] RBAC rules & role-based filter conditions
│   ├── sql_engine.py      # [Person 3] DuckDB client, PRAGMA recon, SQL generator
│   ├── rag_engine.py      # [Person 4] Vector store, PDF chunking, metadata filters
│   └── agent.py           # [Person 5] Central agent, tool routing, causal reasoning
│
├── frontend/              # [Person 2] React 18+ SPA (Vite + Tailwind CSS)
│   ├── vite.config.js     # Proxy → http://localhost:8000
│   └── src/
│       ├── App.jsx        # App shell, persona state, dashboard layout
│       ├── api.js         # Fetch wrapper for /api/chat and /api/audit/run
│       └── components/
│           ├── Header.jsx # Persona toggle dropdown & active org indicator
│           ├── Chat.jsx   # Conversational feed with diagnostic inspections
│           └── Audit.jsx  # Active rules table & "Run Operational Audit" button
│
├── demo/
│   ├── seed.py            # [Person 5] Initializes DuckDB tables & records
│   ├── rules.json         # [Person 1] Intent-compiled audit rules
│   └── docs/              # [Person 4] Operational incident PDFs
│       ├── carrier_sop.pdf
│       └── workshop_log.pdf
│
├── requirements.txt
└── README.md
```

**Person → Discord handle mapping:** TODO (PM to fill in — tell the bot who is Person 1–5).

## 5. RBAC Clearances (backend/permissions.py)

**Roles:**
- `executive`: unrestricted — telemetry, supplier pricing, contract margins, compliance policy.
- `driver`: strictly bounded to assigned deliveries (`assigned_driver_id`), shipment status, route notes. Financial margins / vendor SLAs → **rejected**.

**Enforcement:**
- Structured: SQL engine appends `WHERE driver_id = ...` for driver role.
- Unstructured: RAG retriever drops chunks whose metadata classification exceeds the active role BEFORE similarity scoring.

## 6. Data Contracts (backend/schemas.py)

### POST /api/chat
Request:
```json
{ "org_id": "org_morocco_logistics", "role": "executive",
  "message": "Why did Batch #104 spoil during transit from Casablanca to Tangier?" }
```
Response:
```json
{
  "response": "Batch #104 spoiled due to a mechanical refrigeration compressor breakdown on vehicle TRK-88.",
  "diagnostics": {
    "structured_data": [{ "table": "shipments", "batch_id": "104", "vehicle_id": "TRK-88",
      "telemetry_spike": "14:15 UTC", "recorded_temp": 8.2 }],
    "retrieved_context": [{ "source": "workshop_log.pdf",
      "snippet": "TRK-88 compressor belt showed severe slippage; replacement part delayed." }],
    "root_cause_verdict": "Mechanical equipment failure resulting from deferred maintenance on TRK-88 refrigeration unit."
  },
  "citations": ["shipments_table", "workshop_log.pdf"]
}
```

### POST /api/audit/run
Request: `{ "org_id": "org_morocco_logistics" }`
Response:
```json
{
  "status": "completed", "total_rules_evaluated": 2,
  "violations": [{ "rule_id": "RULE-COLD-01", "label": "Cold-Chain Dairy Compliance",
    "severity": "CRITICAL",
    "affected_records": [{ "batch_id": "104", "product_name": "Greek Yogurt",
      "current_temp": 8.2, "max_safe_temp": 4.0, "status": "BREACHED" }] }]
}
```

## 7. Golden Seed Dataset (demo/seed.py → demo/supply_chain.duckdb)

**inventory:** batch_id | product_name | category | warehouse_id | storage_days | current_temp | max_safe_temp
- B-101 | Whole Milk 1L | Dairy | WH-NORTH | 2 | 3.1 | 4.0
- B-104 | Greek Yogurt | Dairy | WH-TRANSIT | 4 | **8.2** | 4.0
- B-202 | Frozen Salmon | Seafood | WH-COAST | 1 | -18.5 | -18.0

**shipments:** shipment_id | batch_id | origin | destination | vehicle_id | driver_id | status
- SH-901 | B-101 | Casablanca | Rabat | TRK-12 | DRV-01 | DELIVERED
- SH-905 | B-104 | Casablanca | Tangier | TRK-88 | DRV-02 | **DELAYED**

**demo/docs/workshop_log.pdf** — Maintenance Incident Report, Casablanca Fleet Depot: reefer compressor (TRK-88, Thermo King) flagged 09:30 yesterday — severe drive-belt wear, replacement on backorder, vehicle cleared for short-run service with deferred maintenance notice.

## 8. Delivery Sequence

**[Hour 0–1] Seed & Gateway Init** — P5: seed.py → supply_chain.duckdb · P1: scaffold FastAPI/CORS/schemas/permissions · P2: scaffold React+Vite + proxy

**[Hour 1–3] Subsystems** — P1: /chat & /audit/run + rules.json · P2: persona dropdown, chat feed, diagnostic drawer, alert bar · P3: PRAGMA recon + Text-to-SQL · P4: PDF ingest + role-scoped filters · P5: agent.py dual-hop fusion

**[Hour 3–4] Integration** — wire api.js → /api; verify golden path (rule → audit alert → root-cause verdict); verify security (driver persona → financial denial)

**[Hour 4–5] Freeze** — one-command clean setup on fresh terminal; 2–3 README screenshots; 60-s backup walkthrough video

## 9. Working Rules

- Read-only SQL only; queries validated before execution.
- RBAC filters are non-negotiable: filter BEFORE ranking (RAG) and append WHERE conditions (SQL).
- Commit per subsystem change, imperative messages; never commit secrets.
- Every assignment/decision/status change gets posted in Discord to the bot — undocumented work does not exist.
- Pinned demo data is the contract: end-to-end demos must run against `demo/seed.py` output.
