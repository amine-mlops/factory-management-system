import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/format.ts'

export interface TabDef<T extends string = string> {
  id: T
  label: string
  icon?: LucideIcon
  /** Short visible count/marker. */
  badge?: ReactNode
  /** Full contextual phrase for screen readers, e.g. "3 open exceptions". */
  badgeLabel?: string
  badgeTone?: 'crit' | 'warn' | 'info' | 'neutral'
}

const BADGE: Record<NonNullable<TabDef['badgeTone']>, string> = {
  crit: 'bg-crit/15 text-crit-2 border-crit/40',
  warn: 'bg-warn/12 text-warn border-warn/40',
  info: 'bg-info/10 text-info border-info/35',
  neutral: 'bg-raised text-fg-2 border-line-2',
}

interface TabsProps<T extends string> {
  tabs: Array<TabDef<T>>
  active: T
  onChange: (id: T) => void
  label: string
  idBase: string
  className?: string
}

/**
 * WAI-ARIA Tabs pattern: roving tabindex, ←/→ + Home/End move focus and
 * activate (automatic activation — panels render instantly), visible focus ring.
 */
export function Tabs<T extends string>({ tabs, active, onChange, label, idBase, className }: TabsProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (e: KeyboardEvent, idx: number) => {
    const n = tabs.length
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % n
    else if (e.key === 'ArrowLeft') next = (idx - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next < 0) return
    e.preventDefault()
    const t = tabs[next]
    onChange(t.id)
    refs.current[t.id]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}>
      {tabs.map((t, i) => {
        const selected = t.id === active
        const Icon = t.icon
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            role="tab"
            type="button"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'relative -mb-px flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition-colors duration-150',
              selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:border-line-2 hover:text-fg',
            )}
          >
            {Icon && <Icon className={cx('size-4', selected ? 'text-accent' : 'text-faint')} aria-hidden />}
            {t.label}
            {t.badge !== undefined && t.badge !== null && t.badge !== 0 && (
              <span className={cx('num rounded-sm border px-1.5 text-[11px] font-semibold leading-4', BADGE[t.badgeTone ?? 'neutral'])} aria-label={t.badgeLabel}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ idBase, id, children, className }: { idBase: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={cx('animate-fade rounded-lg', className)}>
      {children}
    </div>
  )
}
