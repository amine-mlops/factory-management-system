import { Check, Cpu, Eye, FileText, Lock, Minus, ShieldAlert, ShieldCheck, Table2 } from 'lucide-react'
import { useState } from 'react'
import type { ModuleId } from '../../data/nav.ts'
import { navItem } from '../../data/nav.ts'
import { can } from '../../lib/access.ts'
import { cx } from '../../lib/format.ts'
import { ragState } from '../../lib/workspace.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import { Badge, Button, Panel } from '../ui/primitives.tsx'

type Status = 'running' | 'simulated' | 'target'
const STATUS: Record<Status, { label: string; tone: 'nv' | 'info' | 'neutral' }> = {
  running: { label: 'Running', tone: 'nv' },
  simulated: { label: 'Simulated in demo', tone: 'info' },
  target: { label: 'Architecture target', tone: 'neutral' },
}

const NODES: Array<{ name: string; detail: string; status: Status; nvidia?: boolean }> = [
  { name: 'React UI', detail: 'This app · role-aware UX only', status: 'running' },
  { name: 'FastAPI gateway', detail: 'Verified identity · tenant + action + scope checks on every call', status: 'simulated' },
  { name: 'Metadata ACL filter', detail: 'Tenant / role / module / scope filter before retrieval', status: 'simulated' },
  { name: 'NVIDIA NIM', detail: 'Embedding + LLM inference microservices', status: 'target', nvidia: true },
  { name: 'NVIDIA NeMo Guardrails', detail: 'Topical and tool-use rails — complements, never replaces, the ACL', status: 'target', nvidia: true },
  { name: 'SQLite prototype store', detail: 'Companies, members, shipments, quotations', status: 'simulated' },
]

/** Request path with honest status labels: nothing marked "architecture target" is called by this demo. */
export function ArchitectureStrip() {
  return (
    <Panel eyebrow="Reference architecture · honest status labels" title="How a request flows">
      <ol className="grid gap-2 sm:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-6">
        {NODES.map((n, i) => {
          const st = STATUS[n.status]
          return (
            <li key={n.name} className="rounded-lg border border-line bg-deck p-3">
              <p className="num text-xs text-muted">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                {n.nvidia && <Cpu className="size-3.5 text-muted" aria-hidden />}
                {n.name}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted">{n.detail}</p>
              <Badge tone={st.tone} className="mt-2">
                {st.label}
              </Badge>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
        Authorization = server-side tenant isolation + role/ACL metadata filtering before retrieval. Guardrails add topical and tool-execution safety on top.
      </p>
    </Panel>
  )
}

const TIER: Record<'bronze' | 'silver' | 'gold' | 'serve', string> = {
  bronze: 'var(--color-tier-bronze)',
  silver: 'var(--color-tier-silver)',
  gold: 'var(--color-tier-gold)',
  serve: 'var(--color-info)',
}

/** The two connected data paths: records → Gold tables, documents → permission-tagged chunks. */
export function DataPaths() {
  const { ws } = useWorkspace()
  const rag = ragState(ws.documents)
  const stale = ws.gold.filter((g) => g.stale)
  const quarantined = ws.connectors.filter((c) => c.connected && c.lastRun.errorKind === 'quality').reduce((s, c) => s + c.errors, 0)
  const failed = ws.connectors.filter((c) => c.connected && c.lastRun.status === 'failed')
  const lanes = [
    {
      icon: Table2,
      title: 'Operational records',
      steps: [
        { k: 'Raw ingestion', sub: 'Bronze', tier: TIER.bronze, stat: `${ws.connectors.filter((c) => c.connected).length} sources · ${failed.length} failed run${failed.length === 1 ? '' : 's'}`, bad: failed.length > 0 },
        { k: 'Validation & cleaning', sub: 'Silver', tier: TIER.silver, stat: quarantined ? `${quarantined} rows quarantined` : 'contracts OK', bad: quarantined > 0 },
        { k: 'Curated Gold tables', sub: 'Gold', tier: TIER.gold, stat: stale.length ? `${stale.map((s) => `${s.name}@${s.version}`).join(', ')} retained · stale` : `${ws.gold.length} datasets current`, bad: stale.length > 0 },
        { k: 'Permission-scoped queries', sub: 'Serve', tier: TIER.serve, stat: 'row filters per grant', bad: false },
      ],
    },
    {
      icon: FileText,
      title: 'PDF documents',
      steps: [
        { k: 'Upload', sub: 'Tenant storage', tier: TIER.bronze, stat: `${ws.documents.length} PDFs`, bad: false },
        { k: 'Extraction & chunking', sub: 'Text', tier: TIER.silver, stat: `${rag.chunks.toLocaleString()} chunks`, bad: false },
        { k: 'Permission-tagged chunks', sub: 'ACL metadata', tier: TIER.gold, stat: 'tenant · modules · roles · scope', bad: false },
        { k: 'Authorized retrieval', sub: 'Serve', tier: TIER.serve, stat: rag.ready ? 'RAG-ready' : `${rag.pending} indexing`, bad: false },
      ],
    },
  ]
  return (
    <Panel eyebrow="Two connected data paths" title="Records → Gold tables · Documents → permission-tagged chunks">
      <div className="space-y-4">
        {lanes.map((lane) => {
          const Icon = lane.icon
          return (
            <div key={lane.title}>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
                <Icon className="size-4 text-muted" aria-hidden /> {lane.title}
              </p>
              <ol className="grid gap-2 @2xl:grid-cols-4">
                {lane.steps.map((s) => (
                  <li key={s.k} className="rounded-md border border-line bg-deck p-3" style={{ borderTopColor: s.tier, borderTopWidth: 2 }}>
                    <p className="eyebrow">{s.sub}</p>
                    <p className="mt-1 text-[13px] font-medium text-fg">{s.k}</p>
                    <p className={cx('num wrap-anywhere mt-1 text-xs', s.bad ? 'font-medium text-warn' : 'text-muted')}>{s.stat}</p>
                  </li>
                ))}
              </ol>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

const CONNECTOR_MODULE: Record<string, ModuleId> = { erp: 'procurement', wms: 'inventory', tms: 'transportation', crm: 'crm', scada: 'manufacturing', s3: 'it' }

/** Configuring a connection and reading its business records are separate grants. */
export function PermissionSeparation() {
  const { ws, perms, me } = useWorkspace()
  const canConfigure = can(perms, 'data', 'configure')
  const [tried, setTried] = useState<Record<string, 'ok' | 'denied'>>({})
  return (
    <Panel eyebrow={`Acting as ${me.name}`} title="Configure connection ≠ read business data" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <caption className="sr-only">Per connector: whether you can configure it and whether you can read its business records</caption>
          <thead>
            <tr className="border-b border-line">
              {['Connector', 'Configure', 'Read records', ''].map((h) => (
                <th key={h} scope="col" className="eyebrow px-3 py-2.5 font-medium">
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ws.connectors.map((c) => {
              const mod = CONNECTOR_MODULE[c.id]
              const read = can(perms, mod, 'read_records')
              const t = tried[c.id]
              return (
                <tr key={c.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">
                    <p className="text-fg">{c.kind}</p>
                    <p className="text-xs text-muted">→ {navItem(mod).label}</p>
                  </td>
                  <td className="px-3 py-2">
                    {canConfigure ? (
                      <span className="flex items-center gap-1.5 text-xs text-fg-2">
                        <Check className="size-4 text-ok" aria-hidden /> Allowed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <Minus className="size-4" aria-hidden /> No
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {read ? (
                      <span className="flex items-center gap-1.5 text-xs text-fg-2">
                        <Check className="size-4 text-ok" aria-hidden /> Allowed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-warn">
                        <Lock className="size-4" aria-hidden /> Denied
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t ? (
                      <span className={cx('text-xs', t === 'ok' ? 'text-fg-2' : 'text-warn')} role="status">
                        {t === 'ok' ? '5 sample rows (mock)' : '403 · schema & health only'}
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" icon={Eye} onClick={() => setTried((x) => ({ ...x, [c.id]: read ? 'ok' : 'denied' }))} aria-label={`Preview ${c.kind} rows`}>
                        Preview rows
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-2 border-t border-line px-3 py-2.5 text-xs text-muted">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
        Data architects manage connections, schemas and pipeline health without reading the business records flowing through them.
      </p>
    </Panel>
  )
}
