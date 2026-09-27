import { useMemo } from 'react'
import { buildOpsModel, visibleActivity, type OpsModel } from './insights.ts'
import { useWorkspace } from './workspaceContext.ts'

/**
 * Role-projected operations model for the acting user. Recomputed only when the
 * workspace state or the effective grants change, so "Updated" reflects data.
 */
export function useOpsModel(): OpsModel {
  const { ws, perms } = useWorkspace()
  return useMemo(() => buildOpsModel(ws, perms, new Date()), [ws, perms])
}

export function useActivity() {
  const { ws, perms } = useWorkspace()
  return useMemo(() => visibleActivity(ws, perms), [ws, perms])
}
