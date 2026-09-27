# Design System Master File — NEXUS Ops Cockpit

> **LOGIC:** When building a specific page, first check `design-system/nexus-ops-cockpit/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise follow the rules below.

**Generated with** the installed UI/UX Pro Max skill (`.claude/skills/ui-ux-pro-max`, upstream `09170ee`), then
**curated**: only results verified to fit a dark, role-based B2B operations app were kept (the skill's Query Contract —
"verify fit, retry once, never persist unverified output").

| Decision | Source command | Verdict |
|---|---|---|
| Style: **Minimalism & Swiss Style** | `search.py "logistics supply chain operations dashboard" --design-system --variance 5 --motion 3 --density 7` | ✅ kept (enterprise dashboards, low a11y risk) |
| Style (1st try): Glassmorphism | `search.py "industrial operations control center enterprise dashboard dark" --design-system …` | ❌ rejected — conflicts with brief ("no excessive glassmorphism") |
| Product profile: Logistics/Delivery → Swiss + Flat, secondary Dark Mode + micro-interactions, *Real-Time Monitoring* dashboard | `search.py "supply chain logistics operations platform" --domain product` | ✅ kept |
| Palette: **"Dark tech + status green"** (Smart Home/IoT Dashboard profile) | `search.py "dark operations monitoring status" --domain color` | ✅ kept, accent swapped to NVIDIA green (brand) |
| Palette (design-system default): light "Tracking blue + delivery orange" | `--design-system` output | ❌ rejected — product is dark-only |
| Typography: **Fira Sans (UI) + Fira Code (data)** — "Dashboard Data" pairing | `search.py "industrial technical dashboard precise" --domain typography` | ✅ kept, self-hosted via @fontsource (no CDN) |
| Data-dense style for technical views | `search.py "data-dense dashboard dark enterprise" --domain style` | ✅ kept for Data Architect page |
| Topology chart guidance (Network Graph, SVG ≤100 nodes, adjacency list fallback) | `search.py "network topology hub nodes status" --domain chart` | ✅ kept |
| Chat/assistant patterns | `search.py "chat assistant conversation panel" --domain ux` → 0 results; retry `"chatbot message input" --domain ux` | ⚠️ no verified match — general `ux` rules applied as **fallback** (visible input label, loading/empty/error states, aria-live, focus not obscured) |

## Tokens (three layers, `src/index.css`)

**Primitive** (raw values, never used directly in components)

| Group | Values |
|---|---|
| Graphite/navy | `#080C12` (base) · `#0B1119` (deck) · `#0E1520` (surface) · `#141D2B` (raised) · `#172131` (overlay) · `#1C2636` (hairline) · `#5E6E85` (control line) |
| Text | `#F1F5F9` · `#CBD5E1` · `#94A3B8` · `#8494AA` |
| Brand / status | NVIDIA `#76B900` / `#9BD62B` · cyan `#22D3EE` · amber `#F5B53D` · red `#F87171` / `#FCA5A5` · ring `#D9F99D` |

**Semantic** — `--color-bg`, `--color-deck`, `--color-surface`, `--color-raised`, `--color-overlay`, `--color-line`, `--color-line-control`,
`--color-fg`, `--color-fg-2`, `--color-muted`, `--color-faint`, `--color-accent` (NVIDIA green = compute/system state + primary CTA only),
`--color-ok`, `--color-info` (cyan = live/informational), `--color-warn` (amber), `--color-crit` (red), `--color-ring`.

**Component** — `--panel-*`, `--control-*`, `--tab-*`, `--chip-*`, `--node-*` (system map), `--dock-*` (assistant).

### Verified contrast (WCAG 2.2, computed)
- All text tokens ≥ **5.24:1** on every surface (`--color-faint` on overlay is the minimum); body text ≥ 12:1.
- Control boundaries `#5E6E85` ≥ **3.26:1** vs raised surfaces (non-text 3:1).
- White on red-500 = 3.76:1 ✗ → critical fills use dark text (`#1A0505` on `#F87171` = 7.11:1) or tinted fills with `#FCA5A5` text.
- Never use slate-500/600 for text (fails 4.5:1 on dark surfaces).

### Scale
- **Type (px):** 11 (mono uppercase eyebrow only) · 12 · 13 · 14 (UI body) · 16 · 18 · 22 (page title) · 28 (KPI) — tabular figures for all numbers.
- **Spacing:** 4-pt grid — 4 · 8 · 12 · 16 · 20 · 24 · 32 (density 7 default; Data Architect = 9).
- **Radius:** `sm` 4 (chips, badges) · `md` 6 (buttons, inputs, tabs) · `lg` 8 (panels, cards) · `xl` 12 (drawer, dock, dialogs) · `full` (dots, avatars). Nothing else.
- **Elevation (dark):** flat panels (1px hairline, no shadow) · overlays get `--shadow-overlay` + scrim. Depth comes from surface steps, not glow.
- **Motion:** `--dur-fast` 120ms (press/hover) · `--dur-base` 200ms (state) · `--dur-enter` 280ms / exit ≈ 65% · decelerate on enter, accelerate on exit · transform/opacity only · `prefers-reduced-motion` renders the final state.
- **Z-index:** content 0 · sticky header 40 · sidebar 30 · dock 45 · drawer 50 · dialog/palette 70 · toast 75.

## Global rules (from the skill's priority table, applied)
1. **Accessibility:** visible 2px focus ring (`--color-ring`) on every control; tabs follow the WAI-ARIA tabs pattern (roving tabindex, ←/→/Home/End); drawers/dialogs trap focus, close on Esc, return focus; icon-only buttons have accessible names; status never by color alone (icon + text).
2. **Interaction:** one primary CTA per view; `cursor-pointer`; ≥24×24 CSS px targets (44px on touch layouts); loading → disabled + spinner.
3. **Layout:** no horizontal scroll at 375px; ≤ 1 viewport per tab at 1080p/125% zoom with 2–3 primary sections; secondary detail in drawers/accordions/tooltips.
4. **Live data honesty:** label data "live" only with an update time; show stale state explicitly; tickers get a pause control; simulated/architecture-target integrations are always labelled.
5. **Charts:** legend + text summary; health rings pair color with icon/label; system map offers an accessible list view.
6. **Focus not obscured:** the docked assistant reserves space (`scroll-padding-bottom`) and never overlaps primary actions.

## Anti-patterns (do not use)
- Emoji icons · mixed icon families (Lucide only) · random gradients · heavy glassmorphism/blur as decoration · AI purple/pink gradients
- Huge hero copy inside the app · long explanatory paragraphs (use chips, cards, tooltips)
- Fake metrics or "live" labels on mock data · white text on red fills · inconsistent radii · layout-shifting hover transforms

## v2 overhaul — "Deep Obsidian & Industrial Hardware" (supersedes the palette above)

Style-only change: tokens, CSS and class names. No logic, state, routing, data-model or API changes.

| Token | Value | Use |
|---|---|---|
| canvas | `#080B10` | App background |
| surface (E1) | `#0E141E` + 1px `rgba(255,255,255,.07)` + inset top highlight | Cards, panels, dock |
| raised (E2) | `#151E2D` + 1px `rgba(255,255,255,.12)` | Hover, nested wells |
| deck (inputs) | `#0A0F17` + 1px `rgba(255,255,255,.10)`, 1px accent focus glow | Inputs, selects |
| terminal | `#040608` | Audit / activity stdout wells, JSON |
| accent | `#76B900` → hover `#88D400`, text on accent `#080B10` bold | Primary triggers, verified states |
| info (telemetry) | `#38BDF8` | Data streams, citations, metadata |
| crit | `#EF4444` · bg `#2A1215` · line `#7F1D1D` · text `#FCA5A5` | Critical alerts |
| warn | `#F59E0B` · bg `#261A08` · line `#78350F` · text `#FCD34D` | Warnings |
| text | high `#F8FAFC` · muted `#94A3B8` · subdued `#475569` (decorative only) | Typography |

- Fonts: Inter (UI) and JetBrains Mono (numbers, IDs, timestamps, badges, code).
- Headers use −0.02em tracking; metadata tags and table headers use 0.05em uppercase.
- Radii: 4px controls and badges, 6px panels, 8px maximum. Round shapes are only used for live-status pings and map nodes.
- No glows or blur. Tables use compact rows, zebra stripes and tabular numerals.
