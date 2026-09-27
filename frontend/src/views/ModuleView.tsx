import { ArrowUpRight, Database, Download, Plus } from 'lucide-react'
import type { NavActions } from '../components/shell/Shell.tsx'
import { Badge, Button, Eyebrow, HealthRing, KpiCard, Meter, Panel, Sparkline, StatusDot } from '../components/ui/primitives.tsx'
import { MACHINES } from '../data/fleet.ts'
import type { Cell, ModuleChart, ModuleConfig } from '../data/modules.ts'
import { navItem } from '../data/nav.ts'
import { cx, TONE_BG, TONE_TEXT } from '../lib/format.ts'
import { useNotify } from '../lib/toast.ts'

export function ModuleView({ config, openTriage }: { config: ModuleConfig } & NavActions) {
  const notify = useNotify()
  const Icon = navItem(config.id).icon
  const isMfg = config.id === 'manufacturing'

  const primary = () => (isMfg ? openTriage('pump_cavitation') : notify(config.action.toast, 'nv'))

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 pb-28 pt-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-line-2 bg-surface text-accent">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <Eyebrow>{config.eyebrow}</Eyebrow>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-fg">{config.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">{config.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config.backend && (
            <Badge tone="neutral" className="normal-case tracking-normal">
              <Database className="size-3" aria-hidden /> {config.backend}
            </Badge>
          )}
          {config.secondary && (
            <Button icon={Download} onClick={() => notify(config.secondary!.toast, 'info')}>
              {config.secondary.label}
            </Button>
          )}
          <Button variant="primary" icon={isMfg ? ArrowUpRight : Plus} onClick={primary}>
            {config.action.label}
          </Button>
        </div>
      </header>

      <section aria-label={`${config.title} KPIs`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {config.kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} unit={k.unit} delta={k.delta} deltaTone={k.deltaTone} tone={k.tone ?? 'neutral'} className="animate-rise" />
        ))}
      </section>

      {isMfg && (
        <Panel eyebrow="Rotating equipment · linked to Autonomous Triage" title="Machinery health" actions={<Badge tone="crit" dot>P-204 critical</Badge>} bodyClassName="p-0">
          <ul className="grid divide-line md:grid-cols-3 md:divide-x">
            {MACHINES.map((m) => (
              <li key={m.id} className="flex items-center gap-4 p-4">
                <HealthRing score={m.health} tone={m.tone} size={60} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="num text-base font-semibold text-fg">{m.id}</span>
                    <span className={cx('truncate text-xs font-medium', TONE_TEXT[m.tone])}>{m.status}</span>
                  </p>
                  <p className="truncate text-[13px] text-muted">{m.name}</p>
                  <Sparkline values={m.trend} tone={m.tone} height={22} className="mt-1.5" />
                </div>
                <Button size="sm" variant={m.tone === 'crit' ? 'danger' : 'secondary'} onClick={() => openTriage(m.preset)} aria-label={`Open ${m.id} in the triage preview`}>
                  Triage
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <Panel eyebrow={config.chart.caption} title={config.chart.title}>
          <Chart chart={config.chart} />
        </Panel>
        <Panel eyebrow="Recent activity" title={config.table.title} bodyClassName="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                {config.table.columns.map((c) => (
                  <th key={c.key} scope="col" className={cx('eyebrow px-4 py-3 text-[11px] font-medium', c.align === 'right' && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.table.rows.map((row, i) => (
                <tr key={i} className="border-b border-line/70 transition-colors last:border-0 hover:bg-raised">
                  {config.table.columns.map((c) => (
                    <td key={c.key} className={cx('px-4 py-3', c.align === 'right' && 'text-right', c.mono && 'num text-fg-2', !c.mono && 'text-fg-2')}>
                      <CellView cell={row[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  )
}

function CellView({ cell }: { cell: Cell | undefined }) {
  if (cell === undefined) return null
  if (typeof cell === 'string') return <>{cell}</>
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium', TONE_TEXT[cell.tone])}>
      <StatusDot tone={cell.tone} className="size-1.5" />
      {cell.text}
    </span>
  )
}

function Chart({ chart }: { chart: ModuleChart }) {
  if (chart.kind === 'progress') {
    return (
      <ul className="space-y-4">
        {chart.data.map((d) => (
          <li key={d.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg-2">{d.label}</span>
              <span className={cx('num font-semibold', TONE_TEXT[d.tone ?? 'nv'])}>{d.detail}</span>
            </div>
            <Meter value={d.value} tone={d.tone ?? 'nv'} label={`${d.label} ${d.detail}`} />
          </li>
        ))}
      </ul>
    )
  }

  const max = Math.max(...chart.data.map((d) => d.value), chart.target?.value ?? 0) * 1.12
  return (
    <figure>
      <div className="relative flex h-[220px] items-end gap-3 border-b border-l border-line pl-2 sm:gap-5" role="img" aria-label={`${chart.title}: ${chart.data.map((d) => `${d.label} ${d.value}${chart.unit}`).join(', ')}`}>
        {chart.target && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn/60" style={{ bottom: `${(chart.target.value / max) * 100}%` }}>
            <span className="absolute -top-5 right-0 font-mono text-[11px] uppercase tracking-[0.08em] text-warn">{chart.target.label}</span>
          </div>
        )}
        {chart.data.map((d) => (
          <div key={d.label} className="group flex h-full flex-1 flex-col items-center justify-end">
            <span className="num mb-1.5 text-xs font-semibold text-fg-2">
              {d.value}
              <span className="text-faint">{chart.unit === '%' ? '%' : ''}</span>
            </span>
            <div
              className={cx('w-full max-w-[46px] rounded-t-sm opacity-85 transition-opacity group-hover:opacity-100', TONE_BG[d.tone ?? 'nv'])}
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-3 pl-2 sm:gap-5">
        {chart.data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center text-xs text-muted">
            {d.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
