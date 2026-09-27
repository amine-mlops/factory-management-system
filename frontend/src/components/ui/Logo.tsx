import { cx } from '../../lib/format.ts'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('grid size-9 place-items-center rounded-lg border border-accent/50 bg-accent/10', className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-5">
        <path d="M8 24V8l16 16V8" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="square" />
        <circle cx="24" cy="8" r="2" fill="var(--color-accent-2)" />
      </svg>
    </span>
  )
}
