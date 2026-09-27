import { useCallback, useMemo } from 'react'
import type { ViewId } from '../data/nav.ts'
import { askAssistant, localAnswer, type AnswerView, type AskOutcome } from './assistant.ts'
import { delay } from './format.ts'
import { authorizeQuery } from './guard.ts'
import { prefersReducedMotion } from './useNow.ts'
import { useWorkspace } from './workspaceContext.ts'

/**
 * Ask hook shared by the dock and in-tab panels. Denials resolve immediately and
 * are written to the shared security incident log; permitted answers show a brief
 * retrieval state so loading is perceivable (skipped under reduced motion).
 */
export function useAsk(context: ViewId) {
  const { ws, perms, actingUserId, me, recordIncident, useMock } = useWorkspace()
  return useCallback(
    async (query: string, contextOverride?: ViewId): Promise<AskOutcome> => {
      const started = performance.now()
      const outcome = await askAssistant(query, { ws, perms, userId: actingUserId, userName: me.name, context: contextOverride ?? context, useMock })
      if (outcome.kind === 'denied') {
        recordIncident(outcome.incident)
        return outcome
      }
      const min = prefersReducedMotion() ? 0 : 480
      const spent = performance.now() - started
      if (spent < min) await delay(min - spent)
      return outcome
    },
    [ws, perms, actingUserId, me.name, recordIncident, useMock, context],
  )
}

/**
 * Synchronous, gate-checked local answer for summary cards (e.g. a cited
 * recommendation on an overview). Returns null when the gate would deny — the
 * card then renders nothing rather than leaking restricted text.
 */
export function useLocalBrief(query: string, context: ViewId): AnswerView | null {
  const { ws, perms, actingUserId, me, useMock } = useWorkspace()
  return useMemo(() => {
    const d = authorizeQuery(query, perms, context)
    if (!d.allowed) return null
    return localAnswer(query, d.resource as ViewId, { ws, perms, userId: actingUserId, userName: me.name, context, useMock })
  }, [query, context, ws, perms, actingUserId, me.name, useMock])
}
