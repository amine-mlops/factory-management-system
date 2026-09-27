import { useCallback, useRef, useState } from 'react'
import { delay } from './format.ts'
import { runInference, type InferenceOutcome } from './inference.ts'
import { presetMeta } from './presets.ts'
import type { PresetId } from './types.ts'
import { prefersReducedMotion } from './useNow.ts'

export type TriagePhase = 'idle' | 'analyzing' | 'done'

export const MODELS = [
  { id: 'nexus-tst-3.2', label: 'NEXUS-TST v3.2 · Temporal transformer', detail: 'FP16 · TensorRT · 38 ms p50' },
  { id: 'nexus-ae-2.8', label: 'NEXUS-AE v2.8 · Conv autoencoder', detail: 'FP16 · 22 ms p50 · lower recall' },
  { id: 'nexus-gnn-1.4', label: 'NEXUS-GNN v1.4 · Fleet graph model', detail: 'Cross-asset correlation · 61 ms p50' },
] as const

export const PIPELINE_STAGES = [
  { key: 'telemetry', label: 'Sensor telemetry', detail: '4 channels · 25.6 kHz' },
  { key: 'engine', label: 'Neural anomaly engine', detail: 'Simulated · Brev GPU target' },
  { key: 'gate', label: 'Physics & standards gate', detail: 'ISO / API limits' },
  { key: 'action', label: 'Action generator', detail: 'PLC/SCADA + CMMS' },
] as const

/** Minimum duration of the analyzing sequence so the pipeline reads on camera. */
export const ANALYZE_MS = 640

export const defaultSource = (preset: PresetId) => `opcua://plant-a/${presetMeta(preset).assetId}/vibration+process`

export interface AttachedFile {
  name: string
  size: number
}

/** Triage controller. `useMock` is the app-wide demo switch (Settings → Integrations), shared with the assistant. */
export function useTriage(useMock: boolean, setUseMock: (v: boolean) => void) {
  const [preset, setPresetState] = useState<PresetId>('pump_cavitation')
  const [source, setSource] = useState(() => defaultSource('pump_cavitation'))
  const [file, setFile] = useState<AttachedFile | null>(null)
  const [model, setModel] = useState<string>(MODELS[0].id)
  const [threshold, setThreshold] = useState(0.7)
  const [margin, setMargin] = useState(15)
  const [phase, setPhase] = useState<TriagePhase>('idle')
  const [stage, setStage] = useState(-1)
  const [outcome, setOutcome] = useState<InferenceOutcome | null>(null)
  const [doneAt, setDoneAt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const runId = useRef(0)

  const reset = useCallback(() => {
    runId.current += 1
    setPhase('idle')
    setStage(-1)
    setOutcome(null)
    setNotice(null)
  }, [])

  const setPreset = useCallback(
    (id: PresetId) => {
      setPresetState(id)
      setFile(null)
      setSource(defaultSource(id))
      reset()
    },
    [reset],
  )

  /** Runs the analysis; `override` switches preset and runs in one step (deep links / command palette). */
  const run = useCallback(async (override?: PresetId) => {
    const target = override ?? preset
    if (override && override !== preset) {
      setPresetState(override)
      setFile(null)
      setSource(defaultSource(override))
    }
    const id = ++runId.current
    const reduced = prefersReducedMotion()
    setPhase('analyzing')
    setOutcome(null)
    setNotice(null)
    setStage(0)
    const stepMs = reduced ? 0 : ANALYZE_MS / PIPELINE_STAGES.length
    const request = runInference(
      { asset_id: presetMeta(target).assetId, preset: target, model, anomaly_threshold: threshold, safety_margin_pct: margin, source: override ? defaultSource(target) : file ? `upload://${file.name}` : source },
      { useMock },
    )
    for (let s = 1; s < PIPELINE_STAGES.length; s++) {
      await delay(stepMs)
      if (runId.current !== id) return
      setStage(s)
    }
    const res = await request
    await delay(stepMs)
    if (runId.current !== id) return
    setOutcome(res)
    setNotice(res.notice ?? null)
    setStage(PIPELINE_STAGES.length)
    setDoneAt(Date.now())
    setPhase('done')
  }, [preset, model, threshold, margin, file, source, useMock])

  return {
    preset, setPreset,
    source, setSource,
    file, setFile,
    model, setModel,
    threshold, setThreshold,
    margin, setMargin,
    useMock, setUseMock,
    phase, stage, outcome, doneAt,
    notice, dismissNotice: () => setNotice(null),
    run, reset,
  }
}

export type TriageController = ReturnType<typeof useTriage>
