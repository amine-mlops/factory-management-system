import { effectivePermissions, type Member, type RoleId } from './access.ts'
import { acceptInvite, demoWorkspace, DEMO_INVITES, normalizeWorkspace, workspaceFromInvite, type InviteCode, type Workspace } from './workspace.ts'

/**
 * LOCAL MOCK of the FastAPI + SQLite backend (companies, memberships,
 * invitation codes). Lives in localStorage so an owner-generated code can be
 * redeemed after signing in as a different user in the same browser.
 * It is demo state only — no real accounts, tokens or security.
 */

const KEY = 'nexus.mockdb.v1'

interface Db {
  workspaces: Record<string, Workspace>
}

function read(): Db {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Db
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return { workspaces: {} }
}

function write(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage unavailable — state stays in memory for this tab */
  }
}

export function saveWorkspace(ws: Workspace) {
  const db = read()
  // Preview state is per-session UX; never persist it as membership data.
  db.workspaces[ws.tenant.tenantId] = { ...ws, previewRoles: null, previewUserId: null }
  write(db)
}

export function loadWorkspace(tenantId: string): Workspace | null {
  const ws = read().workspaces[tenantId]
  return ws ? normalizeWorkspace(ws) : null
}

export interface Membership {
  tenantId: string
  tenantName: string
  roles: RoleId[]
  userId: string
}

/** Companies the user belongs to (one user may hold several memberships). */
export function membershipsFor(email: string): Membership[] {
  const e = email.toLowerCase()
  return Object.values(read().workspaces).flatMap((ws) => {
    const m = ws.members.find((x) => x.email.toLowerCase() === e && x.status === 'active')
    return m ? [{ tenantId: ws.tenant.tenantId, tenantName: ws.tenant.name, roles: m.roles, userId: m.userId }] : []
  })
}

/** Finds an owner-generated code in any stored company, else a built-in demo code. */
export function lookupInvite(input: string): { invite: InviteCode; ws: Workspace | null } | null {
  const raw = input.trim()
  const code = (raw.match(/(?:code=|invite\/)([A-Za-z0-9-]+)/)?.[1] ?? raw).toUpperCase()
  for (const ws of Object.values(read().workspaces)) {
    const inv = ws.invites?.find((i) => i.code === code)
    if (inv) return { invite: inv, ws: normalizeWorkspace(ws) }
  }
  const demo = DEMO_INVITES.find((i) => i.code === code)
  if (!demo) return null
  return { invite: { code: demo.code, tenantId: 'tnt_plant_a_demo', roles: demo.roles, createdBy: demo.invitedBy, createdAt: '', seatUserId: demo.roles.includes('truck_driver') ? 'usr_jlee' : undefined }, ws: null }
}

export function previewPages(ws: Workspace | null, roles: RoleId[]) {
  const tenant = ws?.tenant ?? demoWorkspace('', '').tenant
  return [...effectivePermissions(tenant, { userId: 'usr_preview', name: '', email: '', roles, grants: [], status: 'invited' } as Member).pages]
}

/** Mock of POST /invites/{code}/accept. */
export function joinWithCode(input: string, name: string, email: string): { ws: Workspace; userId: string } | null {
  const found = lookupInvite(input)
  if (!found) return null
  if (found.ws) {
    const { ws, userId } = acceptInvite(found.ws, found.invite, name, email)
    saveWorkspace(ws)
    return { ws: { ...ws, currentUserId: userId }, userId }
  }
  const demo = DEMO_INVITES.find((i) => i.code === found.invite.code)!
  const stored = loadWorkspace('tnt_plant_a_demo')
  if (stored) {
    const { ws, userId } = acceptInvite(stored, found.invite, name, email)
    saveWorkspace(ws)
    return { ws: { ...ws, currentUserId: userId }, userId }
  }
  const ws = workspaceFromInvite(demo, name, email)
  saveWorkspace(ws)
  return { ws, userId: ws.currentUserId }
}

/** Opens (or seeds) the pre-configured demo company for this user as Owner. */
export function openDemoCompany(name: string, email: string): Workspace {
  const existing = loadWorkspace('tnt_plant_a_demo')
  const base = existing ?? demoWorkspace(name, email)
  const me = base.members.find((m) => m.email.toLowerCase() === email.toLowerCase())
  const ws: Workspace = me
    ? { ...base, currentUserId: me.userId }
    : { ...base, members: base.members.map((m) => (m.userId === 'usr_owner' ? { ...m, name, email } : m)), currentUserId: 'usr_owner' }
  saveWorkspace(ws)
  return ws
}

export function openMembership(tenantId: string, email: string): Workspace | null {
  const ws = loadWorkspace(tenantId)
  const me = ws?.members.find((m) => m.email.toLowerCase() === email.toLowerCase())
  return ws && me ? { ...ws, currentUserId: me.userId } : null
}

export function resetMockDb() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
