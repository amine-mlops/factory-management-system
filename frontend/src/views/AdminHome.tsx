import { Activity, ArrowRight, BookOpen, ChevronRight, CircleX, FileText, Info, LayoutDashboard, Lock, Pause, Play, ShieldAlert, Sparkles, TriangleAlert, Truck, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { AssistantPanel } from '../components/assistant/AssistantPanel.tsx'
import { SystemMap } from '../components/map/SystemMap.tsx'
import { StoryCards, type StoryId, type StoryProof } from '../components/story/StoryCards.tsx'
import { Drawer } from '../components/ui/Drawer.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { HEALTH_META } from '../components/ui/health.ts'
import { Badge, Button, EmptyState, HealthBadge, KpiCard, Panel, StatusDot } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import { AccessModel, IncidentEvidence, IncidentList } from '../components/workspace/Security.tsx'
import { navItem, type ViewId } from '../data/nav.ts'
import { can, isOwnerLike, moduleStage } from '../lib/access.ts'
import { cx, fmtClock, fmtUsd, TONE_TEXT, type Tone } from '../lib/format.ts'
import type { Alert, DeliveryKpis, NextAction, OpsModel } from '../lib/insights.ts'
import { useRoute, useTab } from '../lib/route.ts'
import { useActivity, useOpsModel } from '../lib/useOps.ts'
import type { AuditEvent, SecurityIncident } from '../lib/workspace.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type AdminTab = 'overview' | 'live' | 'briefing' | 'security'

const ALERT_ICON: Record<Tone, LucideIcon> = { crit: CircleX, warn: TriangleAlert, info: Info, nv: Info, neutral: Info }

/**
 * Company home for owners and managers. Every number comes from the role-projected
 * ops model: blocks the viewer may not read arrive as null and render as "no access".
 */
export function AdminHome() {
  const { ws, perms } = useWorkspace()
  const { navigate } = useRoute()
  const model = useOpsModel()
  const showSecurity = model.kpis.security !== null
  const tabs: Array<TabDef<AdminTab>> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'live', label: 'Live Operations', icon: Activity, badge: model.hub.attention || undefined, badgeTone: 'warn', badgeLabel: `${model.hub.attention} modules need attention` },
    { id: 'briefing', label: 'AI Briefing', icon: Sparkles },
    ...(showSecurity
      ? [{ id: 'security' as const, label: 'Security', icon: ShieldAlert, badge: model.kpis.security?.deniedLast24h || undefined, badgeTone: 'crit' as const, badgeLabel: `${model.kpis.security?.deniedLast24h} denied requests in 24 hours` }]
      : []),
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const go = (t: { view: ViewId; tab?: string } | null | undefined) => t && navigate(t.view, t.tab)
  const exec = isOwnerLike(perms.roles)
  const live = model.modules.filter((m) => m.enabled && m.implemented)
  const integrated = live.filter((m) => moduleStage(m.id) === 'integrated').length
  const simulated = live.length - integrated

  return (
    <Page>
      <PageHeader
        eyebrow={`${ws.tenant.name} · ${exec ? 'Executive view' : 'Manager view'}`}
        title="Operations overview"
        subtitle={`${integrated} integrated + ${simulated} simulated module${simulated === 1 ? '' : 's'} live · ${model.hub.attention} need attention · ${model.hub.soon} coming soon`}
        right={
          <>
            <HealthBadge health={model.hub.health} label={`Operations · ${HEALTH_META[model.hub.health].label}`} />
            <span className="text-xs text-muted">
              Updated <time className="num text-fg-2">{fmtClock(model.generatedAt)}</time>
            </span>
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Overview sections" idBase="admin" />
      <TabPanel idBase="admin" id={tab}>
        {tab === 'overview' && (
          <div className="space-y-4">
            <WhyItMatters model={model} onOpen={(v, t) => navigate(v, t)} />
            <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
              <SystemMap model={model} mode="executive" tenantName={ws.tenant.name} onOpen={(v, t) => navigate(v, t)} canOpenData={perms.pages.has('data')} />
              <div className="flex min-w-0 flex-col gap-4">
                <NextActionCard action={model.nextAction} onGo={go} />
                <AlertsPanel alerts={model.alerts} onGo={go} />
                <CompactKpis model={model} onGo={go} />
              </div>
            </div>
          </div>
        )}
        {tab === 'live' && <LiveOperations model={model} onGo={go} />}
        {tab === 'briefing' && <BriefingTab model={model} />}
        {tab === 'security' && showSecurity && <SecurityTab model={model} />}
      </TabPanel>
    </Page>
  )
}

/** Problem → solution in four cards, each backed by a live, role-visible proof point (never invented numbers). */
function WhyItMatters({ model, onOpen }: { model: OpsModel; onOpen: (v: ViewId, tab?: string) => void }) {
  const { ws, perms } = useWorkspace()
  const k = model.kpis
  const rolesInUse = new Set(ws.members.flatMap((m) => m.roles)).size
  const proofs: Partial<Record<StoryId, StoryProof>> = {
    silos: {
      text: k.knowledge ? `${k.knowledge.indexed} PDFs indexed · answers cite the page` : undefined,
      link: perms.pages.has('knowledge') ? { label: 'Knowledge', view: 'knowledge', tab: 'ask' } : undefined,
    },
    access: {
      text: k.security ? `${rolesInUse} roles in use · ${k.security.preRetrieval} requests blocked before retrieval` : 'Every question is checked before retrieval',
      link: perms.pages.has('team') ? { label: 'Team & Access', view: 'team', tab: 'roles' } : undefined,
    },
    field: {
      text: k.deliveries ? 'Shift briefings flag stale ETAs instead of hiding them' : undefined,
      link: perms.pages.has('transportation') ? { label: 'Briefing', view: 'transportation', tab: 'briefing' } : undefined,
    },
    solution: {
      text: `${ws.tenant.enabledModules.length} of 8 modules enabled`,
      link: perms.pages.has('settings') ? { label: 'Modules', view: 'settings', tab: 'modules' } : undefined,
    },
  }
  const [hidden, setHidden] = useState(readHidden)
  const toggle = () => {
    setHidden((h) => {
      try {
        localStorage.setItem(STORY_KEY, h ? '0' : '1')
      } catch {
        /* per-viewer convenience only */
      }
      return !h
    })
  }
  return (
    <section aria-labelledby="why-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="why-title" className="eyebrow">
          Why it matters
        </h2>
        <Button size="sm" variant="ghost" onClick={toggle} aria-expanded={!hidden} aria-controls="why-cards">
          {hidden ? 'Show' : 'Hide'}
        </Button>
      </div>
      {!hidden && (
        <div id="why-cards">
          <StoryCards proofs={proofs} onOpen={onOpen} brief />
        </div>
      )}
    </section>
  )
}

const STORY_KEY = 'nexus.story.hidden'
const readHidden = () => {
  try {
    return localStorage.getItem(STORY_KEY) === '1'
  } catch {
    return false
  }
}

function NextActionCard({ action, onGo }: { action: NextAction; onGo: (t: NextAction['target']) => void }) {
  return (
    <section className="panel border-l-2 border-l-accent p-4" aria-labelledby="next-action-title">
      <p className="eyebrow text-accent-2">Recommended next action</p>
      <h2 id="next-action-title" className="mt-1.5 text-lg font-semibold leading-snug text-fg">
        {action.title}
      </h2>
      <p className="mt-1 text-[13px] text-fg-2">{action.detail}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">Rule-based from current module state</span>
        {action.target && (
          <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={() => onGo(action.target)}>
            {action.cta}
          </Button>
        )}
      </div>
    </section>
  )
}

function AlertsPanel({ alerts, onGo }: { alerts: Alert[]; onGo: (t: Alert['target']) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? alerts : alerts.slice(0, 3)
  return (
    <Panel
      eyebrow="Critical alerts"
      title={alerts.length ? `${alerts.length} open` : 'No open alerts'}
      bodyClassName="p-0"
      actions={
        alerts.length > 3 ? (
          <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show all ${alerts.length}`}
          </Button>
        ) : undefined
      }
    >
      {alerts.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">Nothing needs attention in the modules you can see.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => {
            const Icon = ALERT_ICON[a.tone]
            return (
              <li key={a.id}>
                <button type="button" onClick={() => onGo(a.target)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-raised">
                  <Icon className={cx('mt-0.5 size-4 shrink-0', TONE_TEXT[a.tone])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-fg">
                      <span className="sr-only">{a.tone === 'crit' ? 'Critical: ' : 'Warning: '}</span>
                      {a.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{a.detail}</span>
                  </span>
                  {a.target && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function LockedKpi({ label }: { label: string }) {
  return (
    <div className="panel flex min-w-0 flex-col gap-2 p-4">
      <p className="eyebrow">{label}</p>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        <Lock className="size-3.5" aria-hidden /> No access
      </p>
    </div>
  )
}

function CompactKpis({ model, onGo }: { model: OpsModel; onGo: (t: { view: ViewId; tab?: string }) => void }) {
  const { deliveries: d, procurement: p, expiry: x, security: s } = model.kpis
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-3">
      {d ? (
        <KpiCard
          label="Open deliveries"
          value={d.open}
          delta={d.delayed ? `${d.delayed} delayed` : 'None delayed'}
          deltaTone={d.delayed ? 'warn' : 'nv'}
          footnote={d.staleOpen ? 'ETAs stale' : undefined}
          onClick={() => onGo({ view: 'transportation', tab: 'deliveries' })}
          actionLabel={`Open deliveries: ${d.open}, ${d.delayed} delayed. Open Transportation deliveries`}
        />
      ) : (
        <LockedKpi label="Open deliveries" />
      )}
      {p ? (
        <KpiCard
          label="Awaiting award"
          value={p.awaiting}
          delta={p.awaitingValue ? `${fmtUsd(p.awaitingValue)} urgent` : 'Nothing urgent'}
          deltaTone={p.awaitingValue ? 'warn' : 'nv'}
          onClick={() => onGo({ view: 'procurement', tab: 'quotations' })}
          actionLabel={`Quotations awaiting award: ${p.awaiting}. Open Procurement quotations`}
        />
      ) : (
        <LockedKpi label="Awaiting award" />
      )}
      {x ? (
        <KpiCard
          label="Expiry value at risk"
          value={fmtUsd(x.valueAtRisk)}
          tone={x.critical ? 'crit' : 'neutral'}
          delta={`${x.critical} critical lots`}
          deltaTone={x.critical ? 'crit' : 'nv'}
          onClick={() => onGo({ view: 'inventory', tab: 'lots' })}
          actionLabel={`Expiry value at risk ${fmtUsd(x.valueAtRisk, false)}, ${x.critical} critical lots. Open at-risk lots`}
        />
      ) : (
        <LockedKpi label="Expiry value at risk" />
      )}
      {s ? (
        <KpiCard
          label="Denied · 24 h"
          value={s.deniedLast24h}
          tone={s.deniedLast24h ? 'crit' : 'neutral'}
          delta={`${s.total} total`}
          deltaTone="info"
          onClick={() => onGo({ view: 'dashboard', tab: 'security' })}
          actionLabel={`Denied requests in 24 hours: ${s.deniedLast24h}. Open security`}
        />
      ) : (
        <LockedKpi label="Denied · 24 h" />
      )}
    </section>
  )
}

/* ------------------------------------------------------------ live operations */

function LiveOperations({ model, onGo }: { model: OpsModel; onGo: (t: { view: ViewId; tab?: string }) => void }) {
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <ActivityFeed />
      <div className="flex min-w-0 flex-col gap-4">
        <ModuleStatusTable model={model} onGo={onGo} />
        <div className="grid gap-4 @2xl:grid-cols-2">
          {model.kpis.deliveries ? <DeliveriesBar d={model.kpis.deliveries} /> : <LockedPanel title="Deliveries" />}
          {model.kpis.procurement ? (
            <Panel eyebrow="Procurement" title="Quotations">
              <StackBar
                label="Quotations by status"
                parts={[
                  ['Awarded', model.kpis.procurement.awarded, 'nv'],
                  ['Awaiting decision', model.kpis.procurement.awaiting, 'warn'],
                ]}
              />
              <p className="mt-2 text-xs text-muted">
                {model.kpis.procurement.probationOpen} open quote{model.kpis.procurement.probationOpen === 1 ? '' : 's'} from suppliers on probation
              </p>
            </Panel>
          ) : (
            <LockedPanel title="Quotations" />
          )}
        </div>
      </div>
    </div>
  )
}

function LockedPanel({ title }: { title: string }) {
  return (
    <Panel eyebrow="Restricted" title={title}>
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Lock className="size-4" aria-hidden /> Your roles don't include this module's records.
      </p>
    </Panel>
  )
}

function StackBar({ parts, label }: { parts: Array<[string, number, Tone]>; label: string }) {
  const total = parts.reduce((s, [, v]) => s + v, 0) || 1
  const BG: Record<Tone, string> = { nv: 'bg-accent', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-info', neutral: 'bg-muted' }
  return (
    <figure>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${label}: ${parts.map(([k, v]) => `${k} ${v}`).join(', ')}`}>
        {parts.map(([k, v, t]) => (v ? <span key={k} className={cx('h-full', BG[t])} style={{ width: `${(v / total) * 100}%` }} /> : null))}
      </div>
      <figcaption>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {parts.map(([k, v, t]) => (
            <li key={k} className="flex items-center gap-1.5 text-muted">
              <StatusDot tone={t} />
              {k}
              <span className="num ml-auto font-semibold text-fg">{v}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

function DeliveriesBar({ d }: { d: DeliveryKpis }) {
  return (
    <Panel eyebrow="Transportation" title="Deliveries today" actions={d.staleOpen ? <Badge tone="warn">ETAs stale since {d.etaAsOf}</Badge> : undefined}>
      <StackBar
        label="Deliveries by status"
        parts={[
          ['Delivered', d.delivered, 'nv'],
          ['In transit', d.inTransit, 'info'],
          ['Scheduled', d.scheduled, 'neutral'],
          ['Delayed', d.delayed, 'warn'],
        ]}
      />
      {d.unassigned > 0 && <p className="mt-2 text-xs text-muted">{d.unassigned} scheduled delivery not yet assigned to a driver</p>}
    </Panel>
  )
}

function ModuleStatusTable({ model, onGo }: { model: OpsModel; onGo: (t: { view: ViewId; tab?: string }) => void }) {
  return (
    <Panel eyebrow="All modules" title="Module status" bodyClassName="p-0">
      <ul className="divide-y divide-line">
        {model.modules.map((m) => {
          const Icon = navItem(m.id).icon
          const line = !m.enabled ? 'Not enabled for this company' : !m.implemented ? 'Integration coming soon' : m.access === 'none' ? 'No access to records' : (m.business?.summary ?? 'All clear')
          const canOpen = m.enabled && m.access === 'granted'
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="w-32 shrink-0 text-[13px] font-medium text-fg">{m.label}</span>
              <HealthBadge health={m.health} />
              <span className="wrap-anywhere min-w-0 flex-1 text-xs text-muted">{line}</span>
              {canOpen && (
                <Button size="sm" variant="ghost" onClick={() => onGo({ view: m.id })} aria-label={`Open ${m.label}`}>
                  Open
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function ActivityFeed() {
  const events = useActivity()
  const [frozen, setFrozen] = useState<AuditEvent[] | null>(null)
  const shown = (frozen ?? events).slice(0, 12)
  const newCount = frozen ? events.filter((e) => !frozen.some((f) => f.id === e.id)).length : 0
  return (
    <Panel
      eyebrow="Activity · events you're allowed to see"
      title="Live activity"
      bodyClassName="p-0"
      actions={
        <Button size="sm" variant="secondary" icon={frozen ? Play : Pause} onClick={() => setFrozen(frozen ? null : events)} aria-pressed={!!frozen}>
          {frozen ? `Resume${newCount ? ` (${newCount} new)` : ''}` : 'Pause updates'}
        </Button>
      }
    >
      {shown.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet">
          Actions in modules you can open appear here as they happen.
        </EmptyState>
      ) : (
        <ol className="terminal m-3 divide-y divide-line" aria-live={frozen ? 'off' : 'polite'} aria-label="Activity events, newest first">
          {shown.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2.5">
              <StatusDot tone={e.tone} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="font-medium text-fg">{e.action}</span>
                  {e.resource && <span className="text-xs text-muted">{navItem(e.resource).label}</span>}
                  <span className="num ml-auto text-xs text-muted">
                    {e.time} · {e.actor}
                  </span>
                </p>
                <p className="wrap-anywhere text-xs text-muted">{e.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------ AI briefing */

function BriefingTab({ model }: { model: OpsModel }) {
  const { perms } = useWorkspace()
  const readable = model.modules.filter((m) => m.enabled && m.implemented)
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <AssistantPanel context="dashboard" title="Daily operations briefing" initialQuery="What needs my attention today?" />
      <Panel eyebrow="Retrieval scope" title="What this briefing can read">
        <ul className="space-y-2 text-[13px]">
          {readable.map((m) => {
            const ok = can(perms, m.id, 'read_records') && can(perms, m.id, 'query_ai')
            const Icon = m.id === 'transportation' ? Truck : FileText
            return (
              <li key={m.id} className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="flex-1 text-fg-2">{m.label} records &amp; documents</span>
                {ok ? <Badge tone="nv">Allowed</Badge> : <Badge tone="neutral">Blocked</Badge>}
              </li>
            )
          })}
          <li className="flex items-center gap-2.5">
            <BookOpen className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="flex-1 text-fg-2">Company-wide documents</span>
            <Badge tone="nv">Allowed</Badge>
          </li>
          <li className="flex items-center gap-2.5">
            <ShieldAlert className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="flex-1 text-fg-2">Security events (metadata)</span>
            {model.kpis.security ? <Badge tone="nv">Allowed</Badge> : <Badge tone="neutral">Blocked</Badge>}
          </li>
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Filters run in order tenant → role/module → data scope before any text is composed. The red prompt asks for another company's data to show the 403 path.
        </p>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------ security */

function SecurityTab({ model }: { model: OpsModel }) {
  const { ws, perms } = useWorkspace()
  const { navigate } = useRoute()
  const [open, setOpen] = useState<SecurityIncident | null>(null)
  const s = model.kpis.security!
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section aria-label="Denied request counts" className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Denied · 24 h" value={s.deniedLast24h} tone={s.deniedLast24h ? 'crit' : 'neutral'} delta={`${s.total} recorded`} deltaTone="info" />
          <KpiCard label="Blocked before retrieval" value={s.preRetrieval} delta="0 chunks retrieved" deltaTone="nv" />
          <KpiCard label="Blocked routes" value={s.route} delta="direct page attempts" deltaTone="info" />
        </section>
        <Panel
          eyebrow="Shared across personas · newest first"
          title="Recent denied requests"
          bodyClassName="p-0"
          actions={
            perms.pages.has('data') ? (
              <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('data', 'incidents')}>
                Full incident log
              </Button>
            ) : undefined
          }
        >
          <IncidentList incidents={ws.incidents} limit={5} onSelect={setOpen} />
        </Panel>
      </div>
      <Panel eyebrow="How access is enforced" title="Access model">
        <AccessModel />
      </Panel>
      <Drawer open={!!open} onClose={() => setOpen(null)} eyebrow="Security event" title="Denied request evidence" width="lg">
        {open && <IncidentEvidence incident={open} />}
      </Drawer>
    </div>
  )
}
