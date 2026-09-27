import { Cable, CircleAlert, CircleCheck, Plug, Unplug } from 'lucide-react'
import { navItem, type ModuleId } from '../../data/nav.ts'
import { cx, TONE_TEXT } from '../../lib/format.ts'
import { connect, disconnect, type Connector, type GoldDataset } from '../../lib/workspace.ts'
import { Badge, Button, StatusDot } from '../ui/primitives.tsx'

type SetConnectors = (fn: (c: Connector[]) => Connector[]) => void
type SetGold = (fn: (g: GoldDataset[]) => GoldDataset[]) => void

interface Props {
  connectors: Connector[]
  gold: GoldDataset[]
  enabledModules: ModuleId[]
  setConnectors?: SetConnectors
  setGold?: SetGold
  compact?: boolean
}

const HEALTH = {
  healthy: { tone: 'nv', label: 'Healthy' },
  stale: { tone: 'warn', label: 'Stale' },
  schema_mismatch: { tone: 'warn', label: 'Schema mismatch' },
  failed: { tone: 'crit', label: 'Refresh failed' },
  disconnected: { tone: 'neutral', label: 'Not connected' },
} as const

const shortModule = (m: ModuleId) => navItem(m).label

export function SourcesGrid({ connectors, setConnectors, compact }: { connectors: Connector[]; setConnectors?: SetConnectors; compact?: boolean }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 @6xl:grid-cols-3">
      {connectors.map((c) => {
        const h = HEALTH[c.connected ? c.health : 'disconnected']
        return (
          <li key={c.id} className={cx('rounded-lg border bg-deck p-3', c.connected ? (h.tone === 'crit' ? 'border-crit/45' : 'border-line') : 'border-dashed border-line-2')}>
            <div className="flex items-start gap-2.5">
              <span className={cx('grid size-8 shrink-0 place-items-center rounded-md border', c.connected ? 'border-line-2 text-fg-2' : 'border-line text-muted')}>
                <Cable className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-muted">{c.kind}</span>
                  <span className={cx('flex items-center gap-1 text-xs', TONE_TEXT[h.tone])}>
                    <StatusDot tone={h.tone} className="size-1.5" /> {h.label}
                  </span>
                </p>
                <p className="truncate text-[13px] font-medium text-fg">{c.name}</p>
                <p className="truncate text-xs text-muted">{c.detail}</p>
              </div>
              {setConnectors && (
                <Button
                  size="sm"
                  variant={c.connected ? 'ghost' : 'secondary'}
                  icon={c.connected ? Unplug : Plug}
                  onClick={() => setConnectors((all) => all.map((x) => (x.id === c.id ? (x.connected ? disconnect(x) : connect(x)) : x)))}
                  aria-label={`${c.connected ? 'Disconnect' : 'Connect'} ${c.name}`}
                >
                  {c.connected ? 'Disconnect' : 'Connect'}
                </Button>
              )}
            </div>
            {c.connected && !compact && (
              <dl className="num mt-2.5 grid grid-cols-4 gap-2 border-t border-line pt-2 text-xs">
                <div>
                  <dt className="text-muted">Fresh</dt>
                  <dd className={c.lastRun.status === 'failed' || c.health === 'stale' ? 'text-warn' : 'text-fg-2'}>{c.freshness}</dd>
                </div>
                <div>
                  <dt className="text-muted">SLA</dt>
                  <dd className="text-fg-2">{c.sla}</dd>
                </div>
                <div>
                  <dt className="text-muted">Quality</dt>
                  <dd className={c.quality < 95 ? 'text-warn' : 'text-fg-2'}>{c.quality}%</dd>
                </div>
                <div>
                  <dt className="text-muted">Errors</dt>
                  <dd className={c.errors ? 'text-crit-2' : 'text-fg-2'}>{c.errors}</dd>
                </div>
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function MedallionStrip({ connectors, gold, enabledModules, vertical }: Pick<Props, 'connectors' | 'gold' | 'enabledModules'> & { vertical?: boolean }) {
  const live = connectors.filter((c) => c.connected)
  const quarantined = live.filter((c) => c.lastRun.errorKind === 'quality').reduce((s, c) => s + c.errors, 0)
  const tiers = [
    { name: 'Bronze', color: 'var(--color-tier-bronze)', desc: 'Raw ingestion · append-only landing', stat: `${live.length} sources · ${live.reduce((s, c) => s + c.errors, 0)} errors` },
    { name: 'Silver', color: 'var(--color-tier-silver)', desc: 'Validation & cleaning · typed, de-duplicated', stat: quarantined ? `${quarantined} rows quarantined` : 'Schema contracts OK' },
    { name: 'Gold', color: 'var(--color-tier-gold)', desc: 'Curated tables → permission-scoped queries', stat: `${gold.length} datasets · ${gold.filter((g) => g.modules.some((m) => enabledModules.includes(m))).length} mapped` },
  ]
  return (
    <ol className={cx('grid items-stretch gap-3', !vertical && 'sm:grid-cols-3')} aria-label="Medallion pipeline">
      {tiers.map((l) => (
        <li key={l.name} className="rounded-md border border-line bg-deck p-3" style={vertical ? { borderLeftColor: l.color, borderLeftWidth: 2 } : { borderTopColor: l.color, borderTopWidth: 2 }}>
          <p className="eyebrow">{l.name}</p>
          <p className="mt-1 text-[13px] text-fg-2">{l.desc}</p>
          <p className="num mt-1 text-xs text-muted">{l.stat}</p>
        </li>
      ))}
    </ol>
  )
}

export function GoldMappings({ gold, connectors, enabledModules, setGold }: Pick<Props, 'gold' | 'connectors' | 'enabledModules' | 'setGold'>) {
  const editable = !!setGold
  const toggle = (gid: string, m: ModuleId) => setGold?.((all) => all.map((g) => (g.id === gid ? { ...g, modules: g.modules.includes(m) ? g.modules.filter((x) => x !== m) : [...g.modules, m] } : g)))
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <caption className="sr-only">Gold datasets, their sources, the modules they feed, freshness and quality</caption>
        <thead>
          <tr className="border-b border-line bg-deck">
            {['Dataset', 'Sources', 'Feeds modules', 'Version · as of', 'Quality'].map((h) => (
              <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gold.map((g) => {
            const srcDown = g.sources.some((s) => !connectors.find((c) => c.id === s)?.connected)
            return (
              <tr key={g.id} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2">
                  <p className="num text-fg">{g.name}</p>
                  <p className="text-xs text-muted">{g.task}</p>
                </td>
                <td className="num px-3 py-2 text-fg-2">
                  {g.sources.join(' + ')}
                  {srcDown && <span className="ml-1.5 text-xs text-warn">(source off)</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(editable ? enabledModules : g.modules).map((m) => {
                      const on = g.modules.includes(m)
                      return editable ? (
                        <button key={m} type="button" aria-pressed={on} onClick={() => toggle(g.id, m)} className={cx('h-7 rounded-sm border px-2 text-xs transition-colors', on ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg')}>
                          {shortModule(m)}
                        </button>
                      ) : (
                        <Badge key={m} tone={enabledModules.includes(m) ? 'neutral' : 'neutral'} className="normal-case tracking-normal">
                          {shortModule(m)}
                        </Badge>
                      )
                    })}
                    {editable && enabledModules.length === 0 && <span className="text-xs text-muted">Enable modules first</span>}
                  </div>
                </td>
                <td className="num whitespace-nowrap px-3 py-2">
                  <span className={g.stale ? 'text-warn' : 'text-fg-2'}>
                    {g.version} · {g.asOf}
                  </span>
                  {g.stale && (
                    <Badge tone="warn" className="ml-1.5">
                      Stale
                    </Badge>
                  )}
                </td>
                <td className="num px-3 py-2">
                  <span className={cx('inline-flex items-center gap-1', g.quality < 96 ? 'text-warn' : 'text-fg-2')}>
                    {g.quality >= 96 ? <CircleCheck className="size-3.5 text-ok" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
                    {g.quality}%
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Composite used by the owner setup wizard. */
export function PipelinePanel({ connectors, gold, enabledModules, setConnectors, setGold, compact }: Props) {
  const warnings = connectors.filter((c) => c.connected && c.warning)
  return (
    <div className="space-y-5">
      <section aria-label="Source connectors" className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Source connectors</p>
          <span className="num text-xs text-muted">
            {connectors.filter((c) => c.connected).length}/{connectors.length} connected · mock
          </span>
        </div>
        <SourcesGrid connectors={connectors} setConnectors={setConnectors} compact={compact} />
      </section>
      <section aria-label="Medallion pipeline" className="space-y-2.5">
        <p className="eyebrow">Raw ingestion → validation &amp; cleaning → curated Gold tables</p>
        <MedallionStrip connectors={connectors} gold={gold} enabledModules={enabledModules} />
      </section>
      {warnings.length > 0 && (
        <ul className="space-y-2" aria-label="Ingestion warnings">
          {warnings.map((c) => (
            <li key={c.id} className={cx('flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]', c.lastRun.status === 'failed' ? 'border-crit-line bg-crit-bg' : 'border-warn-line bg-warn-bg')}>
              <CircleAlert className={cx('mt-0.5 size-4 shrink-0', c.lastRun.status === 'failed' ? 'text-crit' : 'text-warn')} aria-hidden />
              <span className="text-fg-2">
                <span className="font-mono text-xs font-semibold text-muted">{c.kind}</span> · {c.warning}
              </span>
            </li>
          ))}
        </ul>
      )}
      <section aria-label="Gold-layer mappings" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Gold datasets → modules</p>
          {setGold && <span className="text-xs text-muted">Toggle chips to map</span>}
        </div>
        <GoldMappings gold={gold} connectors={connectors} enabledModules={enabledModules} setGold={setGold} />
      </section>
    </div>
  )
}
