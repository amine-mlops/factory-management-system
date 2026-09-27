/**
 * Typed request/response contracts for the FastAPI backend (MASTER_SPEC.md §6–§7).
 * Route names live in ONE place (`ENDPOINTS` in api.ts).
 *
 * Resource JSON uses the UI's own camelCase types (re-exported below), so a
 * `GET /api/workspace` snapshot drops straight into the existing reducers.
 * Every response is computed server-side for the caller identified by the
 * bearer token — the client never sends tenant ids or roles as authority.
 */

export type { Member, RoleId, Tenant, Action, DataScope } from './access.ts'
export type { AuditEvent, Connector, GoldDataset, InviteCode, KbDocument, SecurityIncident, Workspace } from './workspace.ts'
export type { Shipment, ShipmentStatus } from '../data/logistics.ts'
export type { Quotation, Supplier } from '../data/procurement.ts'
export type { ExpiryAction, ExpiryFeed, ExpiryRules, ExpiryRun, ExpiryState, Lot } from '../data/expiry.ts'

import type { Action, DataScope, RoleId, Tenant } from './access.ts'
import type { ModuleId, ViewId } from '../data/nav.ts'
import type { Quotation } from '../data/procurement.ts'

/* ---------- auth & company selection */
export interface LoginRequest { email: string; password: string }
export interface LoginResponse { access_token: string; token_type: 'bearer'; expires_in: number; user: { id: string; name: string; email: string } }
export type DemoPersona = 'owner' | 'driver' | 'procurement' | 'data_architect'

export interface MembershipDto { company_id: string; company_name: string; roles: RoleId[] }
/** GET /auth/session → who am I + which companies can I enter. */
export interface SessionResponse { user: { id: string; name: string; email: string }; memberships: MembershipDto[]; current_company_id: string | null }
/** POST /auth/company — switch current company (server re-derives grants). */
export interface SelectCompanyRequest { company_id: string }

/* ---------- workspaces, invites, members, modules */
export interface CreateCompanyRequest { name: string; industry: string; size: string; locations: string[]; context?: string; enabledModules: ModuleId[] }
export interface CreateCompanyResponse extends LoginResponse { tenant: Tenant }
export interface InvitePreview { code: string; companyName: string; roles: RoleId[]; invitedBy: string; pages: ViewId[] }
export interface AcceptInviteResponse { company_id: string; company_name: string; roles: RoleId[]; access_token: string }
export interface ModuleDto { id: ModuleId; label: string; enabled: boolean; implemented: boolean }
export interface GrantDto { resource: ViewId; actions: Action[]; scope: DataScope }
export type ProfilePatch = Partial<Pick<Tenant, 'name' | 'industry' | 'size' | 'locations' | 'context'>>

/* ---------- documents / RAG */
export interface DocumentMeta { category: string; visibility: 'Company' | 'Module' | 'Restricted'; module?: ModuleId | null }
export interface RagQueryRequest { question: string; module: string }

/** `diagnostics` on the canonical answer — the "Diagnostics" disclosure renders it. */
export interface AnswerDiagnostics {
  intent?: 'root_cause' | 'compile_rule' | 'analytics' | 'briefing' | 'docs' | 'metadata' | string
  sql?: string | null
  structured_data?: Array<Record<string, unknown>>
  retrieved_context?: Array<{ source: string; page?: number; snippet: string }>
  root_cause_verdict?: string | null
  trace?: { candidates: number; afterTenant: number; afterPermission: number; afterScope: number }
}

/** Canonical AI answer — `answer` + `sources` are required; the rest is optional metadata. */
export interface RagAnswer {
  answer: string
  sources: Array<{ document: string; page: number }>
  freshness?: Array<{ source: string; as_of: string; stale: boolean }>
  decision?: { status: 'allowed' | 'denied'; stage: 'pre-retrieval' | 'retrieval'; reason?: string; resource?: string; resourceLabel?: string }
  gaps?: string[]
  diagnostics?: AnswerDiagnostics
}

/** HTTP 403 `detail` from /rag/query and every guarded route. */
export interface DeniedDetail {
  decision: 'denied'
  stage: 'pre-retrieval' | 'api' | 'route'
  resource?: string
  resourceLabel?: string
  reason: string
  chunks_retrieved?: 0
  incidentId?: string
}

/* ---------- procurement */
export interface AwardResponse { quotations: Quotation[]; purchaseOrderDraft: string }

/* ---------- autonomous auditing */
export interface RuleCondition { field: string; op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains'; value?: string | number; field_ref?: string; param?: string }
export interface Rule {
  id: string
  label: string
  severity: 'CRITICAL' | 'WARNING' | 'INFO'
  active: boolean
  source: string
  text: string
  table: string
  conditions: RuleCondition[]
  created_by?: string | null
  created_at?: string | null
  version?: number
}
export interface AffectedRecord { batch_id?: string; shipment_id?: string; product_name?: string; current_temp?: number; max_safe_temp?: number; status: 'BREACHED'; [k: string]: unknown }
export interface Violation { rule_id: string; label: string; severity: Rule['severity']; table?: string; affected_records: AffectedRecord[] }
/** POST /audit/run — the AGENTS.md shape. */
export interface AuditRunResponse { status: 'completed'; total_rules_evaluated: number; violations: Violation[]; run_id?: string }
/** GET /audit/runs — latest first; the anomaly banner reads [0]. */
export interface AuditRun { id: string; at: string; trigger: string; status: string; total_rules_evaluated: number; violations: Violation[] }
