import type { ReactNode } from 'react'
import { cx } from '../../lib/format.ts'

/** Consistent workspace header: eyebrow · h1 · one-line context · right-aligned status/actions. */
export function PageHeader({ eyebrow, title, subtitle, right, className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  )
}

/** Standard page frame: width, gutters and vertical rhythm shared by every workspace. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  // A size container: grids inside respond to the space actually available (e.g. when the assistant is docked), not the viewport.
  return <div className={cx('@container mx-auto w-full space-y-4 px-4 pb-28 pt-5 sm:px-6', wide ? 'max-w-[1760px]' : 'max-w-[1600px]', className)}>{children}</div>
}
