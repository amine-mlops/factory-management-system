import { ApiError, apiRequest, endpoint, TOKEN_KEY, USE_MOCK_DEFAULT } from './api.ts'
import type {
  AcceptInviteResponse,
  AuditRun,
  AuditRunResponse,
  AwardResponse,
  CreateCompanyRequest,
  CreateCompanyResponse,
  DemoPersona,
  DocumentMeta,
  InvitePreview,
  LoginResponse,
  ProfilePatch,
  Rule,
  SessionResponse,
} from './apiContract.ts'
import type { RoleId } from './access.ts'
import type { ExpiryAction, ExpiryRules } from '../data/expiry.ts'
import type { ShipmentStatus } from '../data/logistics.ts'
import type { ModuleId, ViewId } from '../data/nav.ts'
import type { KbDocument, SecurityIncident, Workspace } from './workspace.ts'

/**
 * Live-mode client (VITE_USE_MOCK=false): every call goes to FastAPI, and
 * every mutation resolves to a FRESH snapshot (`GET /api/workspace`) so the
 * UI's existing reducers stay untouched — the server is the source of truth.
 * Audit-rule calls return their own payloads (rules are not part of the Workspace).
 */

const PERSONA_KEY = 'nexus.persona'
const DEMO_KEY = 'nexus.demo'
export const DEMO_OWNER_EMAIL = 'operator@nexus-demo.io'

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* storage unavailable — the token then lives only for this request chain */
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const setToken = (t: string | null) => store(TOKEN_KEY, t)

export const hasToken = () => !!read(TOKEN_KEY)

/** Demo personas ("View as") are available when the session started as the demo owner. */
export const canSwitchPersona = () => read(DEMO_KEY) === '1'
export const currentPersona = (): DemoPersona => (read(PERSONA_KEY) as DemoPersona | null) ?? 'owner'

/* ---------------------------------------------------------------- auth */

export async function login(email: string, password: string): Promise<LoginResponse> {
  const r = await apiRequest<LoginResponse>(endpoint('authLogin'), { method: 'POST', body: { email, password } })
  setToken(r.access_token)
  const demo = r.user.email.toLowerCase() === DEMO_OWNER_EMAIL
  store(DEMO_KEY, demo ? '1' : null)
  store(PERSONA_KEY, demo ? 'owner' : null)
  return r
}

export async function demoLogin(persona: DemoPersona): Promise<LoginResponse> {
  const r = await apiRequest<LoginResponse>(endpoint('authDemoLogin'), { method: 'POST', body: { persona } })
  setToken(r.access_token)
  store(DEMO_KEY, '1')
  store(PERSONA_KEY, persona)
  return r
}

export function logout() {
  setToken(null)
  store(DEMO_KEY, null)
  store(PERSONA_KEY, null)
}

export const session = () => apiRequest<SessionResponse>(endpoint('auth'))

export async function selectCompany(companyId: string): Promise<LoginResponse> {
  const r = await apiRequest<LoginResponse>(endpoint('authCompany'), { method: 'POST', body: { company_id: companyId } })
  setToken(r.access_token)
  return r
}

/** RBAC-projected workspace for the caller. Preview fields are UX-only and always start empty. */
export async function snapshot(): Promise<Workspace> {
  const ws = await apiRequest<Workspace>(endpoint('workspace'))
  return { ...ws, stock: ws.stock ?? [], previewRoles: null, previewUserId: null }
}

/* ---------------------------------------------------------------- company, members, invites */

export async function createCompany(draft: CreateCompanyRequest): Promise<Workspace> {
  const r = await apiRequest<CreateCompanyResponse>(endpoint('workspaces'), { method: 'POST', body: draft })
  setToken(r.access_token)
  return snapshot()
}

export async function updateProfile(patch: ProfilePatch): Promise<Workspace> {
  await apiRequest(endpoint('workspaceCurrent'), { method: 'PATCH', body: patch })
  return snapshot()
}

export async function setModules(ids: ModuleId[]): Promise<Workspace> {
  await apiRequest(endpoint('modules'), { method: 'PUT', body: { enabledModules: ids } })
  return snapshot()
}

export async function createInvite(roles: RoleId[]): Promise<Workspace> {
  await apiRequest(endpoint('invites'), { method: 'POST', body: { roles } })
  return snapshot()
}

export const previewInvite = (code: string) => apiRequest<InvitePreview>(endpoint('invite', { code: normalizeCode(code) }))

export async function acceptInvite(code: string): Promise<Workspace> {
  const r = await apiRequest<AcceptInviteResponse>(endpoint('inviteAccept', { code: normalizeCode(code) }), { method: 'POST', body: {} })
  setToken(r.access_token)
  return snapshot()
}

/** Accepts a bare code or a pasted invite link (…/join?code=XYZ or …/invite/XYZ). */
export function normalizeCode(input: string) {
  const raw = input.trim()
  return (raw.match(/(?:code=|invite\/)([A-Za-z0-9-]+)/)?.[1] ?? raw).toUpperCase()
}

export async function setMemberRoles(userId: string, roles: RoleId[]): Promise<Workspace> {
  await apiRequest(endpoint('memberRoles', { id: userId }), { method: 'PUT', body: { roles } })
  return snapshot()
}

export async function requestAccess(resource: ViewId): Promise<Workspace> {
  await apiRequest(endpoint('accessRequests'), { method: 'POST', body: { resource } })
  return snapshot()
}

/* ---------------------------------------------------------------- documents */

/** Files picked in the setup wizard, kept until the company exists (the draft only holds metadata). */
const pendingFiles = new Map<string, File>()
export const stashFile = (docId: string, file: File) => pendingFiles.set(docId, file)
export const stashedFile = (docId: string) => pendingFiles.get(docId)

export async function uploadDocument(file: File, meta: DocumentMeta, refresh = true): Promise<Workspace | null> {
  const form = new FormData()
  form.append('file', file)
  form.append('category', meta.category)
  form.append('visibility', meta.visibility)
  if (meta.visibility === 'Module' && meta.module) form.append('module', meta.module)
  await apiRequest(endpoint('documentsUpload'), { method: 'POST', body: form, timeoutMs: 30_000 })
  return refresh ? snapshot() : null
}

export async function patchDocument(id: string, patch: Partial<Pick<KbDocument, 'category' | 'visibility' | 'module'>>): Promise<Workspace> {
  await apiRequest(endpoint('document', { id }), { method: 'PATCH', body: patch })
  return snapshot()
}

export async function deleteDocument(id: string): Promise<Workspace> {
  await apiRequest(endpoint('document', { id }), { method: 'DELETE' })
  return snapshot()
}

/* ---------------------------------------------------------------- operations */

export async function setShipmentStatus(id: string, status: ShipmentStatus): Promise<Workspace> {
  await apiRequest(endpoint('shipmentStatus', { id }), { method: 'PATCH', body: { status } })
  return snapshot()
}

export async function assignShipment(id: string, driverId: string | null): Promise<Workspace> {
  await apiRequest(endpoint('shipmentAssignment', { id }), { method: 'PATCH', body: { driverId } })
  return snapshot()
}

export async function awardQuotation(id: string): Promise<Workspace> {
  await apiRequest<AwardResponse>(endpoint('quotationAward', { id }), { method: 'POST', body: {} })
  return snapshot()
}

export async function decideExpiryAction(id: string, decision: ExpiryAction['status']): Promise<Workspace> {
  await apiRequest(endpoint('expiryDecision', { id }), { method: 'POST', body: { decision } })
  return snapshot()
}

export async function updateExpiryRules(patch: Partial<Pick<ExpiryRules, 'criticalDays' | 'warningDays' | 'scanMinutes' | 'markdownMaxPct' | 'minConfidence'>>): Promise<Workspace> {
  await apiRequest(endpoint('expiryRules'), { method: 'PUT', body: patch })
  return snapshot()
}

export async function runExpiryScan(): Promise<Workspace> {
  await apiRequest(endpoint('expiryScan'), { method: 'POST', body: {} })
  return snapshot()
}

export async function connectSource(id: string, connected: boolean): Promise<Workspace> {
  await apiRequest(endpoint(connected ? 'sourceConnect' : 'sourceDisconnect', { id }), { method: 'POST', body: {} })
  return snapshot()
}

/* ---------------------------------------------------------------- autonomous auditing */

export const listRules = () => apiRequest<Rule[]>(endpoint('auditRules'))
export const compileRule = (text: string) => apiRequest<Rule>(endpoint('auditCompile'), { method: 'POST', body: { text } })
export const setRuleActive = (id: string, active: boolean) => apiRequest<Rule>(endpoint('auditRule', { id }), { method: 'PATCH', body: { active } })
export const runAudit = () => apiRequest<AuditRunResponse>(endpoint('auditRun'), { method: 'POST', body: {} })

export async function latestAuditRun(): Promise<AuditRun | null> {
  const runs = await apiRequest<AuditRun[]>(`${endpoint('auditRuns')}?limit=1`)
  return runs[0] ?? null
}

/* ---------------------------------------------------------------- security */

/** Route-guard incident; the server re-checks access and answers 409 when the caller is actually allowed. */
export async function logRouteDenial(resource: ViewId, query: string): Promise<SecurityIncident | null> {
  try {
    return await apiRequest<SecurityIncident>(endpoint('securityEvents'), { method: 'POST', body: { requestedResource: resource, query } })
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return null
    throw err
  }
}

const api = {
  login, demoLogin, logout, session, selectCompany, snapshot, hasToken, canSwitchPersona, currentPersona,
  createCompany, updateProfile, setModules, createInvite, previewInvite, acceptInvite, normalizeCode, setMemberRoles, requestAccess,
  stashFile, stashedFile, uploadDocument, patchDocument, deleteDocument,
  setShipmentStatus, assignShipment, awardQuotation, decideExpiryAction, updateExpiryRules, runExpiryScan, connectSource,
  listRules, compileRule, setRuleActive, runAudit, latestAuditRun, logRouteDenial,
}

export type LiveApi = typeof api

/** Non-null only when the build targets FastAPI (VITE_USE_MOCK=false). Mock mode never touches the network. */
export const live: LiveApi | null = USE_MOCK_DEFAULT ? null : api
