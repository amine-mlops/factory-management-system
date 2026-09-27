import { AlertTriangle, ArrowRight, BookOpen, Check, CircleCheck, ClipboardList, Clock, ListChecks, MapPin, Navigation, Package, Sparkles, TriangleAlert, Truck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { AssistantPanel } from '../components/assistant/AssistantPanel.tsx'
import { Drawer } from '../components/ui/Drawer.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Button, EmptyState, KeyValues, KpiCard, Panel } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import type { Shipment, ShipmentStatus } from '../data/logistics.ts'
import { can, scopeOf } from '../lib/access.ts'
import { cx, type Tone } from '../lib/format.ts'
import { useRoute, useTab } from '../lib/route.ts'
import { useNotify } from '../lib/toast.ts'
import { useOpsModel } from '../lib/useOps.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type TrTab = 'today' | 'deliveries' | 'briefing' | 'exceptions'

const STATUS_TONE: Record<ShipmentStatus, Tone> = { Scheduled: 'neutral', Loading: 'info', 'In transit': 'info', Arrived: 'nv', Delivered: 'nv', Delayed: 'warn' }
const ALL_STATUS = Object.keys(STATUS_TONE) as ShipmentStatus[]
const NEXT: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  Scheduled: ['Loading', 'In transit'],
  Loading: ['In transit'],
  'In transit': ['Arrived', 'Delayed'],
  Delayed: ['In transit', 'Arrived'],
  Arrived: ['Delivered'],
}
const ACTION_LABEL: Record<ShipmentStatus, string> = {
  Scheduled: 'Mark scheduled',
  Loading: 'Start loading',
  'In transit': 'Depart · in transit',
  Arrived: 'Mark arrived',
  Delivered: 'Confirm delivered',
  Delayed: 'Report delay',
}

const SHIFT_TASKS = [
  { id: 'inspect', label: 'Pre-trip vehicle inspection' },
  { id: 'seals', label: 'Verify seal numbers on ADR loads' },
  { id: 'docs', label: 'Carry the wash-out certificate for food-grade stops' },
  { id: 'fuel', label: 'Log fuel and odometer at end of shift' },
]

/** Shared shipment state + guarded actions (UX mirror of the backend's update_status / manage checks). */
function useShipments() {
  const { ws, update, log, perms, actingUserId } = useWorkspace()
  const notify = useNotify()
  const assigned = scopeOf(perms, 'transportation') === 'assigned'
  const visible = (assigned ? ws.shipments.filter((s) => s.driverId === actingUserId) : ws.shipments).slice().sort((a, b) => (a.driverName + a.stopOrder).localeCompare(b.driverName + b.stopOrder))
  const canUpdate = can(perms, 'transportation', 'update_status')
  const canManage = can(perms, 'transportation', 'manage')
  const eta = ws.gold.find((g) => g.name === 'gold.shipments_eta')
  const tms = ws.connectors.find((c) => c.id === 'tms')
  const drivers = ws.members.filter((m) => m.roles.includes('truck_driver'))

  const setStatus = (sh: Shipment, status: ShipmentStatus) => {
    if (!canUpdate || (assigned && sh.driverId !== actingUserId)) return
    update((w) => ({ ...w, shipments: w.shipments.map((x) => (x.id === sh.id ? { ...x, status } : x)) }))
    log('Shipment status updated', `${sh.id} → ${status} (${sh.customer})`, status === 'Delayed' ? 'warn' : 'nv', 'transportation')
    notify(`${sh.id} marked ${status}`, status === 'Delayed' ? 'warn' : 'nv')
  }
  const assign = (sh: Shipment, driverId: string) => {
    if (!canManage) return
    const d = drivers.find((x) => x.userId === driverId)
    update((w) => ({ ...w, shipments: w.shipments.map((x) => (x.id === sh.id ? { ...x, driverId: d?.userId ?? null, driverName: d?.name ?? 'Unassigned' } : x)) }))
    log('Shipment reassigned', `${sh.id} → ${d?.name ?? 'Unassigned'}`, 'info', 'transportation')
    notify(`${sh.id} assigned to ${d?.name ?? 'nobody'}`, 'info')
  }
  return { visible, assigned, canUpdate, canManage, setStatus, assign, drivers, stale: !!eta?.stale, etaAsOf: eta?.asOf ?? '—', tmsFailedAt: tms?.lastRun.status === 'failed' ? tms.lastRun.at : null }
}

type ShipCtl = ReturnType<typeof useShipments>

export function TransportationView() {
  const { ws, me } = useWorkspace()
  const ctl = useShipments()
  const [tasks, setTasks] = useState<Record<string, boolean>>({ inspect: true })
  const [detail, setDetail] = useState<string | null>(null)
  const open = ctl.visible.filter((s) => s.status !== 'Delivered')
  const exceptions = exceptionsFor(ctl)
  const tabs: Array<TabDef<TrTab>> = [
    { id: 'today', label: 'Today', icon: Navigation },
    { id: 'deliveries', label: 'Deliveries', icon: Package, badge: open.length, badgeLabel: `${open.length} open` },
    { id: 'briefing', label: 'AI Briefing', icon: Sparkles },
    { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle, badge: exceptions.length || undefined, badgeTone: 'warn', badgeLabel: `${exceptions.length} exceptions` },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const sel = ctl.visible.find((s) => s.id === detail) ?? null

  return (
    <Page>
      <PageHeader
        eyebrow={ctl.assigned ? `Transportation · Driver · ${ws.tenant.name}` : `Transportation · Dispatch · ${ws.tenant.name}`}
        title={ctl.assigned ? `Today's route · ${me.name}` : 'Shipments & drivers'}
        subtitle={
          ctl.assigned
            ? `${ctl.visible[0]?.vehicle ?? 'No vehicle assigned'} · ${open.length} open stop${open.length === 1 ? '' : 's'} · you see only deliveries assigned to you`
            : `${ctl.visible.length} shipments · drivers only ever see the stops assigned to them`
        }
        right={
          <>
            <Badge tone="info">{ctl.assigned ? 'Scope · assigned only' : 'Scope · whole company'}</Badge>
            {ctl.canUpdate && <Badge tone="nv">Can update status</Badge>}
            {ctl.canManage && <Badge tone="nv">Can assign</Badge>}
          </>
        }
      />
      {ctl.stale && <StaleBanner ctl={ctl} />}
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Transportation sections" idBase="tr" />
      <TabPanel idBase="tr" id={tab}>
        {tab === 'today' && (ctl.assigned ? <DriverToday ctl={ctl} tasks={tasks} setTasks={setTasks} onDetail={setDetail} /> : <DispatchToday ctl={ctl} onDetail={setDetail} />)}
        {tab === 'deliveries' && (ctl.assigned ? <DriverDeliveries ctl={ctl} onDetail={setDetail} /> : <DispatchBoard ctl={ctl} onDetail={setDetail} />)}
        {tab === 'briefing' && <TrBriefing assigned={ctl.assigned} />}
        {tab === 'exceptions' && <ExceptionsTab ctl={ctl} onDetail={setDetail} />}
      </TabPanel>
      <Drawer
        open={!!sel}
        onClose={() => setDetail(null)}
        eyebrow={sel ? `${sel.id} · stop ${sel.stopOrder}` : undefined}
        title={sel?.customer ?? ''}
        footer={sel && <StatusActions sh={sel} ctl={ctl} size="md" />}
      >
        {sel && <ShipmentDetails sh={sel} ctl={ctl} />}
      </Drawer>
    </Page>
  )
}

function StaleBanner({ ctl }: { ctl: ShipCtl }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-fg-2">
        <strong className="font-semibold text-warn">ETAs are stale. </strong>
        {ctl.tmsFailedAt ? `The transport data refresh failed at ${ctl.tmsFailedAt}. ` : ''}
        Times shown are from the last good snapshot at <span className="num">{ctl.etaAsOf}</span> — confirm with {ctl.assigned ? 'dispatch' : 'drivers'} before committing to customers.
      </p>
    </div>
  )
}

function EtaText({ sh, ctl }: { sh: Shipment; ctl: ShipCtl }) {
  const stale = ctl.stale && sh.status !== 'Delivered'
  return (
    <span className="num inline-flex items-center gap-1.5">
      {sh.eta}
      {stale && <Badge tone="warn">Stale</Badge>}
    </span>
  )
}

function StatusActions({ sh, ctl, size = 'md' }: { sh: Shipment; ctl: ShipCtl; size?: 'sm' | 'md' }) {
  const next = NEXT[sh.status]
  if (!ctl.canUpdate || !next) return sh.status === 'Delivered' ? <Badge tone="nv">Delivered</Badge> : null
  return (
    <div className="flex flex-wrap gap-2">
      {next.map((st) => (
        <Button
          key={st}
          size={size}
          variant={st === 'Delayed' ? 'danger' : 'primary'}
          className={cx(size === 'md' && 'min-h-11')}
          onClick={() => ctl.setStatus(sh, st)}
          aria-label={`${ACTION_LABEL[st]} for ${sh.id} (${sh.customer})`}
        >
          {ACTION_LABEL[st]}
        </Button>
      ))}
    </div>
  )
}

function ShipmentDetails({ sh, ctl }: { sh: Shipment; ctl: ShipCtl }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[sh.status]}>{sh.status}</Badge>
        {ctl.stale && sh.status !== 'Delivered' && <Badge tone="warn">ETA stale · as of {ctl.etaAsOf}</Badge>}
      </div>
      <KeyValues
        items={[
          ['Destination', sh.destination],
          ['Address', sh.address],
          ['Delivery window', <span key="w" className="num">{sh.window}</span>],
          ['ETA', <EtaText key="e" sh={sh} ctl={ctl} />],
          ['Load', `${sh.pallets} pallets · ${(sh.weightKg / 1000).toFixed(1)} t`],
          ['Vehicle', sh.vehicle],
          ['Origin', sh.origin],
          ['Driver', sh.driverName],
        ]}
      />
      <div>
        <p className="eyebrow mb-1.5">Handling</p>
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-2">{sh.handling}</p>
      </div>
      <p className="text-xs text-muted">Record from gold.shipments_eta. Status changes are written back through PATCH /shipments/{'{id}'} in live mode; in the demo they update the local mock store.</p>
    </div>
  )
}

/* ------------------------------------------------------------ driver */

function DriverToday({ ctl, tasks, setTasks, onDetail }: { ctl: ShipCtl; tasks: Record<string, boolean>; setTasks: (fn: (t: Record<string, boolean>) => Record<string, boolean>) => void; onDetail: (id: string) => void }) {
  const current = ctl.visible.find((s) => s.status !== 'Delivered') ?? null
  const done = Object.values(tasks).filter(Boolean).length
  return (
    <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {current ? (
        <section className="panel flex min-w-0 flex-col" aria-labelledby="current-stop">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="eyebrow">Current stop · {current.stopOrder} of {ctl.visible.length}</p>
              <h2 id="current-stop" className="mt-1 text-lg font-semibold text-fg">
                {current.customer}
              </h2>
            </div>
            <Badge tone={STATUS_TONE[current.status]}>{current.status}</Badge>
          </header>
          <div className="space-y-4 p-4">
            <p className="flex items-start gap-2 text-[15px] text-fg-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span>
                {current.destination}
                <span className="block text-[13px] text-muted">{current.address}</span>
              </span>
            </p>
            <dl className="grid grid-cols-3 gap-3 text-[13px]">
              <div>
                <dt className="text-xs text-muted">Window</dt>
                <dd className="num mt-0.5 text-base font-semibold text-fg">{current.window}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">ETA</dt>
                <dd className="mt-0.5 text-base font-semibold text-fg">
                  <EtaText sh={current} ctl={ctl} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Load</dt>
                <dd className="num mt-0.5 text-base font-semibold text-fg">{current.pallets} plt</dd>
              </div>
            </dl>
            <p className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-fg-2">
              <Package className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {current.handling}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <StatusActions sh={current} ctl={ctl} />
              <Button variant="ghost" onClick={() => onDetail(current.id)}>
                Stop details
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Panel title="All stops complete">
          <EmptyState icon={CircleCheck} title="No open stops">
            Every delivery assigned to you today is confirmed.
          </EmptyState>
        </Panel>
      )}
      <div className="flex min-w-0 flex-col gap-4">
        <Panel eyebrow="Route" title={`${ctl.visible.length} assigned stops`} bodyClassName="p-0">
          <RouteStepper ctl={ctl} onDetail={onDetail} currentId={current?.id ?? null} />
        </Panel>
        <Panel eyebrow="Shift tasks" title={`${done} of ${SHIFT_TASKS.length} done`}>
          <ul className="space-y-1.5">
            {SHIFT_TASKS.map((t) => (
              <li key={t.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line bg-deck px-3 text-[13px] text-fg-2 hover:border-line-2">
                  <input type="checkbox" checked={!!tasks[t.id]} onChange={(e) => setTasks((x) => ({ ...x, [t.id]: e.target.checked }))} className="size-4 accent-[var(--color-accent)]" />
                  <span className={cx(tasks[t.id] && 'text-muted line-through')}>{t.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function RouteStepper({ ctl, onDetail, currentId }: { ctl: ShipCtl; onDetail: (id: string) => void; currentId: string | null }) {
  return (
    <ol className="divide-y divide-line">
      {ctl.visible.map((sh) => {
        const done = sh.status === 'Delivered'
        const current = sh.id === currentId
        return (
          <li key={sh.id}>
            <button type="button" onClick={() => onDetail(sh.id)} className={cx('flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised', current && 'bg-accent/[0.05]')} aria-current={current ? 'step' : undefined}>
              <span className={cx('num grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold', done ? 'border-accent/50 bg-accent/15 text-accent-2' : current ? 'border-accent text-fg' : 'border-line-2 text-muted')}>
                {done ? <Check className="size-3.5" aria-label="Delivered" /> : sh.stopOrder}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{sh.customer}</span>
                <span className="num block text-xs text-muted">
                  {sh.window} · {sh.id}
                </span>
              </span>
              <Badge tone={STATUS_TONE[sh.status]}>{sh.status}</Badge>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function DriverDeliveries({ ctl, onDetail }: { ctl: ShipCtl; onDetail: (id: string) => void }) {
  if (!ctl.visible.length)
    return (
      <Panel title="Assigned deliveries">
        <EmptyState icon={Truck} title="Nothing assigned">
          Dispatch hasn't assigned deliveries to you yet.
        </EmptyState>
      </Panel>
    )
  return (
    <ul className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
      {ctl.visible.map((sh) => (
        <li key={sh.id} className={cx('panel flex flex-col p-4', sh.status === 'Delayed' && 'border-warn/50')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="num text-xs text-muted">
                Stop {sh.stopOrder} · {sh.id}
              </p>
              <h2 className="mt-0.5 text-base font-semibold text-fg">{sh.customer}</h2>
            </div>
            <Badge tone={STATUS_TONE[sh.status]}>{sh.status}</Badge>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[13px] text-fg-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden /> {sh.destination}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden /> <span className="num">{sh.window}</span>
            </span>
            <span>
              ETA <EtaText sh={sh} ctl={ctl} />
            </span>
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
            <StatusActions sh={sh} ctl={ctl} size="sm" />
            <Button size="sm" variant="ghost" onClick={() => onDetail(sh.id)} aria-label={`Details for ${sh.id}`}>
              Details
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------ dispatch */

function DispatchToday({ ctl, onDetail }: { ctl: ShipCtl; onDetail: (id: string) => void }) {
  const model = useOpsModel()
  const { perms } = useWorkspace()
  const { navigate } = useRoute()
  const d = model.kpis.deliveries
  const attention = ctl.visible.filter((s) => s.status === 'Delayed' || !s.driverId)
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {d && (
          <section aria-label="Delivery figures" className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <KpiCard label="Open" value={d.open} delta={`${d.delivered} delivered`} deltaTone="nv" />
            <KpiCard label="In transit" value={d.inTransit} delta={`${d.scheduled} scheduled`} deltaTone="info" />
            <KpiCard label="Delayed" value={d.delayed} tone={d.delayed ? 'warn' : 'neutral'} delta={d.delayed ? 'needs re-plan' : 'none'} deltaTone={d.delayed ? 'warn' : 'nv'} />
            <KpiCard label="Unassigned" value={d.unassigned} tone={d.unassigned ? 'warn' : 'neutral'} delta={d.unassigned ? 'assign a driver' : 'all assigned'} deltaTone={d.unassigned ? 'warn' : 'nv'} />
          </section>
        )}
        <Panel eyebrow="Needs action" title={attention.length ? `${attention.length} shipments` : 'Nothing waiting'} bodyClassName="p-0">
          {attention.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted">No delayed or unassigned shipments.</p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((sh) => (
                <li key={sh.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-fg">
                      {sh.customer} <span className="num text-xs font-normal text-muted">{sh.id}</span>
                    </span>
                    <span className="block text-xs text-muted">{!sh.driverId ? `Unassigned · ${sh.window}` : `${sh.driverName} · window ${sh.window} · ETA ${sh.eta}`}</span>
                  </span>
                  <Badge tone={!sh.driverId ? 'warn' : STATUS_TONE[sh.status]}>{!sh.driverId ? 'Unassigned' : sh.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => onDetail(sh.id)} aria-label={`Details for ${sh.id}`}>
                    Details
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel eyebrow="Data freshness" title="Transport data feed">
        <div className="space-y-3 text-[13px]">
          <p className="flex items-center gap-2">
            {ctl.tmsFailedAt ? <Badge tone="crit">Refresh failed · {ctl.tmsFailedAt}</Badge> : <Badge tone="nv">Current</Badge>}
            {ctl.stale && <Badge tone="warn">ETAs as of {ctl.etaAsOf}</Badge>}
          </p>
          <p className="text-fg-2">
            {ctl.tmsFailedAt
              ? 'The TMS export changed shape, so the latest ETAs could not be loaded. Shipments keep the last validated ETAs, marked stale, until the feed is fixed.'
              : 'ETAs are loaded from the TMS feed within SLA.'}
          </p>
          <p className="text-xs text-muted">Impact: {d ? `${d.staleOpen} open shipments carry stale ETAs.` : 'restricted.'}</p>
          {perms.pages.has('data') && (
            <Button size="sm" iconRight={ArrowRight} onClick={() => navigate('data', 'sources')}>
              Open data sources
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}

function DispatchBoard({ ctl, onDetail }: { ctl: ShipCtl; onDetail: (id: string) => void }) {
  return (
    <Panel eyebrow="gold.shipments_eta · all shipments" title="Shipment board" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <caption className="sr-only">All shipments with driver assignment and status</caption>
          <thead>
            <tr className="border-b border-line">
              {['Shipment', 'Customer / lane', 'Window', 'ETA', 'Driver', 'Status', ''].map((h) => (
                <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ctl.visible.map((sh) => (
              <tr key={sh.id} className="border-b border-line/60 last:border-0">
                <td className="num px-3 py-2 text-fg-2">{sh.id}</td>
                <td className="px-3 py-2">
                  <p className="text-fg">{sh.customer}</p>
                  <p className="text-xs text-muted">
                    {sh.origin} → {sh.destination}
                  </p>
                </td>
                <td className="num whitespace-nowrap px-3 py-2 text-fg-2">{sh.window}</td>
                <td className="whitespace-nowrap px-3 py-2 text-fg-2">
                  <EtaText sh={sh} ctl={ctl} />
                </td>
                <td className="px-3 py-2">
                  {ctl.canManage ? (
                    <select aria-label={`Driver for ${sh.id}`} value={sh.driverId ?? ''} onChange={(e) => ctl.assign(sh, e.target.value)} className="h-8 rounded-md border border-field bg-deck px-2 text-xs text-fg-2">
                      <option value="">Unassigned</option>
                      {ctl.drivers.map((d) => (
                        <option key={d.userId} value={d.userId}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-fg-2">{sh.driverName}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {ctl.canUpdate ? (
                    <select aria-label={`Status for ${sh.id}`} value={sh.status} onChange={(e) => ctl.setStatus(sh, e.target.value as ShipmentStatus)} className="h-8 rounded-md border border-field bg-deck px-2 text-xs text-fg-2">
                      {ALL_STATUS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={STATUS_TONE[sh.status]}>{sh.status}</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onDetail(sh.id)} aria-label={`Details for ${sh.id}`}>
                    Details
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------ briefing + exceptions */

function TrBriefing({ assigned }: { assigned: boolean }) {
  const { ws, perms } = useWorkspace()
  const docs = ws.documents.filter((d) => d.status === 'indexed' && (d.visibility === 'Company' || (d.visibility === 'Module' && d.module === 'transportation')))
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <AssistantPanel context="transportation" title={assigned ? 'Shift briefing' : 'Dispatch rundown'} initialQuery={assigned ? 'Brief my shift' : 'Give me the dispatch rundown'} />
      <Panel eyebrow={`Documents your role can cite · ${docs.length}`} title="Permitted documents" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]">
              <BookOpen className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="wrap-anywhere min-w-0 flex-1 text-fg-2">{d.name}</span>
              <Badge tone="neutral">{d.visibility === 'Company' ? 'Company' : 'Transportation'}</Badge>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          {can(perms, 'procurement', 'read_records') ? 'Other modules are answered in their own workspaces.' : 'Procurement, CRM and other companies’ documents are excluded before retrieval.'}
        </p>
      </Panel>
    </div>
  )
}

interface Exception {
  id: string
  tone: Tone
  title: string
  detail: string
  sh?: Shipment
}

function exceptionsFor(ctl: ShipCtl): Exception[] {
  const out: Exception[] = []
  if (ctl.stale)
    out.push({ id: 'stale', tone: 'warn', title: 'ETAs are stale', detail: `Last good ETA snapshot ${ctl.etaAsOf}${ctl.tmsFailedAt ? ` · refresh failed at ${ctl.tmsFailedAt}` : ''}. Confirm times before promising customers.` })
  for (const sh of ctl.visible) {
    if (sh.status === 'Delayed') out.push({ id: `d-${sh.id}`, tone: 'warn', title: `${sh.id} delayed`, detail: `${sh.customer} · window ${sh.window} · ETA ${sh.eta}. ${sh.handling}`, sh })
    if (!ctl.assigned && !sh.driverId) out.push({ id: `u-${sh.id}`, tone: 'warn', title: `${sh.id} has no driver`, detail: `${sh.customer} · ${sh.window}`, sh })
    if (/ADR|expedite/i.test(sh.handling) && sh.status !== 'Delivered') out.push({ id: `h-${sh.id}`, tone: 'info', title: `${sh.id} special handling`, detail: sh.handling, sh })
  }
  return out
}

function ExceptionsTab({ ctl, onDetail }: { ctl: ShipCtl; onDetail: (id: string) => void }) {
  const { ws } = useWorkspace()
  const list = exceptionsFor(ctl)
  const handbook = ws.documents.find((d) => d.name === 'Fleet_Driver_Handbook_2026.pdf' && d.status === 'indexed')
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel eyebrow={ctl.assigned ? 'Your stops' : 'All shipments'} title={list.length ? `${list.length} exceptions` : 'No exceptions'} bodyClassName="p-0">
        {list.length === 0 ? (
          <EmptyState icon={ListChecks} title="All clear">
            No delays, stale data or special-handling stops right now.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {x.tone === 'warn' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <ClipboardList className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-fg">{x.title}</span>
                  <span className="wrap-anywhere block text-xs text-muted">{x.detail}</span>
                </span>
                {x.sh && (
                  <span className="flex flex-wrap items-center gap-2">
                    {!ctl.assigned && !x.sh.driverId && ctl.canManage ? (
                      <Button size="sm" icon={UserPlus} onClick={() => onDetail(x.sh!.id)}>
                        Assign
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => onDetail(x.sh!.id)} aria-label={`Details for ${x.sh.id}`}>
                        Details
                      </Button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel eyebrow="What to do" title="Exception playbook">
        <ul className="space-y-3 text-[13px] text-fg-2">
          <li className="flex gap-2.5">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> Report any delay over 15 minutes with the Delayed status — dispatch re-plans the route.
          </li>
          <li className="flex gap-2.5">
            <Package className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> ADR loads stay upright and sealed; check seal numbers before departure.
          </li>
          <li className="flex gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> When ETAs are stale, treat times as estimates and confirm with {ctl.assigned ? 'dispatch' : 'the driver'}.
          </li>
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {handbook ? `Source: ${handbook.name}, pages 4, 9 and 12.` : 'The driver handbook is not indexed — upload it in Knowledge to cite these rules.'}
        </p>
      </Panel>
    </div>
  )
}
