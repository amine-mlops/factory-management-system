import { createContext, useContext } from 'react'
import type { ViewId } from '../data/nav.ts'
import type { EffectivePermissions, Member, UserId } from './access.ts'
import type { Tone } from './format.ts'
import type { SecurityIncident, Workspace } from './workspace.ts'

export interface WorkspaceCtx {
  ws: Workspace
  update: (fn: (w: Workspace) => Workspace) => void
  /** Acting identity (the previewed member when an owner uses "Preview as"). */
  me: Member
  actingUserId: UserId
  /** True when the signed-in user is owner/admin (controls the preview switcher). */
  realOwner: boolean
  perms: EffectivePermissions
  recordIncident: (i: SecurityIncident) => void
  /** Global demo kill switch (VITE_USE_MOCK default): true = local mock data, false = call FastAPI with fallback. */
  useMock: boolean
  setUseMock: (v: boolean) => void
  /** Appends a mock audit event (Team & Access → Audit; role-filtered activity feeds via `resource`). */
  log: (action: string, detail: string, tone?: Tone, resource?: ViewId) => void
}

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null)

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceContext.Provider')
  return ctx
}
