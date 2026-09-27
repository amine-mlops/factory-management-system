#!/usr/bin/env python3
"""Golden demo seed for NEXUS.

Builds (idempotently) the DuckDB file at DB_PATH, the demo PDFs in DOCS_DIR and
demo/rules.json. Data is ported verbatim from the frontend mock
(frontend/src/data/*.ts, frontend/src/lib/workspace.ts, rag.ts) so live mode
renders like mock mode, plus the AGENTS.md golden records (B-104 / SH-905 / TRK-88).

    python -m demo.seed            # seed only if the DB is empty
    python -m demo.seed --reset    # drop everything and rebuild
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import db  # noqa: E402
from backend.auth import hash_password  # noqa: E402
from backend.config import DEMO_TENANT, get_settings  # noqa: E402

BOREALIS = "tnt_borealis"
ALL_MODULES = ["procurement", "inventory", "transportation", "warehousing", "manufacturing", "distribution", "crm", "it"]
FEFO_POLICY = "Shelf_Life_and_FEFO_Policy_2026.pdf"

# ---------------------------------------------------------------- people

USERS = [
    # id, email, name, password, roles, status
    ("usr_owner", "operator@nexus-demo.io", "Alex Moreno", "brev-a100", ["owner"], "active"),
    ("usr_jlee", "jordan.lee@acme-demo.io", "Jordan Lee", "demo1234", ["truck_driver"], "active"),
    ("usr_rdiaz", "rafa.diaz@acme-demo.io", "Rafa Díaz", "demo1234", ["truck_driver"], "active"),
    ("usr_tvos", "tess.vos@acme-demo.io", "Tess Vos", "demo1234", ["procurement_manager"], "active"),
    ("usr_pshah", "priya.shah@acme-demo.io", "Priya Shah", "demo1234", ["data_architect"], "active"),
    ("usr_mkim", "mina.kim@acme-demo.io", "Mina Kim", "demo1234", ["customer_service"], "active"),
    ("usr_sortiz", "sam.ortiz@acme-demo.io", "Sam Ortiz", "demo1234", [], "active"),
]

DEMO_INVITES = [
    ("ACME-MFG-7F3K", ["manufacturing_engineer"]),
    ("ACME-DRV-2291", ["truck_driver"]),
    ("ACME-PRC-4410", ["procurement_manager"]),
]

# ---------------------------------------------------------------- transportation (logistics.ts SHIPMENTS + golden)

SHIPMENTS = [
    # id, customer, origin, destination, address, window, eta, driver_id, driver_name, vehicle, pallets, kg, handling, status, stop
    ("SHP-88329", "Orion Chemicals", "Plant A", "Orion · Botlek terminal", "Welplaatweg 12, Rotterdam", "09:30–10:30", "10:05", "usr_jlee", "Jordan Lee", "TRK-14 · 18 t", 12, 8400, "ADR class 8 — corrosive; keep upright", "Delivered", 1, None),
    ("SHP-88335", "Helix Energy", "Plant A", "Helix · Maasvlakte plant", "Europaweg 900, Rotterdam", "12:00–13:00", "12:40", "usr_jlee", "Jordan Lee", "TRK-14 · 18 t", 8, 5200, "Coolant modules — max stack 2", "In transit", 2, None),
    ("SHP-88341", "Atlas Foods", "Plant A", "Atlas DC · Barendrecht", "Dierensteinweg 30, Barendrecht", "15:00–16:00", "15:20", "usr_jlee", "Jordan Lee", "TRK-14 · 18 t", 6, 3100, "Food-grade — no co-loading with chemicals", "Scheduled", 3, None),
    ("SHP-88331", "Plant A (inbound)", "Hydraflow Pumps", "Plant A · Dock D-01", "Industrieweg 4, Rotterdam", "17:00–18:00", "17:45", "usr_rdiaz", "Rafa Díaz", "TRK-09 · 7.5 t", 2, 640, "Expedite — impeller kit for WO-48219", "In transit", 1, None),
    ("SHP-88338", "Plant A (inbound)", "Port of Rotterdam", "Plant A · Dock D-06", "Industrieweg 4, Rotterdam", "13:00–14:00", "19:10", "usr_rdiaz", "Rafa Díaz", "TRK-09 · 7.5 t", 10, 7800, "Customs hold released 12:40", "Delayed", 2, None),
    ("SHP-88347", "Nordic Paper", "Plant A", "Nordic · Moerdijk", "Middenweg 11, Moerdijk", "Tomorrow 08:00–09:00", "Tomorrow 08:20", None, "Unassigned", "—", 14, 9900, "Standard", "Scheduled", 1, None),
    # AGENTS.md golden records (status normalised: DELIVERED → Delivered, DELAYED → Delayed)
    ("SH-901", "Atlas Dairy Retail", "Casablanca", "Rabat", "Rabat DC · Zone Industrielle", "08:00–10:00", "09:10", "usr_rdiaz", "Rafa Díaz", "TRK-12 · reefer 12 t", 10, 4200, "Chilled dairy — keep at or below 4 °C", "Delivered", 3, "B-101"),
    ("SH-905", "Tangier Fresh Markets", "Casablanca", "Tangier", "Tanger Med logistics zone", "14:00–18:00", "21:30", "usr_rdiaz", "Rafa Díaz", "TRK-88 · reefer 18 t", 16, 6400, "Chilled dairy — keep at or below 4 °C; reefer alarm open", "Delayed", 4, "B-104"),
]

# ---------------------------------------------------------------- procurement (procurement.ts)

SUPPLIERS = [
    ("sup_hydraflow", "Hydraflow Pumps", "Pumps & impellers", 94, "Preferred", "MSA-2025-014"),
    ("sup_crestline", "Crestline Industrial", "Pumps & impellers", 81, "Probation", "Spot"),
    ("sup_meridian", "Meridian Seals", "Seals & gaskets", 91, "Approved", "MSA-2024-031"),
    ("sup_apex", "Apex Bearings Co.", "Bearings", 97, "Preferred", "MSA-2025-002"),
]

QUOTATIONS = [
    ("Q-7781", "RFQ-2291", "sup_hydraflow", "Impeller kit IMP-204-316SS-RC", 2, 9200, "USD", 5, "2026-10-15", "Net 30 · 24-month warranty", "Under review", "Hydraflow_Quotation_Q-7781.pdf", 1),
    ("CQ-5520", "RFQ-2291", "sup_crestline", "Impeller kit IMP-204-316SS-RC", 2, 7650, "USD", 21, "2026-10-05", "Prepayment 50% · 12-month warranty", "Received", "Crestline_Quotation_CQ-5520.pdf", 2),
    ("MS-3310", "RFQ-2291", "sup_meridian", "Mechanical seal cartridge (add-on)", 4, 1410, "USD", 9, "2026-10-20", "Net 45", "Clarification", "Meridian_Quotation_MS-3310.pdf", 1),
    ("AB-1190", "RFQ-2287", "sup_apex", "Bearing BRG-6320-2Z-C3", 6, 1325, "USD", 6, "2026-10-11", "Net 30 · consignment eligible", "Awarded", "Apex_Quotation_AB-1190.pdf", 1),
]

# ---------------------------------------------------------------- inventory: Expiry Guard lots (expiry.ts) + golden batches

# id, sku, product, lot batch, facility, qty, unit, unit_value, days, storage, category, supplier, valuation_estimated
LOTS = [
    ("LOT-24811", "EZ-12-20", "Enzyme concentrate EZ-12 · 20 kg pail", "B2408-17", "Cold store CS-1", 36, "pails", 410, 3, "Chilled", "Ingredients", None, False),
    ("LOT-24790", "SC-3-FZ", "Starter culture SC-3 · 500 g frozen", "B2407-02", "Cold store CS-1", 120, "packs", 58, 6, "Frozen", "Ingredients", None, False),
    ("LOT-24756", "EPX-2K-KIT", "Two-part epoxy repair kit", "E-5531", "Plant A · MRO store", 14, "kits", 145, -2, "Ambient", "MRO", None, False),
    ("LOT-24833", "PX-150-25", "Pectin powder PX-150 · 25 kg bag", "B2409-08", "DC-C2 · Central Park", 30, "bags", 75, 8, "Ambient", "Ingredients", None, False),
    ("LOT-24802", "GS-80-IBC", "Glucose syrup GS-80 · 1,000 kg IBC", "B2409-05", "DC-C2 · Central Park", 6, "IBCs", 1150, 11, "Ambient", "Ingredients", None, False),
    ("LOT-24733", "WT-220-25", "Water-treatment biocide WT-220 · 25 kg drum", "WT-8812", "Plant A · Utilities", 18, "drums", 96, 13, "Ambient", "Chemicals", None, True),
    ("LOT-24769", "ORK-NBR70", "O-ring kit NBR-70 (ISO 2230 shelf life)", "MS-24-118", "Plant A · MRO store", 40, "kits", 62, 19, "Ambient", "MRO", "sup_meridian", False),
    ("LOT-24799", "RGT-WA-KIT", "Water-analysis reagent kit", "RG-1190", "Plant A · Lab", 8, "kits", 180, 27, "Chilled", "Lab", None, False),
    ("LOT-24840", "GS-80-IBC", "Glucose syrup GS-80 · 1,000 kg IBC", "B2409-26", "DC-C2 · Central Park", 4, "IBCs", 1150, 58, "Ambient", "Ingredients", None, False),
    ("LOT-24818", "CM-40-FG", "Coolant concentrate CM-40 · 20 L", "B2409-21", "DC-C2 · Central Park", 210, "cans", 38, 45, "Ambient", "Chemicals", None, False),
    ("LOT-24744", "LUB-H1-400", "Food-grade lubricant H1 · 400 g", "NL-7731", "Plant A · MRO store", 96, "cartridges", 14, 64, "Ambient", "MRO", None, False),
    ("LOT-24825", "CIT-50-DR", "Citric acid solution 50% · 200 L drum", "B2409-30", "DC-C2 · Central Park", 24, "drums", 210, 120, "Ambient", "Chemicals", None, False),
]
STORAGE_TEMPS = {"Chilled": (3.0, 8.0), "Frozen": (-20.0, -18.0), "Ambient": (19.0, 30.0)}

# batch, sku, product, category, warehouse, storage_days, temp, max, qty, unit, unit_value, expiry_in_days, storage
GOLDEN_INVENTORY = [
    ("B-101", "DAI-WM-1L", "Whole Milk 1L", "Dairy", "WH-NORTH", 2, 3.1, 4.0, 480, "cartons", 1.2, 5, "Chilled"),
    ("B-104", "DAI-GY-150", "Greek Yogurt", "Dairy", "WH-TRANSIT", 4, 8.2, 4.0, 320, "cups", 0.9, 3, "Chilled"),
    ("B-202", "SEA-FS-5KG", "Frozen Salmon", "Seafood", "WH-COAST", 1, -18.5, -18.0, 60, "cases", 45.0, 40, "Frozen"),
]


def P(page: int) -> dict:
    return {"document": FEFO_POLICY, "page": page}


ACTIONS = [
    ("ACT-1041", "dispatch", "LOT-24811", "Ship 36 pails of EZ-12 with today’s Atlas Foods delivery (SHP-88341)", "Shortest-dated chilled lot. SHP-88341 to Atlas Foods (food-grade customer) leaves today, well inside the remaining shelf life; the customer must confirm the add-on.", 14760, 0.86, True, "inventory", [P(2), P(6)]),
    ("ACT-1042", "markdown", "LOT-24790", "Offer 120 packs of SC-3 on the secondary channel at 25% markdown", "Frozen culture with 6 days left and no scheduled shipment that includes it; a 25% markdown stays inside the 30% cap.", 5220, 0.71, True, "inventory", [P(3), P(6)]),
    ("ACT-1043", "quarantine", "LOT-24756", "Quarantine 14 expired epoxy kits and block issue to work orders", "The lot expired 2 days ago; expired material may not be issued. Quarantine prevents use in open repair work orders.", 0, 0.97, False, "inventory", [P(3)]),
    ("ACT-1044", "donation", "LOT-24833", "Donate 30 bags of pectin PX-150 to the regional food-bank partner", "Food-grade ingredient with 8 days left and no scheduled shipment that includes it; donating avoids disposal.", 450, 0.68, True, "inventory", [P(3), P(6)]),
    ("ACT-1045", "fefo", "LOT-24802", "FEFO: pick GS-80 lot B2409-05 before newer lots for this week’s production orders", "Two GS-80 lots are in stock at DC-C2; picking the earlier-expiring lot first uses it before the newer lot.", 6900, 0.91, False, "inventory", [P(2)]),
    ("ACT-1046", "fefo", "LOT-24733", "Reallocate WT-220 biocide to Cooling Loop 2 dosing first", "Cooling Loop 2 is the main WT-220 consumer; dosing it from this lot first uses the oldest drums before they expire.", 1728, 0.88, False, "inventory", [P(2)]),
    ("ACT-1047", "supplier_return", "LOT-24769", "Return 40 O-ring kits to Meridian Seals under MSA-2024-031", "19 days of shelf life remain (policy requires ≥ 18) and the supplier agreement allows returns; estimated credit is net of a 10% restocking fee.", 2232, 0.64, True, "procurement", [P(5), P(6)]),
]

FEED_CHECKS = [
    ("fresh", "Freshness ≤ 30 min", "pass", "Last load 6 min ago"),
    ("schema", "Schema contract lot_expiry v2", "pass", "All required columns present"),
    ("date", "expiry_date is a valid ISO date", "fail", "2 rows rejected and quarantined in Silver"),
    ("qty", "qty ≥ 0", "pass", "0 violations"),
    ("facility", "Facility code in master data", "pass", "0 unknown codes"),
    ("value", "Unit value joined from ERP", "warn", "1 lot valued from last cost (ERP join miss)"),
]
FEED_REJECTED = [
    ("wms_lots_0927.csv:88", "expiry_date", "30/09/2026", "dd/mm/yyyy format — contract expects YYYY-MM-DD"),
    ("wms_lots_0927.csv:141", "expiry_date", "2026-13-02", "month 13 is not a valid date"),
]

# ---------------------------------------------------------------- data platform (workspace.ts CONNECTORS + GOLD_DATASETS)

CONNECTORS = [
    {"id": "erp", "kind": "ERP", "name": "ERP · orders & materials", "detail": "OData · 42 tables", "connected": True, "freshness": "4 min", "sla": "15 min", "quality": 99.2, "errors": 0, "health": "healthy", "rows_per_day": "1.8M", "last_run": {"at": "14:28", "status": "ok"}, "last_success": {"at": "14:28", "version": "erp_orders@v981"}},
    {"id": "wms", "kind": "WMS", "name": "Warehouse management", "detail": "REST · docks, bins, picks", "connected": True, "freshness": "2 min", "sla": "10 min", "quality": 98.7, "errors": 0, "health": "healthy", "rows_per_day": "640k", "last_run": {"at": "14:30", "status": "ok"}, "last_success": {"at": "14:30", "version": "wms_bins@v4410"}},
    {"id": "tms", "kind": "TMS", "name": "Transport management", "detail": "SFTP batch · shipments, routes, ETAs", "connected": True, "freshness": "3 h 28 min", "sla": "30 min", "quality": 96.1, "errors": 1, "health": "failed", "warning": "Refresh failed at 14:10 — required column eta_ts missing. Serving last good snapshot shipments_eta@v142 (11:04) — STALE", "rows_per_day": "84k", "last_run": {"at": "14:10", "status": "failed", "errorKind": "schema", "error": "Required column 'eta_ts' missing in shipments_2026-09-27T14-10.csv (upstream export changed)", "action": "Map estimated_arrival → eta_ts in the ingestion contract, or ask the TMS admin to restore the column, then re-run"}, "last_success": {"at": "11:04", "version": "shipments_eta@v142"}},
    {"id": "crm", "kind": "CRM", "name": "CRM · accounts & cases", "detail": "Webhook + nightly sync", "connected": True, "freshness": "9 min", "sla": "1 h", "quality": 97.9, "errors": 0, "health": "healthy", "rows_per_day": "52k", "last_run": {"at": "14:23", "status": "ok"}, "last_success": {"at": "14:23", "version": "crm_cases@v612"}},
    {"id": "scada", "kind": "IoT/SCADA", "name": "OPC UA historian", "detail": "Streaming · 25.6 kHz vibration", "connected": True, "freshness": "< 1 s", "sla": "5 s", "quality": 99.8, "errors": 0, "health": "healthy", "rows_per_day": "2.1B", "last_run": {"at": "14:32", "status": "ok"}, "last_success": {"at": "14:32", "version": "stream · live"}},
    {"id": "s3", "kind": "Database/S3", "name": "Lakehouse object store", "detail": "s3://plant-a-lake/raw/", "connected": True, "freshness": "18 min", "sla": "1 h", "quality": 94.4, "errors": 7, "health": "schema_mismatch", "warning": "Schema mismatch — receipts.lot_no changed int → string (7 rows quarantined)", "rows_per_day": "3.4M", "last_run": {"at": "14:14", "status": "ok", "errorKind": "quality", "error": "receipts.lot_no changed int → string; 7 rows failed validation and were quarantined", "action": "Update the Silver contract for lot_no or fix the upstream export; quarantined rows are excluded from Gold"}, "last_success": {"at": "14:14", "version": "receipts@v233 (7 rows quarantined)"}},
]

GOLD_DATASETS = [
    ("g1", "gold.asset_health_features", ["scada", "erp"], ["manufacturing"], "Autonomous Triage feature store", "1 s", 99.6, "nv", "v5120", "14:32:08", False),
    ("g2", "gold.inventory_positions", ["erp", "wms"], ["inventory", "procurement"], "Reorder signals, spares reservation", "5 min", 98.9, "nv", "v877", "14:30", False),
    ("g3", "gold.shipments_eta", ["tms", "erp"], ["transportation", "distribution"], "Driver briefings, ETA risk", "3 h 28 min", 95.8, "warn", "v142", "11:04", True),
    ("g4", "gold.supplier_scorecard", ["erp", "s3"], ["procurement"], "OTIF scoring, expedite advice", "18 min", 94.4, "warn", "v61", "14:14", False),
    ("g5", "gold.customer_360", ["crm", "erp"], ["crm"], "Case context, proactive notices", "9 min", 97.9, "nv", "v612", "14:23", False),
    ("g6", "gold.warehouse_ops", ["wms"], ["warehousing"], "Dock & wave planning", "2 min", 98.7, "nv", "v4410", "14:30", False),
    ("g7", "gold.platform_telemetry", ["scada", "s3"], ["it"], "Integration health, SLOs", "1 min", 99.1, "nv", "v2291", "14:31", False),
    ("g8", "gold.lot_expiry", ["wms", "erp"], ["inventory"], "Perishable Expiry Guard scans", "6 min", 98.3, "warn", "v318", "14:26", False),
]

SEED_AUDIT = [
    ("au_s1", "14:31:02", "nv", "system", "Gate policy applied", "Physics & standards gate v2.4 active for all command writes (triage preview)", "triage"),
    ("au_s6", "14:10:05", "crit", "system", "TMS refresh failed", "shipments export missing required column eta_ts — serving shipments_eta@v142 (11:04)", "data"),
    ("au_s2", "12:14:47", "warn", "jordan.lee", "Access denied", "Driver asked for Hydraflow purchase orders — blocked before retrieval, 0 chunks", "data"),
    ("au_s3", "11:58:10", "info", "priya.shah", "Credential rotated", "S3 connector key rotated (secret stored server-side)", "data"),
    ("au_s7", "10:05:40", "nv", "jordan.lee", "Shipment status updated", "SHP-88329 → Delivered (Orion Chemicals)", "transportation"),
    ("au_s8", "09:44:12", "info", "tess.vos", "Quotation received", "CQ-5520 from Crestline Industrial for RFQ-2291", "procurement"),
    ("au_s4", "09:40:33", "info", "alex.moreno", "Role changed", "Tess Vos: + Transportation Manager", "team"),
    ("au_s5", "09:02:11", "nv", "alex.moreno", "Sign-in", "SSO · MFA verified (simulated)", "team"),
]

# ---------------------------------------------------------------- documents (workspace.ts DEMO_PDFS + AGENTS.md docs; text from rag.ts PDF_TEXT)

DOCS = [
    # name, size_kb, category, visibility, module, classification, {page: text}
    ("workshop_log.pdf", 2, "Maintenance log", "Module", "transportation", "internal", {1: "Maintenance Incident Report, Casablanca Fleet Depot. Reefer compressor (TRK-88, Thermo King) flagged 09:30 yesterday — severe drive-belt wear; replacement part on backorder. Vehicle cleared for short-run service with deferred maintenance notice."}),
    ("carrier_sop.pdf", 2, "SOP / Procedure", "Company", None, "internal", {1: "Dairy must stay at or below 4 °C; any excursion over 12 h is a spoilage event.", 2: "Drivers log reefer alarms immediately and divert to the nearest cold store."}),
    ("Fleet_Driver_Handbook_2026.pdf", 2210, "Policy", "Module", "transportation", "internal", {
        4: "ADR class 8 (corrosive) loads must stay upright and secured; verify seal numbers before departure.",
        9: "Food-grade loads may never be co-loaded with chemicals; carry the wash-out certificate.",
        12: "Report any delay over 15 minutes with the 'Delayed' status; dispatch re-plans the route."}),
    ("Hydraflow_Quotation_Q-7781.pdf", 310, "Supplier contract", "Module", "procurement", "financial", {1: "Quotation Q-7781 — impeller kit IMP-204-316SS-RC at USD 9,200 per unit, lead time 5 days, valid until 15 Oct 2026, net 30, 24-month warranty."}),
    ("Crestline_Quotation_CQ-5520.pdf", 280, "Supplier contract", "Module", "procurement", "financial", {1: "Crestline Industrial — quotation cover page.", 2: "Quotation CQ-5520 — impeller kit at USD 7,650 per unit, lead time 21 days, 50% prepayment, 12-month warranty."}),
    ("Procurement_Policy_2026.pdf", 720, "Policy", "Module", "procurement", "internal", {
        4: "Critical spares tied to an open work order are awarded to the lowest total cost that meets the required-by date.",
        6: "Suppliers on probation, or prepayment above 30%, require procurement-director approval."}),
    (FEFO_POLICY, 540, "Policy", "Company", None, "internal", {
        2: "First-expired, first-out (FEFO): pick, issue and dispatch the lot with the earliest expiry date first unless a customer specification requires otherwise.",
        3: "Lots within the critical window are dispatched, marked down (capped at 30%) or routed to a secondary channel; expired lots are quarantined and may not be issued.",
        5: "Supplier returns are allowed when at least 18 days of shelf life remain and the supplier agreement allows returns; procurement approves the return.",
        6: "Any action involving a customer, supplier or partner requires human approval before it is executed."}),
    ("Supplier_Pricing_2026_CONFIDENTIAL.pdf", 450, "Supplier contract", "Restricted", None, "financial", {2: "Negotiated unit prices and rebates for bearings, impellers and seals."}),
    ("Critical_Spares_Policy_v3.pdf", 980, "Policy", "Module", "inventory", "internal", {
        3: "Critical spares with supplier lead time above 7 days keep a minimum of 2 available units.",
        5: "Units reserved for open work orders are not available stock and must trigger replenishment."}),
    ("Loop2_Cavitation_Response_SOP.pdf", 640, "SOP / Procedure", "Module", "manufacturing", "internal", {2: "On confirmed cavitation, reduce pump speed within the validated envelope before considering a trip."}),
    ("P-204_Pump_OEM_Manual_rev7.pdf", 8420, "Equipment manual", "Module", "manufacturing", "internal", {37: "Required NPSH margin ratio for continuous duty is 1.10 or higher."}),
    ("ISO-10816-3_Vibration_Limits_Summary.pdf", 1260, "Safety standard", "Company", None, "internal", {1: "Group 2 rigid machines: zone B/C boundary 2.8 mm/s, zone C/D boundary 4.5 mm/s."}),
]

# Another tenant's records in the shared index (frontend rag.ts OTHER_TENANT) — must never be returned to Acme users.
BOREALIS_CHUNKS = [
    ("bf-x-2", "doc_bf_hb", 3, "Borealis drivers take a mandatory break every 3 h.", "Module", ["transportation"], "internal", "Borealis_Driver_Rules.pdf"),
    ("bf-x-3", "doc_bf_q", 1, "Nordfrost quotation to Borealis Foods: impeller kit USD 6,900; compressor maintenance included.", "Module", ["procurement"], "financial", "Borealis_Quote_Nordfrost.pdf"),
    ("bf-x-4", "doc_bf_sop", 1, "Borealis reefer SOP: TRK-88 style compressor faults are logged by the Oslo depot; dairy at or below 4 °C.", "Company", [], "internal", "Borealis_Reefer_SOP.pdf"),
]

RULES = [
    {"id": "RULE-COLD-01", "label": "Cold-Chain Dairy Compliance", "severity": "CRITICAL", "active": True, "source": "seed",
     "text": "Flag any dairy batch whose temperature exceeds its safe maximum", "table": "inventory",
     "conditions": [{"field": "category", "op": "=", "value": "Dairy"}, {"field": "current_temp", "op": ">", "field_ref": "max_safe_temp"}]},
    {"id": "RULE-EXP-01", "label": "Expiry — critical window", "severity": "CRITICAL", "active": True, "source": "seed",
     "text": "Flag lots expiring within the critical window", "table": "inventory",
     "conditions": [{"field": "days_remaining", "op": "<=", "param": "critical_days"}]},
    {"id": "RULE-EXP-02", "label": "Expiry — warning window", "severity": "WARNING", "active": True, "source": "seed",
     "text": "Flag lots expiring within the warning window", "table": "inventory",
     "conditions": [{"field": "days_remaining", "op": "<=", "param": "warning_days"}, {"field": "days_remaining", "op": ">", "param": "critical_days"}]},
]

# ---------------------------------------------------------------- helpers

_LATIN1 = {"—": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "≥": ">=", "≤": "<=", "→": "->", "·": "-", "…": "..."}


def latin1(text: str) -> str:
    for k, v in _LATIN1.items():
        text = text.replace(k, v)
    return text.encode("latin-1", "replace").decode("latin-1")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def minutes_ago(now: datetime, m: float) -> str:
    return iso(now - timedelta(minutes=m))


def write_pdf(path: Path, title: str, pages: dict[int, str]) -> None:
    """One PDF page per page number; missing pages get a one-line header so citations stay page-exact."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=False)
    for n in range(1, max(pages) + 1):
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 10, latin1(f"{title} - page {n}"), new_x="LMARGIN", new_y="NEXT")
        if n in pages:
            pdf.set_font("Helvetica", "", 11)
            pdf.multi_cell(0, 6, latin1(pages[n]))
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(path))


def write_docs(docs_dir: Path) -> list[Path]:
    out = []
    for name, _size, _cat, _vis, _mod, _cls, pages in DOCS:
        p = docs_dir / name
        write_pdf(p, name.removesuffix(".pdf").replace("_", " "), pages)
        out.append(p)
    return out


def write_rules(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(RULES, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- seed


def seed_data(today: date | None = None) -> None:
    """Insert every demo row. Assumes empty tables (call after drop/init)."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    today = today or now.date()
    created = iso(now - timedelta(days=30))
    t = DEMO_TENANT

    db.insert("companies", {"id": t, "name": "Acme Process Industries", "industry": "Process manufacturing", "size": "1,000–5,000",
                            "locations": ["Plant A · Rotterdam", "DC-C2 · Central Park"],
                            "context": "Continuous cooling-water and compression loops; unplanned trips cost ≈ $25k/h.",
                            "enabled_modules": ALL_MODULES, "created_at": created, "origin": "demo"})
    db.insert("companies", {"id": BOREALIS, "name": "Borealis Foods", "industry": "Food distribution", "size": "200–1,000",
                            "locations": ["Oslo"], "context": "Second tenant in the shared index (isolation demo).",
                            "enabled_modules": ALL_MODULES, "created_at": created, "origin": "demo"})

    for uid, email, name, pw, roles, status in USERS:
        digest, salt = hash_password(pw)
        db.insert("users", {"id": uid, "email": email, "name": name, "password_hash": digest, "salt": salt, "created_at": created})
        db.insert("memberships", {"tenant_id": t, "user_id": uid, "roles": roles, "grants": [], "status": status})

    for code, roles in DEMO_INVITES:
        db.insert("invites", {"code": code, "tenant_id": t, "roles": roles, "created_by": "Alex Moreno (Owner)", "created_at": created,
                              "expires_at": iso(now + timedelta(days=365)), "seat_user_id": None, "used_by": None})

    eta = next(g for g in GOLD_DATASETS if g[1] == "gold.shipments_eta")
    for (sid, cust, org, dest, addr, win, eta_s, drv, drv_name, vehicle, pallets, kg, handling, status, stop, batch) in SHIPMENTS:
        vid, _, desc = vehicle.partition(" · ")
        db.insert("shipments", {"tenant_id": t, "shipment_id": sid, "batch_id": batch, "customer": cust, "origin": org, "destination": dest,
                                "address": addr, "delivery_window": win, "eta": eta_s, "eta_as_of": eta[9], "eta_stale": eta[10],
                                "vehicle_id": None if vid == "—" else vid, "vehicle_desc": desc or None, "driver_id": drv,
                                "driver_name": drv_name, "pallets": pallets, "weight_kg": kg, "handling": handling, "status": status,
                                "stop_order": stop})
    db.insert("shipments", {"tenant_id": BOREALIS, "shipment_id": "BF-2201", "batch_id": None, "customer": "Borealis Foods",
                            "origin": "Oslo", "destination": "Rotterdam", "address": "Oslo terminal", "delivery_window": "06:00–08:00",
                            "eta": "07:40", "eta_as_of": "14:20", "eta_stale": False, "vehicle_id": "TRK-88", "vehicle_desc": None,
                            "driver_id": "usr_jlee", "driver_name": "Borealis driver", "pallets": 22, "weight_kg": 9000,
                            "handling": "Chilled", "status": "In transit", "stop_order": 1})

    for (lid, sku, product, batch, facility, qty, unit, value, days, storage, cat, sup, est) in LOTS:
        cur, mx = STORAGE_TEMPS[storage]
        db.insert("inventory", {"tenant_id": t, "batch_id": lid, "sku": sku, "product_name": product, "category": cat,
                                "warehouse_id": facility, "qty": qty, "unit": unit, "unit_value": value,
                                "expiry_date": today + timedelta(days=days), "storage_days": 5, "current_temp": cur,
                                "max_safe_temp": mx, "storage_class": storage, "supplier_id": sup, "valuation_estimated": est,
                                "lot_batch": batch})
    for (bid, sku, product, cat, wh, sdays, temp, mx, qty, unit, value, exp_days, storage) in GOLDEN_INVENTORY:
        db.insert("inventory", {"tenant_id": t, "batch_id": bid, "sku": sku, "product_name": product, "category": cat,
                                "warehouse_id": wh, "qty": qty, "unit": unit, "unit_value": value,
                                "expiry_date": today + timedelta(days=exp_days), "storage_days": sdays, "current_temp": temp,
                                "max_safe_temp": mx, "storage_class": storage, "supplier_id": None, "valuation_estimated": False,
                                "lot_batch": bid})

    # Telemetry: TRK-88 / B-104 every 30 min 10:00–18:00 UTC yesterday, compressor fault spike at 14:15.
    y = datetime.combine(today - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    before = [3.5, 3.6, 3.7, 3.6, 3.8, 3.9, 3.7, 3.8, 3.9]  # 10:00 … 14:00
    after = [8.0, 8.3, 8.4, 8.1, 7.9, 7.8, 7.7, 7.6]       # 14:30 … 18:00
    readings = [(y.replace(hour=10) + timedelta(minutes=30 * i), v, "reading") for i, v in enumerate(before)]
    readings.append((y.replace(hour=14, minute=15), 8.2, "compressor_fault"))
    readings += [(y.replace(hour=14, minute=30) + timedelta(minutes=30 * i), v, "reading") for i, v in enumerate(after)]
    for ts, v, ev in readings:
        db.insert("telemetry", {"tenant_id": t, "vehicle_id": "TRK-88", "batch_id": "B-104", "ts": iso(ts), "temp_c": v, "event": ev})
    for i, v in enumerate([3.2, 3.1, 3.3, 3.0, 3.1]):
        db.insert("telemetry", {"tenant_id": t, "vehicle_id": "TRK-12", "batch_id": "B-101", "ts": iso(y.replace(hour=6) + timedelta(minutes=30 * i)), "temp_c": v, "event": "reading"})

    for sid, name, cat, otif, rating, contract in SUPPLIERS:
        db.insert("suppliers", {"tenant_id": t, "supplier_id": sid, "name": name, "category": cat, "otif": otif, "rating": rating, "contract": contract})
    for (qid, rfq, sup, item, qty, price, cur, lead, valid, terms, status, doc, page) in QUOTATIONS:
        db.insert("quotations", {"tenant_id": t, "quote_id": qid, "rfq": rfq, "supplier_id": sup, "item": item, "qty": qty, "unit_price": price,
                                 "currency": cur, "lead_time_days": lead, "valid_until": valid, "terms": terms, "status": status,
                                 "document": doc, "page": page})

    for c in CONNECTORS:
        db.insert("sources", {"tenant_id": t, "warning": None, **c})
    feed_as_of = minutes_ago(now, 6)
    for (gid, name, srcs, mods, task, fresh, q, tone, ver, as_of, stale) in GOLD_DATASETS:
        if name == "gold.lot_expiry":
            as_of = (now - timedelta(minutes=6)).strftime("%H:%M")
        db.insert("gold_datasets", {"tenant_id": t, "id": gid, "name": name, "sources": srcs, "modules": mods, "task": task,
                                    "freshness": fresh, "quality": q, "tone": tone, "version": ver, "as_of": as_of, "stale": stale})

    day = today.isoformat()
    for aid, tm, tone, actor, action, detail, res in SEED_AUDIT:
        db.insert("audit_events", {"id": aid, "tenant_id": t, "time": tm, "tone": tone, "actor": actor, "action": action,
                                   "detail": detail, "resource": res, "at": f"{day}T{tm}.000Z"})
    db.insert("security_events", {"id": "inc_seed_1", "tenant_id": t, "at": f"{day}T12:14:47.000Z", "user_id": "usr_jlee",
                                  "user_name": "Jordan Lee", "roles": ["truck_driver"], "requested_resource": "procurement",
                                  "query": "open purchase orders for Hydraflow", "decision": "DENY", "stage": "pre-retrieval",
                                  "reason": "No read_records / query_ai grant on Procurement", "chunks_retrieved": 0, "sent_to_model": False})

    # Expiry Guard state
    history = [
        {"version": 3, "at": minutes_ago(now, 26 * 60), "by": "alex.moreno", "change": "Warning window 14 → 21 days"},
        {"version": 2, "at": minutes_ago(now, 9 * 24 * 60), "by": "alex.moreno", "change": "Markdown cap set to 30%"},
        {"version": 1, "at": minutes_ago(now, 30 * 24 * 60), "by": "system", "change": "Initial rules: critical 7 d, warning 14 d, scan every 15 min"},
    ]
    for tenant in (t, BOREALIS):
        db.insert("expiry_rules", {"tenant_id": tenant, "version": 3, "critical_days": 7, "warning_days": 21, "scan_minutes": 15,
                                   "markdown_max_pct": 30, "min_confidence": 0.6, "updated_at": minutes_ago(now, 26 * 60),
                                   "updated_by": "alex.moreno", "history": history if tenant == t else [],
                                   "feed_dataset": "gold.lot_expiry", "feed_version": "v318", "feed_as_of": feed_as_of,
                                   "feed_stale": False, "feed_sources": ["wms", "erp"]})
    for (aid, kind, lot, title, rationale, value, conf, ext, route, policy) in ACTIONS:
        db.insert("expiry_actions", {"id": aid, "tenant_id": t, "kind": kind, "lot_id": lot, "title": title, "rationale": rationale,
                                     "value_protected": value, "confidence": conf, "external": ext, "route": route, "status": "proposed",
                                     "decided_by": None, "decided_at": None, "policy": policy, "created_at": created})
    for rid, mins, status, rej, risk, dur, ver in [("RUN-1042", 4, "partial", 2, 7, 840, "v318"), ("RUN-1041", 19, "partial", 2, 7, 812, "v317"), ("RUN-1040", 34, "ok", 0, 6, 790, "v316")]:
        db.insert("audit_runs", {"id": rid, "tenant_id": t, "kind": "expiry", "at": minutes_ago(now, mins), "trigger": "schedule",
                                 "status": status, "rules_evaluated": 2, "violations": [], "lots_scanned": 12, "rows_rejected": rej,
                                 "at_risk": risk, "rule_version": 3, "source_version": f"gold.lot_expiry@{ver}", "duration_ms": dur})
    for cid, name, status, detail in FEED_CHECKS:
        db.insert("feed_checks", {"tenant_id": t, "id": cid, "name": name, "status": status, "detail": detail})
    for row, fld, val, err in FEED_REJECTED:
        db.insert("feed_rejected", {"tenant_id": t, "row_ref": row, "field": fld, "value": val, "error": err})

    # Rules registry (DB) — mirrored to rules.json by the audit engine.
    for r in RULES:
        db.insert("audit_rules", {"id": r["id"], "tenant_id": t, "label": r["label"], "severity": r["severity"], "active": r["active"],
                                  "source": r["source"], "text": r["text"], "table_name": r["table"], "conditions": r["conditions"],
                                  "created_by": "system", "created_at": created, "version": 1})

    # Documents (chunks are produced by the RAG ingest on API start-up or by `ingest_all` below).
    idx = f"idx-{today.isoformat()}"
    for i, (name, size, cat, vis, mod, cls, _pages) in enumerate(DOCS, start=1):
        db.insert("documents", {"id": f"doc_{i:02d}", "tenant_id": t, "name": name, "size_kb": size, "category": cat, "visibility": vis,
                                "module": mod, "status": "indexed", "progress": 100, "chunks": 0,
                                "path": str(s.docs_path / name), "index_version": idx, "updated_at": iso(now), "error": None,
                                "classification": cls})
    for cid, doc, page, text, vis, mods, cls, src in BOREALIS_CHUNKS:
        db.insert("chunks", {"id": cid, "tenant_id": BOREALIS, "document_id": doc, "page": page, "text": text, "visibility": vis,
                             "modules": mods, "roles": ["*"], "classification": cls, "updated_at": iso(now), "source": src})


def seed(reset: bool = False, write_files: bool = True) -> bool:
    """Create schema + data. Returns True when data was (re)inserted."""
    s = get_settings()
    conn = db.connect()
    if reset:
        db.drop_all(conn)
    db.init_schema(conn)
    if write_files:
        write_docs(s.docs_path)
        if reset or not s.rules_file.exists():
            write_rules(s.rules_file)
    if not db.is_empty():
        return False
    with db.LOCK:
        conn.execute("BEGIN TRANSACTION")
        try:
            seed_data()
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Seed the NEXUS demo database, PDFs and rules.json")
    ap.add_argument("--reset", action="store_true", help="drop all tables and rebuild")
    args = ap.parse_args(argv)
    s = get_settings()
    changed = seed(reset=args.reset)
    from backend import rag_engine

    n = rag_engine.ingest_all()
    counts = {t: db.scalar(f"SELECT count(*) FROM {t} WHERE tenant_id = ?", [DEMO_TENANT])
              for t in ("shipments", "inventory", "telemetry", "suppliers", "quotations", "documents", "chunks", "audit_rules")}
    pdfs = sorted(p.name for p in s.docs_path.glob("*.pdf"))
    print(f"[{'OK' if changed else 'SKIP'}] {'seeded' if changed else 'already seeded (use --reset to rebuild)'}: {s.db_file}")
    print(f"      rows: {counts}  · chunks ingested now: {n}")
    print(f"      {len(pdfs)} PDFs in {s.docs_path}")
    print(f"      rules: {s.rules_file}")
    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
