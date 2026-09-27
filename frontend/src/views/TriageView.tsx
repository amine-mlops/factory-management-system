import { CloudOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ControlRail } from '../components/triage/ControlRail.tsx'
import { ResultDrawer } from '../components/triage/Drawer.tsx'
import { AssetCard, CriticalBanner, DiagnosisCard, ImpactPanel, MitigationPanel, SafetyGate, TicketCard, type CmdState } from '../components/triage/Results.tsx'
import { AnalyzingState, EmptyState, PipelineStrip } from '../components/triage/Stages.tsx'
import { TelemetryPanel } from '../components/triage/Telemetry.tsx'
import { Badge, Eyebrow } from '../components/ui/primitives.tsx'
import type { InferenceResult } from '../lib/types.ts'
import { prefersReducedMotion } from '../lib/useNow.ts'
import type { TriageController } from '../lib/useTriage.ts'

const GATE_START = 250
const GATE_STEP = 220

/**
 * Post-analysis narrative: standards gate validates check-by-check, then the
 * command dispatches and is acknowledged, then the work order is created and
 * the impact metrics count up. Derived from `doneAt` so navigating away and
 * back shows the finished state instead of replaying.
 */
function useReveal(result: InferenceResult | null, doneAt: number) {
  const [now, setNow] = useState(() => Date.now())
  const n = result?.standards_validation.checks.length ?? 0
  const gateEnd = GATE_START + n * GATE_STEP
  const ack = result?.mitigation_command ? Math.min(600, result.mitigation_command.ack_ms * 2.5) : 0
  const end = gateEnd + 150 + ack + 600
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (!result || reduced) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t - doneAt > end) clearInterval(id)
    }, 60)
    return () => clearInterval(id)
  }, [result, doneAt, end, reduced])

  const e = reduced ? Infinity : Math.max(0, now - doneAt)
  const gateCount = Math.max(0, Math.min(n, Math.floor((e - GATE_START) / GATE_STEP) + 1))
  const cmdAt = gateEnd + 150
  const cmd: CmdState = e < cmdAt ? 'idle' : e < cmdAt + ack ? 'dispatching' : 'acked'
  const ticket = e < cmdAt + ack ? 'idle' : e < cmdAt + ack + 400 ? 'creating' : 'created'
  return { gateCount, gateDone: gateCount >= n, cmd, ticket: ticket as 'idle' | 'creating' | 'created', impact: e >= cmdAt + ack + 450 }
}

export function TriageView({ triage: t }: { triage: TriageController }) {
  const result = t.phase === 'done' ? (t.outcome?.result ?? null) : null
  const rid = result?.telemetry.request_id ?? ''
  const [pick, setPick] = useState<{ rid: string; id: string | null } | null>(null)
  const selected = pick && pick.rid === rid ? pick.id : (result?.detections[0]?.id ?? null)
  const setSelected = (id: string | null) => setPick({ rid, id })
  const reveal = useReveal(result, t.doneAt)

  const gateState = !result ? undefined : !reveal.gateDone ? 'validating' : result.standards_validation.verdict === 'NO_ACTION' ? 'clear' : 'authorized'
  const stage = t.phase === 'idle' ? -1 : t.phase === 'analyzing' ? t.stage : 4

  return (
    <div className="mx-auto max-w-[1760px] px-4 pt-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Manufacturing · Autonomous Industrial Triage &amp; Mitigation</Eyebrow>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-fg">Autonomous Triage cockpit</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">Simulated inference · Brev GPU is an architecture target</Badge>
          <Badge tone="neutral">Gate policy v2.4</Badge>
          <Badge tone="info">PLC writes simulated</Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(300px,30%)_minmax(0,1fr)]">
        <aside aria-label="Triage controls" className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:self-start lg:overflow-y-auto lg:pb-4 lg:pr-1">
          <ControlRail t={t} />
        </aside>

        <section aria-label="Triage results" className="@container flex min-w-0 flex-col gap-4">
          <PipelineStrip stage={stage} gateState={gateState} />

          {t.notice && (
            <div role="status" className="flex animate-rise items-center gap-3 rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5">
              <CloudOff className="size-4 shrink-0 text-warn" aria-hidden />
              <p className="flex-1 text-[13px] text-fg-2">{t.notice}</p>
              <button type="button" onClick={t.dismissNotice} className="rounded-sm p-1 text-muted hover:text-fg" aria-label="Dismiss notice">
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {t.phase === 'idle' && <EmptyState preset={t.preset} />}
          {t.phase === 'analyzing' && <AnalyzingState stage={t.stage} preset={t.preset} />}

          {result && t.outcome && (
            <>
              <CriticalBanner result={result} />
              <div className="grid gap-4 @min-[820px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <AssetCard outcome={t.outcome} />
                <DiagnosisCard result={result} />
              </div>
              <TelemetryPanel result={result} threshold={t.threshold} selectedId={selected} onSelect={setSelected} />
              <div className="grid gap-4 @min-[1040px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                <SafetyGate result={result} revealed={reveal.gateCount} />
                <MitigationPanel result={result} state={reveal.cmd} margin={t.margin} />
              </div>
              <div className="grid gap-4 @min-[820px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <TicketCard result={result} state={reveal.ticket} />
                <ImpactPanel result={result} visible={reveal.impact} />
              </div>
              <ResultDrawer result={result} />
            </>
          )}
          {!result && <div className="h-4" />}
        </section>
      </div>
    </div>
  )
}
