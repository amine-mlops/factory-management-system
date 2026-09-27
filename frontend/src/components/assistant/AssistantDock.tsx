import { Ban, Eraser, MessageSquareText, Send, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { navItem, type ViewId } from '../../data/nav.ts'
import { roleDef } from '../../lib/access.ts'
import { historyKey, loadHistory, quickPrompts, saveHistory, type ChatMsg } from '../../lib/assistant.ts'
import { cx } from '../../lib/format.ts'
import { useAsk } from '../../lib/useAsk.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import { Badge } from '../ui/primitives.tsx'
import { BotAvatar, LoadingBlock, OutcomeBlock } from './AnswerBlocks.tsx'

const newId = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: ViewId
  /** true when the dock reserves layout space (wide screens) instead of overlaying. */
  docked: boolean
}

/**
 * Persistent bottom-right assistant. On wide screens it docks as a side column
 * and the page reflows (never covering primary actions); on small screens it
 * opens as a dismissible sheet. History is stored locally per tenant + user +
 * grant set, so a persona switch never shows another role's answers.
 */
export function AssistantDock({ open, onOpenChange, view, docked }: Props) {
  const { ws, perms, me, useMock } = useWorkspace()
  const ask = useAsk(view)
  const key = historyKey(perms, me.userId)
  const [store, setStore] = useState<{ key: string; msgs: ChatMsg[] }>(() => ({ key, msgs: loadHistory(key) }))
  const msgs = store.key === key ? store.msgs : loadHistory(key)
  const [pending, setPending] = useState(false)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputId = useId()
  const prompts = quickPrompts(perms, view)
  const moduleLabel = navItem(view).label

  const setMsgs = useCallback(
    (fn: (m: ChatMsg[]) => ChatMsg[]) =>
      setStore((s) => {
        const base = s.key === key ? s.msgs : loadHistory(key)
        const next = fn(base)
        saveHistory(key, next)
        return { key, msgs: next }
      }),
    [key],
  )

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [msgs.length, pending, open])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Esc closes the panel when focus is inside it (and returns focus to the launcher).
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !panelRef.current?.contains(document.activeElement)) return
      onOpenChange(false)
      requestAnimationFrame(() => launcherRef.current?.focus())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const send = async (q: string, ctx?: ViewId) => {
    const query = q.trim()
    if (!query || pending) return
    setText('')
    setMsgs((m) => [...m, { id: newId(), at: new Date().toISOString(), role: 'user', text: query }])
    setPending(true)
    try {
      const outcome = await ask(query, ctx)
      setMsgs((m) => [...m, { id: newId(), at: new Date().toISOString(), role: 'assistant', outcome }])
    } finally {
      setPending(false)
    }
  }

  const close = () => {
    onOpenChange(false)
    requestAnimationFrame(() => launcherRef.current?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(text)
    }
  }

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => onOpenChange(true)}
          aria-expanded={false}
          aria-controls="assistant-dock"
          className="shadow-overlay fixed bottom-4 right-4 flex h-11 items-center gap-2 rounded-md border border-accent/50 bg-surface pl-2 pr-3.5 text-sm font-semibold text-fg transition-colors hover:border-accent hover:bg-raised"
          style={{ zIndex: 'var(--z-dock)' }}
        >
          <span className="grid size-7 place-items-center rounded-sm bg-accent text-on-accent">
            <MessageSquareText className="size-4" aria-hidden />
          </span>
          Ask NEXUS
        </button>
      )}
      {open && (
        <section
          id="assistant-dock"
          ref={panelRef}
          aria-label="NEXUS assistant"
          className={cx(
            'shadow-overlay fixed flex animate-dock-in flex-col overflow-hidden border border-line-2 bg-surface',
            docked ? 'bottom-4 right-4 top-[calc(var(--header-h)+12px)] w-[var(--dock-width)] rounded-lg' : 'inset-x-2 bottom-2 top-[calc(var(--header-h)+8px)] rounded-lg',
          )}
          style={{ zIndex: 'var(--z-dock)' }}
        >
          <header className="border-b border-line px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <BotAvatar />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-fg">NEXUS assistant</h2>
                <p className="text-xs text-muted">Answers only from sources your role can access</p>
              </div>
              <button type="button" onClick={() => setMsgs(() => [])} disabled={!msgs.length} className="grid size-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg disabled:opacity-40" aria-label="Clear conversation history">
                <Eraser className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={close} className="grid size-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg" aria-label="Close assistant">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Assistant context">
              <li>
                <Badge tone="neutral" className="normal-case tracking-normal">
                  {ws.tenant.name}
                </Badge>
              </li>
              <li>
                <Badge tone="neutral" className="normal-case tracking-normal">
                  {perms.roles.map((r) => roleDef(r).label).join(' + ')}
                </Badge>
              </li>
              <li>
                <Badge tone="neutral" className="normal-case tracking-normal">
                  {moduleLabel}
                </Badge>
              </li>
              <li>
                <Badge tone={useMock ? 'info' : 'nv'}>{useMock ? 'Local simulation' : 'FastAPI'}</Badge>
              </li>
            </ul>
          </header>

          <ol ref={listRef} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            {msgs.length === 0 && !pending && (
              <li className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
                <p className="font-medium text-fg">Ask about {moduleLabel}.</p>
                <p className="mt-1">I cite the documents and records your role can read. Anything outside your grants is blocked before retrieval — try a negative test below.</p>
              </li>
            )}
            {msgs.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="flex justify-end">
                  <p className="wrap-anywhere max-w-[85%] rounded-lg rounded-br-sm bg-raised px-3 py-2 text-[13px] text-fg">{m.text}</p>
                </li>
              ) : (
                <li key={m.id} className="flex gap-2">
                  <BotAvatar className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <OutcomeBlock outcome={m.outcome} compact />
                  </div>
                </li>
              ),
            )}
            {pending && (
              <li className="flex gap-2">
                <BotAvatar className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <LoadingBlock />
                </div>
              </li>
            )}
          </ol>

          <div className="border-t border-line px-3.5 pb-3 pt-2.5">
            <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick prompts">
              {prompts.map((p) => (
                <button
                  key={p.query}
                  type="button"
                  disabled={pending}
                  onClick={() => void send(p.query, p.context)}
                  className={cx(
                    'flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50',
                    p.negative ? 'border-crit/45 text-crit-2 hover:bg-crit/10' : 'border-line-2 text-fg-2 hover:bg-raised hover:text-fg',
                  )}
                >
                  {p.negative && <Ban className="size-3" aria-hidden />}
                  {p.negative && <span className="sr-only">Negative access test:</span>}
                  {p.query}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void send(text)
              }}
            >
              <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-muted">
                Ask about {moduleLabel}
              </label>
              <div className="flex items-end gap-2">
                <textarea
                  id={inputId}
                  ref={inputRef}
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Type a question · Enter to send"
                  className="min-h-[44px] min-w-0 flex-1 resize-none rounded-md border border-field bg-deck px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
                />
                <button type="submit" disabled={pending || !text.trim()} className="grid size-11 shrink-0 place-items-center rounded-md bg-accent text-on-accent hover:bg-accent-2 disabled:bg-accent/40" aria-label="Send question">
                  <Send className="size-4" aria-hidden />
                </button>
              </div>
            </form>
          </div>
        </section>
      )}
    </>
  )
}
