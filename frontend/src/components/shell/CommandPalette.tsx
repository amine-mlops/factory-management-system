import { CornerDownLeft, Play, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ALL_NAV, type ViewId } from '../../data/nav.ts'
import { cx } from '../../lib/format.ts'
import { PRESETS } from '../../lib/presets.ts'
import type { PresetId } from '../../lib/types.ts'

/** Deep links into tabs (shown only when the page itself is permitted; role-specific tabs fall back to the first tab). */
const TAB_COMMANDS: Array<{ view: ViewId; tab: string; label: string }> = [
  { view: 'dashboard', tab: 'live', label: 'Overview · Live Operations' },
  { view: 'dashboard', tab: 'briefing', label: 'Overview · AI Briefing' },
  { view: 'transportation', tab: 'deliveries', label: 'Transportation · Deliveries' },
  { view: 'transportation', tab: 'exceptions', label: 'Transportation · Exceptions' },
  { view: 'procurement', tab: 'quotations', label: 'Procurement · Quotations' },
  { view: 'procurement', tab: 'ai', label: 'Procurement · AI Comparison' },
  { view: 'inventory', tab: 'lots', label: 'Inventory · At-Risk Lots' },
  { view: 'inventory', tab: 'actions', label: 'Inventory · Agent Actions' },
  { view: 'knowledge', tab: 'ingestion', label: 'Knowledge · Ingestion Status' },
  { view: 'team', tab: 'invitations', label: 'Team & Access · Invitations' },
  { view: 'settings', tab: 'integrations', label: 'Settings · Integrations' },
  { view: 'data', tab: 'pipeline', label: 'Data & Pipelines · Pipeline Health' },
  { view: 'data', tab: 'incidents', label: 'Data & Pipelines · Security Incidents' },
]

interface Props {
  open: boolean
  onClose: () => void
  navigate: (v: ViewId, tab?: string) => void
  openTriage: (preset: PresetId, autoRun?: boolean) => void
  /** Pages the acting persona may open — commands for others are hidden (UX only). */
  allowed: Set<ViewId>
}

interface Cmd {
  id: string
  group: string
  label: string
  hint: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette({ open, onClose, navigate, openTriage, allowed }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const commands = useMemo<Cmd[]>(
    () => [
      ...(allowed.has('triage') ? PRESETS : []).map((p) => ({
        id: `run-${p.id}`,
        group: 'Autonomous triage · preview',
        label: `Run ${p.label} analysis`,
        hint: `${p.assetId} · ${p.tagline}`,
        icon: <Play className="size-4 text-accent" aria-hidden />,
        run: () => openTriage(p.id, true),
      })),
      ...(allowed.has('triage') ? PRESETS : []).map((p) => ({
        id: `asset-${p.assetId}`,
        group: 'Assets',
        label: `Open ${p.assetId} in AI Triage`,
        hint: p.tagline,
        icon: <ShieldCheck className="size-4 text-muted" aria-hidden />,
        run: () => openTriage(p.id),
      })),
      ...ALL_NAV.filter((n) => allowed.has(n.id)).map((n) => {
        const Icon = n.icon
        return { id: `nav-${n.id}`, group: 'Navigate', label: n.label, hint: n.hint, icon: <Icon className="size-4 text-muted" aria-hidden />, run: () => navigate(n.id) }
      }),
      ...TAB_COMMANDS.filter((t) => allowed.has(t.view)).map((t) => {
        const Icon = ALL_NAV.find((n) => n.id === t.view)!.icon
        return { id: `tab-${t.view}-${t.tab}`, group: 'Go to tab', label: t.label, hint: `#/${t.view}/${t.tab}`, icon: <Icon className="size-4 text-muted" aria-hidden />, run: () => navigate(t.view, t.tab) }
      }),
    ],
    [navigate, openTriage, allowed],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => `${c.label} ${c.hint} ${c.group}`.toLowerCase().includes(q))
  }, [commands, query])

  // Mounted fresh on every open; restore focus to the trigger on close.
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      cancelAnimationFrame(raf)
      returnFocus.current?.focus?.()
    }
  }, [])

  if (!open) return null

  const choose = (c: Cmd | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Tab') e.preventDefault()
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 flex items-start justify-center bg-canvas/70 px-4 pt-[12vh] animate-fade" style={{ zIndex: 'var(--z-dialog)' }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="shadow-overlay w-full max-w-[640px] animate-rise overflow-hidden rounded-xl border border-line-2 bg-overlay">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-accent" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Search pages, tabs and actions…"
            className="h-14 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint"
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            aria-label="Command search"
          />
          <kbd className="rounded-sm border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">ESC</kbd>
        </div>
        <div id="cmd-list" role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{query}”.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id} role="presentation">
                {header && <p className="eyebrow px-3 pb-2 pt-3 text-[11px]">{c.group}</p>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerMove={() => setActive(i)}
                  tabIndex={-1}
                  onClick={() => choose(c)}
                  onKeyDown={(e) => e.key === 'Enter' && choose(c)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5', i === active ? 'bg-accent/10 text-fg' : 'text-fg-2')}
                >
                  {c.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.label}</span>
                    <span className="block truncate text-xs text-muted">{c.hint}</span>
                  </span>
                  {i === active && <CornerDownLeft className="size-3.5 text-accent" aria-hidden />}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span className="ml-auto">Try “expiry” or “quotations”</span>
        </div>
      </div>
    </div>
  )
}
