import { MODULE_NAV, type ModuleId, type ViewId } from '../data/nav.ts'
import { can, IMPLEMENTED_MODULES, isOwnerLike, scopeOf, type EffectivePermissions } from './access.ts'
import { canReadLots, canSeeExpiryTech, summarize, type ExpirySummary } from './expiry.ts'
import { fmtUsd, type Health, type Tone } from './format.ts'
import { ragState, type Connector, type GoldDataset, type SecurityIncident, type Workspace } from './workspace.ts'

/**
 * Single role-aware data model.
 *
 * Every dashboard, the system map and the assistant read from this. It is built
 * from the same workspace state and the same effective permissions the rest of
 * the app uses, so a role never receives fields it may not see:
 *   - business impact requires `read_records` on the module,
 *   - technical diagnostics require `configure` on data (metadata only — never
 *     business records),
 *   - unauthorized modules come back as `access: 'none'` with no detail.
 * UX only: the FastAPI backend computes the same projection server-side.
 */

export type Audience = 'executive' | 'technical' | 'driver' | 'procurement' | 'limited'

export function audienceFor(p: EffectivePermissions): Audience {
  if (isOwnerLike(p.roles)) return 'executive'
  if (can(p, 'data', 'configure') && !p.pages.has('dashboard')) return 'technical'
  if (p.roles.includes('data_architect')) return 'technical'
  if (scopeOf(p, 'transportation') === 'assigned' && !p.pages.has('dashboard')) return 'driver'
  if (can(p, 'procurement', 'read_records') && !p.pages.has('dashboard')) return 'procurement'
  if (p.pages.has('dashboard')) return 'executive'
  return 'limited'
}

const WORST: Health[] = ['critical', 'warning', 'healthy']
const worst = (hs: Health[]): Health => WORST.find((h) => hs.includes(h)) ?? 'healthy'

export interface SourceDiag {
  id: string
  kind: Connector['kind']
  name: string
  connected: boolean
  health: Connector['health']
  lastRun: Connector['lastRun']
  lastSuccess: Connector['lastSuccess']
  freshness: string
  sla: string
  quality: number
  errors: number
}

export interface DatasetDiag {
  name: string
  version: string
  asOf: string
  stale: boolean
  quality: number
  sources: string[]
}

export interface TechDiag {
  sources: SourceDiag[]
  datasets: DatasetDiag[]
  brokenFlow: boolean
  diagnosis: string
  /** One-line status for the map node (the drawer shows the full diagnosis). */
  short: string
  /** Module-specific technical findings (e.g. expiry-scan validation failures). */
  notes: string[]
  docs: { count: number; chunks: number; indexVersion: string }
  incidents: number
}

export interface ModuleStatus {
  id: ModuleId
  label: string
  enabled: boolean
  implemented: boolean
  health: Health
  /** Can the acting user open this module at all? */
  access: 'granted' | 'none'
  /** Short labels rendered on the map node (problem locations). */
  problems: string[]
  /** Executive projection — null when the user cannot read the module's records. */
  business: { summary: string; metrics: Array<[string, string]> } | null
  /** Technical projection — null unless the user may configure data connections. */
  tech: TechDiag | null
}

export interface Alert {
  id: string
  tone: Tone
  title: string
  detail: string
  module?: ModuleId
  target?: { view: ViewId; tab?: string }
}

export interface NextAction {
  title: string
  detail: string
  cta: string
  target: { view: ViewId; tab?: string } | null
}

export interface OpsModel {
  generatedAt: Date
  audience: Audience
  modules: ModuleStatus[]
  hub: { health: Health; live: number; soon: number; disabled: number; attention: number }
  alerts: Alert[]
  nextAction: NextAction
  /** Role-projected KPIs: a block is null when the acting user may not see it (never computed client-side for display). */
  kpis: {
    deliveries: DeliveryKpis | null
    procurement: { awaiting: number; awaitingValue: number; probationOpen: number; awarded: number; rfqs: number; suppliers: number; avgOtif: number } | null
    knowledge: { indexed: number; total: number; ready: boolean; chunks: number } | null
    data: { connected: number; total: number; failed: number; staleDatasets: number; quarantined: number } | null
    security: { deniedLast24h: number; total: number; preRetrieval: number; route: number } | null
    /** Perishable Expiry Guard business summary — requires read_records on Inventory. */
    expiry: ExpirySummary | null
  }
  staleSources: number
}

export interface DeliveryKpis {
  /** 'assigned' = only the acting driver's stops are counted. */
  scope: 'tenant' | 'assigned'
  total: number
  delivered: number
  inTransit: number
  scheduled: number
  delayed: number
  open: number
  unassigned: number
  staleOpen: number
  etaAsOf: string | null
}

const INDEX_VERSION = 'idx-2026.09.27-r3'

function sourceDiag(c: Connector): SourceDiag {
  return { id: c.id, kind: c.kind, name: c.name, connected: c.connected, health: c.connected ? c.health : 'disconnected', lastRun: c.lastRun, lastSuccess: c.lastSuccess, freshness: c.freshness, sla: c.sla, quality: c.quality, errors: c.errors }
}

function datasetsFor(ws: Workspace, id: ModuleId): GoldDataset[] {
  return ws.gold.filter((g) => g.modules.includes(id))
}

function expiryNotes(ws: Workspace): string[] {
  const ex = ws.expiry
  if (!ex) return []
  const run = ex.runs[0]
  const notes: string[] = []
  if (run && run.status !== 'ok') notes.push(`Expiry scan ${run.id} ${run.status} · ${run.rowsRejected} rows rejected (${ex.feed.checks.filter((c) => c.status === 'fail').map((c) => c.id === 'date' ? 'expiry_date' : c.name).join(', ') || 'validation'})`)
  const warn = ex.feed.checks.filter((c) => c.status === 'warn')
  if (warn.length) notes.push(`${warn.length} check warning: ${warn.map((c) => c.detail).join('; ')}`)
  if (ex.feed.stale) notes.push(`${ex.feed.dataset} is stale`)
  return notes
}

function techFor(ws: Workspace, id: ModuleId): TechDiag {
  const datasets = datasetsFor(ws, id)
  const notes = id === 'inventory' ? expiryNotes(ws) : []
  const srcIds = [...new Set(datasets.flatMap((d) => d.sources))]
  const sources = ws.connectors.filter((c) => srcIds.includes(c.id)).map(sourceDiag)
  const failed = sources.filter((s) => s.lastRun.status === 'failed' || !s.connected)
  const quality = sources.filter((s) => s.lastRun.errorKind === 'quality')
  const stale = datasets.filter((d) => d.stale)
  const docs = ws.documents.filter((d) => d.status === 'indexed' && (d.visibility === 'Company' || d.module === id))
  const diagnosis = failed.length
    ? `${failed.map((f) => `${f.kind} ${f.connected ? `${f.lastRun.errorKind ?? 'run'} error at ${f.lastRun.at}` : 'disconnected'}`).join(' · ')}${stale.length ? ` · serving ${stale.map((s) => `${s.name}@${s.version}`).join(', ')} (stale)` : ''}`
    : notes.length
      ? notes[0]
      : quality.length
        ? `${quality.map((q) => `${q.kind}: ${q.errors} rows quarantined`).join(' · ')}`
        : datasets.length
          ? `${datasets.length} dataset${datasets.length > 1 ? 's' : ''} fresh within SLA`
          : 'No Gold datasets mapped'
  const ex = id === 'inventory' ? ws.expiry : undefined
  const short = failed.length
    ? `${failed[0].kind} ${failed[0].connected ? `${failed[0].lastRun.errorKind ?? 'run'} error · ${failed[0].lastRun.at}` : 'disconnected'}`
    : ex && ex.runs[0] && ex.runs[0].status !== 'ok'
      ? `Scan ${ex.runs[0].status} · ${ex.runs[0].rowsRejected} rows rejected`
      : quality.length
        ? `${quality[0].kind} · ${quality[0].errors} rows quarantined`
        : datasets.length
          ? 'Fresh within SLA'
          : 'No datasets mapped'
  return {
    sources,
    datasets: datasets.map((d) => ({ name: d.name, version: d.version, asOf: d.asOf, stale: d.stale, quality: d.quality, sources: d.sources })),
    brokenFlow: failed.length > 0,
    diagnosis,
    short,
    notes,
    docs: { count: docs.length, chunks: docs.reduce((s, d) => s + d.chunks, 0), indexVersion: INDEX_VERSION },
    incidents: ws.incidents.filter((i) => i.requestedResource.toLowerCase().includes(id === 'crm' ? 'crm' : id)).length,
  }
}

function hoursAgo(iso: string, now: Date) {
  return (now.getTime() - new Date(iso).getTime()) / 36e5
}

export function buildOpsModel(ws: Workspace, perms: EffectivePermissions, now: Date = new Date()): OpsModel {
  const audience = audienceFor(perms)
  const canTech = can(perms, 'data', 'configure')

  /* ---------- shared business facts (computed once, projected per role below) */
  const eta = ws.gold.find((g) => g.name === 'gold.shipments_eta')
  const countShips = (ships: Workspace['shipments'], scope: DeliveryKpis['scope']): DeliveryKpis => {
    const open = ships.filter((s) => s.status !== 'Delivered')
    return {
      scope,
      total: ships.length,
      delivered: ships.filter((s) => s.status === 'Delivered').length,
      inTransit: ships.filter((s) => s.status === 'In transit' || s.status === 'Arrived').length,
      scheduled: ships.filter((s) => s.status === 'Scheduled' || s.status === 'Loading').length,
      delayed: ships.filter((s) => s.status === 'Delayed').length,
      open: open.length,
      unassigned: ships.filter((s) => !s.driverId).length,
      staleOpen: eta?.stale ? open.length : 0,
      etaAsOf: eta?.asOf ?? null,
    }
  }
  // Company-wide facts drive module health; only the projection below reaches the UI.
  const deliveries = countShips(ws.shipments, 'tenant')
  const trScope = scopeOf(perms, 'transportation')
  const visibleDeliveries = !can(perms, 'transportation', 'read_records')
    ? null
    : trScope === 'assigned'
      ? countShips(ws.shipments.filter((s) => s.driverId === perms.userId), 'assigned')
      : deliveries
  const urgent = ws.quotations.filter((q) => q.rfq === 'RFQ-2291')
  const awaitingQ = ws.quotations.filter((q) => q.status !== 'Awarded')
  const urgentAwarded = urgent.some((q) => q.status === 'Awarded' && q.item.startsWith('Impeller'))
  const probationOpen = awaitingQ.filter((q) => ws.suppliers.find((s) => s.id === q.supplierId)?.rating === 'Probation').length
  const awaitingValue = urgent.filter((q) => q.status !== 'Awarded' && q.item.startsWith('Impeller')).reduce((m, q) => Math.max(m, q.unitPrice * q.qty), 0)
  const procurement = {
    awaiting: awaitingQ.length,
    awaitingValue: urgentAwarded ? 0 : awaitingValue,
    probationOpen,
    awarded: ws.quotations.filter((q) => q.status === 'Awarded').length,
    rfqs: new Set(ws.quotations.map((q) => q.rfq)).size,
    suppliers: ws.suppliers.length,
    avgOtif: Math.round(ws.suppliers.reduce((a, x) => a + x.otif, 0) / Math.max(1, ws.suppliers.length)),
  }
  const rag = ragState(ws.documents)
  const connected = ws.connectors.filter((c) => c.connected)
  const data = {
    connected: connected.length,
    total: ws.connectors.length,
    failed: connected.filter((c) => c.lastRun.status === 'failed').length,
    staleDatasets: ws.gold.filter((g) => g.stale).length,
    quarantined: connected.filter((c) => c.lastRun.errorKind === 'quality').reduce((s, c) => s + c.errors, 0),
  }
  const security = {
    deniedLast24h: ws.incidents.filter((i) => hoursAgo(i.at, now) <= 24).length,
    total: ws.incidents.length,
    preRetrieval: ws.incidents.filter((i) => i.stage === 'pre-retrieval').length,
    route: ws.incidents.filter((i) => i.stage === 'route').length,
  }
  const seesSecurity = isOwnerLike(perms.roles) || canTech
  const ex = ws.expiry ? summarize(ws.expiry, now) : null
  const readLots = canReadLots(perms)

  /* ---------- per-module status */
  const modules: ModuleStatus[] = MODULE_NAV.map(({ id, label }) => {
    const enabled = ws.tenant.enabledModules.includes(id)
    const implemented = IMPLEMENTED_MODULES.includes(id)
    const access: ModuleStatus['access'] = perms.pages.has(id) ? 'granted' : 'none'
    const tech = techFor(ws, id)
    let health: Health = !enabled ? 'disabled' : !implemented ? 'soon' : 'healthy'
    const problems: string[] = []
    let business: ModuleStatus['business'] = null

    if (enabled && implemented && id === 'transportation') {
      const signals: Health[] = []
      if (tech.brokenFlow) {
        problems.push('Refresh failed')
        signals.push(deliveries.delayed > 0 || deliveries.staleOpen > 0 ? 'critical' : 'warning')
      }
      if (eta?.stale) problems.push('Stale ETAs')
      if (deliveries.delayed) {
        // Counts are business facts: only readers get the number.
        problems.push(visibleDeliveries ? `${visibleDeliveries.delayed} delayed` : 'Delays')
        signals.push('warning')
      }
      if (deliveries.unassigned) signals.push('warning')
      health = worst(signals)
      if (visibleDeliveries) {
        const d = visibleDeliveries
        business = {
          summary: `${d.open} open ${d.scope === 'assigned' ? 'assigned stops' : 'deliveries'} · ${d.delayed} delayed${eta?.stale ? ` · ETAs stale since ${eta.asOf}` : ''}`,
          metrics: [
            ['Delivered', `${d.delivered} of ${d.total}`],
            ['In transit', String(d.inTransit)],
            ['Delayed', String(d.delayed)],
            ...(d.scope === 'tenant' ? [['Unassigned', String(d.unassigned)] as [string, string]] : []),
            ['ETA freshness', eta?.stale ? `Stale — last good ${eta.asOf}` : 'Current'],
          ],
        }
      }
    }

    if (enabled && implemented && id === 'procurement') {
      const signals: Health[] = []
      if (!urgentAwarded && urgent.length) {
        problems.push('Award pending')
        signals.push('warning')
      }
      if (probationOpen) signals.push('warning')
      if (tech.sources.some((s) => s.lastRun.errorKind === 'quality')) {
        problems.push('Data quality')
        signals.push('warning')
      }
      if (tech.brokenFlow) {
        problems.push('Refresh failed')
        signals.push('critical')
      }
      health = worst(signals)
      if (can(perms, 'procurement', 'read_records')) {
        business = {
          summary: urgentAwarded
            ? `RFQ-2291 awarded · ${procurement.awaiting} quotations open`
            : `RFQ-2291 awaiting award (${fmtUsd(procurement.awaitingValue, false)}) · ${probationOpen} on probation`,
          metrics: [
            ['Awaiting decision', String(procurement.awaiting)],
            ['Awarded', String(procurement.awarded)],
            ['Suppliers on probation (open quotes)', String(probationOpen)],
            ['Urgent value at stake', procurement.awaitingValue ? fmtUsd(procurement.awaitingValue, false) : '—'],
          ],
        }
      }
    }

    if (enabled && implemented && id === 'inventory' && ex) {
      const signals: Health[] = []
      if (ex.critical) signals.push('critical')
      if (ex.warning) signals.push('warning')
      if (ex.failingChecks || ex.warningChecks) signals.push('warning')
      health = worst(signals)
      if (readLots) {
        if (ex.critical) problems.push(`${ex.critical} critical lots`)
        if (ex.valueAtRisk) problems.push(`${fmtUsd(ex.valueAtRisk)} at risk`)
        business = {
          summary: `${ex.atRisk} lots at risk · ${fmtUsd(ex.valueAtRisk, false)} · ${ex.facilities.length} facilities`,
          metrics: [
            ['Critical lots', String(ex.critical)],
            ['Warning lots', String(ex.warning)],
            ['Value at risk', fmtUsd(ex.valueAtRisk, false)],
            ['Most affected', ex.facilities[0]?.facility ?? '—'],
            ['Top proposal', ex.topAction?.title ?? 'None pending'],
          ],
        }
      } else {
        if (ex.critical || ex.warning) problems.push('Lots at risk')
        if (ex.failingChecks) problems.push('Validation failures')
      }
    }

    if (enabled && !implemented && access === 'granted') business = { summary: 'Enabled · integration coming soon', metrics: [] }
    return { id, label, enabled, implemented, health, access, problems, business, tech: canTech && enabled ? tech : null }
  })

  const live = modules.filter((m) => m.enabled && m.implemented)
  const hubHealth = worst(live.map((m) => m.health).filter((h) => h === 'critical' || h === 'warning' || h === 'healthy'))

  /* ---------- alerts (only what this role may see) */
  const alerts: Alert[] = []
  const tr = modules.find((m) => m.id === 'transportation')!
  const pr = modules.find((m) => m.id === 'procurement')!
  if (tr.enabled && tr.implemented && tr.health !== 'healthy' && (tr.business || tr.tech)) {
    const tms = ws.connectors.find((c) => c.id === 'tms')
    alerts.push({
      id: 'al-tms',
      tone: tr.health === 'critical' ? 'crit' : 'warn',
      title: tr.tech?.brokenFlow || tms?.lastRun.status === 'failed' ? 'Transport data feed failed' : 'Transportation needs attention',
      detail: visibleDeliveries
        ? `${visibleDeliveries.staleOpen} open ${visibleDeliveries.scope === 'assigned' ? 'stops' : 'deliveries'} show stale ETAs (last good ${eta?.asOf ?? '—'}); ${visibleDeliveries.delayed} delayed.`
        : (tr.tech?.diagnosis ?? 'Stale ETAs'),
      module: 'transportation',
      target: perms.pages.has('data') && tr.tech ? { view: 'data', tab: 'sources' } : { view: 'transportation', tab: 'exceptions' },
    })
  }
  if (pr.enabled && pr.implemented && pr.business && !urgentAwarded) {
    alerts.push({ id: 'al-rfq', tone: 'warn', title: 'RFQ-2291 awaiting award', detail: `Impeller kit for WO-48219 · ${fmtUsd(procurement.awaitingValue, false)} · lead time decides the repair window.`, module: 'procurement', target: { view: 'procurement', tab: 'quotations' } })
  }
  if (security.deniedLast24h && seesSecurity) {
    alerts.push({ id: 'al-sec', tone: 'crit', title: `${security.deniedLast24h} denied request${security.deniedLast24h > 1 ? 's' : ''} in 24 h`, detail: 'Blocked before retrieval — nothing restricted reached the model.', target: perms.pages.has('data') ? { view: 'data', tab: 'incidents' } : { view: 'dashboard', tab: 'security' } })
  }
  const inv = modules.find((m) => m.id === 'inventory')!
  if (inv.enabled && ex && readLots && ex.critical) {
    alerts.push({
      id: 'al-expiry',
      tone: 'crit',
      title: `${ex.critical} lots near or past expiry`,
      detail: `${fmtUsd(ex.criticalValue, false)} at risk · ${ex.facilities.filter((f) => f.critical).map((f) => f.facility).join(', ')}${ex.topAction ? ` · top proposal: ${ex.topAction.title}` : ''}.`,
      module: 'inventory',
      target: { view: 'inventory', tab: 'actions' },
    })
  }
  if (inv.enabled && ex && !readLots && canSeeExpiryTech(perms) && ex.failingChecks) {
    alerts.push({ id: 'al-expiry-feed', tone: 'warn', title: 'Expiry feed validation failures', detail: `${ws.expiry.feed.rejected.length} lot rows rejected (expiry_date) — excluded from scans until fixed.`, module: 'inventory', target: perms.pages.has('data') ? { view: 'data', tab: 'pipeline' } : { view: 'inventory', tab: 'rules' } })
  }
  if (canTech && data.quarantined) {
    alerts.push({ id: 'al-q', tone: 'warn', title: `${data.quarantined} rows quarantined`, detail: 'Silver validation rejected rows with a changed lot_no type (S3 receipts).', target: { view: 'data', tab: 'pipeline' } })
  }

  /* ---------- recommended next action (rule-based, highest impact first) */
  let nextAction: NextAction = { title: 'All live modules nominal', detail: 'No open exceptions in the modules you can see.', cta: 'Review activity', target: { view: 'dashboard', tab: 'live' } }
  if (tr.health === 'critical' && (tr.business || tr.tech)) {
    nextAction = {
      title: 'Restore the TMS feed',
      detail: visibleDeliveries
        ? `${visibleDeliveries.staleOpen} open ${visibleDeliveries.scope === 'assigned' ? 'stops are' : 'deliveries are'} running on stale ETAs. Fix the eta_ts schema change, then re-run the refresh.`
        : 'The TMS refresh failed on a schema change (eta_ts missing). Fix the ingestion contract, then re-run the refresh.',
      cta: perms.pages.has('data') ? 'Open data sources' : 'View exceptions',
      target: perms.pages.has('data') ? { view: 'data', tab: 'sources' } : { view: 'transportation', tab: 'exceptions' },
    }
  } else if (ex && readLots && ex.critical && ex.topAction) {
    nextAction = {
      title: 'Approve expiry mitigations',
      detail: `${ex.critical} critical lots, ${fmtUsd(ex.criticalValue, false)} at risk. Start with: ${ex.topAction.title}.`,
      cta: 'Review agent actions',
      target: { view: 'inventory', tab: 'actions' },
    }
  } else if (pr.business && !urgentAwarded) {
    nextAction = { title: 'Award RFQ-2291', detail: 'Compare the two impeller quotations with cited evidence and award before the repair window closes.', cta: 'Compare quotations', target: { view: 'procurement', tab: 'quotations' } }
  }

  return {
    generatedAt: now,
    audience,
    modules,
    hub: {
      health: live.length ? hubHealth : 'soon',
      live: live.length,
      soon: modules.filter((m) => m.enabled && !m.implemented).length,
      disabled: modules.filter((m) => !m.enabled).length,
      attention: live.filter((m) => m.health === 'warning' || m.health === 'critical').length,
    },
    alerts,
    nextAction,
    kpis: {
      deliveries: visibleDeliveries,
      procurement: can(perms, 'procurement', 'read_records') ? procurement : null,
      knowledge: perms.pages.has('knowledge') || canTech || perms.pages.has('dashboard') ? { indexed: rag.indexed, total: ws.documents.length, ready: rag.ready, chunks: rag.chunks } : null,
      data: isOwnerLike(perms.roles) || can(perms, 'data', 'view') ? data : null,
      security: seesSecurity ? security : null,
      expiry: readLots ? ex : null,
    },
    staleSources: connected.filter((c) => c.lastRun.status === 'failed' || c.health === 'stale').length,
  }
}

const MODULE_IDS = new Set<ViewId>(MODULE_NAV.map((m) => m.id))

/**
 * Activity events the acting user may see. Module events carry business detail,
 * so they need read_records on that module; team/settings events are owner-only;
 * untagged events are admin-only.
 */
export function visibleActivity(ws: Workspace, perms: EffectivePermissions) {
  const owner = isOwnerLike(perms.roles)
  return ws.audit.filter((e) => {
    if (!e.resource) return owner
    if (e.resource === 'team' || e.resource === 'settings') return owner
    if (MODULE_IDS.has(e.resource)) return can(perms, e.resource, 'read_records')
    return perms.pages.has(e.resource)
  })
}

export const newestFirst = (list: SecurityIncident[]) => [...list].sort((a, b) => b.at.localeCompare(a.at))
