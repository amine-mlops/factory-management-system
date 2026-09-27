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

/** sessionStorage key of the FastAPI bearer token (live mode only; mock mode never stores one). */
export const TOKEN_KEY = 'nexus.token'

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

// Live mode: every request carries the token issued by POST /api/auth/login (or demo-login).
setAuthTokenProvider(readToken)

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON-serialisable body, or FormData for multipart uploads. */
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
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const token = await tokenProvider()
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    let res: Response
    try {
      res = await (opts.fetchImpl ?? fetch)(`${API_URL}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
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
  llm?: 'nim' | 'deterministic'
  rag?: 'tfidf' | 'chroma'
  db?: string
}

/** GET /health — used by the connection card. */
export async function checkHealth(fetchImpl?: typeof fetch): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = performance.now()
  try {
    const h = await apiRequest<HealthResponse>('/health', { timeoutMs: 3000, fetchImpl })
    const extra = [h?.version, h?.llm && `LLM ${h.llm}`, h?.rag && `RAG ${h.rag}`].filter(Boolean).join(' · ')
    return { ok: h?.status === 'ok', detail: `${h?.status ?? 'unknown'}${extra ? ` · ${extra}` : ''}`, ms: Math.round(performance.now() - t0) }
  } catch (err) {
    return { ok: false, detail: describeError(err), ms: Math.round(performance.now() - t0) }
  }
}

/**
 * Endpoint catalogue served by FastAPI under VITE_API_URL (e.g. `/api` through the Vite proxy).
 * See MASTER_SPEC.md §7 for payloads. `{param}` placeholders are filled by `endpoint()`.
 * Mock mode (VITE_USE_MOCK=true) calls none of these.
 */
export const ENDPOINTS = {
  health: '/health',
  auth: '/auth/session',
  authLogin: '/auth/login',
  authDemoLogin: '/auth/demo-login',
  authCompany: '/auth/company',
  workspace: '/workspace',
  workspaces: '/workspaces',
  workspaceCurrent: '/workspaces/current',
  invites: '/invites',
  invite: '/invites/{code}',
  inviteAccept: '/invites/{code}/accept',
  members: '/members',
  memberRoles: '/members/{id}/roles',
  accessRequests: '/access-requests',
  roleGrants: '/roles/grants',
  modules: '/modules',
  documentsUpload: '/documents/upload',
  documentsStatus: '/documents/status',
  document: '/documents/{id}',
  ragQuery: '/rag/query',
  chat: '/chat',
  sources: '/sources',
  sourceConnect: '/sources/{id}/connect',
  sourceDisconnect: '/sources/{id}/disconnect',
  pipelines: '/pipelines',
  shipments: '/shipments',
  shipmentStatus: '/shipments/{id}/status',
  shipmentAssignment: '/shipments/{id}/assignment',
  suppliers: '/procurement/suppliers',
  quotations: '/procurement/quotations',
  quotationAward: '/procurement/quotations/{id}/award',
  inventory: '/inventory',
  triageInfer: '/triage/infer',
  securityEvents: '/audit/security-events',
  auditEvents: '/audit/events',
  auditRules: '/audit/rules',
  auditRule: '/audit/rules/{id}',
  auditCompile: '/audit/rules/compile',
  auditRun: '/audit/run',
  auditRuns: '/audit/runs',
  expiryLots: '/inventory/expiry/lots',
  expiryActions: '/inventory/expiry/actions',
  expiryDecision: '/inventory/expiry/actions/{id}/decision',
  expiryRules: '/inventory/expiry/rules',
  expiryRuns: '/inventory/expiry/runs',
  expiryScan: '/inventory/expiry/scan',
} as const

export type EndpointKey = keyof typeof ENDPOINTS

/** Fills `{param}` placeholders (URI-encoded). */
export function endpoint(key: EndpointKey, params: Record<string, string> = {}): string {
  return ENDPOINTS[key].replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
}
