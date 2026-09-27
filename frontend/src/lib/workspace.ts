import { seedExpiry, type ExpiryState } from '../data/expiry.ts'
import { SHIPMENTS, STOCK, type Shipment, type StockItem } from '../data/logistics.ts'
import { QUOTATIONS, SUPPLIERS, type Quotation, type Supplier } from '../data/procurement.ts'
import type { ModuleId, ViewId } from '../data/nav.ts'
import { newTenantId, type Member, type RoleId, type Tenant, type UserId } from './access.ts'
import type { Tone } from './format.ts'

/* ------------------------------------------------------------ knowledge */

/** PDF lifecycle: uploaded → extracted/chunked → ACL metadata tagged → indexed (RAG-ready). Distinct from Gold tables. */
export type DocStatus = 'uploaded' | 'extracting' | 'tagging' | 'indexed'

export const DOC_STAGES: Array<{ id: DocStatus; label: string }> = [
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'extracting', label: 'Extracted & chunked' },
  { id: 'tagging', label: 'ACL metadata tagged' },
  { id: 'indexed', label: 'Indexed · RAG-ready' },
]
export type DocVisibility = 'Company' | 'Module' | 'Restricted'

export interface KbDocument {
  id: string
  name: string
  sizeKb: number
  category: string
  visibility: DocVisibility
  module?: ModuleId
  status: DocStatus
  progress: number
  chunks: number
}

export const DOC_CATEGORIES = ['SOP / Procedure', 'Equipment manual', 'Safety standard', 'Supplier contract', 'Policy'] as const

export const DEMO_PDFS: Array<Pick<KbDocument, 'name' | 'sizeKb' | 'category' | 'visibility' | 'module'>> = [
  { name: 'P-204_Pump_OEM_Manual_rev7.pdf', sizeKb: 8420, category: 'Equipment manual', visibility: 'Module', module: 'manufacturing' },
  { name: 'ISO-10816-3_Vibration_Limits_Summary.pdf', sizeKb: 1260, category: 'Safety standard', visibility: 'Company' },
  { name: 'Loop2_Cavitation_Response_SOP.pdf', sizeKb: 640, category: 'SOP / Procedure', visibility: 'Module', module: 'manufacturing' },
  { name: 'Fleet_Driver_Handbook_2026.pdf', sizeKb: 2210, category: 'Policy', visibility: 'Module', module: 'transportation' },
  { name: 'Hydraflow_Quotation_Q-7781.pdf', sizeKb: 310, category: 'Supplier contract', visibility: 'Module', module: 'procurement' },
  { name: 'Crestline_Quotation_CQ-5520.pdf', sizeKb: 280, category: 'Supplier contract', visibility: 'Module', module: 'procurement' },
  { name: 'Procurement_Policy_2026.pdf', sizeKb: 720, category: 'Policy', visibility: 'Module', module: 'procurement' },
  { name: 'Critical_Spares_Policy_v3.pdf', sizeKb: 980, category: 'Policy', visibility: 'Module', module: 'inventory' },
  { name: 'Shelf_Life_and_FEFO_Policy_2026.pdf', sizeKb: 540, category: 'Policy', visibility: 'Company' },
  { name: 'Supplier_Pricing_2026_CONFIDENTIAL.pdf', sizeKb: 450, category: 'Supplier contract', visibility: 'Restricted' },
]

let docSeq = 0
export function makeDoc(d: Pick<KbDocument, 'name' | 'sizeKb' | 'category' | 'visibility' | 'module'>, status: DocStatus = 'uploaded'): KbDocument {
  docSeq += 1
  const chunks = Math.max(8, Math.round(d.sizeKb / 38))
  return { id: `doc_${docSeq}_${Math.random().toString(36).slice(2, 6)}`, ...d, status, progress: status === 'indexed' ? 100 : 0, chunks }
}

/** Advances local, simulated processing one tick, one document at a time: uploaded → extracting → tagging → indexed. */
export function advanceDocs(docs: KbDocument[]): KbDocument[] {
  const activeIdx = docs.findIndex((d) => d.status === 'extracting' || d.status === 'tagging')
  const idx = activeIdx >= 0 ? activeIdx : docs.findIndex((d) => d.status === 'uploaded')
  if (idx < 0) return docs
  return docs.map((d, i) => {
    if (i !== idx) return d
    if (d.status === 'uploaded') return { ...d, status: 'extracting', progress: 10 }
    if (d.status === 'extracting') {
      const progress = Math.min(60, d.progress + 25)
      return progress >= 60 ? { ...d, status: 'tagging', progress: 70 } : { ...d, progress }
    }
    return { ...d, status: 'indexed', progress: 100 }
  })
}

/** Human-readable ACL metadata attached to every chunk of a document. */
export function aclLabel(d: Pick<KbDocument, 'visibility' | 'module'>) {
  if (d.visibility === 'Restricted') return 'roles=[owner,admin]'
  if (d.visibility === 'Module') return `modules=[${d.module ?? '—'}] · roles=*`
  return 'modules=* · roles=*'
}

export function ragState(docs: KbDocument[]) {
  const indexed = docs.filter((d) => d.status === 'indexed')
  const pending = docs.length - indexed.length
  return { ready: docs.length > 0 && pending === 0, indexed: indexed.length, pending, chunks: indexed.reduce((s, d) => s + d.chunks, 0) }
}

/* ------------------------------------------------------------ data sources */

export interface Connector {
  id: string
  kind: 'ERP' | 'WMS' | 'TMS' | 'CRM' | 'IoT/SCADA' | 'Database/S3'
  name: string
  detail: string
  connected: boolean
  freshness: string
  sla: string
  quality: number
  errors: number
  health: 'healthy' | 'stale' | 'schema_mismatch' | 'failed' | 'disconnected'
  warning?: string
  rowsPerDay: string
  /** Last run of the ingestion job. */
  lastRun: { at: string; status: 'ok' | 'failed'; errorKind?: 'schema' | 'quality' | 'freshness'; error?: string; action?: string }
  /** Last dataset version that passed validation — retained and served (flagged stale) when a refresh fails. */
  lastSuccess: { at: string; version: string }
}

export const CONNECTORS: Connector[] = [
  { id: 'erp', kind: 'ERP', name: 'ERP · orders & materials', detail: 'OData · 42 tables', connected: true, freshness: '4 min', sla: '15 min', quality: 99.2, errors: 0, health: 'healthy', rowsPerDay: '1.8M', lastRun: { at: '14:28', status: 'ok' }, lastSuccess: { at: '14:28', version: 'erp_orders@v981' } },
  { id: 'wms', kind: 'WMS', name: 'Warehouse management', detail: 'REST · docks, bins, picks', connected: true, freshness: '2 min', sla: '10 min', quality: 98.7, errors: 0, health: 'healthy', rowsPerDay: '640k', lastRun: { at: '14:30', status: 'ok' }, lastSuccess: { at: '14:30', version: 'wms_bins@v4410' } },
  { id: 'tms', kind: 'TMS', name: 'Transport management', detail: 'SFTP batch · shipments, routes, ETAs', connected: true, freshness: '3 h 28 min', sla: '30 min', quality: 96.1, errors: 1, health: 'failed', warning: 'Refresh failed at 14:10 — required column eta_ts missing. Serving last good snapshot shipments_eta@v142 (11:04) — STALE', rowsPerDay: '84k', lastRun: { at: '14:10', status: 'failed', errorKind: 'schema', error: "Required column 'eta_ts' missing in shipments_2026-09-27T14-10.csv (upstream export changed)", action: 'Map estimated_arrival → eta_ts in the ingestion contract, or ask the TMS admin to restore the column, then re-run' }, lastSuccess: { at: '11:04', version: 'shipments_eta@v142' } },

  { id: 'crm', kind: 'CRM', name: 'CRM · accounts & cases', detail: 'Webhook + nightly sync', connected: true, freshness: '9 min', sla: '1 h', quality: 97.9, errors: 0, health: 'healthy', rowsPerDay: '52k', lastRun: { at: '14:23', status: 'ok' }, lastSuccess: { at: '14:23', version: 'crm_cases@v612' } },
  { id: 'scada', kind: 'IoT/SCADA', name: 'OPC UA historian', detail: 'Streaming · 25.6 kHz vibration', connected: true, freshness: '< 1 s', sla: '5 s', quality: 99.8, errors: 0, health: 'healthy', rowsPerDay: '2.1B', lastRun: { at: '14:32', status: 'ok' }, lastSuccess: { at: '14:32', version: 'stream · live' } },
  { id: 's3', kind: 'Database/S3', name: 'Lakehouse object store', detail: 's3://plant-a-lake/raw/', connected: true, freshness: '18 min', sla: '1 h', quality: 94.4, errors: 7, health: 'schema_mismatch', warning: 'Schema mismatch — receipts.lot_no changed int → string (7 rows quarantined)', rowsPerDay: '3.4M', lastRun: { at: '14:14', status: 'ok', errorKind: 'quality', error: 'receipts.lot_no changed int → string; 7 rows failed validation and were quarantined', action: 'Update the Silver contract for lot_no or fix the upstream export; quarantined rows are excluded from Gold' }, lastSuccess: { at: '14:14', version: 'receipts@v233 (7 rows quarantined)' } },
]

export interface GoldDataset {
  id: string
  name: string
  sources: string[]
  modules: ModuleId[]
  task: string
  freshness: string
  quality: number
  tone: Tone
  version: string
  asOf: string
  stale: boolean
}

export const GOLD_DATASETS: GoldDataset[] = [
  { id: 'g1', name: 'gold.asset_health_features', sources: ['scada', 'erp'], modules: ['manufacturing'], task: 'Autonomous Triage feature store', freshness: '1 s', quality: 99.6, tone: 'nv', version: 'v5120', asOf: '14:32:08', stale: false },
  { id: 'g2', name: 'gold.inventory_positions', sources: ['erp', 'wms'], modules: ['inventory', 'procurement'], task: 'Reorder signals, spares reservation', freshness: '5 min', quality: 98.9, tone: 'nv', version: 'v877', asOf: '14:30', stale: false },
  { id: 'g3', name: 'gold.shipments_eta', sources: ['tms', 'erp'], modules: ['transportation', 'distribution'], task: 'Driver briefings, ETA risk', freshness: '3 h 28 min', quality: 95.8, tone: 'warn', version: 'v142', asOf: '11:04', stale: true },
  { id: 'g4', name: 'gold.supplier_scorecard', sources: ['erp', 's3'], modules: ['procurement'], task: 'OTIF scoring, expedite advice', freshness: '18 min', quality: 94.4, tone: 'warn', version: 'v61', asOf: '14:14', stale: false },
  { id: 'g5', name: 'gold.customer_360', sources: ['crm', 'erp'], modules: ['crm'], task: 'Case context, proactive notices', freshness: '9 min', quality: 97.9, tone: 'nv', version: 'v612', asOf: '14:23', stale: false },
  { id: 'g6', name: 'gold.warehouse_ops', sources: ['wms'], modules: ['warehousing'], task: 'Dock & wave planning', freshness: '2 min', quality: 98.7, tone: 'nv', version: 'v4410', asOf: '14:30', stale: false },
  { id: 'g7', name: 'gold.platform_telemetry', sources: ['scada', 's3'], modules: ['it'], task: 'Integration health, SLOs', freshness: '1 min', quality: 99.1, tone: 'nv', version: 'v2291', asOf: '14:31', stale: false },
  { id: 'g8', name: 'gold.lot_expiry', sources: ['wms', 'erp'], modules: ['inventory'], task: 'Perishable Expiry Guard scans', freshness: '6 min', quality: 98.3, tone: 'warn', version: 'v318', asOf: '14:26', stale: false },
]

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** Gold catalog copy whose gold.lot_expiry entry mirrors the Expiry Guard feed (version + as-of). */
export function goldWithExpiry(gold: GoldDataset[], expiry: ExpiryState): GoldDataset[] {
  return gold.map((g) => (g.name === expiry.feed.dataset ? { ...g, modules: [...g.modules], version: expiry.feed.version, asOf: clock(expiry.feed.asOf) } : { ...g, modules: [...g.modules] }))
}

/* ------------------------------------------------------------ audit */

export interface AuditEvent {
  id: string
  time: string
  tone: Tone
  actor: string
  action: string
  detail: string
  /** Resource the event concerns — activity feeds only show events for resources the viewer may open. Untagged = admin-only. */
  resource?: ViewId
}

let auditSeq = 0
export function auditEvent(actor: string, action: string, detail: string, tone: Tone = 'info', resource?: ViewId): AuditEvent {
  auditSeq += 1
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
  return { id: `au_${auditSeq}_${Date.now().toString(36)}`, time, tone, actor, action, detail, resource }
}

const SEED_AUDIT: AuditEvent[] = [
  { id: 'au_s1', time: '14:31:02', tone: 'nv', actor: 'system', action: 'Gate policy applied', detail: 'Physics & standards gate v2.4 active for all command writes (triage preview)', resource: 'triage' },
  { id: 'au_s6', time: '14:10:05', tone: 'crit', actor: 'system', action: 'TMS refresh failed', detail: "shipments export missing required column eta_ts — serving shipments_eta@v142 (11:04)", resource: 'data' },
  { id: 'au_s2', time: '12:14:47', tone: 'warn', actor: 'jordan.lee', action: 'Access denied', detail: 'Driver asked for Hydraflow purchase orders — blocked before retrieval, 0 chunks', resource: 'data' },
  { id: 'au_s3', time: '11:58:10', tone: 'info', actor: 'priya.shah', action: 'Credential rotated', detail: 'S3 connector key rotated (secret stored server-side)', resource: 'data' },
  { id: 'au_s7', time: '10:05:40', tone: 'nv', actor: 'jordan.lee', action: 'Shipment status updated', detail: 'SHP-88329 → Delivered (Orion Chemicals)', resource: 'transportation' },
  { id: 'au_s8', time: '09:44:12', tone: 'info', actor: 'tess.vos', action: 'Quotation received', detail: 'CQ-5520 from Crestline Industrial for RFQ-2291', resource: 'procurement' },
  { id: 'au_s4', time: '09:40:33', tone: 'info', actor: 'alex.moreno', action: 'Role changed', detail: 'Tess Vos: + Transportation Manager', resource: 'team' },
  { id: 'au_s5', time: '09:02:11', tone: 'nv', actor: 'alex.moreno', action: 'Sign-in', detail: 'SSO · MFA verified (simulated)', resource: 'team' },
]

const SEED_INCIDENTS: SecurityIncident[] = [
  {
    id: 'inc_seed_1',
    at: '2026-09-27T12:14:47.000Z',
    tenantId: 'tnt_plant_a_demo',
    userId: 'usr_jlee',
    userName: 'Jordan Lee',
    roles: ['truck_driver'],
    requestedResource: 'procurement',
    query: 'open purchase orders for Hydraflow',
    decision: 'DENY',
    stage: 'pre-retrieval',
    reason: 'No read_records / query_ai grant on Procurement',
    chunksRetrieved: 0,
    sentToModel: false,
  },
]

/* ------------------------------------------------------------ workspace */

/** Security incident recorded by the (simulated) pre-retrieval authorization gate. */
export interface SecurityIncident {
  id: string
  at: string
  tenantId: string
  userId: UserId
  userName: string
  roles: RoleId[]
  requestedResource: string
  query: string
  decision: 'DENY'
  /** pre-retrieval = AI query blocked before search; route = direct navigation to an ungranted page. */
  stage: 'pre-retrieval' | 'route'
  reason: string
  chunksRetrieved: 0
  sentToModel: false
}

/** Invitation code generated by an owner (mock of POST /invites). */
export interface InviteCode {
  code: string
  tenantId: string
  roles: RoleId[]
  createdBy: string
  createdAt: string
  /** Driver invites claim a seeded driver seat so assigned deliveries resolve for the new member. */
  seatUserId?: UserId
  usedBy?: string
}

export interface Workspace {
  tenant: Tenant
  incidents: SecurityIncident[]
  invites: InviteCode[]
  suppliers: Supplier[]
  quotations: Quotation[]
  members: Member[]
  currentUserId: UserId
  documents: KbDocument[]
  connectors: Connector[]
  gold: GoldDataset[]
  audit: AuditEvent[]
  shipments: Shipment[]
  stock: StockItem[]
  /** Perishable Expiry Guard state (simulated agent: lots, rules, runs, proposed actions). */
  expiry: ExpiryState
  /** Owner-only "preview as" persona; null = own identity. UX only — never sent to the backend as authority. */
  previewRoles: RoleId[] | null
  previewUserId: UserId | null
  origin: 'demo' | 'setup' | 'join'
}

export const ALL_MODULES: ModuleId[] = ['procurement', 'inventory', 'transportation', 'warehousing', 'manufacturing', 'distribution', 'crm', 'it']

export const SEED_TEAM: Array<Omit<Member, 'userId'> & { userId: UserId }> = [
  { userId: 'usr_jlee', name: 'Jordan Lee', email: 'jordan.lee@acme-demo.io', roles: [], grants: [], status: 'invited' },
  { userId: 'usr_pshah', name: 'Priya Shah', email: 'priya.shah@acme-demo.io', roles: [], grants: [], status: 'invited' },
  { userId: 'usr_sortiz', name: 'Sam Ortiz', email: 'sam.ortiz@acme-demo.io', roles: [], grants: [], status: 'invited' },
]

export function ownerMember(name: string, email: string): Member {
  return { userId: 'usr_owner', name, email, roles: ['owner'], grants: [], status: 'active' }
}

/** Fully configured workspace used by "Use demo company" and as the demo baseline. */
export function demoWorkspace(name: string, email: string): Workspace {
  const expiry = seedExpiry()
  return {
    tenant: {
      tenantId: 'tnt_plant_a_demo',
      name: 'Acme Process Industries',
      industry: 'Process manufacturing',
      size: '1,000–5,000',
      locations: ['Plant A · Rotterdam', 'DC-C2 · Central Park'],
      context: 'Continuous cooling-water and compression loops; unplanned trips cost ≈ $25k/h.',
      enabledModules: [...ALL_MODULES],
    },
    members: [
      ownerMember(name, email),
      { ...SEED_TEAM[0], roles: ['truck_driver'], status: 'active' },
      { ...SEED_TEAM[1], roles: ['data_architect'], status: 'active' },
      { ...SEED_TEAM[2], status: 'active' },
      { userId: 'usr_rdiaz', name: 'Rafa Díaz', email: 'rafa.diaz@acme-demo.io', roles: ['truck_driver'], grants: [], status: 'active' },
      { userId: 'usr_tvos', name: 'Tess Vos', email: 'tess.vos@acme-demo.io', roles: ['procurement_manager', 'transportation_manager'], grants: [], status: 'active' },
      { userId: 'usr_mkim', name: 'Mina Kim', email: 'mina.kim@acme-demo.io', roles: ['customer_service'], grants: [], status: 'active' },
    ],
    currentUserId: 'usr_owner',
    documents: DEMO_PDFS.map((d) => makeDoc(d, 'indexed')),
    connectors: CONNECTORS.map((c) => ({ ...c })),
    gold: goldWithExpiry(GOLD_DATASETS, expiry),
    audit: [...SEED_AUDIT],
    incidents: [...SEED_INCIDENTS],
    invites: [],
    suppliers: SUPPLIERS.map((x) => ({ ...x })),
    quotations: QUOTATIONS.map((x) => ({ ...x })),
    shipments: SHIPMENTS.map((x) => ({ ...x })),
    stock: STOCK.map((x) => ({ ...x })),
    expiry,
    previewRoles: null,
    previewUserId: null,
    origin: 'demo',
  }
}

/* ------------------------------------------------------------ invites */

export interface DemoInvite {
  code: string
  tenant: Pick<Tenant, 'name' | 'industry' | 'locations'>
  roles: RoleId[]
  invitedBy: string
  enabledModules: ModuleId[]
}

export const DEMO_INVITES: DemoInvite[] = [
  {
    code: 'ACME-MFG-7F3K',
    tenant: { name: 'Acme Process Industries', industry: 'Process manufacturing', locations: ['Plant A · Rotterdam'] },
    roles: ['manufacturing_engineer'],
    invitedBy: 'Alex Moreno (Owner)',
    enabledModules: [...ALL_MODULES],
  },
  {
    code: 'ACME-DRV-2291',
    tenant: { name: 'Acme Process Industries', industry: 'Process manufacturing', locations: ['DC-C2 · Central Park'] },
    roles: ['truck_driver'],
    invitedBy: 'Alex Moreno (Owner)',
    enabledModules: [...ALL_MODULES],
  },
  {
    code: 'ACME-PRC-4410',
    tenant: { name: 'Acme Process Industries', industry: 'Process manufacturing', locations: ['Sourcing · Rotterdam'] },
    roles: ['procurement_manager'],
    invitedBy: 'Alex Moreno (Owner)',
    enabledModules: [...ALL_MODULES],
  },
]

/** Accepts a bare code or a pasted invite link (…/join?code=XYZ or …/invite/XYZ). */
export function findInvite(input: string): DemoInvite | null {
  const raw = input.trim()
  const fromLink = raw.match(/(?:code=|invite\/)([A-Za-z0-9-]+)/)?.[1]
  const code = (fromLink ?? raw).toUpperCase()
  return DEMO_INVITES.find((i) => i.code === code) ?? null
}

export function workspaceFromInvite(inv: DemoInvite, name: string, email: string): Workspace {
  const base = demoWorkspace(name, email)
  // A driver invite claims the seeded driver seat so their assigned deliveries resolve.
  const userId: UserId = inv.roles.includes('truck_driver') ? 'usr_jlee' : 'usr_me'
  const me: Member = { userId, name, email, roles: inv.roles, grants: [], status: 'active' }
  return {
    ...base,
    tenant: { ...base.tenant, name: inv.tenant.name, enabledModules: inv.enabledModules },
    members: [...base.members.filter((m) => m.userId !== userId).map((m) => (m.userId === 'usr_owner' ? { ...m, name: 'Alex Moreno', email: 'operator@nexus-demo.io' } : m)), me],
    shipments: base.shipments.map((sh) => (sh.driverId === userId ? { ...sh, driverName: name } : sh)),
    currentUserId: userId,
    origin: 'join',
    audit: [auditEvent(email.split('@')[0], 'Invite accepted', `Joined with code ${inv.code} as ${inv.roles.join(', ')}`, 'nv', 'team'), ...base.audit],
  }
}

export interface SetupDraft {
  tenant: Omit<Tenant, 'tenantId'>
  documents: KbDocument[]
  connectors: Connector[]
  gold: GoldDataset[]
  members: Member[]
  invites: InviteCode[]
}

export function emptyDraft(): SetupDraft {
  return {
    tenant: { name: '', industry: 'Process manufacturing', size: '200–1,000', locations: ['Plant A'], context: '', enabledModules: [] },
    documents: [],
    connectors: CONNECTORS.map((c) => ({ ...c, connected: false, health: 'disconnected' as const })),
    gold: GOLD_DATASETS.map((g) => ({ ...g, modules: [...g.modules] })),
    members: SEED_TEAM.map((m) => ({ ...m, roles: [...m.roles] })),
    invites: [],
  }
}

export function workspaceFromDraft(d: SetupDraft, owner: Member): Workspace {
  const expiry = seedExpiry()
  return {
    tenant: { ...d.tenant, tenantId: newTenantId() },
    members: [owner, ...d.members],
    currentUserId: owner.userId,
    documents: d.documents,
    connectors: d.connectors,
    gold: goldWithExpiry(d.gold, expiry),
    audit: [
      auditEvent(owner.email.split('@')[0], 'Workspace launched', `${d.tenant.enabledModules.length} modules · ${d.members.length} invites queued (demo)`, 'nv', 'settings'),
      auditEvent('system', 'Tenant isolation', 'Backend must scope every API/RAG call to this tenant (see INTEGRATION.md)', 'info', 'settings'),
    ],
    incidents: [],
    invites: d.invites,
    suppliers: SUPPLIERS.map((x) => ({ ...x })),
    quotations: QUOTATIONS.map((x) => ({ ...x })),
    shipments: SHIPMENTS.map((x) => ({ ...x })),
    stock: STOCK.map((x) => ({ ...x })),
    expiry,
    previewRoles: null,
    previewUserId: null,
    origin: 'setup',
  }
}

/** Restores a connector to its seeded, connected state (simulated connect). */
export function connect(c: Connector): Connector {
  const seed = CONNECTORS.find((x) => x.id === c.id) ?? c
  return { ...seed, connected: true }
}

export function disconnect(c: Connector): Connector {
  return { ...c, connected: false, health: 'disconnected', warning: undefined }
}

/* ------------------------------------------------------------ invite codes */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateInvite(ws: Workspace, roles: RoleId[], createdBy: string): InviteCode {
  const prefix = ws.tenant.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'NXS'
  const tag = roles.includes('truck_driver') ? 'DRV' : roles.includes('procurement_manager') ? 'PRC' : 'MBR'
  let rand = ''
  for (let i = 0; i < 4; i++) rand += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  const claimedSeats = new Set(ws.invites.map((i) => i.seatUserId).filter(Boolean))
  const seat = roles.includes('truck_driver')
    ? (['usr_jlee', 'usr_rdiaz'] as UserId[]).find((u) => !claimedSeats.has(u) && !ws.members.some((m) => m.userId === u && m.status === 'active'))
    : undefined
  return { code: `${prefix}-${tag}-${rand}`, tenantId: ws.tenant.tenantId, roles, createdBy, createdAt: new Date().toISOString(), seatUserId: seat }
}

/** Adds (or re-activates) the joining user as a member and marks the invite used. */
export function acceptInvite(ws: Workspace, inv: InviteCode, name: string, email: string): { ws: Workspace; userId: UserId } {
  const existing = ws.members.find((m) => m.email.toLowerCase() === email.toLowerCase())
  const userId: UserId = existing?.userId ?? inv.seatUserId ?? (`usr_${email.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}` as UserId)
  const member: Member = { userId, name, email, roles: [...new Set([...(existing?.roles ?? []), ...inv.roles])], grants: existing?.grants ?? [], status: 'active' }
  const members = [...ws.members.filter((m) => m.userId !== userId && m.email.toLowerCase() !== email.toLowerCase()), member]
  return {
    userId,
    ws: {
      ...ws,
      members,
      shipments: ws.shipments.map((sh) => (sh.driverId === userId ? { ...sh, driverName: name } : sh)),
      invites: ws.invites.map((i) => (i.code === inv.code ? { ...i, usedBy: email } : i)),
      audit: [auditEvent(email.split('@')[0], 'Invite accepted', `${inv.code} → ${inv.roles.join(' + ')}`, 'nv', 'team'), ...ws.audit],
    },
  }
}

/** Fills fields added after a workspace was stored (older mock DB entries). */
export function normalizeWorkspace(ws: Workspace): Workspace {
  if (ws.expiry && ws.gold.some((g) => g.name === 'gold.lot_expiry')) return ws
  const expiry = ws.expiry ?? seedExpiry()
  const gold = ws.gold.some((g) => g.name === 'gold.lot_expiry') ? ws.gold : [...ws.gold, ...GOLD_DATASETS.filter((g) => g.name === 'gold.lot_expiry')]
  return { ...ws, expiry, gold: goldWithExpiry(gold, expiry) }
}
