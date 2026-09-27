import { apiRequest, describeError, ENDPOINTS } from './api.ts'
import { getPreset } from './presets.ts'
import type { InferenceRequest, InferenceResult } from './types.ts'

/**
 * Triage inference client.
 *
 *  - VITE_USE_MOCK (default `true`): resolve from the in-code preset datasets.
 *  - VITE_USE_MOCK=false: POST `${VITE_API_URL}/triage/infer` (FastAPI) with an
 *    8 s timeout via the shared API client. Any network error, timeout, non-2xx
 *    status or malformed payload resolves with mock data plus a non-blocking
 *    notice — the demo never breaks.
 */

export { API_URL, USE_MOCK_DEFAULT } from './api.ts'
export const INFER_TIMEOUT_MS = 8000
export const INFER_PATH = ENDPOINTS.triageInfer

export type ResultSource = 'mock' | 'live' | 'fallback'

export interface InferenceOutcome {
  result: InferenceResult
  source: ResultSource
  /** Human-readable reason when the live call failed and mock data was used. */
  notice?: string
  /** Wall-clock round-trip measured in the browser. */
  roundTripMs: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Structural guard for the response contract (keeps rendering code safe from partial payloads). */
export function isInferenceResult(v: unknown): v is InferenceResult {
  if (!isObj(v)) return false
  const { telemetry, input, asset, signals, spectrum, detections, diagnosis, summary, standards_validation, impact, actions } = v
  return (
    isObj(telemetry) && typeof telemetry.latency_ms === 'number' && typeof telemetry.request_id === 'string' &&
    isObj(input) && typeof input.preset === 'string' &&
    isObj(asset) && typeof asset.id === 'string' && typeof asset.health_score === 'number' &&
    Array.isArray(signals) && signals.every((s) => isObj(s) && typeof s.key === 'string' && Array.isArray(s.values)) &&
    Array.isArray(spectrum) &&
    Array.isArray(detections) &&
    isObj(diagnosis) && typeof diagnosis.confidence === 'number' && Array.isArray(diagnosis.evidence) && Array.isArray(diagnosis.anomaly_score) &&
    isObj(summary) && typeof summary.total_detections === 'number' &&
    isObj(standards_validation) && Array.isArray(standards_validation.checks) &&
    'mitigation_command' in v && 'maintenance_ticket' in v &&
    isObj(impact) && typeof impact.avoided_cost_usd === 'number' &&
    Array.isArray(actions)
  )
}

function newRequestId() {
  const rand = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return `req_${rand}`
}

/** Mock result stamped with a fresh request id / timestamp so repeated runs feel live. */
export function mockResult(req: InferenceRequest): InferenceResult {
  const result = getPreset(req.preset)
  result.telemetry.request_id = `${newRequestId()}-${result.asset.id.toLowerCase()}`
  result.telemetry.timestamp = new Date().toISOString()
  if (req.source.trim()) result.input.source = req.source.trim()
  return result
}

export async function runInference(
  req: InferenceRequest,
  opts: { useMock: boolean; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<InferenceOutcome> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)

  if (opts.useMock) {
    return { result: mockResult(req), source: 'mock', roundTripMs: elapsed() }
  }

  try {
    const body = await apiRequest<unknown>(INFER_PATH, { method: 'POST', body: req, timeoutMs: opts.timeoutMs ?? INFER_TIMEOUT_MS, fetchImpl: opts.fetchImpl })
    if (!isInferenceResult(body)) throw new Error('response did not match the inference contract')
    return { result: body, source: 'live', roundTripMs: elapsed() }
  } catch (err) {
    return {
      result: mockResult(req),
      source: 'fallback',
      notice: `Live backend unavailable (${describeError(err)}) — showing mock data.`,
      roundTripMs: elapsed(),
    }
  }
}
