import { ArrowRight, BadgeCheck, CircleCheck, CircleX, ClipboardList, Fan, LoaderCircle, Scale, Send, ShieldCheck, Siren, TriangleAlert, Wind, Wrench, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx, fmtInt, fmtPct, fmtUsd, healthTone, severityTone, TONE_TEXT } from '../../lib/format.ts'
import type { InferenceOutcome } from '../../lib/inference.ts'
import type { InferenceResult, StandardsCheck } from '../../lib/types.ts'
import { prefersReducedMotion } from '../../lib/useNow.ts'
import { Badge, Eyebrow, HealthRing, Meter, Panel } from '../ui/primitives.tsx'

const ASSET_ICON = { pump: Wind, compressor: Fan, turbine: Zap } as const

export function CriticalBanner({ result }: { result: InferenceResult }) {
  if (result.summary.critical_count === 0) return null
  const isCrit = result.maintenance_ticket?.severity === 'critical' && result.summary.critical_count > 1
  return (
    <div role="alert" className={cx('panel flex animate-rise flex-wrap items-center gap-3 px-4 py-3', isCrit ? 'glow-crit border-crit-line bg-crit-bg' : 'border-warn-line bg-warn-bg')}>
      <Siren className={cx('size-5 shrink-0', isCrit ? 'text-crit' : 'text-warn')} aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-fg">
        <span className={cx('mr-2 font-mono text-xs font-bold uppercase tracking-[0.12em]', isCrit ? 'text-crit-2' : 'text-warn')}>{isCrit ? 'Critical' : 'Warning'}</span>
        <span className="font-semibold">{result.asset.id}</span> — {result.diagnosis.fault.toLowerCase()} · {result.summary.critical_count} critical finding{result.summary.critical_count > 1 ? 's' : ''}. Validated intervention dispatched instead of a trip.
      </p>
      <Badge tone="neutral">Simulated control</Badge>
    </div>
  )
}

export function AssetCard({ outcome }: { outcome: InferenceOutcome }) {
  const { result } = outcome
  const a = result.asset
  const Icon = ASSET_ICON[a.type]
  const tone = healthTone(a.health_score)
  return (
    <Panel eyebrow="Asset identity" title={a.name} actions={<Icon className={cx('size-5', TONE_TEXT[tone])} aria-hidden />} className="animate-rise">
      <div className="flex items-center gap-5">
        <HealthRing score={a.health_score} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[11px]">Remaining useful life</p>
          <p className={cx('num mt-1 text-[28px] font-semibold leading-none', TONE_TEXT[tone])}>
            {fmtInt(a.remaining_useful_life_hours)}
            <span className="ml-1 text-sm text-muted">h</span>
          </p>
          <p className="mt-1 text-xs text-muted">{a.remaining_useful_life_hours < 500 ? 'Safe operation with mitigation in place' : 'No degradation trend detected'}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[13px]">
        <Item k="Tag" v={a.id} mono />
        <Item k="Type" v={a.type[0].toUpperCase() + a.type.slice(1)} />
        <Item k="Model" v={a.model} />
        <Item k="Location" v={a.location} />
        <Item k="Rated speed" v={`${fmtInt(a.rated_rpm)} rpm · ${a.shaft_hz} Hz`} mono />
        <Item k="Request" v={result.telemetry.request_id} mono />
        <Item k="Inference (mock)" v={`${result.telemetry.latency_ms} ms · ${result.telemetry.gpu_utilization}% GPU`} mono />
        <Item k="Source" v={outcome.source === 'live' ? 'LIVE /infer' : outcome.source === 'fallback' ? 'MOCK (fallback)' : 'MOCK'} mono />
      </dl>
    </Panel>
  )
}

function Item({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{k}</dt>
      <dd className={cx('truncate text-fg-2', mono && 'num')}>{v}</dd>
    </div>
  )
}

export function DiagnosisCard({ result }: { result: InferenceResult }) {
  const d = result.diagnosis
  const healthy = result.detections.length === 0
  const tone = healthy ? 'nv' : result.summary.critical_count > 1 ? 'crit' : 'warn'
  return (
    <Panel eyebrow="Neural anomaly engine · diagnosis" title="Root-cause assessment" actions={<Badge tone={tone} dot>{healthy ? 'Nominal' : 'Fault isolated'}</Badge>} className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={cx('text-[22px] font-semibold leading-tight tracking-tight', TONE_TEXT[tone])}>{d.fault}</p>
          <p className="mt-1 text-[13px] text-fg-2">
            {d.component} · <span className="text-muted">{d.failure_mode}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow text-[11px]">Confidence</p>
          <p className="num mt-1 text-[28px] font-semibold leading-none text-fg">{fmtPct(d.confidence)}</p>
        </div>
      </div>
      <Meter value={d.confidence} tone={tone} className="mt-3" label="Diagnosis confidence" />
      <Eyebrow className="mb-2.5 mt-5">Evidence</Eyebrow>
      <ol className="space-y-2">
        {d.evidence.map((e, i) => (
          <li key={e} className="flex gap-3 text-sm text-fg-2">
            <span className="num mt-px shrink-0 rounded-sm border border-line-2 px-1.5 text-[11px] leading-5 text-muted">E{i + 1}</span>
            {e}
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function allowed(c: StandardsCheck) {
  if (c.allowed_min !== null && c.allowed_max !== null) return `${c.allowed_min}–${c.allowed_max}`
  if (c.allowed_max !== null) return `≤ ${c.allowed_max}`
  return `≥ ${c.allowed_min}`
}

/** Position of the measured value relative to the allowed band, for a mini gauge. */
function gauge(c: StandardsCheck) {
  const lo = c.allowed_min ?? 0
  const hi = c.allowed_max ?? (c.allowed_min ?? 1) * 2
  const span = Math.max(hi, c.measured) * 1.15 - Math.min(lo, c.measured) * 0.85 || 1
  const base = Math.min(lo, c.measured) * 0.85
  return { band: [((lo - base) / span) * 100, ((hi - base) / span) * 100], mark: ((c.measured - base) / span) * 100 }
}

export function SafetyGate({ result, revealed }: { result: InferenceResult; revealed: number }) {
  const g = result.standards_validation
  const done = revealed >= g.checks.length
  const verdictTone = g.verdict === 'INTERVENTION_AUTHORIZED' ? 'nv' : g.verdict === 'NO_ACTION' ? 'nv' : 'crit'
  const groups: Array<[StandardsCheck['scope'], string, string]> = [
    ['condition', 'Condition vs limits', "Confirms the AI's diagnosis against physics"],
    ['command_envelope', 'Command envelope', 'Proves the proposed action is safe'],
  ]
  return (
    <Panel
      eyebrow="Physics & standards gate · deterministic"
      title="Independent safety validation"
      actions={done ? <Badge tone={verdictTone} dot>{g.verdict.replace(/_/g, ' ')}</Badge> : <Badge tone="info"><LoaderCircle className="size-3 animate-spin" aria-hidden /> Validating</Badge>}
      className={cx('animate-rise', done && 'brackets')}
    >
      <div className="space-y-4" aria-live="polite">
        {groups.map(([scope, title, sub]) => {
          const checks = g.checks.filter((c) => c.scope === scope)
          if (!checks.length) return null
          return (
            <div key={scope}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <Eyebrow>{title}</Eyebrow>
                <span className="text-xs text-faint">{sub}</span>
              </div>
              <ul className="divide-y divide-line/70 rounded-md border border-line">
                {checks.map((c) => {
                  const shown = g.checks.indexOf(c) < revealed
                  const pass = c.result === 'PASS'
                  const gm = gauge(c)
                  return (
                    <li key={c.id} className={cx('grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]', !shown && 'opacity-40')}>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-fg">{c.parameter}</p>
                        <p className="num text-[11px] text-faint">{c.standard}</p>
                      </div>
                      <div className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                        <div className="num flex justify-between text-xs">
                          <span className={shown ? (pass ? 'text-fg-2' : 'text-crit-2') : 'text-faint'}>
                            {shown ? c.measured : '—'} {c.unit}
                          </span>
                          <span className="text-faint">
                            allowed {allowed(c)} {c.unit}
                          </span>
                        </div>
                        <div className="relative mt-1 h-1.5 rounded-full bg-line" aria-hidden>
                          <div className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: `${gm.band[0]}%`, width: `${gm.band[1] - gm.band[0]}%` }} />
                          {shown && <div className={cx('absolute -top-[3px] h-3 w-[3px] rounded-sm', pass ? 'bg-accent' : 'bg-crit')} style={{ left: `calc(${Math.min(99, gm.mark)}% - 1px)` }} />}
                        </div>
                      </div>
                      <div className="w-[92px] text-right">
                        {shown ? (
                          <span className={cx('inline-flex animate-fade items-center gap-1 font-mono text-[11px] font-bold tracking-[0.08em]', pass ? 'text-accent' : 'text-crit')}>
                            {pass ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleX className="size-3.5" aria-hidden />}
                            {c.result}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-faint">checking…</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      <div className={cx('mt-4 flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-500', done && g.independently_validated ? 'border-accent/50 bg-accent/[0.07]' : 'border-line bg-deck/60')}>
        <BadgeCheck className={cx('mt-0.5 size-4 shrink-0', done ? 'text-accent' : 'text-faint')} aria-hidden />
        <div>
          <p className="text-sm font-semibold text-fg">{done ? 'AI recommendation independently validated' : 'Validating AI recommendation…'}</p>
          <p className="mt-0.5 text-[13px] text-muted">{done ? g.rationale : 'Rule-based engine — no ML in the loop — checks every limit before any command can leave the gate.'}</p>
        </div>
      </div>
    </Panel>
  )
}

export type CmdState = 'idle' | 'dispatching' | 'acked'

export function MitigationPanel({ result, state, margin }: { result: InferenceResult; state: CmdState; margin: number }) {
  const cmd = result.mitigation_command
  if (!cmd) {
    return (
      <Panel eyebrow="Action generator · PLC / SCADA" title="Closed-loop action" className="animate-rise">
        <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
          <span className="grid size-12 place-items-center rounded-full border border-accent/40 bg-accent/10">
            <ShieldCheck className="size-5 text-accent" aria-hidden />
          </span>
          <p className="text-base font-semibold text-fg">No intervention required</p>
          <p className="max-w-xs text-[13px] text-muted">Gate verdict NO ACTION — setpoints unchanged, continuous monitoring continues (simulated).</p>
        </div>
      </Panel>
    )
  }
  return (
    <Panel
      eyebrow="Action generator · PLC / SCADA"
      title="Closed-loop mitigation command"
      actions={<Badge tone="info">Simulated</Badge>}
      className={cx('animate-rise', state === 'acked' && 'glow-accent')}
    >
      <p className="text-sm text-fg-2">{cmd.intent}</p>
      <dl className="num mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-sm border border-line bg-deck/70 px-2.5 py-1.5">
          <dt className="text-faint">Command</dt>
          <dd className="truncate text-fg">{cmd.command_id}</dd>
        </div>
        <div className="rounded-sm border border-line bg-deck/70 px-2.5 py-1.5">
          <dt className="text-faint">Target</dt>
          <dd className="truncate text-fg">{cmd.target}</dd>
        </div>
      </dl>
      <ul className="mt-3 space-y-2">
        {cmd.operations.map((op) => {
          const delta = op.from === 0 ? null : ((op.to - op.from) / op.from) * 100
          return (
            <li key={op.tag} className="rounded-md border border-line bg-deck/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-fg">{op.description}</span>
                {delta !== null && <span className={cx('num text-xs font-semibold', delta < 0 ? 'text-warn' : 'text-info')}>{delta > 0 ? '+' : ''}{delta.toFixed(0)}%</span>}
              </div>
              <div className="num mt-1 flex items-center gap-2 text-xs">
                <span className="truncate text-faint">{op.tag}</span>
                <span className="ml-auto text-muted">{op.from}</span>
                <ArrowRight className="size-3 text-accent" aria-hidden />
                <span className="font-semibold text-accent-2">
                  {op.to} {op.unit}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex items-center gap-2.5 rounded-md border border-line bg-canvas/60 px-3 py-2.5" aria-live="polite">
        {state === 'acked' ? <CircleCheck className="size-4 shrink-0 text-accent" aria-hidden /> : state === 'dispatching' ? <LoaderCircle className="size-4 shrink-0 animate-spin text-info" aria-hidden /> : <Send className="size-4 shrink-0 text-faint" aria-hidden />}
        <p className="min-w-0 flex-1 text-[13px] text-fg-2">
          {state === 'acked' ? (
            <>
              <span className="font-mono font-semibold text-accent">ACK {cmd.ack_ms} ms</span> · {cmd.protocol} · simulated write — no physical PLC connected
            </>
          ) : state === 'dispatching' ? (
            `Dispatching to ${cmd.target} via ${cmd.protocol}…`
          ) : (
            'Held at gate until validation completes'
          )}
        </p>
      </div>
      <p className="mt-2 text-xs text-faint">Operator safety margin applied: {margin}% · production preserved at reduced throughput.</p>
    </Panel>
  )
}

export function TicketCard({ result, state }: { result: InferenceResult; state: 'idle' | 'creating' | 'created' }) {
  const t = result.maintenance_ticket
  if (!t) {
    return (
      <Panel eyebrow="CMMS · maintenance" title="Work order" className="animate-rise">
        <div className="flex items-center gap-3 py-4">
          <ClipboardList className="size-5 text-muted" aria-hidden />
          <p className="text-sm text-fg-2">No work order needed. Next condition-based review scheduled automatically in 7 days.</p>
        </div>
      </Panel>
    )
  }
  const tone = severityTone(t.severity)
  const ready = state === 'created'
  return (
    <Panel
      eyebrow={`${t.system} · auto-generated`}
      title={
        <span className="flex items-center gap-2">
          <Wrench className="size-4 text-muted" aria-hidden />
          <span className="num">{t.ticket_id}</span>
        </span>
      }
      actions={ready ? <Badge tone="nv" dot>Created</Badge> : <Badge tone="info"><LoaderCircle className="size-3 animate-spin" aria-hidden /> {state === 'creating' ? 'Creating' : 'Queued'}</Badge>}
      className={cx('animate-rise transition-opacity duration-500', !ready && 'opacity-70')}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold text-fg">{t.title}</p>
        <Badge tone={tone}>{t.severity}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] text-faint">Component</dt>
          <dd className="text-fg-2">{t.component}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] text-faint">Replacement SKU</dt>
          <dd className="num text-fg">{t.replacement_sku}</dd>
        </div>
        <div className="col-span-2">
          <dt className="flex justify-between text-[11px] text-faint">
            <span>Remaining safe operating hours</span>
            <span className="num font-semibold text-fg">{t.remaining_safe_hours} h</span>
          </dt>
          <dd className="mt-1.5">
            <Meter value={t.remaining_safe_hours / 336} tone={t.remaining_safe_hours < 120 ? 'crit' : 'warn'} label="Remaining safe hours of 2-week horizon" />
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] text-faint">Inspection window</dt>
          <dd className="text-fg-2">{t.inspection_window}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] text-faint">Assigned to</dt>
          <dd className="text-fg-2">{t.assigned_to}</dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{t.notes}</p>
    </Panel>
  )
}

function useCountUp(target: number, active: boolean, ms = 900) {
  const reduced = prefersReducedMotion()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!active || reduced) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      setV(target * (1 - (1 - p) ** 3))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, ms, reduced])
  return active && reduced ? target : v
}

export function ImpactPanel({ result, visible }: { result: InferenceResult; visible: boolean }) {
  const i = result.impact
  const hours = useCountUp(i.avoided_downtime_hours, visible)
  const cost = useCountUp(i.avoided_cost_usd, visible)
  const tput = useCountUp(i.throughput_maintained_pct, visible)
  return (
    <Panel eyebrow="Business impact" title="From passive alerts to active protection." className={cx('animate-rise transition-opacity duration-500', !visible && 'opacity-50')}>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
        {[
          ['Avoided downtime', `${hours.toFixed(1)}`, 'h'],
          ['Avoided cost', fmtUsd(cost), ''],
          ['Throughput kept', `${Math.round(tput)}`, '%'],
        ].map(([k, v, u]) => (
          <div key={k} className="bg-deck px-3 py-3">
            <p className="eyebrow text-[11px]">{k}</p>
            <p className="num mt-2 text-[22px] font-semibold leading-none text-accent-2">
              {v}
              <span className="ml-0.5 text-sm text-muted">{u}</span>
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-deck/60 p-3">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">
            <TriangleAlert className="size-3.5" aria-hidden /> Traditional system
          </p>
          <p className="mt-1.5 text-xs text-faint">Alert or full shutdown</p>
          <p className="mt-2 text-[13px] text-fg-2">{i.traditional_outcome}</p>
        </div>
        <div className="rounded-md border border-accent/45 bg-accent/[0.06] p-3">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            <Scale className="size-3.5" aria-hidden /> NEXUS
          </p>
          <p className="mt-1.5 text-xs text-muted">Validated, adaptive intervention</p>
          <p className="mt-2 text-[13px] text-fg">{i.nexus_outcome}</p>
        </div>
      </div>
    </Panel>
  )
}
