/**
 * Central typed client for the FastAPI backend.
 *
 *  - Base URL: VITE_API_URL (FastAPI origin, e.g. http://localhost:8000).
 *  - JSON headers, AbortController timeout, normalized `ApiError`.
 *  - Optional `Authorization: Bearer <token>` via `setAuthTokenProvider` once
 *    real auth exists. This repo never stores or invents tokens.
 *
 * The client is NOT authoritative: FastAPI derives user/tenant/roles from the
 * verified token and authorizes every request (tenant + action + data scope).
 */

export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
export const USE_MOCK_DEFAULT: boolean = String(import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() !== 'false'
export const DEFAULT_TIMEOUT_MS = 8000

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'contract'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly detail?: unknown

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.detail = detail
  }
}

type TokenProvider = () => string | null | Promise<string | null>
let tokenProvider: TokenProvider = () => null

/** Register how to obtain the current access token (e.g. from your auth SDK). Default: none. */
export function setAuthTokenProvider(fn: TokenProvider) {
  tokenProvider = fn
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = await tokenProvider()
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    let res: Response
    try {
      res = await (opts.fetchImpl ?? fetch)(`${API_URL}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) throw new ApiError('timeout', `timed out after ${timeoutMs / 1000}s`)
      throw new ApiError('network', err instanceof Error ? err.message || 'network error' : 'network error')
    }
    let data: unknown = null
    const text = await res.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        if (res.ok) throw new ApiError('parse', 'response was not valid JSON', res.status)
      }
    }
    if (!res.ok) {
      // FastAPI's HTTPException shape: { "detail": ... }
      const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data
      throw new ApiError('http', `HTTP ${res.status}${typeof detail === 'string' ? ` · ${detail}` : ''}`, res.status, detail)
    }
    return data as T
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message || err.name
  return 'unknown error'
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version?: string
  gpu?: string
}

/** GET /health — used by the connection card. */
export async function checkHealth(fetchImpl?: typeof fetch): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = performance.now()
  try {
    const h = await apiRequest<HealthResponse>('/health', { timeoutMs: 3000, fetchImpl })
    return { ok: h?.status === 'ok', detail: `${h?.status ?? 'unknown'}${h?.version ? ` · ${h.version}` : ''}`, ms: Math.round(performance.now() - t0) }
  } catch (err) {
    return { ok: false, detail: describeError(err), ms: Math.round(performance.now() - t0) }
  }
}

/**
 * Endpoint catalogue expected from FastAPI (see INTEGRATION.md for payloads).
 * Only `/health` and `/triage/infer` are called by this UI today; the rest run
 * on local mock state until the backend exists.
 */
export const ENDPOINTS = {
  health: '/health',
  auth: '/auth/session',
  workspaces: '/workspaces',
  invites: '/invites',
  members: '/members',
  roleGrants: '/roles/grants',
  modules: '/modules',
  documentsUpload: '/documents/upload',
  documentsStatus: '/documents/status',
  ragQuery: '/rag/query',
  sources: '/sources',
  pipelines: '/pipelines',
  shipments: '/shipments',
  inventory: '/inventory',
  triageInfer: '/triage/infer',
  securityEvents: '/audit/security-events',
  expiryLots: '/inventory/expiry/lots',
  expiryActions: '/inventory/expiry/actions',
  expiryDecision: '/inventory/expiry/actions/{id}/decision',
  expiryRules: '/inventory/expiry/rules',
  expiryRuns: '/inventory/expiry/runs',
} as const
