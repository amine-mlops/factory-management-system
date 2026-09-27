import { useId, useMemo, useState, type PointerEvent } from 'react'
import { cx, fmtPct, severityTone, TONE_COLOR, TONE_TEXT, type Tone } from '../../lib/format.ts'
import type { Detection, InferenceResult, Signal } from '../../lib/types.ts'
import { Badge, Eyebrow, Meter, Panel } from '../ui/primitives.tsx'

const VB_W = 400
const VB_H = 120
const PAD = 10

function signalTone(s: Signal, v: number): Tone {
  if (s.limit === 'upper') return v >= s.alarm ? 'crit' : v >= s.warn ? 'warn' : 'nv'
  return v <= s.alarm ? 'crit' : v <= s.warn ? 'warn' : 'nv'
}

function minutesAgo(i: number, n: number) {
  const m = n - 1 - i
  return m === 0 ? 'NOW' : `T−${m}m`
}

interface WaveProps {
  signal: Signal
  cursor: number | null
  onCursor: (i: number | null) => void
  detections: Detection[]
  selectedId: string | null
}

function Waveform({ signal: s, cursor, onCursor, detections, selectedId }: WaveProps) {
  const gid = useId()
  const n = s.values.length
  const { min, max } = useMemo(() => {
    const all = [...s.values, s.warn, s.alarm]
    const lo = Math.min(...all)
    const hi = Math.max(...all)
    const pad = (hi - lo) * 0.08 || 1
    return { min: lo - pad, max: hi + pad }
  }, [s])
  const y = (v: number) => VB_H - PAD - ((v - min) / (max - min)) * (VB_H - 2 * PAD)
  const x = (i: number) => (i / (n - 1)) * VB_W
  const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')

  const idx = cursor ?? n - 1
  const value = s.values[idx]
  const tone = signalTone(s, value)
  const color = TONE_COLOR[tone]
  const mine = detections.filter((d) => d.signal === s.key)

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    onCursor(Math.round(f * (n - 1)))
  }

  return (
    <figure className="min-w-0 rounded-lg border border-line bg-deck/70 p-3">
      <figcaption className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fg">{s.label}</p>
          <p className="num text-[11px] text-faint">
            {s.limit === 'upper' ? '≤' : '≥'} {s.warn} warn · {s.alarm} alarm {s.unit}
          </p>
        </div>
        <div className="text-right">
          <span className={cx('num text-lg font-semibold leading-none', TONE_TEXT[tone])}>{value.toFixed(s.key === 'pressure' ? 2 : 1)}</span>
          <span className="num ml-1 text-[11px] text-muted">{s.unit}</span>
          <p className="num mt-0.5 text-[11px] text-faint">{minutesAgo(idx, n)}</p>
        </div>
      </figcaption>
      <div className="relative h-[92px] cursor-crosshair touch-none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => onCursor(null)} aria-hidden>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={VB_W} y1={VB_H * f} y2={VB_H * f} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
          ))}
          {mine.map((d) => {
            const sel = d.id === selectedId
            return (
              <rect
                key={d.id}
                x={x(d.window[0])}
                y={0}
                width={x(d.window[1]) - x(d.window[0])}
                height={VB_H}
                fill={TONE_COLOR[severityTone(d.severity)]}
                opacity={sel ? 0.16 : 0.06}
                stroke={sel ? TONE_COLOR[severityTone(d.severity)] : 'none'}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                className="transition-opacity duration-300"
              />
            )
          })}
          <line x1={0} x2={VB_W} y1={y(s.warn)} y2={y(s.warn)} stroke="var(--color-warn)" strokeOpacity="0.7" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={VB_W} y1={y(s.alarm)} y2={y(s.alarm)} stroke="var(--color-crit)" strokeOpacity="0.75" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={`${line} L${VB_W},${VB_H} L0,${VB_H} Z`} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-fg/50" style={{ left: `${(idx / (n - 1)) * 100}%`, opacity: cursor === null ? 0 : 1 }} />
        <div
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-canvas"
          style={{ left: `${(idx / (n - 1)) * 100}%`, top: `${(y(value) / VB_H) * 100}%`, background: color }}
        />
      </div>
    </figure>
  )
}

function Spectrum({ result }: { result: InferenceResult }) {
  const bins = result.spectrum
  const max = Math.max(...bins.map((b) => b.amplitude))
  const anomalous = result.detections.length > 0
  const peak = bins.reduce((best, b) => {
    const skip = anomalous && Math.abs(b.order - 1) < 0.3
    return !skip && b.amplitude > best.amplitude ? b : best
  }, { order: 1, amplitude: -1 })
  const tone: Tone = anomalous ? 'crit' : 'nv'
  return (
    <figure className="min-w-0 rounded-lg border border-line bg-deck/70 p-3">
      <figcaption className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-fg">Harmonic signature</p>
          <p className="num text-[11px] text-faint">order spectrum · 1× = {result.asset.shaft_hz} Hz</p>
        </div>
        <Badge tone={tone}>
          {peak.order}× · {(peak.order * result.asset.shaft_hz).toFixed(1)} Hz
        </Badge>
      </figcaption>
      <div className="flex h-[92px] items-end gap-[2px]" role="img" aria-label={`Dominant ${anomalous ? 'anomalous ' : ''}peak at ${peak.order} times shaft frequency`}>
        {bins.map((b) => {
          const isPeak = b.order === peak.order
          const is1x = Math.abs(b.order - 1) < 0.01
          return (
            <div
              key={b.order}
              className={cx('flex-1 rounded-t-sm transition-[height] duration-700', isPeak ? (anomalous ? 'bg-crit' : 'bg-accent') : is1x ? 'bg-fg-2' : 'bg-line-2')}
              style={{ height: `${Math.max(2, (b.amplitude / max) * 100)}%` }}
            />
          )
        })}
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
        <span>0.5×</span>
        <span>1×</span>
        <span>5×</span>
        <span>10×</span>
      </div>
    </figure>
  )
}

function AnomalyTimeline({ result, threshold }: { result: InferenceResult; threshold: number }) {
  const vals = result.diagnosis.anomaly_score
  const n = vals.length
  const onset = vals.findIndex((v) => v >= threshold)
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * VB_W).toFixed(2)},${(VB_H - v * VB_H).toFixed(2)}`).join(' ')
  const over = onset >= 0
  return (
    <figure className="min-w-0 rounded-lg border border-line bg-deck/70 p-3">
      <figcaption className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-fg">Neural anomaly score</p>
          <p className="num text-[11px] text-faint">operator threshold {threshold.toFixed(2)}</p>
        </div>
        <Badge tone={over ? 'crit' : 'nv'}>{over ? `Onset ${minutesAgo(onset, n)}` : 'Below threshold'}</Badge>
      </figcaption>
      <div className="relative h-[92px]" role="img" aria-label={over ? `Anomaly score crossed threshold ${n - 1 - onset} minutes ago` : 'Anomaly score below threshold'}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
          {over && <rect x={(onset / (n - 1)) * VB_W} y={0} width={VB_W - (onset / (n - 1)) * VB_W} height={VB_H} fill="var(--color-crit)" opacity="0.07" />}
          <line x1={0} x2={VB_W} y1={VB_H - threshold * VB_H} y2={VB_H - threshold * VB_H} stroke="var(--color-warn)" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" className="transition-all duration-300" />
          <path d={`${line} L${VB_W},${VB_H} L0,${VB_H} Z`} fill={over ? 'var(--color-crit)' : 'var(--color-accent)'} opacity="0.12" />
          <path d={line} fill="none" stroke={over ? 'var(--color-crit)' : 'var(--color-accent)'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
        <span>T−63m</span>
        <span>T−32m</span>
        <span>NOW</span>
      </div>
    </figure>
  )
}

export function TelemetryPanel({ result, threshold, selectedId, onSelect }: { result: InferenceResult; threshold: number; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const [cursor, setCursor] = useState<number | null>(null)
  const n = result.signals[0]?.values.length ?? 64
  return (
    <Panel
      eyebrow="Sensor telemetry · synchronized · 64-min trend"
      title={`${result.asset.id} · high-frequency channels`}
      actions={<Badge tone="neutral">25.6 kHz · 4 ch</Badge>}
      className="animate-rise"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {result.signals.map((s) => (
          <Waveform key={s.key} signal={s} cursor={cursor} onCursor={setCursor} detections={result.detections} selectedId={selectedId} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <label htmlFor="scrub" className="eyebrow shrink-0 text-[11px]">
          Scrub
        </label>
        <input
          id="scrub"
          aria-label="Scrub synchronized telemetry cursor"
          type="range"
          className="range"
          min={0}
          max={n - 1}
          value={cursor ?? n - 1}
          onChange={(e) => setCursor(Number(e.target.value))}
          onBlur={() => setCursor(null)}
          aria-valuetext={minutesAgo(cursor ?? n - 1, n)}
          style={{ ['--fill' as string]: `${((cursor ?? n - 1) / (n - 1)) * 100}%` }}
        />
        <span className="num w-12 shrink-0 text-right text-[11px] text-muted">{minutesAgo(cursor ?? n - 1, n)}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Spectrum result={result} />
        <AnomalyTimeline result={result} threshold={threshold} />
      </div>
      <Findings result={result} selectedId={selectedId} onSelect={onSelect} />
    </Panel>
  )
}

function Findings({ result, selectedId, onSelect }: { result: InferenceResult; selectedId: string | null; onSelect: (id: string | null) => void }) {
  if (result.detections.length === 0) {
    return <p className="mt-4 rounded-md border border-accent/30 bg-accent/[0.05] px-3 py-2.5 text-[13px] text-fg-2">No anomalous findings — all channels inside the learned baseline envelope.</p>
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <Eyebrow className="mb-2">Findings · select to highlight on the waveform</Eyebrow>
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {['Finding', 'Channel', 'Confidence', 'Severity', 'Window'].map((h) => (
              <th key={h} scope="col" className="eyebrow px-2 py-2 text-[11px] font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.detections.map((d) => {
            const sel = d.id === selectedId
            const tone = severityTone(d.severity)
            const sig = result.signals.find((s) => s.key === d.signal)
            return (
              <tr key={d.id} className={cx('border-b border-line/60 transition-colors last:border-0', sel ? 'bg-raised' : 'hover:bg-raised')}>
                {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- cell text is in nested elements */}
                <td className="px-2 py-2">
                  <button type="button" onClick={() => onSelect(sel ? null : d.id)} aria-pressed={sel} className="text-left">
                    <span className={cx('block font-medium', sel ? 'text-fg' : 'text-fg-2')}>{d.label}</span>
                    <span className="block max-w-[340px] truncate text-xs text-muted">{d.evidence}</span>
                  </button>
                </td>
                <td className="px-2 py-2 text-fg-2">{sig?.label ?? d.signal}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <Meter value={d.confidence} tone={tone} className="w-16" label={`${d.label} confidence`} />
                    <span className="num text-fg-2">{fmtPct(d.confidence)}</span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Badge tone={tone}>{d.severity}</Badge>
                </td>
                <td className="num px-2 py-2 text-muted">
                  {minutesAgo(d.window[0], result.signals[0].values.length)} → {minutesAgo(d.window[1], result.signals[0].values.length)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
