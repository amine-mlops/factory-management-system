import { isoDay, type ActionKind, type ActionStatus, type ExpiryAction, type ExpiryRules, type ExpiryRun, type ExpiryState, type Lot } from '../data/expiry.ts'
import { can, type EffectivePermissions } from './access.ts'
import { auditEvent, goldWithExpiry, type Workspace } from './workspace.ts'

/**
 * Perishable Expiry Guard — pure logic shared by the Inventory workspace, the
 * ops model (map / alerts), the RAG corpus and the tests.
 *
 * It is a LOCAL SIMULATION of an autonomous observability agent: a scan reads
 * the Gold lot table, classifies each lot against the tenant's rules, and
 * proposes mitigations. Nothing is ever executed without a human decision, and
 * external actions (customers, suppliers, partners) are only "queued" here.
 */

export type Severity = 'healthy' | 'warning' | 'critical'

export interface LotRisk extends Lot {
  days: number
  severity: Severity
  value: number
  valueAtRisk: number
}

const DAY = 86_400_000

export const ACTION_META: Record<ActionKind, { label: string; short: string }> = {
  fefo: { label: 'FEFO reallocation', short: 'FEFO' },
  dispatch: { label: 'Prioritized dispatch', short: 'Dispatch' },
  markdown: { label: 'Controlled markdown', short: 'Markdown' },
  quarantine: { label: 'Quarantine', short: 'Quarantine' },
  donation: { label: 'Donation / secondary channel', short: 'Donation' },
  supplier_return: { label: 'Supplier return', short: 'Return' },
}

export function daysLeft(expiry: string, now: Date): number {
  return Math.round((Date.parse(expiry) - Date.parse(isoDay(now))) / DAY)
}

export function severityFor(days: number, rules: Pick<ExpiryRules, 'criticalDays' | 'warningDays'>): Severity {
  if (days <= rules.criticalDays) return 'critical'
  if (days <= rules.warningDays) return 'warning'
  return 'healthy'
}

/** Every lot with days remaining, severity and value at risk — soonest first. */
export function assessLots(state: ExpiryState, now: Date): LotRisk[] {
  return state.lots
    .map((l) => {
      const days = daysLeft(l.expiry, now)
      const severity = severityFor(days, state.rules)
      const value = l.qty * l.unitValue
      return { ...l, days, severity, value, valueAtRisk: severity === 'healthy' ? 0 : value }
    })
    .sort((a, b) => a.days - b.days || b.value - a.value)
}

export interface ExpirySummary {
  lots: number
  atRisk: number
  critical: number
  warning: number
  expired: number
  valueAtRisk: number
  criticalValue: number
  facilities: Array<{ facility: string; atRisk: number; critical: number; value: number }>
  lastRun: ExpiryRun | null
  nextScanAt: string | null
  proposed: number
  approved: number
  topAction: ExpiryAction | null
  /** Expiring-soon trend: lots per week of expiry, coloured by the worst severity inside the bucket. */
  weeks: Array<{ label: string; count: number; value: number; severity: Severity }>
  failingChecks: number
  warningChecks: number
}

const WEEKS: Array<[string, number, number]> = [
  ['Expired', -Infinity, -1],
  ['Wk 1', 0, 6],
  ['Wk 2', 7, 13],
  ['Wk 3', 14, 20],
  ['Wk 4', 21, 27],
  ['Wk 5', 28, 34],
  ['Wk 6', 35, 41],
]

export function summarize(state: ExpiryState, now: Date): ExpirySummary {
  const lots = assessLots(state, now)
  const risky = lots.filter((l) => l.severity !== 'healthy')
  const byFacility = new Map<string, { facility: string; atRisk: number; critical: number; value: number }>()
  for (const l of risky) {
    const f = byFacility.get(l.facility) ?? { facility: l.facility, atRisk: 0, critical: 0, value: 0 }
    f.atRisk += 1
    if (l.severity === 'critical') f.critical += 1
    f.value += l.valueAtRisk
    byFacility.set(l.facility, f)
  }
  const lastRun = state.runs[0] ?? null
  const sevRank = (a: ExpiryAction) => {
    const lot = lots.find((l) => l.id === a.lotId)
    return lot?.severity === 'critical' ? 2 : lot?.severity === 'warning' ? 1 : 0
  }
  const proposed = state.actions.filter((a) => a.status === 'proposed')
  const topAction = [...proposed].sort((a, b) => sevRank(b) - sevRank(a) || b.valueProtected - a.valueProtected)[0] ?? null
  return {
    lots: lots.length,
    atRisk: risky.length,
    critical: risky.filter((l) => l.severity === 'critical').length,
    warning: risky.filter((l) => l.severity === 'warning').length,
    expired: lots.filter((l) => l.days < 0).length,
    valueAtRisk: risky.reduce((s, l) => s + l.valueAtRisk, 0),
    criticalValue: risky.filter((l) => l.severity === 'critical').reduce((s, l) => s + l.valueAtRisk, 0),
    facilities: [...byFacility.values()].sort((a, b) => b.critical - a.critical || b.value - a.value),
    lastRun,
    nextScanAt: lastRun ? new Date(Date.parse(lastRun.at) + state.rules.scanMinutes * 60_000).toISOString() : null,
    proposed: proposed.length,
    approved: state.actions.filter((a) => a.status === 'approved').length,
    topAction,
    weeks: WEEKS.map(([label, lo, hi]) => {
      const inBucket = lots.filter((l) => l.days >= lo && l.days <= hi)
      const severity: Severity = inBucket.some((l) => l.severity === 'critical') ? 'critical' : inBucket.some((l) => l.severity === 'warning') ? 'warning' : 'healthy'
      return { label, count: inBucket.length, value: inBucket.reduce((s, l) => s + l.value, 0), severity }
    }),
    failingChecks: state.feed.checks.filter((c) => c.status === 'fail').length,
    warningChecks: state.feed.checks.filter((c) => c.status === 'warn').length,
  }
}

/* ------------------------------------------------------------ permissions */

/** Business view of lots (quantities, values, actions) needs read_records on Inventory. */
export const canReadLots = (p: EffectivePermissions) => can(p, 'inventory', 'read_records')

/** Technical view (lineage, checks, runs, rule versions, event metadata) — configure without records is enough. */
export const canSeeExpiryTech = (p: EffectivePermissions) => can(p, 'inventory', 'configure') || can(p, 'data', 'configure')

/** Supplier returns route to Procurement: visible with procurement records, decided with procurement or inventory manage. */
export function canDecide(p: EffectivePermissions, a: Pick<ExpiryAction, 'route'>) {
  return a.route === 'procurement' ? can(p, 'procurement', 'manage') || can(p, 'inventory', 'manage') : can(p, 'inventory', 'manage')
}

export interface SupplierReturnView {
  action: ExpiryAction
  sku: string
  product: string
  batch: string
  qty: number
  unit: string
  supplierId: string
  days: number
}

/**
 * Procurement's projection: only supplier-return proposals, with the fields a
 * return needs — never facility stock, other lots, or non-supplier actions.
 */
export function supplierReturnsFor(state: ExpiryState, perms: EffectivePermissions, now: Date): SupplierReturnView[] {
  if (!can(perms, 'procurement', 'read_records') && !canReadLots(perms)) return []
  return state.actions
    .filter((a) => a.kind === 'supplier_return')
    .flatMap((a) => {
      const lot = state.lots.find((l) => l.id === a.lotId)
      if (!lot?.supplierId) return []
      return [{ action: a, sku: lot.sku, product: lot.product, batch: lot.batch, qty: lot.qty, unit: lot.unit, supplierId: lot.supplierId, days: daysLeft(lot.expiry, now) }]
    })
}

/* ------------------------------------------------------------ state changes (pure) */

export function decideAction(state: ExpiryState, id: string, status: ActionStatus, actor: string, now: Date): ExpiryState {
  return {
    ...state,
    actions: state.actions.map((a) => (a.id === id ? { ...a, status, decidedBy: status === 'proposed' ? undefined : actor, decidedAt: status === 'proposed' ? undefined : now.toISOString() } : a)),
  }
}

export type RulesPatch = Partial<Pick<ExpiryRules, 'criticalDays' | 'warningDays' | 'scanMinutes' | 'markdownMaxPct' | 'minConfidence'>>

/** Validates and applies a rules change; returns the new state or a message explaining why it was rejected. */
export function updateRules(state: ExpiryState, patch: RulesPatch, actor: string, now: Date): { state: ExpiryState; change: string } | { error: string } {
  const next = { ...state.rules, ...patch }
  if (!Number.isInteger(next.criticalDays) || next.criticalDays < 0 || next.criticalDays > 60) return { error: 'Critical window must be a whole number of days between 0 and 60.' }
  if (!Number.isInteger(next.warningDays) || next.warningDays <= next.criticalDays || next.warningDays > 120) return { error: 'Warning window must be longer than the critical window and at most 120 days.' }
  if (next.markdownMaxPct < 0 || next.markdownMaxPct > 60) return { error: 'Markdown cap must be between 0% and 60%.' }
  if (next.minConfidence < 0.3 || next.minConfidence > 0.95) return { error: 'Minimum confidence must be between 0.30 and 0.95.' }
  const fields: Array<[keyof RulesPatch, string, (v: number) => string]> = [
    ['criticalDays', 'Critical window', (v) => `${v} d`],
    ['warningDays', 'Warning window', (v) => `${v} d`],
    ['scanMinutes', 'Scan cadence', (v) => `${v} min`],
    ['markdownMaxPct', 'Markdown cap', (v) => `${v}%`],
    ['minConfidence', 'Min. confidence', (v) => v.toFixed(2)],
  ]
  const diffs = fields.filter(([k]) => next[k] !== state.rules[k]).map(([k, label, f]) => `${label} ${f(state.rules[k])} → ${f(next[k])}`)
  if (!diffs.length) return { error: 'No changes to save.' }
  const version = state.rules.version + 1
  const change = diffs.join(' · ')
  return {
    change,
    state: {
      ...state,
      rules: { ...next, version, updatedAt: now.toISOString(), updatedBy: actor },
      ruleHistory: [{ version, at: now.toISOString(), by: actor, change }, ...state.ruleHistory],
    },
  }
}

let runSeq = 0

/** Default mitigation for a newly at-risk lot that has no open proposal (rule-based, conservative). */
function proposeFor(l: LotRisk, rules: ExpiryRules, n: number): ExpiryAction | null {
  const base = { id: `ACT-${2000 + n}`, lotId: l.id, status: 'proposed' as const, policy: [] as ExpiryAction['policy'] }
  if (l.days < 0) return { ...base, kind: 'quarantine', title: `Quarantine ${l.qty} ${l.unit} of ${l.sku} (expired)`, rationale: 'Expired material may not be issued.', valueProtected: 0, confidence: 0.97, external: false, route: 'inventory', policy: [{ document: 'Shelf_Life_and_FEFO_Policy_2026.pdf', page: 3 }] }
  if (l.supplierId && l.days >= 18) return { ...base, kind: 'supplier_return', title: `Return ${l.qty} ${l.unit} of ${l.sku} to the supplier`, rationale: `${l.days} days of shelf life remain (policy requires ≥ 18).`, valueProtected: Math.round(l.value * 0.9), confidence: 0.62, external: true, route: 'procurement', policy: [{ document: 'Shelf_Life_and_FEFO_Policy_2026.pdf', page: 5 }] }
  if (l.severity === 'critical') return { ...base, kind: 'markdown', title: `Offer ${l.qty} ${l.unit} of ${l.sku} at up to ${rules.markdownMaxPct}% markdown`, rationale: `${l.days} days left and no scheduled shipment includes this lot.`, valueProtected: Math.round(l.value * (1 - rules.markdownMaxPct / 100)), confidence: 0.66, external: true, route: 'inventory', policy: [{ document: 'Shelf_Life_and_FEFO_Policy_2026.pdf', page: 3 }] }
  if (l.severity === 'warning') return { ...base, kind: 'fefo', title: `FEFO: issue ${l.sku} lot ${l.batch} first`, rationale: `${l.days} days left; picking it before newer lots uses it before expiry.`, valueProtected: l.value, confidence: 0.8, external: false, route: 'inventory', policy: [{ document: 'Shelf_Life_and_FEFO_Policy_2026.pdf', page: 2 }] }
  return null
}

/**
 * One simulated agent run: re-reads the (mock) Gold table, re-classifies lots
 * with the current rules and proposes actions for at-risk lots that have none.
 * Rows that fail validation stay quarantined, so the run reports "partial".
 */
export function runScan(state: ExpiryState, now: Date, trigger: ExpiryRun['trigger']): { state: ExpiryState; run: ExpiryRun; proposedNow: ExpiryAction[] } {
  const lots = assessLots(state, now)
  const risky = lots.filter((l) => l.severity !== 'healthy')
  const open = new Set(state.actions.filter((a) => a.status !== 'dismissed').map((a) => a.lotId))
  const proposedNow: ExpiryAction[] = []
  for (const l of risky) {
    if (open.has(l.id)) continue
    const a = proposeFor(l, state.rules, state.actions.length + proposedNow.length + 1)
    if (a && a.confidence >= state.rules.minConfidence) proposedNow.push(a)
  }
  runSeq += 1
  const prev = state.runs[0]
  const num = prev ? Number(prev.id.replace(/\D/g, '')) + 1 : 1000 + runSeq
  const rejected = state.feed.rejected.length
  const version = `v${Number(state.feed.version.replace(/\D/g, '')) + 1}`
  const run: ExpiryRun = {
    id: `RUN-${num}`,
    at: now.toISOString(),
    status: rejected ? 'partial' : 'ok',
    lotsScanned: lots.length,
    rowsRejected: rejected,
    atRisk: risky.length,
    ruleVersion: state.rules.version,
    durationMs: 700 + ((lots.length * 37) % 200),
    sourceVersion: `${state.feed.dataset}@${version}`,
    trigger,
  }
  return {
    run,
    proposedNow,
    state: {
      ...state,
      actions: [...state.actions, ...proposedNow],
      runs: [run, ...state.runs].slice(0, 20),
      feed: { ...state.feed, version, asOf: now.toISOString() },
    },
  }
}

/** Event envelopes the agent emits (metadata the Data Architect may inspect; payload values stay redacted). */
export function eventEnvelopes(state: ExpiryState, now: Date) {
  const run = state.runs[0]
  if (!run) return []
  const s = summarize(state, now)
  return [
    { type: 'expiry.scan.completed', count: 1, schema: 'expiry.scan.v1', fields: ['run_id', 'status', 'lots_scanned', 'rows_rejected', 'rule_version', 'source_version'], at: run.at },
    { type: 'expiry.risk.detected', count: s.atRisk, schema: 'expiry.risk.v2', fields: ['lot_id', 'sku', 'facility', 'days_remaining', 'severity', 'value_at_risk_usd'], at: run.at },
    { type: 'expiry.action.proposed', count: s.proposed, schema: 'expiry.action.v1', fields: ['action_id', 'kind', 'lot_id', 'external', 'confidence', 'requires_approval'], at: run.at },
  ]
}

/* ------------------------------------------------------------ workspace-level reducers */

/** Runs one simulated scan and records it: new run, synced Gold catalog entry, audit event. */
export function withScan(ws: Workspace, now: Date, trigger: ExpiryRun['trigger']): Workspace {
  const { state, run, proposedNow } = runScan(ws.expiry, now, trigger)
  const detail = `${run.id} ${run.status} · ${run.lotsScanned} lots · ${run.atRisk} at risk · ${run.rowsRejected} rows rejected · rules v${run.ruleVersion}${proposedNow.length ? ` · ${proposedNow.length} new proposal${proposedNow.length > 1 ? 's' : ''}` : ''}`
  return {
    ...ws,
    expiry: state,
    gold: goldWithExpiry(ws.gold, state),
    audit: [auditEvent('expiry-guard', 'Expiry scan completed', detail, run.status === 'ok' ? 'nv' : 'warn', 'inventory'), ...ws.audit].slice(0, 60),
  }
}

/** True when the schedule says a scan is due (the simulated agent catches up once, never in a burst). */
export function scanDue(state: ExpiryState, now: Date) {
  const last = state.runs[0]
  return !last || now.getTime() - Date.parse(last.at) >= state.rules.scanMinutes * 60_000
}
