# Data Architect — Page Overrides

> Generated: `search.py "data-dense pipeline monitoring dashboard" --design-system --density 9 --motion 2 --page data-architect`, then curated.
> Rejected from generation: marketing section order ("Hero > Solutions > Client Logos > Contact Sales") and "Contact Sales" CTA — not applicable to an app.

## Overrides
- **Density:** 9 — Data-Dense Dashboard style: 12-col grid, compact rows (36px), sticky table headers, monospace IDs/timestamps.
- **Content:** source lineage, Bronze → Silver → Gold stages, freshness vs SLA, last successful version, connector errors with fix, ACL/RAG metadata, incident evidence with timestamps.
- **Map mode:** technical diagnostics per node (datasets, freshness, error class, lineage); click → diagnostics drawer.
- **Color:** navy/grey corporate base, accents only for state (amber stale, red failed, cyan live).
- **Effects kept:** row highlight on hover, tooltips, loading indicators; pause on anything that auto-updates.
- **Permission rule:** can configure connections, never reads business records (shown explicitly).
