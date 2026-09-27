import { Info } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { cx } from '../../lib/format.ts'

/**
 * Accessible info tooltip: opens on hover, keyboard focus or tap; Esc dismisses;
 * the trigger is described by the tip (not hover-only, WCAG 1.4.13).
 */
export function InfoTip({ label, children, align = 'center', className }: { label: string; children: ReactNode; align?: 'center' | 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <span className={cx('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="grid size-6 place-items-center rounded-sm text-faint hover:text-fg"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cx(
            'shadow-overlay pointer-events-none absolute top-7 z-[60] w-64 animate-fade rounded-md border border-line-2 bg-overlay px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-fg-2',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'start' && 'left-0',
            align === 'end' && 'right-0',
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}
