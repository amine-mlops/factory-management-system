import { FEFO_POLICY } from '../data/expiry.ts'
import type { ModuleId, ViewId } from '../data/nav.ts'
import { can, scopeOf, type EffectivePermissions, type RoleId, type TenantId, type UserId } from './access.ts'
import { ACTION_META, assessLots, summarize } from './expiry.ts'
import type { Workspace } from './workspace.ts'

/**
 * Permission-aware retrieval — LOCAL SIMULATION of the contract the backend
 * must implement. In production this runs server-side: the tenant and the
 * effective grants come from the verified session, filters are applied in the
 * vector/SQL query itself (before ranking), and only surviving chunks are sent
 * to the LLM. Cached answers and generated summaries are keyed by
 * tenant + user + grants-hash and invalidated when grants, documents or
 * source versions change.
 */

export type ChunkSource =
  | { kind: 'pdf'; name: string; page: number }
  | { kind: 'record'; dataset: string; version: string; recordId: string }

export interface Chunk {
  chunkId: string
  tenantId: TenantId
  documentId: string
  source: ChunkSource
  module: ModuleId | null
  /** Empty = company-wide. */
  allowedModules: ModuleId[]
  allowedRoles: RoleId[] | '*'
  dataScope: 'tenant' | 'assigned'
  assignedTo?: UserId
  text: string
  topics: string[]
  updatedAt: string
  indexVersion: string
  stale: boolean
}

const INDEX_VERSION = 'idx-2026.09.27-r3'

interface PdfPage {
  page: number
  text: string
  topics: string[]
}

const PDF_TEXT: Record<string, PdfPage[]> = {
  'Fleet_Driver_Handbook_2026.pdf': [
    { page: 4, text: 'ADR class 8 (corrosive) loads must stay upright and secured; verify seal numbers before departure.', topics: ['handling', 'rundown'] },
    { page: 9, text: 'Food-grade loads may never be co-loaded with chemicals; carry the wash-out certificate.', topics: ['handling', 'rundown'] },
    { page: 12, text: "Report any delay over 15 minutes with the 'Delayed' status; dispatch re-plans the route.", topics: ['route', 'rundown'] },
  ],
  'Critical_Spares_Policy_v3.pdf': [
    { page: 3, text: 'Critical spares with supplier lead time above 7 days keep a minimum of 2 available units.', topics: ['spares_policy', 'stock'] },
    { page: 5, text: 'Units reserved for open work orders are not available stock and must trigger replenishment.', topics: ['spares_policy', 'stock'] },
  ],
  'Hydraflow_Quotation_Q-7781.pdf': [
    { page: 1, text: 'Quotation Q-7781 — impeller kit IMP-204-316SS-RC at USD 9,200 per unit, lead time 5 days, valid until 15 Oct 2026, net 30, 24-month warranty.', topics: ['compare', 'quotation'] },
  ],
  'Crestline_Quotation_CQ-5520.pdf': [
    { page: 2, text: 'Quotation CQ-5520 — impeller kit at USD 7,650 per unit, lead time 21 days, 50% prepayment, 12-month warranty.', topics: ['compare', 'quotation'] },
  ],
  'Procurement_Policy_2026.pdf': [
    { page: 4, text: 'Critical spares tied to an open work order are awarded to the lowest total cost that meets the required-by date.', topics: ['compare', 'policy'] },
    { page: 6, text: 'Suppliers on probation, or prepayment above 30%, require procurement-director approval.', topics: ['compare', 'policy'] },
  ],
  'Loop2_Cavitation_Response_SOP.pdf': [{ page: 2, text: 'On confirmed cavitation, reduce pump speed within the validated envelope before considering a trip.', topics: ['triage'] }],
  'P-204_Pump_OEM_Manual_rev7.pdf': [{ page: 37, text: 'Required NPSH margin ratio for continuous duty is 1.10 or higher.', topics: ['triage'] }],
  'ISO-10816-3_Vibration_Limits_Summary.pdf': [{ page: 1, text: 'Group 2 rigid machines: zone B/C boundary 2.8 mm/s, zone C/D boundary 4.5 mm/s.', topics: ['triage'] }],
  'Supplier_Pricing_2026_CONFIDENTIAL.pdf': [{ page: 2, text: 'Negotiated unit prices and rebates for bearings, impellers and seals.', topics: ['stock', 'spares_policy'] }],
  [FEFO_POLICY]: [
    { page: 2, text: 'First-expired, first-out (FEFO): pick, issue and dispatch the lot with the earliest expiry date first unless a customer specification requires otherwise.', topics: ['expiry'] },
    { page: 3, text: 'Lots within the critical window are dispatched, marked down (capped at 30%) or routed to a secondary channel; expired lots are quarantined and may not be issued.', topics: ['expiry'] },
    { page: 5, text: 'Supplier returns are allowed when at least 18 days of shelf life remain and the supplier agreement allows returns; procurement approves the return.', topics: ['expiry', 'supplier_return'] },
    { page: 6, text: 'Any action involving a customer, supplier or partner requires human approval before it is executed.', topics: ['expiry', 'supplier_return'] },
  ],
}

const usd = (v: number) => `USD ${Math.round(v).toLocaleString('en-US')}`
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** Another company's data that lives in the same (shared) index — must never be returned. */
const OTHER_TENANT: Chunk[] = [
  { chunkId: 'x-1', tenantId: 'tnt_borealis', documentId: 'rec_bf_1', source: { kind: 'record', dataset: 'gold.shipments_eta', version: 'v77', recordId: 'BF-2201' }, module: 'transportation', allowedModules: ['transportation'], allowedRoles: '*', dataScope: 'tenant', text: 'Borealis Foods · BF-2201 · Oslo → Rotterdam · 22 pallets', topics: ['borealis', 'rundown'], updatedAt: '14:20', indexVersion: INDEX_VERSION, stale: false },
  { chunkId: 'x-3', tenantId: 'tnt_borealis', documentId: 'doc_bf_q', source: { kind: 'pdf', name: 'Borealis_Quote_Nordfrost.pdf', page: 1 }, module: 'procurement', allowedModules: ['procurement'], allowedRoles: '*', dataScope: 'tenant', text: 'Nordfrost quotation to Borealis Foods: impeller kit USD 6,900.', topics: ['compare', 'quotation', 'borealis'], updatedAt: '2026-09-20', indexVersion: INDEX_VERSION, stale: false },
  { chunkId: 'x-2', tenantId: 'tnt_borealis', documentId: 'doc_bf_hb', source: { kind: 'pdf', name: 'Borealis_Driver_Rules.pdf', page: 3 }, module: 'transportation', allowedModules: ['transportation'], allowedRoles: '*', dataScope: 'tenant', text: 'Borealis drivers take a mandatory break every 3 h.', topics: ['borealis', 'handling'], updatedAt: '2026-09-01', indexVersion: INDEX_VERSION, stale: false },
]

export function buildCorpus(ws: Workspace, now: Date = new Date()): Chunk[] {
  const tenantId = ws.tenant.tenantId
  const chunks: Chunk[] = []
  for (const d of ws.documents) {
    if (d.status !== 'indexed') continue
    const pages = PDF_TEXT[d.name] ?? [{ page: 1, text: `${d.category}: ${d.name.replace(/[_-]/g, ' ').replace(/\.pdf$/i, '')}.`, topics: ['general'] }]
    for (const p of pages) {
      chunks.push({
        chunkId: `${d.id}#p${p.page}`,
        tenantId,
        documentId: d.id,
        source: { kind: 'pdf', name: d.name, page: p.page },
        module: d.visibility === 'Module' ? (d.module ?? null) : null,
        allowedModules: d.visibility === 'Module' && d.module ? [d.module] : [],
        allowedRoles: d.visibility === 'Restricted' ? ['owner', 'admin'] : '*',
        dataScope: 'tenant',
        text: p.text,
        topics: p.topics,
        updatedAt: '2026-09-27 09:12',
        indexVersion: INDEX_VERSION,
        stale: false,
      })
    }
  }
  const eta = ws.gold.find((g) => g.name === 'gold.shipments_eta')
  for (const sh of ws.shipments) {
    chunks.push({
      chunkId: `shp#${sh.id}`,
      tenantId,
      documentId: `rec_${sh.id}`,
      source: { kind: 'record', dataset: 'gold.shipments_eta', version: eta?.version ?? 'v?', recordId: sh.id },
      module: 'transportation',
      allowedModules: ['transportation'],
      allowedRoles: '*',
      dataScope: 'assigned',
      assignedTo: sh.driverId ?? undefined,
      text: `${sh.id} · ${sh.customer} · ${sh.destination} · window ${sh.window} · ETA ${sh.eta} · ${sh.pallets} plt · ${sh.handling} · ${sh.status}`,
      topics: ['rundown', 'route', 'exec_brief', ...(sh.customer.includes('Hydraflow') || sh.origin.includes('Hydraflow') ? ['inbound'] : [])],
      updatedAt: eta?.asOf ?? '—',
      indexVersion: INDEX_VERSION,
      stale: eta?.stale ?? false,
    })
  }
  const inv = ws.gold.find((g) => g.name === 'gold.inventory_positions')
  for (const it of ws.stock) {
    chunks.push({
      chunkId: `stk#${it.sku}`,
      tenantId,
      documentId: `rec_${it.sku}`,
      source: { kind: 'record', dataset: 'gold.inventory_positions', version: inv?.version ?? 'v?', recordId: it.sku },
      module: 'inventory',
      allowedModules: ['inventory'],
      allowedRoles: '*',
      dataScope: 'tenant',
      text: `${it.sku} · ${it.description} · on hand ${it.onHand} · reserved ${it.reserved} · ROP ${it.reorderPoint} · lead ${it.leadTimeDays} d`,
      topics: ['stock'],
      updatedAt: inv?.asOf ?? '—',
      indexVersion: INDEX_VERSION,
      stale: inv?.stale ?? false,
    })
  }
  const quoteSet = ctx_quotes(ws)
  chunks.push(...quoteSet)
  chunks.push({
    chunkId: 'crm#CS-20928',
    tenantId,
    documentId: 'rec_CS-20928',
    source: { kind: 'record', dataset: 'gold.customer_360', version: 'v612', recordId: 'CS-20928' },
    module: 'crm',
    allowedModules: ['crm'],
    allowedRoles: '*',
    dataScope: 'tenant',
    text: 'Helix Energy · case CS-20928 · proactive notice about Loop 2 throughput',
    topics: ['crm'],
    updatedAt: '14:23',
    indexVersion: INDEX_VERSION,
    stale: false,
  })
  chunks.push(...expiryChunks(ws, now))
  chunks.push(...opsChunks(ws))
  return [...chunks, ...OTHER_TENANT]
}

/** Perishable Expiry Guard: lot records + proposed actions (business) — supplier returns are also readable by Procurement. */
function expiryChunks(ws: Workspace, now: Date): Chunk[] {
  const ex = ws.expiry
  if (!ex) return []
  const tenantId = ws.tenant.tenantId
  const asOf = hhmm(ex.feed.asOf)
  const out: Chunk[] = []
  for (const l of assessLots(ex, now)) {
    out.push({
      chunkId: `lot#${l.id}`,
      tenantId,
      documentId: `rec_${l.id}`,
      source: { kind: 'record', dataset: ex.feed.dataset, version: ex.feed.version, recordId: l.id },
      module: 'inventory',
      allowedModules: ['inventory'],
      allowedRoles: '*',
      dataScope: 'tenant',
      text: `${l.id} · ${l.product} · batch ${l.batch} · ${l.facility} · ${l.qty} ${l.unit} · expires ${l.expiry} (${l.days < 0 ? `${-l.days} d ago` : `${l.days} d`}) · ${l.severity} · ${usd(l.value)}`,
      topics: ['expiry', ...(l.severity !== 'healthy' ? ['exec_brief'] : [])],
      updatedAt: asOf,
      indexVersion: INDEX_VERSION,
      stale: ex.feed.stale,
    })
  }
  for (const a of ex.actions) {
    out.push({
      chunkId: `act#${a.id}`,
      tenantId,
      documentId: `rec_${a.id}`,
      source: { kind: 'record', dataset: 'inventory.expiry_actions', version: `rules-v${ex.rules.version}`, recordId: a.id },
      module: 'inventory',
      allowedModules: a.route === 'procurement' ? ['inventory', 'procurement'] : ['inventory'],
      allowedRoles: '*',
      dataScope: 'tenant',
      text: `${a.id} · ${ACTION_META[a.kind].label} · ${a.title} · ${a.status}${a.external ? ' · external — human approval required' : ''} · protects ${usd(a.valueProtected)} · confidence ${Math.round(a.confidence * 100)}%`,
      topics: ['expiry', ...(a.kind === 'supplier_return' ? ['supplier_return'] : [])],
      updatedAt: a.decidedAt ? hhmm(a.decidedAt) : asOf,
      indexVersion: INDEX_VERSION,
      stale: false,
    })
  }
  return out
}

/** Operational metadata (pipeline runs, Gold catalog, security log) — ACL-tagged for ops roles only; never business records. */
const OPS_ROLES: RoleId[] = ['owner', 'admin', 'data_architect', 'it_security']

function opsChunks(ws: Workspace): Chunk[] {
  const tenantId = ws.tenant.tenantId
  const base = { tenantId, module: null, allowedModules: [] as ModuleId[], allowedRoles: OPS_ROLES, dataScope: 'tenant' as const, indexVersion: INDEX_VERSION }
  const out: Chunk[] = []
  for (const c of ws.connectors) {
    if (!c.connected) continue
    out.push({
      ...base,
      chunkId: `run#${c.id}`,
      documentId: `run_${c.id}`,
      source: { kind: 'record', dataset: 'ops.source_runs', version: c.lastRun.at, recordId: c.id },
      text: `${c.kind} (${c.name}): last run ${c.lastRun.at} ${c.lastRun.status.toUpperCase()}${c.lastRun.error ? ` — ${c.lastRun.error}` : ''}; last good ${c.lastSuccess.version} at ${c.lastSuccess.at}`,
      topics: ['data_brief', 'exec_brief', 'pipeline'],
      updatedAt: c.lastRun.at,
      stale: c.lastRun.status === 'failed',
    })
  }
  for (const g of ws.gold) {
    out.push({
      ...base,
      chunkId: `ds#${g.name}`,
      documentId: `ds_${g.id}`,
      source: { kind: 'record', dataset: 'ops.gold_catalog', version: g.version, recordId: g.name },
      text: `${g.name}@${g.version} as of ${g.asOf} · quality ${g.quality}%${g.stale ? ' · STALE' : ''} · feeds ${g.modules.join(', ')}`,
      topics: ['stale_datasets', 'data_brief'],
      updatedAt: g.asOf,
      stale: g.stale,
    })
  }
  const ex = ws.expiry
  if (ex) {
    for (const r of ex.runs.slice(0, 3)) {
      out.push({
        ...base,
        chunkId: `xrun#${r.id}`,
        documentId: `xrun_${r.id}`,
        source: { kind: 'record', dataset: 'ops.expiry_runs', version: r.sourceVersion, recordId: r.id },
        text: `Expiry Guard ${r.id} at ${hhmm(r.at)}: ${r.status.toUpperCase()} — ${r.lotsScanned} lots scanned, ${r.rowsRejected} rows rejected by validation, rules v${r.ruleVersion}, source ${r.sourceVersion}`,
        topics: ['expiry_feed', 'data_brief'],
        updatedAt: hhmm(r.at),
        stale: false,
      })
    }
    for (const c of ex.feed.checks.filter((x) => x.status !== 'pass')) {
      const rows = c.id === 'date' ? ex.feed.rejected.map((x) => `${x.row} ${x.field}='${x.value}' (${x.error})`).join('; ') : ''
      out.push({
        ...base,
        chunkId: `xchk#${c.id}`,
        documentId: `xchk_${c.id}`,
        source: { kind: 'record', dataset: 'ops.expiry_checks', version: ex.feed.version, recordId: c.id },
        text: `Check "${c.name}" ${c.status === 'fail' ? 'FAILED' : 'WARNING'}: ${c.detail}${rows ? ` — ${rows}` : ''}`,
        topics: ['expiry_feed'],
        updatedAt: hhmm(ex.feed.asOf),
        stale: false,
      })
    }
  }
  for (const i of ws.incidents.slice(0, 12)) {
    const t = new Date(i.at).toLocaleTimeString('en-GB', { hour12: false })
    out.push({
      ...base,
      chunkId: `inc#${i.id}`,
      documentId: `inc_${i.id}`,
      source: { kind: 'record', dataset: 'audit.security_events', version: 'live', recordId: i.id },
      text: `${t} · ${i.userName} → ${i.requestedResource}: 403 ${i.stage} — ${i.reason}`,
      topics: ['incidents', 'exec_brief'],
      updatedAt: t,
      stale: false,
    })
  }
  return out
}

function ctx_quotes(ws: Workspace): Chunk[] {
  const out: Chunk[] = []
  for (const q of ws.quotations ?? []) {
    const sup = ws.suppliers?.find((x) => x.id === q.supplierId)
    out.push({
      chunkId: `quo#${q.id}`,
      tenantId: ws.tenant.tenantId,
      documentId: `rec_${q.id}`,
      source: { kind: 'record', dataset: 'procurement.quotations', version: 'v19', recordId: q.id },
      module: 'procurement',
      allowedModules: ['procurement'],
      allowedRoles: '*',
      dataScope: 'tenant',
      text: `${q.id} · ${sup?.name ?? q.supplierId} (${sup?.rating ?? '—'}, OTIF ${sup?.otif ?? '—'}%) · ${q.item} · USD ${q.unitPrice.toLocaleString('en-US')} × ${q.qty} · ${q.leadTimeDays} d · ${q.terms}`,
      topics: q.rfq === 'RFQ-2291' ? ['compare', 'quotation', 'exec_brief'] : ['quotation'],
      updatedAt: '14:05',
      indexVersion: INDEX_VERSION,
      stale: false,
    })
  }
  return out
}

export interface RetrievalTrace {
  candidates: number
  afterTenant: number
  afterPermission: number
  afterScope: number
  chunks: Chunk[]
}

/** Default-deny filtering, applied BEFORE anything is composed into an answer. */
export function retrieve(corpus: Chunk[], perms: EffectivePermissions, userId: UserId, topics: string[]): RetrievalTrace {
  const candidates = corpus.filter((c) => c.topics.some((t) => topics.includes(t)))
  const afterTenant = candidates.filter((c) => c.tenantId === perms.tenantId)
  const afterPermission = afterTenant.filter((c) => {
    const roleOk = c.allowedRoles === '*' || c.allowedRoles.some((r) => perms.roles.includes(r))
    if (!roleOk) return false
    if (c.allowedModules.length === 0) return true
    const action = c.source.kind === 'record' ? 'read_records' : 'view'
    return c.allowedModules.some((m) => can(perms, m, action))
  })
  const afterScope = afterPermission.filter((c) => c.dataScope === 'tenant' || (c.module && scopeOf(perms, c.module) === 'tenant') || c.assignedTo === userId)
  return { candidates: candidates.length, afterTenant: afterTenant.length, afterPermission: afterPermission.length, afterScope: afterScope.length, chunks: afterScope }
}

export interface Question {
  id: string
  label: string
  topics: string[]
}

export const QUESTIONS: Partial<Record<ViewId, Question[]>> = {
  dashboard: [
    { id: 'exec_brief', label: 'What needs my attention today?', topics: ['exec_brief'] },
    { id: 'incidents', label: 'Summarize security incidents', topics: ['incidents'] },
  ],
  data: [
    { id: 'data_brief', label: 'Why is the TMS refresh failing?', topics: ['data_brief'] },
    { id: 'stale_datasets', label: 'Which datasets are stale?', topics: ['stale_datasets'] },
    { id: 'incidents', label: 'Show denied-request evidence', topics: ['incidents'] },
    { id: 'expiry_feed', label: 'Why did the expiry scan reject rows?', topics: ['expiry_feed'] },
  ],
  knowledge: [
    { id: 'sop', label: 'What is our cavitation response procedure?', topics: ['triage'] },
    { id: 'handling', label: 'Driver load & handling rules', topics: ['handling'] },
    { id: 'policy', label: 'Which approvals does a supplier award need?', topics: ['policy'] },
  ],
  manufacturing: [{ id: 'sop', label: 'What is our cavitation response procedure?', topics: ['triage'] }],
  transportation: [
    { id: 'rundown', label: 'Give me my route rundown', topics: ['rundown'] },
    { id: 'handling', label: 'Load & handling rules', topics: ['handling'] },
    { id: 'crm', label: 'Helix Energy case history', topics: ['crm'] },
    { id: 'other', label: 'Borealis Foods deliveries', topics: ['borealis'] },
  ],
  procurement: [
    { id: 'compare', label: 'Compare quotations for RFQ-2291', topics: ['compare'] },
    { id: 'policy', label: 'Which approvals does this award need?', topics: ['policy'] },
    { id: 'returns', label: 'Which supplier returns are proposed?', topics: ['supplier_return'] },
  ],
  inventory: [
    { id: 'expiry', label: 'Which lots expire in the next 14 days and what should we do?', topics: ['expiry'] },
    { id: 'returns', label: 'Which supplier returns are proposed?', topics: ['supplier_return'] },
    { id: 'below_rop', label: 'Which spares are below reorder point?', topics: ['stock', 'spares_policy'] },
    { id: 'inbound', label: 'When does the impeller kit arrive?', topics: ['inbound'] },
    { id: 'pricing', label: 'Negotiated bearing prices', topics: ['spares_policy'] },
  ],
}

export interface Sentence {
  text: string
  cites: number[]
}

export interface Answer {
  sentences: Sentence[]
  citations: Chunk[]
  gaps: string[]
  staleNotice: string | null
  trace: RetrievalTrace
}

const cite = (all: Chunk[], c: Chunk) => {
  let i = all.indexOf(c)
  if (i < 0) {
    all.push(c)
    i = all.length - 1
  }
  return i + 1
}

/**
 * Deterministic "LLM" composition over permitted chunks only. Never invents
 * content: missing or filtered information becomes an explicit gap.
 */
export function answer(q: Question, trace: RetrievalTrace, ctx: { ws: Workspace; userId: UserId; perms: EffectivePermissions; now?: Date }): Answer {
  const now = ctx.now ?? new Date()
  const citations: Chunk[] = []
  const sentences: Sentence[] = []
  const gaps: string[] = []
  const recs = trace.chunks.filter((c) => c.source.kind === 'record')
  const pdfs = trace.chunks.filter((c) => c.source.kind === 'pdf')
  const staleRecs = recs.filter((c) => c.stale)
  const eta = ctx.ws.gold.find((g) => g.name === 'gold.shipments_eta')
  const tms = ctx.ws.connectors.find((c) => c.id === 'tms')
  let staleNotice: string | null = null

  if (q.id === 'rundown') {
    const mine = recs
      .map((c) => ({ c, sh: ctx.ws.shipments.find((s) => `shp#${s.id}` === c.chunkId)! }))
      .filter((x) => x.sh)
      .sort((a, b) => a.sh.stopOrder - b.sh.stopOrder)
    if (mine.length === 0) gaps.push('No deliveries are assigned to you in this workspace, so there is nothing to brief.')
    const open = mine.filter((x) => x.sh.status !== 'Delivered')
    const fleet = scopeOf(ctx.perms, 'transportation') === 'tenant'
    if (mine.length)
      sentences.push({
        text: fleet ? `${mine.length} shipments across the fleet today; ${open.length} still open.` : `You have ${mine.length} assigned deliveries today; ${open.length} still open.`,
        cites: mine.map((x) => cite(citations, x.c)),
      })
    for (const { c, sh } of open) {
      sentences.push({ text: `${fleet ? `${sh.id} (${sh.driverName})` : `Stop ${sh.stopOrder}`}: ${sh.customer}, ${sh.destination} — window ${sh.window}, ${sh.pallets} pallets, ETA ${sh.eta}${c.stale ? ' (stale)' : ''}. ${sh.handling}.`, cites: [cite(citations, c)] })
    }
    for (const p of pdfs.slice(0, 2)) sentences.push({ text: p.text, cites: [cite(citations, p)] })
  } else if (q.id === 'handling') {
    if (!pdfs.length) gaps.push('No handling procedures you are allowed to read are indexed yet.')
    for (const p of pdfs) sentences.push({ text: p.text, cites: [cite(citations, p)] })
  } else if (q.id === 'below_rop') {
    const low = recs.map((c) => ({ c, it: ctx.ws.stock.find((s) => `stk#${s.sku}` === c.chunkId)! })).filter((x) => x.it && x.it.onHand - x.it.reserved < x.it.reorderPoint)
    if (!recs.length) gaps.push('You cannot read inventory records, so stock levels are not available to you.')
    else sentences.push({ text: `${low.length} items have available stock (on hand − reserved) below their reorder point.`, cites: low.map((x) => cite(citations, x.c)) })
    for (const { c, it } of low) sentences.push({ text: `${it.sku} — ${it.onHand - it.reserved} available vs ROP ${it.reorderPoint}${it.reservedFor ? `, 1 reserved for ${it.reservedFor}` : ''}; lead time ${it.leadTimeDays} d from ${it.supplier}.`, cites: [cite(citations, c)] })
    const policy = pdfs.filter((p) => p.source.kind === 'pdf' && p.source.name.startsWith('Critical_Spares'))
    for (const p of policy) sentences.push({ text: p.text, cites: [cite(citations, p)] })
  } else if (q.id === 'compare') {
    const quotes = recs.filter((c) => c.chunkId.startsWith('quo#')).map((c) => ({ c, q: ctx.ws.quotations.find((x) => `quo#${x.id}` === c.chunkId)! })).filter((x) => x.q && x.q.rfq === 'RFQ-2291' && x.q.item.startsWith('Impeller'))
    const pdf = (name: string) => pdfs.find((p) => p.source.kind === 'pdf' && p.source.name.startsWith(name))
    if (quotes.length < 2) gaps.push('Fewer than two permitted quotations for RFQ-2291 are available, so I cannot compare them.')
    else {
      const hyd = quotes.find((x) => x.q.supplierId === 'sup_hydraflow')!
      const cre = quotes.find((x) => x.q.supplierId === 'sup_crestline')!
      const hp = pdf('Hydraflow_Quotation')
      const cp = pdf('Crestline_Quotation')
      sentences.push({ text: `Two quotations cover the impeller kit for RFQ-2291 (2 units, needed for WO-48219 within 96 safe-operating hours).`, cites: [cite(citations, hyd.c), cite(citations, cre.c)] })
      sentences.push({ text: `Hydraflow Q-7781: USD ${hyd.q.unitPrice.toLocaleString('en-US')}/unit, ${hyd.q.leadTimeDays}-day lead time, net 30, 24-month warranty; preferred supplier, OTIF 94%.`, cites: [hp ? cite(citations, hp) : cite(citations, hyd.c), cite(citations, hyd.c)] })
      sentences.push({ text: `Crestline CQ-5520: USD ${cre.q.unitPrice.toLocaleString('en-US')}/unit (USD ${((hyd.q.unitPrice - cre.q.unitPrice) * 2).toLocaleString('en-US')} cheaper in total) but ${cre.q.leadTimeDays}-day lead time, 50% prepayment; supplier on probation, OTIF 81%.`, cites: [cp ? cite(citations, cp) : cite(citations, cre.c), cite(citations, cre.c)] })
      const p4 = pdfs.find((p) => p.source.kind === 'pdf' && p.source.name.startsWith('Procurement_Policy') && p.source.page === 4)
      const p6 = pdfs.find((p) => p.source.kind === 'pdf' && p.source.name.startsWith('Procurement_Policy') && p.source.page === 6)
      sentences.push({ text: `Recommendation: award Q-7781 to Hydraflow — it is the lowest-cost option that meets the required-by date; Crestline's 21-day lead time misses it and would need director approval for probation status and prepayment.`, cites: [p4, p6].filter(Boolean).map((p) => cite(citations, p!)) })
      if (!p4 || !p6) gaps.push('The procurement policy PDF is not indexed (or not visible to you), so the policy basis for this recommendation is not cited.')
    }
  } else if (q.id === 'exec_brief') {
    const shipRecs = recs.filter((c) => c.chunkId.startsWith('shp#'))
    const quoteRecs = recs.filter((c) => c.chunkId.startsWith('quo#'))
    const runRecs = recs.filter((c) => c.chunkId.startsWith('run#'))
    const incRecs = recs.filter((c) => c.chunkId.startsWith('inc#'))
    const tmsRun = runRecs.find((c) => c.chunkId === 'run#tms')
    if (shipRecs.length) {
      const rows = shipRecs.map((c) => ({ c, sh: ctx.ws.shipments.find((x) => `shp#${x.id}` === c.chunkId) })).filter((x) => x.sh)
      const openRows = rows.filter((x) => x.sh!.status !== 'Delivered')
      const delayed = rows.filter((x) => x.sh!.status === 'Delayed')
      sentences.push({
        text: `Transportation: ${openRows.length} open deliveries, ${delayed.length} delayed${eta?.stale ? `; ETAs are stale since ${eta.asOf} because the ${tms?.lastRun.at ?? 'latest'} TMS refresh failed` : ''}.`,
        cites: [...delayed.map((x) => cite(citations, x.c)), ...(tmsRun ? [cite(citations, tmsRun)] : [])],
      })
    }
    const pending = quoteRecs.filter((c) => ctx.ws.quotations.some((q) => `quo#${q.id}` === c.chunkId && q.rfq === 'RFQ-2291' && q.item.startsWith('Impeller') && q.status !== 'Awarded'))
    if (pending.length >= 2) sentences.push({ text: 'Procurement: RFQ-2291 (impeller kit for WO-48219) is awaiting award — Hydraflow Q-7781 has a 5-day lead time; Crestline CQ-5520 is cheaper but takes 21 days from a supplier on probation.', cites: pending.map((c) => cite(citations, c)) })
    const lotRecs = recs.filter((c) => c.chunkId.startsWith('lot#'))
    if (lotRecs.length && ctx.ws.expiry) {
      const ex = summarize(ctx.ws.expiry, now)
      const crit = assessLots(ctx.ws.expiry, now).filter((l) => l.severity === 'critical')
      sentences.push({
        text: `Inventory: ${ex.critical} lots critical and ${ex.warning} in warning — ${usd(ex.valueAtRisk)} at risk across ${ex.facilities.length} facilities${ex.topAction ? `; top proposal: ${ex.topAction.title} (needs approval)` : ''}.`,
        cites: lotRecs.filter((c) => crit.some((l) => `lot#${l.id}` === c.chunkId)).slice(0, 3).map((c) => cite(citations, c)),
      })
    }
    if (incRecs.length) sentences.push({ text: `Security: ${incRecs.length} request${incRecs.length > 1 ? 's were' : ' was'} denied before retrieval; nothing restricted reached the model.`, cites: incRecs.slice(0, 2).map((c) => cite(citations, c)) })
    if (tmsRun?.stale && tms?.lastRun.action) sentences.push({ text: `Recommended next step: restore the TMS feed — ${tms.lastRun.action}.`, cites: [cite(citations, tmsRun)] })
    const readable = [shipRecs, quoteRecs, lotRecs].filter((x) => x.length).length
    if (!readable) gaps.push('No module records you can read are in scope for this briefing.')
    else if (readable < 3) gaps.push('Modules you cannot read are excluded from this briefing rather than summarized.')
  } else if (q.id === 'data_brief') {
    const runs = recs.filter((c) => c.chunkId.startsWith('run#'))
    const failed = runs.filter((c) => c.stale)
    for (const c of failed) {
      const conn = ctx.ws.connectors.find((x) => `run#${x.id}` === c.chunkId)
      sentences.push({ text: `${conn?.kind} refresh failed at ${conn?.lastRun.at} (${conn?.lastRun.errorKind} error): ${conn?.lastRun.error}. The last good version ${conn?.lastSuccess.version} (${conn?.lastSuccess.at}) is still served and flagged stale.`, cites: [cite(citations, c)] })
      if (conn?.lastRun.action) sentences.push({ text: `Fix: ${conn.lastRun.action}.`, cites: [cite(citations, c)] })
    }
    for (const c of runs.filter((r) => !r.stale && ctx.ws.connectors.find((x) => `run#${x.id}` === r.chunkId)?.lastRun.errorKind === 'quality')) {
      const conn = ctx.ws.connectors.find((x) => `run#${x.id}` === c.chunkId)!
      sentences.push({ text: `${conn.kind}: ${conn.lastRun.error}. Quarantined rows are excluded from Gold.`, cites: [cite(citations, c)] })
    }
    const xrun = recs.find((c) => c.chunkId.startsWith('xrun#'))
    if (xrun && ctx.ws.expiry?.runs[0]?.status !== 'ok') sentences.push({ text: `${xrun.text}.`, cites: [cite(citations, xrun)] })
    if (runs.length && !failed.length) sentences.push({ text: 'All connected sources completed their last run.', cites: runs.slice(0, 3).map((c) => cite(citations, c)) })
    if (!runs.length) gaps.push('No pipeline run records are visible to your roles.')
    if (!can(ctx.perms, 'transportation', 'read_records')) gaps.push('Business records are not included — your access covers pipeline metadata, not the shipments flowing through it.')
  } else if (q.id === 'stale_datasets') {
    const ds = recs.filter((c) => c.chunkId.startsWith('ds#'))
    const stale = ds.filter((c) => c.stale)
    if (!ds.length) gaps.push('No dataset catalog entries are visible to your roles.')
    else if (!stale.length) sentences.push({ text: 'No Gold dataset is stale; all are within SLA.', cites: ds.slice(0, 3).map((c) => cite(citations, c)) })
    for (const c of stale) sentences.push({ text: c.text, cites: [cite(citations, c)] })
  } else if (q.id === 'incidents') {
    const inc = recs.filter((c) => c.chunkId.startsWith('inc#'))
    if (!inc.length) gaps.push('No denied requests are recorded for this company.')
    else sentences.push({ text: `${inc.length} request${inc.length > 1 ? 's were' : ' was'} blocked at the pre-retrieval gate; 0 restricted chunks were retrieved and nothing was sent to the model.`, cites: inc.slice(0, 4).map((c) => cite(citations, c)) })
    for (const c of inc.slice(0, 3)) sentences.push({ text: c.text, cites: [cite(citations, c)] })
  } else if (q.id === 'expiry') {
    const ex = ctx.ws.expiry
    const lotRecs = recs.filter((c) => c.chunkId.startsWith('lot#'))
    const actRecs = recs.filter((c) => c.chunkId.startsWith('act#'))
    if (!lotRecs.length || !ex) gaps.push('You cannot read inventory lot records, so expiry dates and values are not available to you.')
    else {
      const lots = assessLots(ex, now).filter((l) => lotRecs.some((c) => c.chunkId === `lot#${l.id}`))
      const soon = lots.filter((l) => l.days <= 14)
      const expired = soon.filter((l) => l.days < 0)
      const lotChunk = (id: string) => lotRecs.find((c) => c.chunkId === `lot#${id}`)!
      sentences.push({
        text: `${soon.length - expired.length} lots expire in the next 14 days${expired.length ? ` and ${expired.length} has already expired` : ''} — ${usd(soon.reduce((s2, l) => s2 + l.value, 0))} at risk.`,
        cites: soon.map((l) => cite(citations, lotChunk(l.id))),
      })
      for (const l of soon.slice(0, 6)) {
        const act = ex.actions.find((a) => a.lotId === l.id && a.status !== 'dismissed')
        const ac = act ? actRecs.find((c) => c.chunkId === `act#${act.id}`) : undefined
        const state = !act ? 'No action proposed yet.' : act.status === 'approved' ? `Approved: ${act.title}.` : `Proposed: ${act.title} — ${act.external ? 'needs human approval (external party)' : 'awaiting approval'}.`
        sentences.push({ text: `${l.product} (${l.id}, ${l.facility}): ${l.days < 0 ? `expired ${-l.days} d ago` : `${l.days} d left`}, ${l.qty} ${l.unit}, ${usd(l.value)}. ${state}`, cites: [cite(citations, lotChunk(l.id)), ...(ac ? [cite(citations, ac)] : [])] })
      }
      const pol = pdfs.filter((p) => p.source.kind === 'pdf' && p.source.name === FEFO_POLICY && (p.source.page === 3 || p.source.page === 6))
      for (const p of pol) sentences.push({ text: p.text, cites: [cite(citations, p)] })
      if (!pol.length) gaps.push('The shelf-life policy is not indexed (or not visible to you), so the policy basis is not cited.')
      if (ex.feed.rejected.length) gaps.push(`${ex.feed.rejected.length} lot rows failed validation in the latest scan and are excluded — this list may be incomplete.`)
    }
  } else if (q.id === 'returns') {
    const ex = ctx.ws.expiry
    const acts = recs
      .filter((c) => c.chunkId.startsWith('act#'))
      .map((c) => ({ c, a: ex?.actions.find((a) => `act#${a.id}` === c.chunkId) }))
      .filter((x) => x.a?.kind === 'supplier_return')
    if (!acts.length) gaps.push('No supplier-return proposals are visible to your roles.')
    for (const { c, a } of acts) sentences.push({ text: `${a!.title}. ${a!.rationale} Estimated credit ${usd(a!.valueProtected)}; status: ${a!.status}${a!.status === 'proposed' ? ' — human approval required before contacting the supplier' : ''}.`, cites: [cite(citations, c)] })
    const p5 = pdfs.find((p) => p.source.kind === 'pdf' && p.source.name === FEFO_POLICY && p.source.page === 5)
    if (p5) sentences.push({ text: p5.text, cites: [cite(citations, p5)] })
  } else if (q.id === 'expiry_feed') {
    const runs = recs.filter((c) => c.chunkId.startsWith('xrun#'))
    const checks = recs.filter((c) => c.chunkId.startsWith('xchk#'))
    if (!runs.length && !checks.length) gaps.push('No Expiry Guard run metadata is visible to your roles.')
    if (runs[0]) sentences.push({ text: `${runs[0].text}.`, cites: [cite(citations, runs[0])] })
    for (const c of checks) sentences.push({ text: `${c.text}.`, cites: [cite(citations, c)] })
    if (checks.some((c) => c.chunkId === 'xchk#date')) sentences.push({ text: 'Fix: accept dd/mm/yyyy in the Silver contract (or ask the WMS admin to export ISO dates); the month-13 row needs an upstream correction. Rejected rows stay quarantined and out of Gold.', cites: checks.filter((c) => c.chunkId === 'xchk#date').map((c) => cite(citations, c)) })
    if (!can(ctx.perms, 'inventory', 'read_records')) gaps.push('Lot quantities and values are business records — not included for your role.')
  } else if (q.id === 'sop') {
    if (!pdfs.length) gaps.push('No procedure documents you are allowed to read are indexed yet.')
    for (const p of pdfs) sentences.push({ text: p.text, cites: [cite(citations, p)] })
  } else if (q.id === 'policy') {
    if (!pdfs.length) gaps.push('No procurement policy you are allowed to read is indexed yet.')
    for (const p of pdfs) sentences.push({ text: p.text, cites: [cite(citations, p)] })
  } else {
    for (const c of trace.chunks.slice(0, 4)) sentences.push({ text: c.text, cites: [cite(citations, c)] })
  }

  if (q.id === 'crm' && trace.chunks.length === 0) gaps.push("You don't have access to CRM records, so I can't answer this. I won't infer customer history from other sources.")
  if (q.id === 'other' && trace.chunks.length === 0)
    gaps.push(`No records match in ${ctx.ws.tenant.name}. Other companies' data is isolated by tenant and is never searched${trace.candidates > trace.afterTenant ? ` (${trace.candidates - trace.afterTenant} matches in another tenant were excluded before retrieval)` : ''}.`)
  if (q.id === 'inbound' && trace.chunks.length === 0) gaps.push('Shipment records belong to Transportation, which your roles cannot read. Ask a Transportation Manager or request access.')
  if (q.id === 'pricing' && trace.chunks.filter((c) => c.source.kind === 'pdf' && c.source.name.includes('Pricing')).length === 0 && trace.afterTenant > trace.afterPermission)
    gaps.push('Pricing terms are in a restricted document you are not permitted to read, so they are omitted from this answer.')
  if (trace.afterPermission > trace.afterScope && q.id === 'rundown')
    gaps.push(`${trace.afterPermission - trace.afterScope} shipments assigned to other drivers were excluded by your data scope.`)

  if (staleRecs.length && eta?.stale) {
    staleNotice = `ETA data is from the last successful refresh at ${eta.asOf} (${eta.name}@${eta.version}). The ${tms?.lastRun.at ?? 'latest'} refresh failed — treat ETAs as stale and confirm with dispatch.`
  }
  if (trace.candidates > trace.afterTenant && q.id !== 'other') gaps.push(`${trace.candidates - trace.afterTenant} matching item(s) from another company were excluded by the tenant filter before retrieval.`)
  if (!sentences.length && !gaps.length) gaps.push('I found no permitted sources that answer this question.')
  return { sentences, citations, gaps, staleNotice, trace }
}

export function sourceLabel(c: Chunk) {
  return c.source.kind === 'pdf' ? `${c.source.name} · p.${c.source.page}` : `${c.source.dataset}@${c.source.version} · ${c.source.recordId}`
}

/** Canonical FastAPI /rag/query response (required: answer + sources; the rest optional). */
export interface AiAnswerResponse {
  answer: string
  sources: Array<{ document: string; page: number }>
  freshness?: Array<{ source: string; as_of: string; stale: boolean }>
  decision?: { status: 'allowed' | 'denied'; stage: 'pre-retrieval' | 'retrieval'; reason?: string }
}

export function toAiAnswerResponse(a: Answer): AiAnswerResponse {
  return {
    answer: [a.staleNotice, ...a.sentences.map((s) => `${s.text} ${s.cites.map((c) => `[${c}]`).join('')}`), ...a.gaps].filter(Boolean).join(' '),
    sources: a.citations.map((c) => (c.source.kind === 'pdf' ? { document: c.source.name, page: c.source.page } : { document: `${c.source.dataset}#${c.source.recordId}`, page: 0 })),
    freshness: a.citations.map((c) => ({ source: sourceLabel(c), as_of: c.updatedAt, stale: c.stale })),
    decision: { status: 'allowed', stage: 'retrieval' },
  }
}
