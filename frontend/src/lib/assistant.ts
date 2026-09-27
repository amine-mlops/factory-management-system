import type { ViewId } from '../data/nav.ts'
import { ApiError, apiRequest, describeError, ENDPOINTS } from './api.ts'
import { can, type EffectivePermissions, type UserId } from './access.ts'
import { audienceFor } from './insights.ts'
import { authorizeQuery, incidentFor, type GateDecision } from './guard.ts'
import { answer, buildCorpus, QUESTIONS, retrieve, sourceLabel, toAiAnswerResponse, type AiAnswerResponse, type Answer, type Question } from './rag.ts'
import type { SecurityIncident, Workspace } from './workspace.ts'

/**
 * Assistant engine shared by the docked chatbot and the in-tab AI briefings.
 *
 * Order of operations mirrors the backend contract:
 *   1. pre-retrieval authorization (default deny → HTTP 403 + security event)
 *   2. retrieval filtered by tenant → role/module ACL → data scope
 *   3. composition over permitted chunks only, with citations + freshness
 * Mock mode runs 2–3 locally. Live mode calls FastAPI `POST /rag/query`; on
 * failure the UI shows an error state and a clearly labelled local fallback.
 */

export interface CitationView {
  n: number
  label: string
  kind: 'pdf' | 'record'
  updatedAt: string
  stale: boolean
}

export interface AnswerView {
  questionId: string
  sentences: Array<{ text: string; cites: number[] }>
  citations: CitationView[]
  gaps: string[]
  staleNotice: string | null
  trace: { candidates: number; afterTenant: number; afterPermission: number; afterScope: number }
  response: AiAnswerResponse
}

export type AskOutcome =
  | { kind: 'answer'; view: AnswerView; source: 'local' | 'live'; resourceLabel: string }
  | { kind: 'denied'; decision: GateDecision; incident: SecurityIncident }
  | { kind: 'error'; message: string; fallback: AnswerView; resourceLabel: string }

export interface AskContext {
  ws: Workspace
  perms: EffectivePermissions
  userId: UserId
  userName: string
  context: ViewId
  useMock: boolean
  fetchImpl?: typeof fetch
}

const byId = (view: ViewId, id: string) => (QUESTIONS[view] ?? []).find((q) => q.id === id)

/** Maps free text to one of the composed question types for the resolved resource. */
export function pickQuestion(resource: ViewId, query: string, context: ViewId): Question {
  const t = query.toLowerCase()
  const q = (view: ViewId, id: string): Question => byId(view, id) ?? { id, label: query, topics: [id] }
  switch (resource) {
    case 'transportation':
      return /handling|rule|adr|food|seal|corros/.test(t) ? q('transportation', 'handling') : q('transportation', 'rundown')
    case 'procurement':
      return /return/.test(t) ? q('procurement', 'returns') : /approv|policy|rule|director/.test(t) ? q('procurement', 'policy') : q('procurement', 'compare')
    case 'inventory':
      if (/return/.test(t)) return q('inventory', 'returns')
      if (/reorder|\brop\b|below|spares|stock level/.test(t)) return q('inventory', 'below_rop')
      if (/arriv|inbound/.test(t)) return q('inventory', 'inbound')
      if (/pric/.test(t)) return q('inventory', 'pricing')
      return q('inventory', 'expiry')
    case 'data':
      if (/expir|\blots?\b|scan|shelf/.test(t)) return q('data', 'expiry_feed')
      return /stale|dataset|catalog/.test(t) ? q('data', 'stale_datasets') : /incident|denied|security|evidence|blocked/.test(t) ? q('data', 'incidents') : q('data', 'data_brief')
    case 'manufacturing':
    case 'triage':
      return q('knowledge', 'sop')
    case 'crm':
      return { id: 'crm', label: query, topics: ['crm'] }
    case 'knowledge':
      if (/cavitation|pump|procedure|sop|npsh|vibration/.test(t)) return q('knowledge', 'sop')
      if (/handling|driver|load|adr/.test(t)) return q('knowledge', 'handling')
      if (/approv|policy|award/.test(t)) return q('knowledge', 'policy')
      return { id: 'search', label: query, topics: ['handling', 'policy', 'triage', 'spares_policy'] }
    default:
      if (context === 'data') return pickQuestion('data', query, context)
      return /incident|security|denied/.test(t) ? q('dashboard', 'incidents') : q('dashboard', 'exec_brief')
  }
}

export function toView(a: Answer, q: Question): AnswerView {
  return {
    questionId: q.id,
    sentences: a.sentences,
    citations: a.citations.map((c, i) => ({ n: i + 1, label: sourceLabel(c), kind: c.source.kind, updatedAt: c.updatedAt, stale: c.stale })),
    gaps: a.gaps,
    staleNotice: a.staleNotice,
    trace: { candidates: a.trace.candidates, afterTenant: a.trace.afterTenant, afterPermission: a.trace.afterPermission, afterScope: a.trace.afterScope },
    response: toAiAnswerResponse(a),
  }
}

function fromLive(r: AiAnswerResponse, q: Question): AnswerView {
  return {
    questionId: q.id,
    sentences: [{ text: r.answer, cites: r.sources.map((_, i) => i + 1) }],
    citations: r.sources.map((s, i) => ({ n: i + 1, label: `${s.document}${s.page ? ` · p.${s.page}` : ''}`, kind: s.page ? 'pdf' : 'record', updatedAt: r.freshness?.[i]?.as_of ?? '—', stale: r.freshness?.[i]?.stale ?? false })),
    gaps: [],
    staleNotice: null,
    trace: { candidates: 0, afterTenant: 0, afterPermission: 0, afterScope: r.sources.length },
    response: r,
  }
}

const isRagAnswer = (v: unknown): v is AiAnswerResponse =>
  typeof v === 'object' && v !== null && typeof (v as AiAnswerResponse).answer === 'string' && Array.isArray((v as AiAnswerResponse).sources)

/** Local composition only (used for inline panels and as the live-mode fallback). */
export function localAnswer(query: string, resource: ViewId, ctx: AskContext): AnswerView {
  const q = pickQuestion(resource, query, ctx.context)
  const trace = retrieve(buildCorpus(ctx.ws), ctx.perms, ctx.userId, q.topics)
  return toView(answer(q, trace, { ws: ctx.ws, userId: ctx.userId, perms: ctx.perms }), q)
}

export async function askAssistant(query: string, ctx: AskContext): Promise<AskOutcome> {
  const decision = authorizeQuery(query, ctx.perms, ctx.context)
  if (!decision.allowed) return { kind: 'denied', decision, incident: incidentFor(query, decision, ctx.perms, { userId: ctx.userId, name: ctx.userName }) }
  const resource = decision.resource as ViewId
  const local = localAnswer(query, resource, ctx)
  if (ctx.useMock) return { kind: 'answer', view: local, source: 'local', resourceLabel: decision.resourceLabel }
  try {
    const r = await apiRequest<unknown>(ENDPOINTS.ragQuery, { method: 'POST', body: { question: query, module: resource }, fetchImpl: ctx.fetchImpl })
    if (!isRagAnswer(r)) throw new Error('response did not match { answer, sources }')
    return { kind: 'answer', view: fromLive(r, pickQuestion(resource, query, ctx.context)), source: 'live', resourceLabel: decision.resourceLabel }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      const denied: GateDecision = { ...decision, allowed: false, status: 403, reason: typeof err.detail === 'string' ? err.detail : 'Denied by FastAPI' }
      return { kind: 'denied', decision: denied, incident: incidentFor(query, denied, ctx.perms, { userId: ctx.userId, name: ctx.userName }) }
    }
    return { kind: 'error', message: describeError(err), fallback: local, resourceLabel: decision.resourceLabel }
  }
}

/* ------------------------------------------------------------ prompts */

export interface QuickPrompt {
  query: string
  negative?: boolean
  /** Evaluate in this context instead of the current page (company-wide prompts use the overview). */
  context?: ViewId
}

export const EXPIRY_PROMPT = 'Which lots expire in the next 14 days and what should we do?'

/** Role- and page-aware suggestions; negative tests demonstrate the pre-retrieval 403. */
export function quickPrompts(perms: EffectivePermissions, context: ViewId): QuickPrompt[] {
  const audience = audienceFor(perms)
  if (audience === 'driver') return [{ query: 'Brief my shift' }, { query: 'Handling rules for my loads' }, { query: 'Show executive CRM margins', negative: true }, { query: 'Which lots expire in the next 14 days?', negative: true }]
  if (audience === 'procurement') return [{ query: 'Compare quotations for RFQ-2291' }, { query: 'Which supplier returns are proposed?' }, { query: 'Which approvals does this award need?' }, { query: "Show today's driver routes", negative: true }]
  if (audience === 'technical') return [{ query: 'Why is the TMS refresh failing?' }, { query: 'Why did the expiry scan reject rows?' }, { query: 'Which datasets are stale?' }, { query: 'List shipments for Helix Energy', negative: true }]
  const expiry: QuickPrompt[] = can(perms, 'inventory', 'query_ai') && can(perms, 'inventory', 'read_records') ? [{ query: EXPIRY_PROMPT, context: 'inventory' }] : []
  const knowledge: QuickPrompt[] = [
    ...(perms.pages.has('manufacturing') ? [{ query: 'What is our cavitation response procedure?', context: 'knowledge' as ViewId }] : []),
    ...(can(perms, 'transportation', 'view') ? [{ query: 'Driver load & handling rules', context: 'knowledge' as ViewId }] : []),
    ...(can(perms, 'procurement', 'view') ? [{ query: 'Which approvals does a supplier award need?', context: 'knowledge' as ViewId }] : []),
  ]
  const byContext: Partial<Record<ViewId, QuickPrompt[]>> = {
    transportation: [{ query: 'Give me the dispatch rundown' }],
    procurement: [{ query: 'Compare quotations for RFQ-2291' }],
    inventory: [...expiry, ...(can(perms, 'procurement', 'query_ai') ? [{ query: 'Which supplier returns are proposed?' }] : [])],
    knowledge: knowledge.slice(0, 2),
    data: [{ query: 'Why is the TMS refresh failing?' }, { query: 'Why did the expiry scan reject rows?' }],
  }
  const general: QuickPrompt[] = perms.pages.has('dashboard')
    ? [{ query: 'What needs my attention today?', context: 'dashboard' }, ...(context === 'inventory' ? [] : expiry), { query: 'Summarize security incidents', context: 'dashboard' }]
    : []
  const own = byContext[context] ?? []
  const merged = [...own, ...general.filter((g) => !own.some((o) => o.query === g.query))].slice(0, 3)
  return [...merged, { query: 'List Borealis Foods deliveries', negative: true }]
}

/* ------------------------------------------------------------ history */

export type ChatMsg = { id: string; at: string } & ({ role: 'user'; text: string } | { role: 'assistant'; outcome: AskOutcome })

/** Permission-scoped cache key: history is never shared across tenants, users or grant sets. */
export function historyKey(perms: EffectivePermissions, userId: UserId) {
  const grants = [...perms.grants.entries()]
    .map(([r, g]) => `${r}:${[...g.actions].sort().join('.')}:${g.scope}`)
    .sort()
    .join('|')
  let h = 5381
  for (let i = 0; i < grants.length; i++) h = ((h << 5) + h + grants.charCodeAt(i)) >>> 0
  return `nexus.chat.v1.${perms.tenantId}.${userId}.${h.toString(36)}`
}

export function loadHistory(key: string): ChatMsg[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ChatMsg[]) : []
  } catch {
    return []
  }
}

export function saveHistory(key: string, msgs: ChatMsg[]) {
  try {
    localStorage.setItem(key, JSON.stringify(msgs.slice(-40)))
  } catch {
    /* storage unavailable — history stays in memory */
  }
}
