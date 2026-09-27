import type { ModuleId, ViewId } from '../data/nav.ts'

/**
 * Multi-tenant access model — UX ONLY.
 *
 * Everything here decides what the *interface* shows. It is not a security
 * boundary: anyone can edit client state, storage or the JS bundle.
 * The FastAPI backend MUST:
 *   - default-deny;
 *   - derive tenant + user from a verified session/token (never from the
 *     request body, headers or query params supplied by the browser);
 *   - load roles, module grants, actions and data scopes from its own store;
 *   - authorize EVERY API request and EVERY retrieval / query, filtering by
 *     tenant_id and data scope before any record or chunk reaches an LLM.
 * Never trust `tenantId`, roles, grants, scopes or filters sent by the client.
 * See INTEGRATION.md → "Security boundaries".
 */

export type TenantId = `tnt_${string}`
export type UserId = `usr_${string}`

/** What a grant allows on a resource. `configure` (e.g. a data connection) is deliberately separate from `read_records`. */
export type Action = 'view' | 'read_records' | 'update_status' | 'manage' | 'configure' | 'query_ai'
/** Which rows a grant covers: every record in the tenant, or only records assigned to the user. */
export type DataScope = 'tenant' | 'assigned'

export interface Grant {
  resource: ViewId
  actions: Action[]
  scope: DataScope
}

export type RoleId =
  | 'owner'
  | 'admin'
  | 'data_architect'
  | 'procurement_manager'
  | 'inventory_planner'
  | 'truck_driver'
  | 'transportation_manager'
  | 'warehouse_operator'
  | 'manufacturing_engineer'
  | 'distribution_lead'
  | 'customer_service'
  | 'it_security'

export interface RoleDef {
  id: RoleId
  label: string
  description: string
  grants: Grant[]
}

const g = (resource: ViewId, actions: Action[], scope: DataScope = 'tenant'): Grant => ({ resource, actions, scope })
const ALL_ACTIONS: Action[] = ['view', 'read_records', 'update_status', 'manage', 'configure', 'query_ai']
const ALL_RESOURCES: ViewId[] = [
  'dashboard', 'triage', 'manufacturing', 'inventory', 'procurement', 'warehousing', 'distribution', 'transportation', 'crm', 'it',
  'knowledge', 'data', 'team', 'settings',
]

export const ROLES: RoleDef[] = [
  { id: 'owner', label: 'Owner', description: 'Full control, workspace setup and access', grants: ALL_RESOURCES.map((r) => g(r, ALL_ACTIONS)) },
  { id: 'admin', label: 'Admin', description: 'Manage members, modules and settings', grants: ALL_RESOURCES.map((r) => g(r, ALL_ACTIONS)) },
  { id: 'data_architect', label: 'Data Architect', description: 'Configure connections & pipelines — cannot read business records', grants: [g('data', ['view', 'configure', 'query_ai']), g('knowledge', ['view', 'configure']), g('inventory', ['view', 'configure'])] },
  // Procurement sees supplier-return proposals through Procurement itself — not the Inventory module's lots or values.
  { id: 'procurement_manager', label: 'Procurement', description: 'Suppliers, quotations, purchase orders and supplier returns', grants: [g('procurement', ['view', 'read_records', 'manage', 'query_ai']), g('knowledge', ['view'])] },
  { id: 'inventory_planner', label: 'Inventory Planner', description: 'Stock positions and replenishment', grants: [g('dashboard', ['view']), g('inventory', ['view', 'read_records', 'manage', 'query_ai']), g('warehousing', ['view', 'read_records']), g('knowledge', ['view'])] },
  { id: 'truck_driver', label: 'Driver', description: 'Assigned deliveries only; can update their status', grants: [g('transportation', ['view', 'read_records', 'update_status', 'query_ai'], 'assigned')] },
  { id: 'transportation_manager', label: 'Transportation Manager', description: 'Manage all shipments, drivers and carriers', grants: [g('dashboard', ['view']), g('transportation', ['view', 'read_records', 'update_status', 'manage', 'query_ai']), g('knowledge', ['view'])] },
  { id: 'warehouse_operator', label: 'Warehouse Operator', description: 'Docks, picks and stock counts', grants: [g('warehousing', ['view', 'read_records', 'update_status']), g('inventory', ['view', 'read_records', 'query_ai'])] },
  { id: 'manufacturing_engineer', label: 'Manufacturing Engineer', description: 'Lines, machinery health, Autonomous Triage', grants: [g('dashboard', ['view']), g('manufacturing', ['view', 'read_records', 'manage', 'query_ai']), g('triage', ['view', 'manage']), g('knowledge', ['view'])] },
  { id: 'distribution_lead', label: 'Distribution Lead', description: 'DC network, fulfilment, outbound lanes', grants: [g('dashboard', ['view']), g('distribution', ['view', 'read_records', 'manage']), g('transportation', ['view', 'read_records']), g('warehousing', ['view', 'read_records'])] },
  { id: 'customer_service', label: 'Customer Service Agent', description: 'Cases, SLAs and customer accounts', grants: [g('crm', ['view', 'read_records', 'update_status', 'query_ai']), g('knowledge', ['view'])] },
  { id: 'it_security', label: 'IT / Security', description: 'Integrations, platform health, connection config', grants: [g('dashboard', ['view']), g('it', ['view', 'read_records', 'manage']), g('data', ['view', 'configure', 'query_ai'])] },
]

export const roleDef = (id: RoleId): RoleDef => ROLES.find((r) => r.id === id) ?? ROLES[0]

export interface Member {
  userId: UserId
  name: string
  email: string
  roles: RoleId[]
  /** Explicit extra module grants (view + read_records, tenant scope) on top of role defaults. */
  grants: ModuleId[]
  status: 'active' | 'invited'
}

export interface Tenant {
  tenantId: TenantId
  name: string
  industry: string
  size: string
  locations: string[]
  context: string
  enabledModules: ModuleId[]
}

export interface EffectivePermissions {
  tenantId: TenantId
  userId: UserId
  roles: RoleId[]
  /** Pages the user may open (any grant on the resource). */
  pages: Set<ViewId>
  grants: Map<ViewId, { actions: Set<Action>; scope: DataScope }>
  reason: (page: ViewId) => 'ok' | 'module_disabled' | 'not_granted'
}

const MODULE_PAGES = new Set<ViewId>(['manufacturing', 'inventory', 'procurement', 'warehousing', 'distribution', 'transportation', 'crm', 'it'])

/**
 * Effective grants = merge(role grants ∪ explicit grants) ∩ tenant-enabled modules.
 * Actions union; scope widens to `tenant` if any contributing grant is tenant-wide.
 * Autonomous Triage additionally requires Manufacturing to be enabled.
 * Mirrors the rule the backend applies — the backend's result is the one that counts.
 */
export function effectivePermissions(tenant: Tenant, member: Member, rolesOverride?: RoleId[] | null): EffectivePermissions {
  const override = !!rolesOverride?.length
  const roles = override ? rolesOverride! : member.roles
  const extra = override ? [] : member.grants.map((m) => g(m, ['view', 'read_records']))
  const enabled = new Set<ViewId>(tenant.enabledModules)
  const available = (p: ViewId) => (MODULE_PAGES.has(p) ? enabled.has(p) : p === 'triage' ? enabled.has('manufacturing') : true)

  const grants = new Map<ViewId, { actions: Set<Action>; scope: DataScope }>()
  const wanted = new Set<ViewId>()
  for (const gr of [...roles.flatMap((r) => roleDef(r).grants), ...extra]) {
    wanted.add(gr.resource)
    if (!available(gr.resource)) continue
    const cur = grants.get(gr.resource)
    if (!cur) grants.set(gr.resource, { actions: new Set(gr.actions), scope: gr.scope })
    else {
      gr.actions.forEach((a) => cur.actions.add(a))
      if (gr.scope === 'tenant') cur.scope = 'tenant'
    }
  }
  const pages = new Set<ViewId>(grants.keys())
  return {
    tenantId: tenant.tenantId,
    userId: member.userId,
    roles,
    pages,
    grants,
    reason: (p) => (pages.has(p) ? 'ok' : !available(p) ? 'module_disabled' : 'not_granted'),
  }
}

/** Default deny: false unless an effective grant includes the action. */
export const can = (p: EffectivePermissions, resource: ViewId, action: Action) => p.grants.get(resource)?.actions.has(action) ?? false

export const scopeOf = (p: EffectivePermissions, resource: ViewId): DataScope | null => p.grants.get(resource)?.scope ?? null

const LANDING_ORDER: ViewId[] = ['dashboard', 'transportation', 'procurement', 'manufacturing', 'inventory', 'data', 'crm', 'procurement', 'warehousing', 'distribution', 'it', 'knowledge', 'triage', 'team', 'settings']

export function landingPage(perms: EffectivePermissions): ViewId {
  return LANDING_ORDER.find((p) => perms.pages.has(p)) ?? 'dashboard'
}

/** Business modules wired to the FastAPI prototype backend. */
export const INTEGRATED_MODULES: ModuleId[] = ['transportation', 'procurement']
/** Demo-capable modules that run on the local simulation until a backend exists — always labelled "simulated". */
export const SIMULATED_MODULES: ModuleId[] = ['inventory']
/** Modules with a working workspace (integrated or simulated). The other five are "Coming soon". */
export const IMPLEMENTED_MODULES: ModuleId[] = [...INTEGRATED_MODULES, ...SIMULATED_MODULES]

export type ModuleStage = 'integrated' | 'simulated' | 'soon'
export const moduleStage = (m: ModuleId): ModuleStage => (INTEGRATED_MODULES.includes(m) ? 'integrated' : SIMULATED_MODULES.includes(m) ? 'simulated' : 'soon')
export const STAGE_LABEL: Record<ModuleStage, string> = { integrated: 'Integrated · FastAPI prototype', simulated: 'Demo module · simulated', soon: 'Coming soon' }

/** Roles supported by the integrated prototype backend (others are UI previews). */
export const PROTOTYPE_ROLES: RoleId[] = ['owner', 'truck_driver', 'procurement_manager']

export const isOwnerLike = (roles: RoleId[]) => roles.includes('owner') || roles.includes('admin')

export function newTenantId(): TenantId {
  return `tnt_${Math.random().toString(36).slice(2, 10)}`
}

export function newUserId(): UserId {
  return `usr_${Math.random().toString(36).slice(2, 10)}`
}

export const ACTION_LABEL: Record<Action, string> = {
  view: 'View',
  read_records: 'Read records',
  update_status: 'Update status',
  manage: 'Manage',
  configure: 'Configure connection',
  query_ai: 'Ask AI',
}
