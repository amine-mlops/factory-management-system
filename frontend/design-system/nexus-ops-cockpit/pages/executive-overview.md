# Executive Overview (Owner / Manager) — Page Overrides

> Generated: `search.py "executive kpi overview dashboard" --design-system --density 6 --motion 3 --page executive-overview`, then curated.
> Rejected from generation: "Max width 800px, single column" (the system map needs width) → kept the density/clarity intent only.

## Overrides
- **Density:** 6 — executive level. KPI row (≤5 tiles) + system map + critical alerts + one recommended next action.
- **Content:** business impact only (on-time %, open exceptions, quotations awaiting decision, security incidents, pipeline freshness summary). **No raw telemetry, schema names or chunk counts.**
- **Map mode:** node status = one plain-language line ("2 shipments stale ETAs"); click → module or impact drawer.
- **Motion:** alert pulse on critical nodes only (reduced-motion: static ring). KPI values render immediately (no count-up delay).
- **Primary action:** exactly one "Recommended next action" card with a single CTA.
