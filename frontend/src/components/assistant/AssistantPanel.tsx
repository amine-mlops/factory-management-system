import { Ban, Send, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ViewId } from '../../data/nav.ts'
import { quickPrompts, type AskOutcome, type QuickPrompt } from '../../lib/assistant.ts'
import { cx } from '../../lib/format.ts'
import { useAsk } from '../../lib/useAsk.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import { Badge, EmptyState } from '../ui/primitives.tsx'
import { LoadingBlock, OutcomeBlock } from './AnswerBlocks.tsx'

interface Props {
  context: ViewId
  title: string
  eyebrow?: string
  /** Runs once on mount so the tab opens with a grounded answer instead of a blank panel. */
  initialQuery?: string
  prompts?: QuickPrompt[]
  className?: string
}

/** In-tab, permission-aware AI panel (single question → cited answer / 403 / error). */
export function AssistantPanel({ context, title, eyebrow = 'Permission-aware RAG · cited', initialQuery, prompts, className }: Props) {
  const { perms, useMock } = useWorkspace()
  const ask = useAsk(context)
  const inputId = useId()
  const [text, setText] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<AskOutcome | null>(null)
  const ran = useRef(false)
  const list = prompts ?? quickPrompts(perms, context)

  const run = useCallback(
    async (q: string, ctx?: ViewId) => {
      const query = q.trim()
      if (!query) return
      setAsked(query)
      setBusy(true)
      setOutcome(null)
      try {
        setOutcome(await ask(query, ctx))
      } finally {
        setBusy(false)
      }
    },
    [ask],
  )

  // Auto-run the default briefing once (guarded by a ref, so later re-renders never re-ask).
  useEffect(() => {
    if (!initialQuery || ran.current) return
    const id = setTimeout(() => {
      ran.current = true
      void run(initialQuery)
    }, 0)
    return () => clearTimeout(id)
  }, [initialQuery, run])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void run(text)
  }

  return (
    <section className={cx('panel flex min-w-0 flex-col', className)} aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-1 text-[15px] font-semibold text-fg">{title}</h2>
        </div>
        <Badge tone={useMock ? 'info' : 'nv'}>{useMock ? 'Local simulation' : 'FastAPI'}</Badge>
      </header>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested questions">
          {list.map((p) => (
            <button
              key={p.query}
              type="button"
              disabled={busy}
              onClick={() => {
                setText(p.query)
                void run(p.query, p.context)
              }}
              className={cx(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                p.negative ? 'border-crit/45 text-crit-2 hover:bg-crit/10' : 'border-line-2 text-fg-2 hover:bg-raised hover:text-fg',
              )}
            >
              {p.negative && <Ban className="size-3.5" aria-hidden />}
              {p.negative && <span className="sr-only">Negative access test:</span>}
              {p.query}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="space-y-1.5">
          <label htmlFor={inputId} className="block text-xs font-medium text-muted">
            Ask a question
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Which approvals does this award need?"
              className="h-10 min-w-0 flex-1 rounded-md border border-field bg-deck px-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent"
            />
            <button type="submit" disabled={busy || !text.trim()} className="flex h-10 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-on-accent hover:bg-accent-2 disabled:bg-accent/40">
              <Send className="size-4" aria-hidden /> Ask
            </button>
          </div>
        </form>
        <div aria-live="polite">
          {busy && <LoadingBlock />}
          {!busy && outcome && <OutcomeBlock outcome={outcome} query={asked ?? undefined} onRetry={asked ? () => void run(asked) : undefined} />}
          {!busy && !outcome && (
            <EmptyState icon={Sparkles} title="Ask about this workspace">
              Answers cite documents and records your role can read. Restricted questions are blocked before retrieval.
            </EmptyState>
          )}
        </div>
      </div>
    </section>
  )
}
