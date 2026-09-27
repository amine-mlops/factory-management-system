import { Database, RefreshCw, Wrench } from 'lucide-react'
import { cx } from '../../lib/format.ts'
import type { Connector } from '../../lib/workspace.ts'
import { Badge, Panel } from '../ui/primitives.tsx'

interface Dataset {
  name: string
  version: string
  asOf: string
  stale: boolean
}

/** One monitored connector: last run, last good version, freshness vs SLA, and the actionable fix when a run fails. */
export function ConnectorMonitor({ connector: c, dataset, className, level = 2 }: { connector: Connector; dataset?: Dataset; className?: string; level?: 2 | 3 }) {
  const failed = c.lastRun.status === 'failed'
  const warn = !failed && !!c.lastRun.error
  return (
    <Panel
      level={level}
      eyebrow={`Monitored source · ${c.kind}`}
      title={c.name}
      className={cx(failed && 'border-crit/45', className)}
      actions={failed ? <Badge tone="crit">Refresh failed</Badge> : warn ? <Badge tone="warn">Quality warning</Badge> : <Badge tone="nv">Healthy</Badge>}
    >
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {(
          [
            ['Last run', `${c.lastRun.at} · ${c.lastRun.status === 'failed' ? 'Failed' : 'OK'}`, failed ? 'text-crit-2' : 'text-fg-2'],
            ['Last good', `${c.lastSuccess.at} · ${c.lastSuccess.version}`, 'text-fg-2'],
            ['Freshness / SLA', `${c.freshness} / ${c.sla}`, failed || c.health === 'stale' ? 'text-warn' : 'text-fg-2'],
            ['Quality', `${c.quality}%`, c.quality < 97 ? 'text-warn' : 'text-fg-2'],
          ] as const
        ).map(([k, v, cls]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted">{k}</dt>
            <dd className={cx('num wrap-anywhere mt-0.5', cls)}>{v}</dd>
          </div>
        ))}
      </dl>
      {c.lastRun.error && (
        <div className={cx('mt-3 rounded-md border px-3 py-2.5 text-[13px]', failed ? 'border-crit-line bg-crit-bg' : 'border-warn-line bg-warn-bg')}>
          <p className="font-medium text-fg">{c.lastRun.errorKind === 'schema' ? 'Schema error' : c.lastRun.errorKind === 'quality' ? 'Validation error' : 'Run error'}</p>
          <p className="wrap-anywhere mt-0.5 text-fg-2">{c.lastRun.error}</p>
          {c.lastRun.action && (
            <p className="mt-1.5 flex items-start gap-1.5 text-muted">
              <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-fg-2">Fix: </span>
                {c.lastRun.action}
              </span>
            </p>
          )}
        </div>
      )}
      {dataset && (
        <p className={cx('mt-3 flex flex-wrap items-center gap-2 text-xs', dataset.stale ? 'text-warn' : 'text-muted')}>
          <Database className="size-3.5 shrink-0" aria-hidden />
          Serving{' '}
          <span className="num text-fg-2">
            {dataset.name}@{dataset.version}
          </span>{' '}
          as of <span className="num">{dataset.asOf}</span>
          {dataset.stale && <Badge tone="warn">Stale — not current</Badge>}
        </p>
      )}
      {failed && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <RefreshCw className="size-3.5" aria-hidden /> The last validated version stays in service (flagged stale) until a refresh passes.
        </p>
      )}
    </Panel>
  )
}
