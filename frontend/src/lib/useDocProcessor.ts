import { useEffect } from 'react'
import { prefersReducedMotion } from './useNow.ts'
import { advanceDocs, type KbDocument } from './workspace.ts'

/** Drives the local, simulated queued → parsing → indexed lifecycle. No file leaves the browser. */
export function useDocProcessor(docs: KbDocument[], setDocs: (fn: (d: KbDocument[]) => KbDocument[]) => void) {
  const pending = docs.some((d) => d.status !== 'indexed')
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setDocs(advanceDocs), prefersReducedMotion() ? 120 : 520)
    return () => clearInterval(id)
  }, [pending, setDocs])
}
