import { FileUp, LoaderCircle, Play, Plug, RotateCcw, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { checkHealth } from '../../lib/api.ts'
import { API_URL, INFER_PATH } from '../../lib/inference.ts'
import { cx } from '../../lib/format.ts'
import { PRESETS } from '../../lib/presets.ts'
import { MODELS, type TriageController } from '../../lib/useTriage.ts'
import { Eyebrow, Panel, StatusDot, Switch } from '../ui/primitives.tsx'

const TONE_RING = { ok: 'bg-accent', warn: 'bg-warn', critical: 'bg-crit' } as const

export function ControlRail({ t }: { t: TriageController }) {
  const busy = t.phase === 'analyzing'
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; detail: string; ms: number } | 'checking' | null>(null)

  const attach = (f: File | undefined) => {
    if (f) t.setFile({ name: f.name, size: f.size })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    attach(e.dataTransfer.files[0])
  }

  const outcome = t.outcome
  const conn = !outcome ? (t.useMock ? 'Local mock data' : 'Ready') : outcome.source === 'live' ? 'Connected · 200 OK' : outcome.source === 'fallback' ? 'Unreachable · fell back' : 'Local mock data'
  const connTone = !outcome ? (t.useMock ? 'info' : 'nv') : outcome.source === 'fallback' ? 'warn' : outcome.source === 'live' ? 'nv' : 'info'

  return (
    <div className="space-y-4">
      <Panel eyebrow="01 · Scenario" title="Demo presets" bodyClassName="p-3">
        <div role="radiogroup" aria-label="Scenario preset" className="space-y-2">
          {PRESETS.map((p) => {
            const active = t.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => t.setPreset(p.id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                  active ? 'border-accent/60 bg-accent/[0.08]' : 'border-line bg-deck/60 hover:border-line-2',
                )}
              >
                <span className={cx('size-2 shrink-0 rounded-full', TONE_RING[p.tone], active && '')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{p.label}</span>
                  <span className="block truncate text-xs text-muted">
                    <span className="num text-fg-2">{p.assetId}</span> · {p.tagline}
                  </span>
                </span>
                {active && <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-accent">SELECTED</span>}
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel eyebrow="02 · Input" title="Telemetry source" bodyClassName="space-y-4 p-4">
        <div>
          <label htmlFor="source" className="eyebrow mb-2 block">
            Stream endpoint
          </label>
          <input
            id="source"
            value={t.file ? `upload://${t.file.name}` : t.source}
            onChange={(e) => t.setSource(e.target.value)}
            disabled={busy || !!t.file}
            spellCheck={false}
            className="num w-full rounded-md border border-line-2 bg-deck px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/70 disabled:opacity-60"
          />
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx('rounded-md border border-dashed px-3 py-3 transition-colors', dragging ? 'border-accent bg-accent/[0.06]' : 'border-line-2')}
        >
          {t.file ? (
            <div className="flex items-center gap-2.5">
              <FileUp className="size-4 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-fg">{t.file.name}</p>
                <p className="num text-[11px] text-muted">{(t.file.size / 1024).toFixed(1)} KB · attached locally (demo)</p>
              </div>
              <button type="button" onClick={() => t.setFile(null)} className="rounded-sm p-1 text-muted hover:text-fg" aria-label="Remove attached capture">
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} className="flex w-full items-center gap-2.5 text-left" disabled={busy}>
              <FileUp className="size-4 text-muted" aria-hidden />
              <span className="text-[13px] text-fg-2">
                Drop a capture or <span className="text-accent underline underline-offset-2">browse</span>
                <span className="block text-[11px] text-faint">.csv · .json · .parquet — stays in the browser</span>
              </span>
            </button>
          )}
          <input ref={fileInput} type="file" accept=".csv,.json,.parquet" className="sr-only" tabIndex={-1} aria-label="Upload telemetry capture" onChange={(e) => attach(e.target.files?.[0])} />
        </div>
      </Panel>

      <Panel eyebrow="03 · Model" title="Inference configuration" bodyClassName="space-y-4 p-4">
        <div>
          <label htmlFor="model" className="eyebrow mb-2 block">
            Anomaly model
          </label>
          <select
            id="model"
            value={t.model}
            onChange={(e) => t.setModel(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-line-2 bg-deck px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/70"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">{MODELS.find((m) => m.id === t.model)?.detail}</p>
        </div>
        <Slider id="thr" label="Anomaly threshold" value={t.threshold} min={0.5} max={0.95} step={0.01} display={t.threshold.toFixed(2)} onChange={t.setThreshold} disabled={busy} />
        <Slider id="margin" label="Safety margin" value={t.margin} min={5} max={30} step={1} display={`${t.margin}%`} onChange={t.setMargin} disabled={busy} />
      </Panel>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void t.run()}
          disabled={busy}
          className="glow-accent group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-md bg-accent px-4 py-4 font-mono text-sm font-bold uppercase tracking-[0.16em] text-on-accent transition-[filter,transform] hover:brightness-110 active:translate-y-px disabled:cursor-progress disabled:brightness-90"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
          {busy ? 'Analyzing…' : t.phase === 'done' ? 'Re-run analysis' : 'Run analysis'}
        </button>
        {t.phase !== 'idle' && (
          <button
            type="button"
            onClick={t.reset}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-line-2 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-fg-2 hover:border-control hover:text-fg disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reset
          </button>
        )}
      </div>

      <Panel bodyClassName="space-y-4 p-4">
        <Switch id="use-mock" label="USE_MOCK" description="Serve local preset data. Off = POST /infer (8 s timeout, auto-fallback)." checked={t.useMock} onChange={t.setUseMock} />
        <div className="rounded-md border border-line bg-deck/70 p-3">
          <div className="flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5 text-[11px]">
              <Plug className="size-3" aria-hidden /> Connection
            </Eyebrow>
            <span className="flex items-center gap-1.5 text-xs text-fg-2">
              <StatusDot tone={connTone} pulse={connTone === 'nv'} className="size-1.5" /> {conn}
            </span>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <Row k="Endpoint" v={`${API_URL}${INFER_PATH}`} />
            <Row k="Mode" v={t.useMock ? 'MOCK (VITE_USE_MOCK)' : 'LIVE → fallback on error'} />
            <Row k="GPU node" v="Architecture target (not connected)" />
            <Row k="Round trip" v={outcome ? `${outcome.roundTripMs} ms` : '—'} />
            <Row k="GET /health" v={health === null ? 'not checked' : health === 'checking' ? 'checking…' : `${health.ok ? 'OK' : 'unreachable'} · ${health.ms} ms`} />
          </dl>
          <button
            type="button"
            onClick={async () => {
              setHealth('checking')
              setHealth(await checkHealth())
            }}
            className="mt-3 w-full rounded-sm border border-line-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-2 hover:text-fg"
          >
            Check FastAPI connection
          </button>
          {health && health !== 'checking' && !health.ok && <p className="mt-2 text-xs text-warn">Backend unreachable ({health.detail}) — demo keeps running on mock data.</p>}
        </div>
      </Panel>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-faint">{k}</dt>
      <dd className="num truncate text-right text-fg-2">{v}</dd>
    </div>
  )
}

function Slider(props: { id: string; label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void; disabled?: boolean }) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={props.id} className="eyebrow">
          {props.label}
        </label>
        <output htmlFor={props.id} className="num rounded-sm border border-line bg-deck px-1.5 py-0.5 text-xs font-semibold text-accent-2">
          {props.display}
        </output>
      </div>
      <input
        id={props.id}
        type="range"
        className="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${fill}%` }}
      />
    </div>
  )
}
