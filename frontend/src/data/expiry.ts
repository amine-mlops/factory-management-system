/**
 * Perishable Expiry Guard — deterministic MOCK data (no live backend).
 * Expiry dates are seeded relative to "today" so the demo stays meaningful on
 * any date; everything here is labelled "simulated" in the UI.
 */

export type StorageClass = 'Ambient' | 'Chilled' | 'Frozen'

export interface Lot {
  id: string
  sku: string
  product: string
  batch: string
  facility: string
  qty: number
  unit: string
  /** USD per unit (ERP valuation join). */
  unitValue: number
  /** ISO date (YYYY-MM-DD, UTC). */
  expiry: string
  storage: StorageClass
  /** Supplier that can take the lot back (only for purchased materials). */
  supplierId?: string
  /** Valued from last cost because the ERP join missed (validation warning). */
  valuationEstimated?: boolean
}

export type ActionKind = 'fefo' | 'dispatch' | 'markdown' | 'quarantine' | 'donation' | 'supplier_return'
export type ActionStatus = 'proposed' | 'approved' | 'dismissed'

export interface ExpiryAction {
  id: string
  kind: ActionKind
  lotId: string
  title: string
  rationale: string
  /** USD protected or recovered if approved (estimate). */
  valueProtected: number
  confidence: number
  /** Involves a customer, supplier or partner — never executed without human approval. */
  external: boolean
  /** Which workspace owns the approval (supplier returns route to Procurement). */
  route: 'inventory' | 'procurement'
  status: ActionStatus
  decidedBy?: string
  decidedAt?: string
  /** Policy pages the rationale relies on. */
  policy: Array<{ document: string; page: number }>
}

export interface ExpiryRules {
  version: number
  criticalDays: number
  warningDays: number
  scanMinutes: number
  markdownMaxPct: number
  minConfidence: number
  updatedAt: string
  updatedBy: string
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface FeedCheck {
  id: string
  name: string
  status: CheckStatus
  detail: string
}

export interface ExpiryRun {
  id: string
  at: string
  status: 'ok' | 'partial' | 'failed'
  lotsScanned: number
  rowsRejected: number
  atRisk: number
  ruleVersion: number
  durationMs: number
  sourceVersion: string
  trigger: 'schedule' | 'manual' | 'rule change'
}

export interface ExpiryFeed {
  dataset: string
  version: string
  sources: string[]
  asOf: string
  stale: boolean
  checks: FeedCheck[]
  /** Rows quarantined in Silver (metadata only — values shown to data roles are the offending field). */
  rejected: Array<{ row: string; field: string; value: string; error: string }>
}

export interface ExpiryState {
  rules: ExpiryRules
  lots: Lot[]
  actions: ExpiryAction[]
  runs: ExpiryRun[]
  feed: ExpiryFeed
  ruleHistory: Array<{ version: number; at: string; by: string; change: string }>
}

export const FEFO_POLICY = 'Shelf_Life_and_FEFO_Policy_2026.pdf'

const DAY = 86_400_000

export function isoDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)
}

const inDays = (now: Date, n: number) => isoDay(new Date(now.getTime() + n * DAY))
const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000).toISOString()

const LOTS: Array<Omit<Lot, 'expiry'> & { days: number }> = [
  { id: 'LOT-24811', sku: 'EZ-12-20', product: 'Enzyme concentrate EZ-12 · 20 kg pail', batch: 'B2408-17', facility: 'Cold store CS-1', qty: 36, unit: 'pails', unitValue: 410, days: 3, storage: 'Chilled' },
  { id: 'LOT-24790', sku: 'SC-3-FZ', product: 'Starter culture SC-3 · 500 g frozen', batch: 'B2407-02', facility: 'Cold store CS-1', qty: 120, unit: 'packs', unitValue: 58, days: 6, storage: 'Frozen' },
  { id: 'LOT-24756', sku: 'EPX-2K-KIT', product: 'Two-part epoxy repair kit', batch: 'E-5531', facility: 'Plant A · MRO store', qty: 14, unit: 'kits', unitValue: 145, days: -2, storage: 'Ambient' },
  { id: 'LOT-24833', sku: 'PX-150-25', product: 'Pectin powder PX-150 · 25 kg bag', batch: 'B2409-08', facility: 'DC-C2 · Central Park', qty: 30, unit: 'bags', unitValue: 75, days: 8, storage: 'Ambient' },
  { id: 'LOT-24802', sku: 'GS-80-IBC', product: 'Glucose syrup GS-80 · 1,000 kg IBC', batch: 'B2409-05', facility: 'DC-C2 · Central Park', qty: 6, unit: 'IBCs', unitValue: 1150, days: 11, storage: 'Ambient' },
  { id: 'LOT-24733', sku: 'WT-220-25', product: 'Water-treatment biocide WT-220 · 25 kg drum', batch: 'WT-8812', facility: 'Plant A · Utilities', qty: 18, unit: 'drums', unitValue: 96, days: 13, storage: 'Ambient', valuationEstimated: true },
  { id: 'LOT-24769', sku: 'ORK-NBR70', product: 'O-ring kit NBR-70 (ISO 2230 shelf life)', batch: 'MS-24-118', facility: 'Plant A · MRO store', qty: 40, unit: 'kits', unitValue: 62, days: 19, storage: 'Ambient', supplierId: 'sup_meridian' },
  { id: 'LOT-24799', sku: 'RGT-WA-KIT', product: 'Water-analysis reagent kit', batch: 'RG-1190', facility: 'Plant A · Lab', qty: 8, unit: 'kits', unitValue: 180, days: 27, storage: 'Chilled' },
  { id: 'LOT-24840', sku: 'GS-80-IBC', product: 'Glucose syrup GS-80 · 1,000 kg IBC', batch: 'B2409-26', facility: 'DC-C2 · Central Park', qty: 4, unit: 'IBCs', unitValue: 1150, days: 58, storage: 'Ambient' },
  { id: 'LOT-24818', sku: 'CM-40-FG', product: 'Coolant concentrate CM-40 · 20 L', batch: 'B2409-21', facility: 'DC-C2 · Central Park', qty: 210, unit: 'cans', unitValue: 38, days: 45, storage: 'Ambient' },
  { id: 'LOT-24744', sku: 'LUB-H1-400', product: 'Food-grade lubricant H1 · 400 g', batch: 'NL-7731', facility: 'Plant A · MRO store', qty: 96, unit: 'cartridges', unitValue: 14, days: 64, storage: 'Ambient' },
  { id: 'LOT-24825', sku: 'CIT-50-DR', product: 'Citric acid solution 50% · 200 L drum', batch: 'B2409-30', facility: 'DC-C2 · Central Park', qty: 24, unit: 'drums', unitValue: 210, days: 120, storage: 'Ambient' },
]

const P = (page: number) => ({ document: FEFO_POLICY, page })

const ACTIONS: ExpiryAction[] = [
  {
    id: 'ACT-1041',
    kind: 'dispatch',
    lotId: 'LOT-24811',
    title: 'Ship 36 pails of EZ-12 with today’s Atlas Foods delivery (SHP-88341)',
    rationale: 'Shortest-dated chilled lot. SHP-88341 to Atlas Foods (food-grade customer) leaves today, well inside the remaining shelf life; the customer must confirm the add-on.',
    valueProtected: 14_760,
    confidence: 0.86,
    external: true,
    route: 'inventory',
    status: 'proposed',
    policy: [P(2), P(6)],
  },
  {
    id: 'ACT-1042',
    kind: 'markdown',
    lotId: 'LOT-24790',
    title: 'Offer 120 packs of SC-3 on the secondary channel at 25% markdown',
    rationale: 'Frozen culture with 6 days left and no scheduled shipment that includes it; a 25% markdown stays inside the 30% cap.',
    valueProtected: 5_220,
    confidence: 0.71,
    external: true,
    route: 'inventory',
    status: 'proposed',
    policy: [P(3), P(6)],
  },
  {
    id: 'ACT-1043',
    kind: 'quarantine',
    lotId: 'LOT-24756',
    title: 'Quarantine 14 expired epoxy kits and block issue to work orders',
    rationale: 'The lot expired 2 days ago; expired material may not be issued. Quarantine prevents use in open repair work orders.',
    valueProtected: 0,
    confidence: 0.97,
    external: false,
    route: 'inventory',
    status: 'proposed',
    policy: [P(3)],
  },
  {
    id: 'ACT-1044',
    kind: 'donation',
    lotId: 'LOT-24833',
    title: 'Donate 30 bags of pectin PX-150 to the regional food-bank partner',
    rationale: 'Food-grade ingredient with 8 days left and no scheduled shipment that includes it; donating avoids disposal.',
    valueProtected: 450,
    confidence: 0.68,
    external: true,
    route: 'inventory',
    status: 'proposed',
    policy: [P(3), P(6)],
  },
  {
    id: 'ACT-1045',
    kind: 'fefo',
    lotId: 'LOT-24802',
    title: 'FEFO: pick GS-80 lot B2409-05 before newer lots for this week’s production orders',
    rationale: 'Two GS-80 lots are in stock at DC-C2; picking the earlier-expiring lot first uses it before the newer lot.',
    valueProtected: 6_900,
    confidence: 0.91,
    external: false,
    route: 'inventory',
    status: 'proposed',
    policy: [P(2)],
  },
  {
    id: 'ACT-1046',
    kind: 'fefo',
    lotId: 'LOT-24733',
    title: 'Reallocate WT-220 biocide to Cooling Loop 2 dosing first',
    rationale: 'Cooling Loop 2 is the main WT-220 consumer; dosing it from this lot first uses the oldest drums before they expire.',
    valueProtected: 1_728,
    confidence: 0.88,
    external: false,
    route: 'inventory',
    status: 'proposed',
    policy: [P(2)],
  },
  {
    id: 'ACT-1047',
    kind: 'supplier_return',
    lotId: 'LOT-24769',
    title: 'Return 40 O-ring kits to Meridian Seals under MSA-2024-031',
    rationale: '19 days of shelf life remain (policy requires ≥ 18) and the supplier agreement allows returns; estimated credit is net of a 10% restocking fee.',
    valueProtected: 2_232,
    confidence: 0.64,
    external: true,
    route: 'procurement',
    status: 'proposed',
    policy: [P(5), P(6)],
  },
]

export function seedExpiry(now: Date = new Date()): ExpiryState {
  const lots: Lot[] = LOTS.map(({ days, ...l }) => ({ ...l, expiry: inDays(now, days) }))
  return {
    rules: { version: 3, criticalDays: 7, warningDays: 21, scanMinutes: 15, markdownMaxPct: 30, minConfidence: 0.6, updatedAt: minutesAgo(now, 26 * 60), updatedBy: 'alex.moreno' },
    lots,
    actions: ACTIONS.map((a) => ({ ...a, policy: [...a.policy] })),
    runs: [
      { id: 'RUN-1042', at: minutesAgo(now, 4), status: 'partial', lotsScanned: 12, rowsRejected: 2, atRisk: 7, ruleVersion: 3, durationMs: 840, sourceVersion: 'gold.lot_expiry@v318', trigger: 'schedule' },
      { id: 'RUN-1041', at: minutesAgo(now, 19), status: 'partial', lotsScanned: 12, rowsRejected: 2, atRisk: 7, ruleVersion: 3, durationMs: 812, sourceVersion: 'gold.lot_expiry@v317', trigger: 'schedule' },
      { id: 'RUN-1040', at: minutesAgo(now, 34), status: 'ok', lotsScanned: 12, rowsRejected: 0, atRisk: 6, ruleVersion: 3, durationMs: 790, sourceVersion: 'gold.lot_expiry@v316', trigger: 'schedule' },
    ],
    feed: {
      dataset: 'gold.lot_expiry',
      version: 'v318',
      sources: ['wms', 'erp'],
      asOf: minutesAgo(now, 6),
      stale: false,
      checks: [
        { id: 'fresh', name: 'Freshness ≤ 30 min', status: 'pass', detail: 'Last load 6 min ago' },
        { id: 'schema', name: 'Schema contract lot_expiry v2', status: 'pass', detail: 'All required columns present' },
        { id: 'date', name: 'expiry_date is a valid ISO date', status: 'fail', detail: '2 rows rejected and quarantined in Silver' },
        { id: 'qty', name: 'qty ≥ 0', status: 'pass', detail: '0 violations' },
        { id: 'facility', name: 'Facility code in master data', status: 'pass', detail: '0 unknown codes' },
        { id: 'value', name: 'Unit value joined from ERP', status: 'warn', detail: '1 lot valued from last cost (ERP join miss)' },
      ],
      rejected: [
        { row: 'wms_lots_0927.csv:88', field: 'expiry_date', value: '30/09/2026', error: 'dd/mm/yyyy format — contract expects YYYY-MM-DD' },
        { row: 'wms_lots_0927.csv:141', field: 'expiry_date', value: '2026-13-02', error: 'month 13 is not a valid date' },
      ],
    },
    ruleHistory: [
      { version: 3, at: minutesAgo(now, 26 * 60), by: 'alex.moreno', change: 'Warning window 14 → 21 days' },
      { version: 2, at: minutesAgo(now, 9 * 24 * 60), by: 'alex.moreno', change: 'Markdown cap set to 30%' },
      { version: 1, at: minutesAgo(now, 30 * 24 * 60), by: 'system', change: 'Initial rules: critical 7 d, warning 14 d, scan every 15 min' },
    ],
  }
}
