#!/usr/bin/env python3
"""Golden dataset seeder for the factory-management-system demo.

Recreates demo/supply_chain.duckdb (DROP + CREATE for idempotency) and writes
the two demo documents to demo/docs/:
  - workshop_log.pdf   Maintenance Incident Report (TRK-88 reefer compressor)
  - carrier_sop.pdf    Cold-chain carrier SOP

Run from repo root:  python demo/seed.py
Requires: duckdb (pip install duckdb fpdf2)
"""

import sys
from datetime import date, timedelta
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = Path(__file__).resolve().parent
DOCS_DIR = DEMO_DIR / "docs"
DB_PATH = DEMO_DIR / "supply_chain.duckdb"

INVENTORY_ROWS = [
    ("B-101", "Whole Milk 1L", "Dairy", "WH-NORTH", 2, 3.1, 4.0),
    ("B-104", "Greek Yogurt", "Dairy", "WH-TRANSIT", 4, 8.2, 4.0),
    ("B-202", "Frozen Salmon", "Seafood", "WH-COAST", 1, -18.5, -18.0),
]

SHIPMENT_ROWS = [
    ("SH-901", "B-101", "Casablanca", "Rabat", "TRK-12", "DRV-01", "DELIVERED"),
    ("SH-905", "B-104", "Casablanca", "Tangier", "TRK-88", "DRV-02", "DELAYED"),
]


def seed_database() -> None:
    """(Re)create the DuckDB golden dataset with exactly the spec rows."""
    con = duckdb.connect(str(DB_PATH))
    try:
        con.execute("DROP TABLE IF EXISTS shipments")
        con.execute("DROP TABLE IF EXISTS inventory")
        con.execute(
            """
            CREATE TABLE inventory (
                batch_id        VARCHAR,
                product_name    VARCHAR,
                category        VARCHAR,
                warehouse_id    VARCHAR,
                storage_days    INTEGER,
                current_temp    DOUBLE,
                max_safe_temp   DOUBLE
            )
            """
        )
        con.execute(
            """
            CREATE TABLE shipments (
                shipment_id  VARCHAR,
                batch_id     VARCHAR,
                origin       VARCHAR,
                destination  VARCHAR,
                vehicle_id   VARCHAR,
                driver_id    VARCHAR,
                status       VARCHAR
            )
            """
        )
        con.executemany("INSERT INTO inventory VALUES (?, ?, ?, ?, ?, ?, ?)", INVENTORY_ROWS)
        con.executemany("INSERT INTO shipments VALUES (?, ?, ?, ?, ?, ?, ?)", SHIPMENT_ROWS)
    finally:
        con.close()


def write_workshop_log(path: Path) -> None:
    """Maintenance Incident Report — Casablanca Fleet Depot (TRK-88)."""
    from fpdf import FPDF

    yesterday = (date.today() - timedelta(days=1)).strftime("%d %B %Y")

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "MAINTENANCE INCIDENT REPORT", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 8, "Casablanca Fleet Depot", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(50, 8, "Report date:")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 8, date.today().strftime("%d %B %Y"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(50, 8, "Facility:")
    pdf.cell(0, 8, "Casablanca Fleet Depot", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(50, 8, "Vehicle:")
    pdf.cell(0, 8, "TRK-88 (Thermo King refrigerated unit)", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(50, 8, "Reported by:")
    pdf.cell(0, 8, "Depot maintenance crew", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Inspection findings", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        f"Inspection performed {yesterday} at 09:30 following an in-transit temperature "
        "alarm on the reefer trailer. The Thermo King reefer compressor was examined "
        "and severe drive-belt wear was observed: glazing, cracking and reduced belt "
        "tension, consistent with overheating and intermittent loss of cooling "
        "capacity.",
    )
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Corrective action status", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Replacement drive belts are currently ON BACKORDER with the parts supplier. "
        "No repair is possible until the part arrives.",
    )
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Operational decision", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Vehicle TRK-88 has been CLEARED FOR SHORT-RUN SERVICE ONLY under a deferred "
        "maintenance notice. Long-haul dispatch is prohibited until the compressor "
        "drive belt is replaced and the reefer unit passes a full cool-down check. "
        "Any in-transit temperature excursion on this vehicle must be reported to "
        "fleet control immediately.",
    )

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(0, 6, f"Report ref: WKL-{date.today().strftime('%Y%m%d')}-TRK88", new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(path))


def write_carrier_sop(path: Path) -> None:
    """Short cold-chain carrier SOP."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "CARRIER SOP - COLD CHAIN HANDLING", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 8, "Standard Operating Procedure (excerpt)", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "1. Temperature requirements", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Dairy products must be stored at 4 degrees C or below at all times. "
        "Frozen goods must remain at their specified setpoint continuously. "
        "Drivers must verify reefer setpoint and return-air temperature before "
        "loading and at every rest stop.",
    )
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "2. Temperature excursions", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Any temperature excursion above 4 degrees C lasting more than 12 hours "
        "REQUIRES ESCALATION to fleet control and the quality department. The "
        "affected batch must be flagged and its temperature log retained.",
    )
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "3. Spoilage risk", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Spoilage risk DOUBLES after 24 hours of exposure above safe temperature. "
        "Batches approaching this threshold must be prioritised for inspection and "
        "disposition before further distribution.",
    )
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "4. Driver responsibilities", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(
        0,
        6,
        "Record reefer temperature readings at each checkpoint. Report alarms, "
        "equipment faults or delays affecting temperature control to fleet control "
        "without delay. Do not dispatch a vehicle with unresolved refrigeration "
        "faults on long-haul routes.",
    )

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(0, 6, f"Doc ref: SOP-CC-01 - Rev {date.today().strftime('%Y-%m')}", new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(path))


def main() -> int:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    seed_database()
    print(f"[OK] DuckDB seeded: {DB_PATH}")

    write_workshop_log(DOCS_DIR / "workshop_log.pdf")
    write_carrier_sop(DOCS_DIR / "carrier_sop.pdf")
    print(f"[OK] Wrote {DOCS_DIR / 'workshop_log.pdf'}")
    print(f"[OK] Wrote {DOCS_DIR / 'carrier_sop.pdf'}")

    # Verification pass: read everything back.
    con = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        inv = con.execute("SELECT * FROM inventory ORDER BY batch_id").fetchall()
        shp = con.execute("SELECT * FROM shipments ORDER BY shipment_id").fetchall()
        inv_cols = [d[0] for d in con.execute("SELECT * FROM inventory LIMIT 0").description]
        shp_cols = [d[0] for d in con.execute("SELECT * FROM shipments LIMIT 0").description]
    finally:
        con.close()

    print(f"\ninventory ({len(inv)} rows): {inv_cols}")
    for row in inv:
        print(f"  {row}")
    print(f"\nshipments ({len(shp)} rows): {shp_cols}")
    for row in shp:
        print(f"  {row}")

    assert inv == sorted(INVENTORY_ROWS), "inventory rows do not match spec"
    assert shp == sorted(SHIPMENT_ROWS), "shipments rows do not match spec"
    print("\n[OK] Golden dataset verified: all rows match the project spec exactly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
