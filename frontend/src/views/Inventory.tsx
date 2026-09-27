import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Boxes,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Gift,
  LayoutDashboard,
  ListFilter,
  PackageX,
  PlayCircle,
  RotateCcw,
  ScrollText,
  Search,
  Shuffle,
  Tag,
  TriangleAlert,
  Truck,
  Undo2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { Drawer } from '../components/ui/Drawer.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Button, EmptyState, KeyValues, KpiCard, Meter, Panel } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import type { ActionKind, ExpiryAction, FeedCheck } from '../data/expiry.ts'
import { can } from '../lib/access.ts'
import {
  ACTION_META,
  assessLots,
  canDecide,
  canReadLots,
  canSeeExpiryTech,
  decideAction,
  eventEnvelopes,
  summarize,
  updateRules,
  withScan,
  type ExpirySummary,
  type LotRisk,
  type RulesPatch,
  type Severity,
} from '../lib/expiry.ts'
import { cx, fmtTime, fmtUsd, TONE_TEXT, type Tone } from '../lib/format.ts'
import { useTab } from '../lib/route.ts'
import { useNotify } from '../lib/toast.ts'
import { useNow } from '../lib/useNow.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type InvTab = 'overview' | 'lots' | 'actions' | 'rules'

const SEV: Record<Severity, { tone: Tone; label: string; icon: LucideIcon }> = {
  critical: { tone: 'crit', label: 'Critical', icon: CircleX },
  warning: { tone: 'warn', label: 'Warning', icon: TriangleAlert },
  healthy: { tone: 'nv', label: 'Healthy', icon: CircleCheck },
}

const KIND_ICON: Record<ActionKind, LucideIcon> = { fefo: Shuffle, dispatch: Truck, markdown: Tag, quarantine: PackageX, donation: Gift, supplier_return: RotateCcw }

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

function SeverityBadge({ s }: { s: Severity }) {
  const m = SEV[s]
  const Icon = m.icon
  return (
    <Badge tone={m.tone}>
      <Icon className="size-3" aria-hidden /> {m.label}
    </Badge>
  )
}

const daysText = (d: number) => (d < 0 ? `Expired ${-d} d ago` : d === 0 ? 'Expires today' : `${d} d`)

interface LotFilters {
  severity: Severity | 'all'
  facility: string
  q: string
}

/**
 * Perishable Expiry Guard — simulated autonomous agent over the Gold lot table.
 * Business roles (read_records) see lots, values and proposals; data roles
 * (configure only) get the technical projection: lineage, checks, runs, rule
 * versions and event metadata — never quantities or values.
 */
export function InventoryView() {
  const { ws, perms } = useWorkspace()
  const now = useNow(30_000)
  const business = canReadLots(perms)
  const tech = canSeeExpiryTech(perms)
  const lots = useMemo(() => assessLots(ws.expiry, now), [ws.expiry, now])
  const summary = useMemo(() => summarize(ws.expiry, now), [ws.expiry, now])
  const [filters, setFilters] = useState<LotFilters>({ severity: 'all', facility: 'all', q: '' })
  const [lotId, setLotId] = useState<string | null>(null)
  const tabs: Array<TabDef<InvTab>> = business
    ? [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'lots', label: 'At-Risk Lots', icon: Boxes, badge: summary.atRisk || undefined, badgeTone: summary.critical ? 'crit' : 'warn', badgeLabel: `${summary.atRisk} lots at risk` },
        { id: 'actions', label: 'Agent Actions', icon: ClipboardCheck, badge: summary.proposed || undefined, badgeTone: 'info', badgeLabel: `${summary.proposed} awaiting approval` },
        { id: 'rules', label: 'Rules & Audit', icon: ScrollText },
      ]
    : [
        { id: 'overview', label: 'Pipeline & Checks', icon: Workflow, badge: summary.failingChecks || undefined, badgeTone: 'warn', badgeLabel: `${summary.failingChecks} failing checks` },
        { id: 'rules', label: 'Rules & Audit', icon: ScrollText },
      ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const lot = lots.find((l) => l.id === lotId) ?? null
  const openLots = (f: Partial<LotFilters>) => {
    setFilters((x) => ({ ...x, ...f }))
    setTab('lots')
  }

  return (
    <Page>
      <PageHeader
        eyebrow={`Inventory · ${ws.tenant.name}`}
        title="Perishable Expiry Guard"
        subtitle={
          business
            ? `An agent audits lot expiry every ${ws.expiry.rules.scanMinutes} min, flags risk and proposes mitigations. People approve every action.`
            : 'Technical view: lineage, validation checks, agent runs and rule versions. Lot quantities and values need read access to Inventory.'
        }
        right={
          <>
            <Badge tone="info">Simulated agent · local mock data</Badge>
            {summary.lastRun && (
              <span className="text-xs text-muted">
                Last scan <time className="num text-fg-2" dateTime={summary.lastRun.at}>{clock(summary.lastRun.at)}</time>
                {summary.nextScanAt && (
                  <>
                    {' '}· next <time className="num text-fg-2" dateTime={summary.nextScanAt}>{clock(summary.nextScanAt)}</time>
                  </>
                )}
              </span>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Expiry Guard sections" idBase="inv" />
      <TabPanel idBase="inv" id={tab}>
        {tab === 'overview' && (business ? <BusinessOverview lots={lots} summary={summary} onLots={openLots} onActions={() => setTab('actions')} /> : <TechOverview summary={summary} />)}
        {tab === 'lots' && business && <LotsTab lots={lots} filters={filters} setFilters={setFilters} onOpen={setLotId} />}
        {tab === 'actions' && business && <ActionsTab lots={lots} onLot={setLotId} />}
        {tab === 'rules' && <RulesTab business={business} tech={tech} summary={summary} />}
      </TabPanel>
      <Drawer open={!!lot} onClose={() => setLotId(null)} eyebrow={lot ? `${lot.id} · ${lot.facility}` : undefined} title={lot?.product ?? ''}>
        {lot && <LotDetails lot={lot} />}
      </Drawer>
    </Page>
  )
}

/* ------------------------------------------------------------ overview (business) */

function BusinessOverview({ lots, summary, onLots, onActions }: { lots: LotRisk[]; summary: ExpirySummary; onLots: (f: Partial<LotFilters>) => void; onActions: () => void }) {
  const { ws } = useWorkspace()
  const top = summary.topAction
  const topLot = top ? lots.find((l) => l.id === top.lotId) : undefined
  return (
    <div className="space-y-4">
      <section aria-label="Expiry risk figures" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        <KpiCard label="Lots at risk" value={summary.atRisk} tone={summary.critical ? 'crit' : summary.atRisk ? 'warn' : 'neutral'} delta={`${summary.critical} critical · ${summary.warning} warning`} deltaTone={summary.critical ? 'crit' : 'warn'} footnote={`of ${summary.lots} lots`} onClick={() => onLots({ severity: 'all' })} actionLabel={`${summary.atRisk} lots at risk. Open the lot table`} />
        <KpiCard label="Value at risk" value={fmtUsd(summary.valueAtRisk)} delta={`${fmtUsd(summary.criticalValue)} in critical lots`} deltaTone="crit" footnote="at unit value" />
        <KpiCard label="Facilities affected" value={summary.facilities.length} delta={summary.facilities[0] ? `Most: ${summary.facilities[0].facility}` : 'None'} deltaTone="warn" />
        <KpiCard label="Awaiting approval" value={summary.proposed} delta={`${summary.approved} approved`} deltaTone="nv" onClick={onActions} actionLabel={`${summary.proposed} proposals awaiting approval. Open agent actions`} />
      </section>
      <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="grid min-w-0 items-start gap-4 @3xl:grid-cols-2">
          <Panel eyebrow="Expiring soon" title="Lots by week of expiry">
            <WeekChart summary={summary} />
          </Panel>
          <Panel eyebrow="Affected locations" title={`${summary.facilities.length} facilities`} bodyClassName="p-0">
            {summary.facilities.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">No lots at risk.</p>
            ) : (
              <ul className="divide-y divide-line">
                {summary.facilities.map((f) => (
                  <li key={f.facility}>
                    <button type="button" onClick={() => onLots({ facility: f.facility, severity: 'all' })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised" aria-label={`${f.facility}: ${f.atRisk} lots at risk, ${fmtUsd(f.value, false)}. Show lots`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-fg">{f.facility}</span>
                        <span className="block text-xs text-muted">
                          {f.atRisk} at risk{f.critical ? ` · ${f.critical} critical` : ''}
                        </span>
                      </span>
                      <span className="num text-[13px] text-fg">{fmtUsd(f.value)}</span>
                      <ArrowRight className="size-4 text-muted" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {top && topLot ? (
            <section className="panel border-l-2 border-l-accent p-4" aria-labelledby="top-action">
              <p className="eyebrow text-accent-2">Top recommended action</p>
              <h2 id="top-action" className="mt-1.5 text-base font-semibold leading-snug text-fg">
                {top.title}
              </h2>
              <p className="mt-1 text-[13px] text-fg-2">{top.rationale}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="nv">{fmtUsd(top.valueProtected, false)} protected</Badge>
                <Badge tone="neutral">Confidence {Math.round(top.confidence * 100)}%</Badge>
                {top.external ? <Badge tone="warn">Human approval required · external</Badge> : <Badge tone="neutral">Internal · approval required</Badge>}
              </div>
              <div className="mt-3 flex justify-end">
                <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={onActions}>
                  Review agent actions
                </Button>
              </div>
            </section>
          ) : (
            <Panel title="No open proposals">
              <p className="text-[13px] text-muted">Every proposal has been decided.</p>
            </Panel>
          )}
          <AgentStatus summary={summary} />
        </div>
      </div>
      <p className="text-xs text-muted">
        Source: {ws.expiry.feed.dataset}@{ws.expiry.feed.version} as of {clock(ws.expiry.feed.asOf)} · {ws.expiry.feed.rejected.length ? `${ws.expiry.feed.rejected.length} rows failed validation and are excluded` : 'all rows validated'}.
      </p>
    </div>
  )
}

function WeekChart({ summary }: { summary: ExpirySummary }) {
  const { ws } = useWorkspace()
  const max = Math.max(1, ...summary.weeks.map((w) => w.count))
  const BG: Record<Severity, string> = { critical: 'bg-crit', warning: 'bg-warn', healthy: 'bg-accent/70' }
  return (
    <figure>
      <div className="flex h-36 items-end gap-2 border-b border-line" role="img" aria-label={`Lots expiring by week: ${summary.weeks.map((w) => `${w.label} ${w.count}`).join(', ')}`}>
        {summary.weeks.map((w) => (
          <div key={w.label} className="flex h-full flex-1 flex-col items-center justify-end">
            <span className="num mb-1 text-xs font-semibold text-fg">{w.count}</span>
            <div className={cx('w-full max-w-10 rounded-t-sm', BG[w.severity])} style={{ height: `${(w.count / max) * 100}%`, minHeight: w.count ? 4 : 0 }} />
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 flex gap-2">
        {summary.weeks.map((w) => (
          <span key={w.label} className="flex-1 text-center text-xs text-muted">
            {w.label}
          </span>
        ))}
      </figcaption>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-crit" aria-hidden /> Critical ≤ {ws.expiry.rules.criticalDays} d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-warn" aria-hidden /> Warning ≤ {ws.expiry.rules.warningDays} d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent/70" aria-hidden /> Healthy
        </span>
      </p>
    </figure>
  )
}

function AgentStatus({ summary }: { summary: ExpirySummary }) {
  const { ws, perms, update } = useWorkspace()
  const notify = useNotify()
  const canRun = can(perms, 'inventory', 'manage') || can(perms, 'inventory', 'configure')
  const run = summary.lastRun
  const scan = () => {
    update((w) => withScan(w, new Date(), 'manual'))
    notify('Expiry scan completed (simulated)', 'info')
  }
  return (
    <Panel eyebrow="Agent" title="Scan status" actions={canRun ? <Button size="sm" icon={PlayCircle} onClick={scan}>Run scan now</Button> : undefined}>
      {run ? (
        <KeyValues
          items={[
            ['Last run', <span key="r" className="num">{run.id} · {clock(run.at)}</span>],
            ['Result', run.status === 'ok' ? 'OK' : run.status === 'partial' ? `Partial · ${run.rowsRejected} rows rejected` : 'Failed'],
            ['Next scheduled', summary.nextScanAt ? <span key="n" className="num">{clock(summary.nextScanAt)} (every {ws.expiry.rules.scanMinutes} min)</span> : '—'],
            ['Rules', `v${ws.expiry.rules.version}`],
          ]}
        />
      ) : (
        <p className="text-[13px] text-muted">No scan has run yet.</p>
      )}
      <p className="mt-3 text-xs text-muted">Runs in this browser on the mock store — no live data source is contacted.</p>
    </Panel>
  )
}

/* ------------------------------------------------------------ lots */

type SortKey = 'product' | 'facility' | 'qty' | 'days' | 'severity' | 'value'
const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, healthy: 2 }

function LotsTab({ lots, filters, setFilters, onOpen }: { lots: LotRisk[]; filters: LotFilters; setFilters: (fn: (f: LotFilters) => LotFilters) => void; onOpen: (id: string) => void }) {
  const { ws } = useWorkspace()
  const searchId = useId()
  const facilityId = useId()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'days', dir: 1 })
  const facilities = [...new Set(lots.map((l) => l.facility))]
  const q = filters.q.trim().toLowerCase()
  const shown = lots
    .filter((l) => (filters.severity === 'all' || l.severity === filters.severity) && (filters.facility === 'all' || l.facility === filters.facility) && (!q || `${l.sku} ${l.product} ${l.batch} ${l.id}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      const cmp =
        sort.key === 'product'
          ? a.product.localeCompare(b.product)
          : sort.key === 'facility'
            ? a.facility.localeCompare(b.facility)
            : sort.key === 'qty'
              ? a.qty - b.qty
              : sort.key === 'days'
                ? a.days - b.days
                : sort.key === 'severity'
                  ? SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.days - b.days
                  : a.valueAtRisk - b.valueAtRisk || a.value - b.value
      return cmp * sort.dir
    })
  const count = (s: Severity) => lots.filter((l) => l.severity === s).length
  const head = (key: SortKey | null, label: string, className?: string) => {
    const active = key && sort.key === key
    return (
      <th key={label} scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className={cx('eyebrow whitespace-nowrap px-3 py-2 font-medium', className)}>
        {key ? (
          <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))} className="inline-flex items-center gap-1 rounded-sm uppercase hover:text-fg">
            {label}
            {active ? sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-60" aria-hidden />}
          </button>
        ) : (
          label
        )}
      </th>
    )
  }
  return (
    <Panel
      eyebrow={`${ws.expiry.feed.dataset}@${ws.expiry.feed.version} · as of ${clock(ws.expiry.feed.asOf)}`}
      title={`Showing ${shown.length} of ${lots.length} lots`}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <div className="flex rounded-md border border-line-2 p-0.5" role="group" aria-label="Filter by severity">
          {(['all', 'critical', 'warning', 'healthy'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={filters.severity === s} onClick={() => setFilters((f) => ({ ...f, severity: s }))} className={cx('h-8 rounded-sm px-2.5 text-xs font-medium', filters.severity === s ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>
              {s === 'all' ? `All ${lots.length}` : `${SEV[s].label} ${count(s)}`}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor={facilityId} className="mb-1 block text-xs font-medium text-muted">
            Facility
          </label>
          <select id={facilityId} value={filters.facility} onChange={(e) => setFilters((f) => ({ ...f, facility: e.target.value }))} className="h-9 rounded-md border border-field bg-deck px-2 text-[13px] text-fg-2">
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-muted">
            Search SKU, product or batch
          </label>
          <div className="flex h-9 items-center gap-2 rounded-md border border-field bg-deck px-2.5 focus-within:border-accent">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input id={searchId} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" placeholder="e.g. GS-80" />
          </div>
        </div>
        {(filters.severity !== 'all' || filters.facility !== 'all' || filters.q) && (
          <Button size="sm" variant="ghost" icon={ListFilter} onClick={() => setFilters(() => ({ severity: 'all', facility: 'all', q: '' }))}>
            Clear filters
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Boxes} title="No lots match these filters" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-[13px]">
            <caption className="sr-only">Lots with expiry, severity and value at risk. Column headers sort the table.</caption>
            <thead>
              <tr className="border-b border-line">
                {head('product', 'Product / SKU')}
                {head(null, 'Batch')}
                {head('facility', 'Facility')}
                {head('qty', 'Quantity')}
                {head('days', 'Expiry · days left')}
                {head('severity', 'Severity')}
                {head('value', 'Value at risk')}
                {head(null, 'Source')}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className={cx('border-b border-line/60 last:border-0', l.severity === 'critical' && 'bg-crit/[0.04]')}>
                  <td className="px-3 py-2">
                    <p className="text-fg">{l.product}</p>
                    <p className="num text-xs text-muted">
                      {l.sku} · {l.id}
                    </p>
                  </td>
                  <td className="num px-3 py-2 text-fg-2">{l.batch}</td>
                  <td className="px-3 py-2 text-fg-2">{l.facility}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-fg-2">
                    {l.qty} {l.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <p className="num text-fg-2">{l.expiry}</p>
                    <p className={cx('num text-xs', TONE_TEXT[SEV[l.severity].tone])}>{daysText(l.days)}</p>
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge s={l.severity} />
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-fg">
                    {l.valueAtRisk ? fmtUsd(l.valueAtRisk, false) : <span className="text-muted">—</span>}
                    {l.valuationEstimated && <p className="text-xs text-warn">estimated</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                    <span className="num">{ws.expiry.feed.version}</span> · WMS + ERP
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(l.id)} aria-label={`Details for ${l.id}`}>
                      Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function LotDetails({ lot }: { lot: LotRisk }) {
  const { ws } = useWorkspace()
  const acts = ws.expiry.actions.filter((a) => a.lotId === lot.id)
  const sup = lot.supplierId ? ws.suppliers.find((s) => s.id === lot.supplierId) : undefined
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <SeverityBadge s={lot.severity} />
        <Badge tone="neutral">{lot.storage}</Badge>
      </div>
      <KeyValues
        items={[
          ['SKU', <span key="s" className="num">{lot.sku}</span>],
          ['Batch', <span key="b" className="num">{lot.batch}</span>],
          ['Facility', lot.facility],
          ['Quantity', `${lot.qty} ${lot.unit}`],
          ['Expiry date', <span key="e" className="num">{lot.expiry}</span>],
          ['Days left', daysText(lot.days)],
          ['Unit value', `${fmtUsd(lot.unitValue, false)}${lot.valuationEstimated ? ' (last cost — estimated)' : ''}`],
          ['Lot value', fmtUsd(lot.value, false)],
          ...(sup ? ([['Supplier', `${sup.name} · ${sup.contract}`]] as Array<[string, string]>) : []),
        ]}
      />
      <div>
        <p className="eyebrow mb-2">Agent proposals for this lot</p>
        {acts.length === 0 ? (
          <p className="text-[13px] text-muted">None — the lot is outside the risk windows or awaits the next scan.</p>
        ) : (
          <ul className="space-y-1.5">
            {acts.map((a) => (
              <li key={a.id} className="rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="num text-muted">{a.id}</span>
                  <StatusBadge a={a} />
                </p>
                <p className="mt-0.5 text-fg-2">{a.title}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">
        Record from {ws.expiry.feed.dataset}@{ws.expiry.feed.version} (WMS lot master joined with ERP valuation), as of {clock(ws.expiry.feed.asOf)}. Mock data.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------ actions */

function StatusBadge({ a }: { a: ExpiryAction }) {
  if (a.status === 'approved') return <Badge tone="nv">Approved</Badge>
  if (a.status === 'dismissed') return <Badge tone="neutral">Dismissed</Badge>
  return <Badge tone="info">Awaiting approval</Badge>
}

function ActionsTab({ lots, onLot }: { lots: LotRisk[]; onLot: (id: string) => void }) {
  const { ws, perms, update, log, me } = useWorkspace()
  const notify = useNotify()
  const [filter, setFilter] = useState<'proposed' | 'approved' | 'dismissed' | 'all'>('proposed')
  const all = ws.expiry.actions
  const shown = all.filter((a) => filter === 'all' || a.status === filter)
  const pendingValue = all.filter((a) => a.status === 'proposed').reduce((s, a) => s + a.valueProtected, 0)
  const decide = (a: ExpiryAction, status: ExpiryAction['status']) => {
    if (!canDecide(perms, a)) return
    const who = me.email.split('@')[0] || me.name
    update((w) => ({ ...w, expiry: decideAction(w.expiry, a.id, status, who, new Date()) }))
    const verb = status === 'approved' ? 'approved' : status === 'dismissed' ? 'dismissed' : 'reopened'
    log(`Expiry action ${verb}`, `${a.id} · ${a.title}${status === 'approved' && a.external ? ' · external hand-off queued (simulated — nothing sent)' : ''}`, status === 'approved' ? 'nv' : 'info', 'inventory')
    notify(`${a.id} ${verb}${status === 'approved' && a.external ? ' — hand-off queued (simulated)' : ''}`, status === 'approved' ? 'nv' : 'info')
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-2">
          <span className="font-semibold text-fg">{all.filter((a) => a.status === 'proposed').length} awaiting approval</span> · {fmtUsd(pendingValue, false)} protected if approved ·{' '}
          <span className="text-muted">the agent never executes on its own</span>
        </p>
        <div className="flex rounded-md border border-line-2 p-0.5" role="group" aria-label="Filter proposals">
          {(['proposed', 'approved', 'dismissed', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cx('h-8 rounded-sm px-2.5 text-xs font-medium capitalize', filter === f ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>
              {f === 'proposed' ? 'Awaiting' : f} {f === 'all' ? all.length : all.filter((a) => a.status === f).length}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <Panel title="Nothing here">
          <EmptyState icon={ClipboardCheck} title={filter === 'proposed' ? 'No proposals awaiting approval' : `No ${filter} proposals`} />
        </Panel>
      ) : (
        <ul className="panel divide-y divide-line" aria-label="Agent proposals">
          {shown.map((a) => {
            const lot = lots.find((l) => l.id === a.lotId)
            const Icon = KIND_ICON[a.kind]
            const allowed = canDecide(perms, a)
            const below = a.confidence < ws.expiry.rules.minConfidence
            return (
              <li key={a.id} className={cx('grid gap-x-4 gap-y-2 px-4 py-3 @4xl:grid-cols-[minmax(0,1fr)_auto]', a.status === 'dismissed' && 'opacity-80')}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <Icon className="size-4 text-fg-2" aria-hidden />
                    <span className="font-medium text-fg-2">{ACTION_META[a.kind].label}</span>
                    <span className="num">{a.id}</span>
                    <StatusBadge a={a} />
                    {a.external ? <Badge tone="warn">Human approval required · external</Badge> : <Badge tone="neutral">Internal</Badge>}
                    {below && <Badge tone="warn">Below confidence threshold</Badge>}
                  </p>
                  <h2 className="mt-1 text-sm font-semibold leading-snug text-fg">{a.title}</h2>
                  <p className="mt-0.5 text-xs text-fg-2">
                    {a.rationale}{' '}
                    {a.policy.map((pp) => (
                      <span key={`${pp.document}-${pp.page}`} className="num ml-1 whitespace-nowrap text-muted">
                        [FEFO policy p.{pp.page}]
                      </span>
                    ))}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    {lot && (
                      <button type="button" onClick={() => onLot(lot.id)} className="rounded-sm underline-offset-2 hover:text-fg hover:underline">
                        {lot.id} · {lot.facility} · {daysText(lot.days)}
                      </button>
                    )}
                    <span>
                      Impact <span className="num font-semibold text-fg">{a.valueProtected ? `${fmtUsd(a.valueProtected, false)} protected` : 'compliance'}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      Confidence
                      <Meter value={a.confidence} tone={below ? 'warn' : 'info'} className="w-14" label={`Confidence ${Math.round(a.confidence * 100)}%`} />
                      <span className="num text-fg">{Math.round(a.confidence * 100)}%</span>
                    </span>
                    <span>Approver: {a.route === 'procurement' ? 'Procurement' : 'Inventory manager'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 @4xl:flex-col @4xl:items-end @4xl:justify-center">
                  {a.status !== 'proposed' && (
                    <span className="text-xs text-muted">
                      {a.status === 'approved' ? 'Approved' : 'Dismissed'} by {a.decidedBy} · {a.decidedAt ? fmtTime(a.decidedAt) : '—'}
                      {a.status === 'approved' && a.external ? ' · hand-off queued (simulated)' : ''}
                    </span>
                  )}
                  {!allowed ? (
                    <span className="text-xs text-muted">View only · needs {a.route === 'procurement' ? 'procurement or inventory' : 'inventory'} manage</span>
                  ) : a.status === 'proposed' ? (
                    <span className="flex gap-2">
                      <Button size="sm" icon={Ban} onClick={() => decide(a, 'dismissed')} aria-label={`Dismiss ${a.id}`}>
                        Dismiss
                      </Button>
                      <Button size="sm" variant="primary" icon={CircleCheck} onClick={() => decide(a, 'approved')} aria-label={`Approve ${a.id}: ${a.title}`}>
                        Approve
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" icon={Undo2} onClick={() => decide(a, 'proposed')} aria-label={`Undo decision on ${a.id}`}>
                      Undo
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ technical projection */

const CHECK: Record<FeedCheck['status'], { icon: LucideIcon; cls: string; label: string }> = {
  pass: { icon: CircleCheck, cls: 'text-ok', label: 'Pass' },
  warn: { icon: TriangleAlert, cls: 'text-warn', label: 'Warning' },
  fail: { icon: CircleX, cls: 'text-crit', label: 'Fail' },
}

function ChecksList() {
  const { ws } = useWorkspace()
  return (
    <ul className="divide-y divide-line">
      {ws.expiry.feed.checks.map((c) => {
        const m = CHECK[c.status]
        const Icon = m.icon
        return (
          <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
            <Icon className={cx('mt-0.5 size-4 shrink-0', m.cls)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-fg">{c.name}</span>
              <span className="block text-xs text-muted">{c.detail}</span>
            </span>
            <span className={cx('text-xs font-medium', m.cls)}>{m.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Lineage() {
  const { ws } = useWorkspace()
  const f = ws.expiry.feed
  const steps: Array<[string, string, string]> = [
    ['Sources', 'WMS lot master + ERP valuation', `${f.sources.map((x) => x.toUpperCase()).join(' + ')}`],
    ['Bronze', 'Raw landing', 'wms_lots_*.csv · erp_valuation'],
    ['Silver', `${f.checks.length} validation checks`, `${f.rejected.length} rows quarantined`],
    ['Gold', `${f.dataset}@${f.version}`, `as of ${clock(f.asOf)}`],
    ['Agent', `Expiry Guard · rules v${ws.expiry.rules.version}`, `every ${ws.expiry.rules.scanMinutes} min`],
    ['Events', 'expiry.risk / action / scan', 'to Inventory + Admin alerts'],
  ]
  return (
    <ol className="grid gap-2 sm:grid-cols-3 @6xl:grid-cols-6" aria-label="Lineage from sources to events">
      {steps.map(([k, v, sub], i) => (
        <li key={k} className="relative rounded-md border border-line bg-deck p-3">
          <p className="eyebrow">
            {i + 1} · {k}
          </p>
          <p className="num wrap-anywhere mt-1 text-[13px] text-fg">{v}</p>
          <p className="num mt-0.5 text-xs text-muted">{sub}</p>
        </li>
      ))}
    </ol>
  )
}

function TechOverview({ summary }: { summary: ExpirySummary }) {
  const { ws } = useWorkspace()
  const run = summary.lastRun
  return (
    <div className="space-y-4">
      <section aria-label="Pipeline figures" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        <KpiCard label="Last run" value={run ? run.status.toUpperCase() : '—'} tone={run?.status === 'ok' ? 'nv' : 'warn'} delta={run ? `${run.id} · ${clock(run.at)}` : 'no runs'} deltaTone="info" />
        <KpiCard label="Rows rejected" value={ws.expiry.feed.rejected.length} tone={ws.expiry.feed.rejected.length ? 'warn' : 'neutral'} delta="quarantined in Silver" deltaTone="info" />
        <KpiCard label="Checks" value={`${summary.failingChecks + summary.warningChecks}/${ws.expiry.feed.checks.length}`} delta={`${summary.failingChecks} failing · ${summary.warningChecks} warning`} deltaTone={summary.failingChecks ? 'crit' : 'warn'} />
        <KpiCard label="Feed freshness" value={clock(ws.expiry.feed.asOf)} delta={ws.expiry.feed.stale ? 'stale' : 'within 30 min SLA'} deltaTone={ws.expiry.feed.stale ? 'warn' : 'nv'} />
      </section>
      <Panel eyebrow="Lineage" title="Sources → Bronze → Silver → Gold → agent → events">
        <Lineage />
      </Panel>
      <div className="grid gap-4 @4xl:grid-cols-2">
        <Panel eyebrow="Silver validation" title="Data checks" bodyClassName="p-0">
          <ChecksList />
        </Panel>
        <RejectedRows />
      </div>
    </div>
  )
}

function RejectedRows() {
  const { ws } = useWorkspace()
  return (
    <Panel eyebrow="Quarantined rows · metadata" title={`${ws.expiry.feed.rejected.length} rejected rows`} bodyClassName="p-0">
      {ws.expiry.feed.rejected.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No rows rejected in the latest load.</p>
      ) : (
        <ul className="divide-y divide-line">
          {ws.expiry.feed.rejected.map((r) => (
            <li key={r.row} className="px-4 py-2.5 text-[13px]">
              <p className="num wrap-anywhere text-fg">{r.row}</p>
              <p className="text-xs text-muted">
                <span className="num">{r.field}</span> = <span className="num text-warn">“{r.value}”</span> — {r.error}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Fix: accept dd/mm/yyyy in the Silver contract or ask the WMS admin to export ISO dates; the month-13 row needs an upstream correction.</p>
    </Panel>
  )
}

/* ------------------------------------------------------------ rules & audit */

function RulesTab({ business, tech, summary }: { business: boolean; tech: boolean; summary: ExpirySummary }) {
  const { ws } = useWorkspace()
  const events = ws.audit.filter((e) => e.resource === 'inventory' && (business || /scan|rules/i.test(e.action)))
  return (
    <div className="space-y-4">
      <div className="grid gap-4 @4xl:grid-cols-2">
        <RulesForm />
        <Panel eyebrow="Agent runs" title="Recent scans" bodyClassName="p-0">
          <RunsTable />
          {business && <div className="border-t border-line p-4"><AgentStatusInline summary={summary} /></div>}
        </Panel>
      </div>
      <div className="grid gap-4 @4xl:grid-cols-2">
        <Panel eyebrow="Silver validation" title="Data checks" bodyClassName="p-0">
          <ChecksList />
        </Panel>
        {tech ? <EventMetadata /> : <RejectedCount />}
      </div>
      <Panel eyebrow={business ? 'Audit trail · Inventory' : 'Audit trail · scans and rule changes'} title={`${events.length} events`} bodyClassName="p-0">
        {events.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">No events yet — approvals, dismissals, scans and rule changes appear here.</p>
        ) : (
          <ol className="terminal m-3 divide-y divide-line">
            {events.slice(0, 10).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                <span className="t-dim w-16 shrink-0">{e.time}</span>
                <span className="t-key">{e.action}</span>
                <span className="wrap-anywhere min-w-0 flex-1">{e.detail}</span>
                <span className="t-dim">{e.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}

function RejectedCount() {
  const { ws } = useWorkspace()
  return (
    <Panel eyebrow="Data quality" title={`${ws.expiry.feed.rejected.length} lot rows excluded`}>
      <p className="text-[13px] text-fg-2">Rows that fail validation never reach the agent, so their lots are not scored. The data team sees the row-level evidence.</p>
    </Panel>
  )
}

function AgentStatusInline({ summary }: { summary: ExpirySummary }) {
  return (
    <p className="text-xs text-muted">
      Next scheduled scan {summary.nextScanAt ? <time className="num text-fg-2" dateTime={summary.nextScanAt}>{clock(summary.nextScanAt)}</time> : '—'} · manual scans are available on the Overview tab.
    </p>
  )
}

function RunsTable() {
  const { ws } = useWorkspace()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="sr-only">Recent Expiry Guard runs</caption>
        <thead>
          <tr className="border-b border-line">
            {['Run', 'Time', 'Result', 'Scanned', 'Rejected', 'Rules', 'Source'].map((h) => (
              <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ws.expiry.runs.slice(0, 5).map((r) => (
            <tr key={r.id} className="border-b border-line/60 last:border-0">
              <td className="num px-3 py-2 text-fg">{r.id}</td>
              <td className="num px-3 py-2 text-fg-2">{clock(r.at)}</td>
              <td className="px-3 py-2">{r.status === 'ok' ? <Badge tone="nv">OK</Badge> : r.status === 'partial' ? <Badge tone="warn">Partial</Badge> : <Badge tone="crit">Failed</Badge>}</td>
              <td className="num px-3 py-2 text-fg-2">{r.lotsScanned}</td>
              <td className={cx('num px-3 py-2', r.rowsRejected ? 'text-warn' : 'text-fg-2')}>{r.rowsRejected}</td>
              <td className="num px-3 py-2 text-fg-2">v{r.ruleVersion}</td>
              <td className="num px-3 py-2 text-xs text-muted">
                {r.sourceVersion.split('@')[1]} · {r.trigger}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventMetadata() {
  const { ws, perms } = useWorkspace()
  const now = useNow(60_000)
  const env = eventEnvelopes(ws.expiry, now)
  const redacted = !canReadLots(perms)
  return (
    <Panel eyebrow="Event payload metadata" title="Emitted events (latest run)" bodyClassName="p-0">
      <ul className="divide-y divide-line">
        {env.map((e) => (
          <li key={e.type} className="px-4 py-2.5 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              <span className="num text-fg">{e.type}</span>
              <Badge tone="neutral">×{e.count}</Badge>
              <span className="num text-xs text-muted">schema {e.schema}</span>
            </p>
            <p className="num wrap-anywhere mt-1 text-xs text-muted">
              {'{ '}
              {e.fields.map((f) => `${f}: ${redacted && /value|qty|sku|lot_id|facility|days/.test(f) ? '•••' : '…'}`).join(', ')}
              {' }'}
            </p>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{redacted ? 'Payload values are redacted — reading them needs read_records on Inventory.' : 'Envelope metadata only; full payloads live in the event store (architecture target).'}</p>
    </Panel>
  )
}

function RulesForm() {
  const { ws, perms, update, log, me } = useWorkspace()
  const notify = useNotify()
  const r = ws.expiry.rules
  const editable = can(perms, 'inventory', 'manage')
  const [draft, setDraft] = useState({ criticalDays: String(r.criticalDays), warningDays: String(r.warningDays), scanMinutes: String(r.scanMinutes), markdownMaxPct: String(r.markdownMaxPct), minConfidence: String(r.minConfidence) })
  const [error, setError] = useState<string | null>(null)
  const ids = { c: useId(), w: useId(), s: useId(), m: useId(), k: useId(), e: useId() }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!editable) return
    const patch: RulesPatch = { criticalDays: Number(draft.criticalDays), warningDays: Number(draft.warningDays), scanMinutes: Number(draft.scanMinutes), markdownMaxPct: Number(draft.markdownMaxPct), minConfidence: Number(draft.minConfidence) }
    const res = updateRules(ws.expiry, patch, me.email.split('@')[0] || me.name, new Date())
    if ('error' in res) {
      setError(res.error)
      return
    }
    setError(null)
    update((w) => ({ ...w, expiry: res.state }))
    log('Expiry rules updated', `v${res.state.rules.version}: ${res.change}`, 'info', 'inventory')
    notify(`Rules v${res.state.rules.version} saved — lots re-classified (demo)`, 'nv')
  }
  const field = 'h-9 w-full rounded-md border border-field bg-deck px-2.5 text-[13px] text-fg outline-none focus:border-accent disabled:opacity-70'
  return (
    <Panel eyebrow={`Rules v${r.version} · updated ${clock(r.updatedAt)} by ${r.updatedBy}`} title="Thresholds & cadence">
      <form onSubmit={save} noValidate aria-describedby={error ? ids.e : undefined} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={ids.c} className="mb-1 block text-xs font-medium text-muted">
              Critical within (days)
            </label>
            <input id={ids.c} type="number" inputMode="numeric" min={0} max={60} disabled={!editable} value={draft.criticalDays} onChange={(e) => setDraft((d) => ({ ...d, criticalDays: e.target.value }))} className={field} />
          </div>
          <div>
            <label htmlFor={ids.w} className="mb-1 block text-xs font-medium text-muted">
              Warning within (days)
            </label>
            <input id={ids.w} type="number" inputMode="numeric" min={1} max={120} disabled={!editable} value={draft.warningDays} onChange={(e) => setDraft((d) => ({ ...d, warningDays: e.target.value }))} className={field} />
          </div>
          <div>
            <label htmlFor={ids.s} className="mb-1 block text-xs font-medium text-muted">
              Scan every
            </label>
            <select id={ids.s} disabled={!editable} value={draft.scanMinutes} onChange={(e) => setDraft((d) => ({ ...d, scanMinutes: e.target.value }))} className={field}>
              {[5, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.m} className="mb-1 block text-xs font-medium text-muted">
              Markdown cap (%)
            </label>
            <input id={ids.m} type="number" inputMode="numeric" min={0} max={60} disabled={!editable} value={draft.markdownMaxPct} onChange={(e) => setDraft((d) => ({ ...d, markdownMaxPct: e.target.value }))} className={field} />
          </div>
          <div>
            <label htmlFor={ids.k} className="mb-1 block text-xs font-medium text-muted">
              Min. confidence
            </label>
            <input id={ids.k} type="number" inputMode="decimal" step={0.05} min={0.3} max={0.95} disabled={!editable} value={draft.minConfidence} onChange={(e) => setDraft((d) => ({ ...d, minConfidence: e.target.value }))} className={field} />
          </div>
        </div>
        {error && (
          <p id={ids.e} role="alert" className="text-[13px] text-crit-2">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-sm text-xs text-muted">Demo setting — saving changes this browser’s mock store and re-classifies lots at once. It is not a production control.</p>
          {editable ? (
            <Button type="submit" variant="primary" size="sm">
              Save rules
            </Button>
          ) : (
            <span className="text-xs text-muted">Read only — needs the inventory manage grant.</span>
          )}
        </div>
      </form>
      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-xs font-medium text-fg-2">Rule history ({ws.expiry.ruleHistory.length} versions)</summary>
        <ol className="mt-2 space-y-1.5">
          {ws.expiry.ruleHistory.map((h) => (
            <li key={h.version} className="flex flex-wrap gap-x-2 text-xs">
              <span className="num font-semibold text-fg">v{h.version}</span>
              <span className="num text-muted">{new Date(h.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
              <span className="text-muted">{h.by}</span>
              <span className="text-fg-2">{h.change}</span>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  )
}
