import { ArrowRight, Building, CircleCheck, CircleDashed, CircleX, LayoutGrid, List, Lock, Minus, TriangleAlert } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { navItem, type ModuleId, type ViewId } from '../../data/nav.ts'
import { cx, fmtClock, TONE_TEXT, type Health } from '../../lib/format.ts'
import type { ModuleStatus, OpsModel } from '../../lib/insights.ts'
import { useElementWidth } from '../../lib/useNow.ts'
import { Drawer } from '../ui/Drawer.tsx'
import { HEALTH_META } from '../ui/health.ts'
import { Badge, Button, HealthBadge, KeyValues } from '../ui/primitives.tsx'

/** Clockwise from 12 o'clock, in the order the product brief lists the domains. */
const ORDER: ModuleId[] = ['procurement', 'inventory', 'transportation', 'warehousing', 'manufacturing', 'distribution', 'crm', 'it']
const VB_W = 1000
const VB_H = 600
const CX = 500
const CY = 300
const RX = 365
const RY = 200

const pos = ORDER.map((id, i) => {
  const a = ((i * 360) / ORDER.length - 90) * (Math.PI / 180)
  // Upper-half nodes put their label above the icon so text grows away from the hub.
  return { id, x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a), above: Math.sin(a) < -0.2 }
})

const RING: Record<Health, string> = {
  healthy: 'border-ok/70',
  warning: 'border-warn',
  critical: 'border-crit',
  soon: 'border-dashed border-faint/70',
  disabled: 'border-dotted border-line-2',
}

const SPOKE: Record<Health, { stroke: string; dash?: string; opacity: number; flow?: boolean }> = {
  healthy: { stroke: 'var(--color-ok)', dash: '4 8', opacity: 0.55, flow: true },
  warning: { stroke: 'var(--color-warn)', dash: '7 5', opacity: 0.8, flow: true },
  critical: { stroke: 'var(--color-crit)', opacity: 0.9 },
  soon: { stroke: 'var(--color-faint)', dash: '2 6', opacity: 0.45 },
  disabled: { stroke: 'var(--color-line-2)', dash: '1 9', opacity: 0.8 },
}

type Mode = 'executive' | 'technical'

function statusLine(m: ModuleStatus, mode: Mode): string {
  if (!m.enabled) return 'Not enabled'
  if (!m.implemented) return 'Coming soon'
  if (mode === 'technical' && m.tech) return m.tech.short
  if (m.access === 'none') return 'No access'
  return m.problems.length ? m.problems.slice(0, 2).join(' · ') : 'All clear'
}

function nodeName(m: ModuleStatus, mode: Mode) {
  return `${m.label}: ${HEALTH_META[m.health].label}. ${statusLine(m, mode)}. Open details`
}

interface Props {
  model: OpsModel
  mode: Mode
  tenantName: string
  onOpen: (view: ViewId, tab?: string) => void
  canOpenData: boolean
}

export function SystemMap({ model, mode, tenantName, onOpen, canOpenData }: Props) {
  const [view, setView] = useState<'map' | 'list'>('map')
  const [selected, setSelected] = useState<ModuleId | 'hub' | null>(null)
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const narrow = width > 0 && width < 620
  const effective = narrow ? 'list' : view
  const byId = (id: ModuleId) => model.modules.find((m) => m.id === id)!
  const sel = selected && selected !== 'hub' ? byId(selected) : null

  return (
    <section className="panel flex min-w-0 flex-col" aria-labelledby="sysmap-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="eyebrow">{mode === 'technical' ? 'Lineage & diagnostics' : 'Company operations'}</p>
          <h2 id="sysmap-title" className="mt-1 text-[15px] font-semibold text-fg">
            Supply-chain system map
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            Updated <time className="num text-fg-2">{fmtClock(model.generatedAt)}</time> · local mock store
          </span>
          {model.staleSources > 0 && (
            <Badge tone="warn">
              <TriangleAlert className="size-3" aria-hidden />
              {model.staleSources} stale source{model.staleSources > 1 ? 's' : ''}
            </Badge>
          )}
          {!narrow && (
            <div className="flex rounded-md border border-line-2 p-0.5" role="group" aria-label="Map display">
              {(
                [
                  ['map', 'Map', LayoutGrid],
                  ['list', 'List', List],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={cx('flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium', view === id ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}
                >
                  <Icon className="size-3.5" aria-hidden /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div ref={ref} className="min-w-0 p-3 sm:p-4">
        {effective === 'map' ? (
          <div className="relative w-full" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 size-full" aria-hidden>
              <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="var(--color-line)" strokeDasharray="2 10" />
              {pos.map((p) => {
                const m = byId(p.id)
                const s = SPOKE[m.health]
                const broken = m.health === 'critical' && (m.problems.includes('Refresh failed') || m.tech?.brokenFlow)
                const mx = (CX + p.x) / 2
                const my = (CY + p.y) / 2
                if (broken) {
                  const dx = p.x - CX
                  const dy = p.y - CY
                  const len = Math.hypot(dx, dy)
                  const ux = dx / len
                  const uy = dy / len
                  return (
                    <g key={p.id}>
                      <line x1={CX} y1={CY} x2={mx - ux * 16} y2={my - uy * 16} stroke={s.stroke} strokeWidth="2" opacity={s.opacity} />
                      <line x1={mx + ux * 16} y1={my + uy * 16} x2={p.x} y2={p.y} stroke={s.stroke} strokeWidth="2" strokeDasharray="3 5" opacity={0.6} />
                      <circle cx={mx} cy={my} r="11" fill="var(--color-surface)" stroke="var(--color-crit)" strokeWidth="2" />
                      <path d={`M${mx - 4.5} ${my - 4.5} L${mx + 4.5} ${my + 4.5} M${mx + 4.5} ${my - 4.5} L${mx - 4.5} ${my + 4.5}`} stroke="var(--color-crit)" strokeWidth="2" strokeLinecap="round" />
                    </g>
                  )
                }
                return (
                  <line
                    key={p.id}
                    x1={CX}
                    y1={CY}
                    x2={p.x}
                    y2={p.y}
                    stroke={s.stroke}
                    strokeWidth={m.health === 'warning' ? 2 : 1.5}
                    strokeDasharray={s.dash}
                    opacity={s.opacity}
                    className={s.flow ? 'animate-dash' : undefined}
                  />
                )
              })}
            </svg>

            <HubNode model={model} tenantName={tenantName} onClick={() => setSelected('hub')} />
            {pos.map((p) => (
              <MapNode key={p.id} m={byId(p.id)} mode={mode} above={p.above} style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%` }} onClick={() => setSelected(p.id)} />
            ))}
          </div>
        ) : (
          <ListView model={model} mode={mode} onSelect={setSelected} narrow={narrow} />
        )}
        <Legend />
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        eyebrow={selected === 'hub' ? tenantName : mode === 'technical' ? 'Diagnostics · metadata only' : 'Module impact'}
        title={selected === 'hub' ? 'Company operations hub' : (sel?.label ?? '')}
        width={mode === 'technical' ? 'lg' : 'md'}
        footer={
          sel && sel.access === 'granted' && sel.enabled && (
            <>
              {mode === 'technical' && canOpenData && sel.tech && (
                <Button
                  onClick={() => {
                    setSelected(null)
                    onOpen('data', 'pipeline')
                  }}
                >
                  Open pipeline health
                </Button>
              )}
              <Button
                variant="primary"
                iconRight={ArrowRight}
                onClick={() => {
                  setSelected(null)
                  onOpen(sel.id)
                }}
              >
                Open {sel.label}
              </Button>
            </>
          )
        }
      >
        {selected === 'hub' ? <HubDetails model={model} /> : sel && <NodeDetails m={sel} mode={mode} />}
      </Drawer>
    </section>
  )
}

function HubNode({ model, tenantName, onClick }: { model: OpsModel; tenantName: string; onClick: () => void }) {
  const meta = HEALTH_META[model.hub.health]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${tenantName} operations hub: ${meta.label}. ${model.hub.live} live modules, ${model.hub.attention} need attention. Open details`}
      className="group absolute left-1/2 flex w-[17%] min-w-[128px] max-w-[176px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-full"
      style={{ top: `${(CY / VB_H) * 100}%` }}
    >
      <span className={cx('flex aspect-square w-full flex-col items-center justify-center rounded-full border-2 bg-surface px-3 text-center transition-colors group-hover:bg-raised', RING[model.hub.health])}>
        <Building className="size-5 text-fg-2" aria-hidden />
        <span className="mt-1.5 text-[13px] font-semibold leading-tight text-fg">Company operations</span>
        <span className="mt-0.5 text-xs text-muted">{model.hub.live} modules live</span>
        <span className={cx('mt-1 text-xs font-medium leading-tight', TONE_TEXT[meta.tone])}>{model.hub.attention ? `${model.hub.attention} need attention` : 'All nominal'}</span>
      </span>
    </button>
  )
}

function MapNode({ m, mode, style, onClick, above }: { m: ModuleStatus; mode: Mode; style: CSSProperties; onClick: () => void; above: boolean }) {
  const Icon = navItem(m.id).icon
  const meta = HEALTH_META[m.health]
  const StatusIcon = meta.icon
  const line = statusLine(m, mode)
  const dim = m.health === 'disabled'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={nodeName(m, mode)}
      title={`${m.label} — ${line}`}
      className={cx(
        'group absolute flex w-[clamp(128px,18%,200px)] -translate-x-1/2 items-center rounded-lg text-center',
        above ? '-translate-y-[calc(100%-26px)] flex-col-reverse' : '-translate-y-[26px] flex-col',
        dim && 'opacity-70',
      )}
      style={style}
    >
      <span className="relative">
        {m.health === 'critical' && <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-crit" aria-hidden />}
        <span className={cx('relative grid size-[52px] place-items-center rounded-full border-2 bg-surface transition-colors group-hover:bg-raised', RING[m.health])}>
          <Icon className={cx('size-5', m.health === 'soon' || dim ? 'text-faint' : 'text-fg')} aria-hidden />
        </span>
        <span className={cx('absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-canvas bg-surface', TONE_TEXT[meta.tone])} aria-hidden>
          <StatusIcon className="size-3.5" />
        </span>
        {m.access === 'none' && m.enabled && (
          <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-canvas bg-raised text-muted" aria-hidden>
            <Lock className="size-3" />
          </span>
        )}
      </span>
      <span className={cx('flex flex-col items-center', above ? 'mb-1' : 'mt-1')}>
        <span className="rounded-sm bg-surface px-1.5 text-[13px] font-semibold leading-snug text-fg">{m.label}</span>
        <span className={cx('rounded-sm bg-surface px-1.5 text-xs leading-snug', m.health === 'critical' ? 'text-crit-2' : m.health === 'warning' ? 'text-warn' : 'text-muted')}>{line}</span>
      </span>
    </button>
  )
}

function ListView({ model, mode, onSelect, narrow }: { model: OpsModel; mode: Mode; onSelect: (id: ModuleId) => void; narrow: boolean }) {
  return (
    <div>
      {narrow && <p className="mb-2 text-xs text-muted">List view — the map needs a wider screen.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Modules and status">
        {ORDER.map((id) => {
          const m = model.modules.find((x) => x.id === id)!
          const Icon = navItem(id).icon
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-[140px] flex-1 text-sm font-medium text-fg">{m.label}</span>
              <HealthBadge health={m.health} />
              <span className="wrap-anywhere w-full text-[13px] text-muted sm:w-auto sm:flex-[2]">{statusLine(m, mode)}</span>
              <Button size="sm" variant="ghost" onClick={() => onSelect(id)} aria-label={`Details for ${m.label}`}>
                Details
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Legend() {
  const items: Array<[string, typeof CircleCheck, string]> = [
    ['Healthy', CircleCheck, 'text-ok'],
    ['Warning', TriangleAlert, 'text-warn'],
    ['Critical', CircleX, 'text-crit'],
    ['Coming soon', CircleDashed, 'text-faint'],
    ['Not enabled', Minus, 'text-faint'],
  ]
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-muted" aria-label="Legend">
      {items.map(([label, Icon, cls]) => (
        <li key={label} className="flex items-center gap-1.5">
          <Icon className={cx('size-3.5', cls)} aria-hidden /> {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden>
          <line x1="0" y1="5" x2="11" y2="5" stroke="var(--color-crit)" strokeWidth="2" />
          <path d="M14 2 L20 8 M20 2 L14 8" stroke="var(--color-crit)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="23" y1="5" x2="34" y2="5" stroke="var(--color-crit)" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
        Broken data flow
      </li>
      <li className="flex items-center gap-1.5">
        <Lock className="size-3.5 text-muted" aria-hidden /> No access
      </li>
    </ul>
  )
}

function HubDetails({ model }: { model: OpsModel }) {
  return (
    <div className="space-y-4">
      <HealthBadge health={model.hub.health} />
      <KeyValues
        items={[
          ['Live modules', String(model.hub.live)],
          ['Need attention', String(model.hub.attention)],
          ['Coming soon', String(model.hub.soon)],
          ['Not enabled', String(model.hub.disabled)],
        ]}
      />
      {model.alerts.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Open alerts</p>
          <ul className="space-y-2">
            {model.alerts.map((a) => (
              <li key={a.id} className="rounded-md border border-line bg-surface px-3 py-2">
                <p className={cx('text-[13px] font-semibold', TONE_TEXT[a.tone])}>{a.title}</p>
                <p className="text-xs text-muted">{a.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NodeDetails({ m, mode }: { m: ModuleStatus; mode: Mode }) {
  if (!m.enabled)
    return (
      <p className="text-sm text-muted">
        <Minus className="mr-1.5 inline size-4" aria-hidden />
        This module is not enabled for the company. An owner can turn it on in Company Settings → Enabled Modules.
      </p>
    )
  if (!m.implemented)
    return (
      <div className="space-y-3">
        <HealthBadge health="soon" />
        <p className="text-sm text-muted">Enabled for future integration. The FastAPI prototype backend implements Transportation and Procurement only — nothing here is live data.</p>
      </div>
    )
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <HealthBadge health={m.health} />
        {m.problems.map((p) => (
          <Badge key={p} tone={m.health === 'critical' ? 'crit' : 'warn'}>
            {p}
          </Badge>
        ))}
      </div>

      {mode === 'executive' &&
        (m.business ? (
          <>
            <p className="text-sm text-fg-2">{m.business.summary}</p>
            {m.business.metrics.length > 0 && <KeyValues items={m.business.metrics} />}
          </>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> You don't have access to this module's records.
          </p>
        ))}

      {mode === 'technical' && m.tech && (
        <>
          <p className="wrap-anywhere text-sm text-fg-2">{m.tech.diagnosis}</p>
          <div>
            <p className="eyebrow mb-2">Lineage</p>
            <ol className="space-y-1.5 text-[13px]">
              {m.tech.datasets.map((d) => (
                <li key={d.name} className="rounded-md border border-line bg-surface px-3 py-2">
                  <p className="num wrap-anywhere text-fg-2">
                    {d.sources.join(' + ')} → Bronze → Silver → <span className="text-fg">{d.name}</span> → {m.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {d.version} · as of <span className="num">{d.asOf}</span> · quality {d.quality}%{' '}
                    {d.stale && (
                      <Badge tone="warn" className="ml-1">
                        Stale
                      </Badge>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="eyebrow mb-2">Sources</p>
            <ul className="space-y-1.5">
              {m.tech.sources.map((s) => (
                <li key={s.id} className="rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-fg">
                      {s.kind} · {s.name}
                    </span>
                    <span className={cx('num text-xs', s.lastRun.status === 'failed' ? 'text-crit-2' : 'text-muted')}>
                      last run {s.lastRun.at} {s.lastRun.status.toUpperCase()}
                    </span>
                  </p>
                  <p className="num mt-0.5 text-xs text-muted">
                    last good {s.lastSuccess.version} ({s.lastSuccess.at}) · fresh {s.freshness} / SLA {s.sla} · errors {s.errors}
                  </p>
                  {s.lastRun.error && <p className="wrap-anywhere mt-1 text-xs text-crit-2">{s.lastRun.error}</p>}
                </li>
              ))}
            </ul>
          </div>
          <KeyValues
            cols={3}
            items={[
              ['ACL filter', <span key="acl" className="num">modules=[{m.id}]</span>],
              ['Indexed docs', `${m.tech.docs.count} · ${m.tech.docs.chunks} chunks`],
              ['Index version', <span key="idx" className="num">{m.tech.docs.indexVersion}</span>],
              ['Denied requests', String(m.tech.incidents)],
              ['Records visible', 'None — configure only'],
            ]}
          />
        </>
      )}
    </div>
  )
}
