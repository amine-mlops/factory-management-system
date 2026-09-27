# DECISIONS.md

Choices made while executing `MASTER_SPEC.md` where the spec was silent, ambiguous or in conflict with the repository. The spec wins wherever it is explicit.

## Repository and tooling

1. **Monorepo root.** The spec's `nexus/` tree maps onto this repository's root (`factory-management-system/`). `backend/` is now a Python package (`uvicorn backend.main:app`), and `demo/` is a package too, so `python -m demo.seed` works.
2. **Legacy files left in place.** These are reported, not deleted: `backend/modules/*.py` (empty; referenced by `frontend/INTEGRATION.md`), `backend/controllers/hhhh.bquery` (empty), `backend/pyproject.toml`, `backend/.python-version`, `backend/README.md`, the root `pyproject.toml` and `uv.lock` (`requires-python >=3.14` and a `hermes-agent` dependency), and `frontend/tsconfig - Copy.json` (a duplicate of `tsconfig.json`). `requirements.txt` is the install contract (§3).
3. **Vite proxy target.** `/api` proxies to `http://localhost:8000` by default. `NEXUS_API_PROXY` overrides it, and `make dev PORT=8011` sets it, for machines where port 8000 is already taken.
4. **`.env` / secrets.** With `DEMO_MODE=true` and no real `JWT_SECRET` (empty or the `change-me-in-.env` placeholder), a fixed demo-only secret is used. With `DEMO_MODE=false`, startup fails without `JWT_SECRET` (§3).

## Data model and seed

5. **JSON columns are `VARCHAR` holding JSON text**, decoded in `db.rows()`, so the demo never depends on loading a DuckDB extension offline.
6. **`at` is a reserved word in DuckDB.** It is always quoted (`"at"`), and the insert/update helpers quote every identifier.
7. **Extra columns** beyond §5 that the UI contracts need:
   - `inventory.lot_batch`: the Lot `batch`, distinct from `batch_id`.
   - `shipments.vehicle_desc`: the UI shows `TRK-14 · 18 t` while `vehicle_id` is `TRK-14`.
   - `documents.classification`, `chunks.source`.
   - `audit_events."at"`: an ISO timestamp for ordering; `time` stays `HH:MM:SS` for the UI.
   - `audit_runs.kind`: `expiry` for Expiry Guard scans, `audit` for operational audits. Both kinds share the §5.3 table.
   - `expiry_rules.feed_*`: the ExpiryFeed dataset, version, asOf, stale flag and sources.
   - `expiry_actions.created_at`.
8. **12 demo PDFs, not 13.** The §5.4 table lists exactly 12 files. The "13 PDFs" count in §13 is inconsistent with that table. The quotations still reference `Meridian_Quotation_MS-3310.pdf` and `Apex_Quotation_AB-1190.pdf`, which the frontend never shipped (they show "Not indexed", as in mock mode).
9. **Page padding.** Each PDF has one page per page number up to its highest cited page, and every page starts with a one-line header. P-204's text therefore sits on p.37. Ingest strips the header before chunking.
10. **Golden shipments.** SH-901 and SH-905 are both assigned to `usr_rdiaz`, per §5.4. AGENTS.md used `DRV-01`/`DRV-02`. Customer, address, window and pallet values were invented; the statuses were normalised to `Delivered` / `Delayed`.
11. **Tess Vos is `procurement_manager` only**, per the §5.4 table. The frontend mock also gave her `transportation_manager`, which would let the Procurement persona read driver routes.
12. **`usr_sortiz` (Sam Ortiz)** is seeded as an active member with no roles, mirroring `SEED_TEAM` in the UI.
13. **A second tenant, `tnt_borealis` (Borealis Foods)**, is seeded with three chunks and one shipment (`BF-2201`, which even uses driver id `usr_jlee`). This makes cross-tenant isolation testable in SQL and in RAG, mirroring `OTHER_TENANT` in `rag.ts`. It has no members.
14. **The demo invite codes** from the UI (`ACME-MFG-7F3K`, `ACME-DRV-2291`, `ACME-PRC-4410`) are seeded so the Join flow works in live mode.
15. **Lot categories and temperatures.** The Expiry Guard lots get non-dairy categories and safe temperatures derived from their storage class, so only B-104 breaches RULE-COLD-01.
16. **Seed on empty uses `reset=True`.** It drops pre-spec tables, such as the old 7-column `inventory`, so an old `supply_chain.duckdb` upgrades cleanly.

## API and RBAC

17. **The `require()` dependency supports `any_of`** for routes the spec grants on alternatives (e.g. actions: inventory `read_records` or procurement `read_records`).
18. **Connectors for non-owner roles** are the sources feeding the Gold datasets the caller may read. A connector has no `modules` of its own. A driver therefore gets `tms` + `erp` and `gold.shipments_eta`.
19. **Incidents** are visible to owner/admin, data_architect and any role with `data:view` (e.g. `it_security`).
20. **`GET /api/inventory/expiry/rules`** accepts view on inventory, procurement or data. The spec's plain "view" names no resource.
21. **`POST /api/audit/run`** also returns `run_id`. `GET /api/inventory/expiry/state` was added as an RBAC-projected convenience.
22. **Document delete** removes files only when they live under `UPLOADS_DIR`. Seeded PDFs in `demo/docs` are never unlinked, only their rows and chunks.
23. **Upload processing** runs in a background thread with `DOC_STAGE_DELAY_SECONDS` per stage, so the UI can watch uploaded → extracting → tagging → indexed. Tests set it to 0, which runs it inline as a FastAPI background task.
24. **Members list.** Every member of a tenant sees the member list (names, emails, roles), as in the UI mock. Invites are owner-only.

## Engines

25. **SQL guard.** Besides §8.1, it also rejects `SET`/`USE`/`RESET`/`CHECKPOINT`/`VACUUM`/`TRUNCATE`/`MERGE`, table functions, `duckdb_*`/`pragma_*`/`getenv`/`*_scan` functions, and any catalog or schema other than `main`. The RBAC rewrite embeds the tenant and user ids as escaped SQL literals built by sqlglot (they come from the verified token, never from input). User-derived template values stay bound `?` parameters.
26. **RAG.** The TF-IDF tokenizer includes a tiny suffix stemmer (`quotations` → `quotation`). Retrieval boosts chunks that mention the incident's vehicle id (hop 2). The trace maps the classification filter to `afterScope`. `RAG_BACKEND=chroma` is accepted but not installed: the API logs a warning and uses TF-IDF, and `/health` reports `tfidf`.
27. **An extra intent, `metadata`.** Questions that the gate resolves to `data` (pipelines, feeds, scans, incidents) are answered from pipeline metadata only: sources, gold datasets, feed checks, rejected-row metadata and security events. When the caller cannot read business records, the answer starts with "Metadata only —" and ends with the §8.4 gap.
28. **Deterministic rule compiler.** "over 4°C" becomes `current_temp > 4`. "more than 12h" becomes `storage_hours > 12`, where `storage_hours` is computed as `storage_days * 24`. "in transit" becomes `warehouse_id = 'WH-TRANSIT'`. Category words map to `category`. "expire within N days" becomes `days_remaining <= N`. Temperature and critical policies get severity CRITICAL.
29. **Scheduler.** The scheduler sleeps first and then runs, so start-up and tests stay deterministic. Each tick runs the operational audit for every tenant, plus an Expiry Guard scan when that tenant's `scan_minutes` has elapsed.

## Frontend

30. **Live mode is build-time.** It is on when `VITE_USE_MOCK=false`. `lib/live.ts` exports `live = null` in mock mode, so mock mode never touches the network. The runtime USE_MOCK toggle still switches only the assistant to the local simulation.
31. **"View as" in live mode is a real re-login** through `POST /api/auth/demo-login`. It is available when the session started as the demo owner. The Shell remounts for the new identity, and the banner reads "Signed in as demo persona".
32. **The assistant in live mode sends every question to FastAPI**, including ones the local gate would deny. The server's gate is authoritative and writes the incident. The UI reads `detail.reason`, `detail.resourceLabel` and `detail.incidentId` from the 403.
33. **Audit-rule calls in `live.ts`** (`listRules`, `compileRule`, `setRuleActive`, `runAudit`, `latestAuditRun`) return their own payloads. Rules are not part of the Workspace snapshot. Every other mutation resolves to a fresh snapshot.
34. **The "Invite by email" form is hidden in live mode.** The spec has no endpoint for it; invitation codes are the live path.
35. **Setup wizard (live).** Files picked in the wizard are kept in memory (`stashFile`) until `POST /workspaces` succeeds, then uploaded. The "Add demo PDFs" entries have no files and are not uploaded.
36. **Pre-existing UI bugs fixed along the way:**
    - The header sat under the docked assistant (`--z-header` 40 < `--z-dock` 45), so the View-as, alerts and account menus could not be clicked at widths of 1600 px and up.
    - Full-width banners under the header now get the same right padding as `<main>` when the dock is open.
