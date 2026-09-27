import { describe, expect, it } from 'vitest'
import mock from '../../../public/mock_data.json'
import { apiRequest, ApiError } from '../api.ts'
import { isInferenceResult, runInference } from '../inference.ts'
import { getPreset, PRESETS } from '../presets.ts'
import type { InferenceRequest } from '../types.ts'

const req: InferenceRequest = { asset_id: 'P-204', preset: 'pump_cavitation', model: 'nexus-tst-3.2', anomaly_threshold: 0.7, safety_margin_pct: 15, source: 'opcua://x' }

describe('mock contract', () => {
  it('public/mock_data.json satisfies the inference contract', () => {
    expect(isInferenceResult(mock)).toBe(true)
    expect(mock.telemetry.latency_ms).toBe(38)
    expect(mock.telemetry.device).toContain('A100')
  })

  it.each(PRESETS.map((p) => p.id))('preset %s is internally consistent', (id) => {
    const r = getPreset(id)
    expect(isInferenceResult(r)).toBe(true)
    expect(r.summary.total_detections).toBe(r.detections.length)
    expect(r.summary.critical_count).toBe(r.detections.filter((d) => d.severity === 'critical').length)
    const violations = r.standards_validation.checks.some((c) => c.result === 'VIOLATION')
    expect(r.standards_validation.verdict).toBe(violations ? 'INTERVENTION_AUTHORIZED' : 'NO_ACTION')
    expect(r.mitigation_command === null).toBe(!violations)
    r.signals.forEach((s) => expect(s.values).toHaveLength(64))
  })
})

describe('runInference', () => {
  it('serves mock data when USE_MOCK is on', async () => {
    const out = await runInference(req, { useMock: true })
    expect(out.source).toBe('mock')
    expect(out.result.asset.id).toBe('P-204')
  })

  it('falls back to mock data on network error', async () => {
    const out = await runInference(req, { useMock: false, fetchImpl: async () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(out.source).toBe('fallback')
    expect(out.notice).toMatch(/Live backend unavailable/)
  })

  it('falls back on non-2xx and on malformed payloads', async () => {
    const http = await runInference(req, { useMock: false, fetchImpl: async () => new Response('{"detail":"boom"}', { status: 500 }) })
    expect(http.notice).toMatch(/HTTP 500/)
    const bad = await runInference(req, { useMock: false, fetchImpl: async () => new Response('{"ok":true}', { status: 200 }) })
    expect(bad.source).toBe('fallback')
  })

  it('times out and falls back', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const out = await runInference(req, { useMock: false, fetchImpl: hang, timeoutMs: 20 })
    expect(out.source).toBe('fallback')
    expect(out.notice).toMatch(/timed out/)
  })

  it('accepts a valid live payload', async () => {
    const out = await runInference(req, { useMock: false, fetchImpl: async () => new Response(JSON.stringify(getPreset('pump_cavitation')), { status: 200 }) })
    expect(out.source).toBe('live')
  })
})

describe('apiRequest', () => {
  it('normalizes FastAPI HTTPException detail into ApiError', async () => {
    const p = apiRequest('/x', { fetchImpl: async () => new Response('{"detail":"Forbidden"}', { status: 403 }) })
    await expect(p).rejects.toBeInstanceOf(ApiError)
    await expect(apiRequest('/x', { fetchImpl: async () => new Response('{"detail":"Forbidden"}', { status: 403 }) })).rejects.toMatchObject({ status: 403, kind: 'http' })
  })
})
