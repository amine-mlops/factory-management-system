import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx, TONE_BG, TONE_COLOR, TONE_TEXT, type Health, type Tone } from '../../lib/format.ts'
import { HEALTH_META } from './health.ts'

export function Eyebrow({ children, className, as: Tag = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'span' | 'h3' }) {
  return <Tag className={cx('eyebrow', className)}>{children}</Tag>
}

interface PanelProps {
  title?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'section' | 'div' | 'article'
  /** Heading level for the title (keeps a sequential h1 → h2 → h3 outline). */
  level?: 2 | 3
  id?: string
}

/** 1px-bordered flat surface with a compact header (Swiss style: hierarchy from type + spacing, not glow). */
export function Panel({ title, eyebrow, actions, children, className, bodyClassName, as: Tag = 'section', level = 2, id }: PanelProps) {
  const H = level === 2 ? 'h2' : 'h3'
  const titleId = id ? `${id}-title` : undefined
  return (
    <Tag className={cx('panel flex min-w-0 flex-col', className)} aria-labelledby={title ? titleId : undefined} id={id}>
      {(title || eyebrow || actions) && (
        <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
            {title && (
              <H id={titleId} className="text-[15px] font-semibold leading-snug text-fg">
                {title}
              </H>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('min-w-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </Tag>
  )
}

export function StatusDot({ tone = 'nv', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx('inline-block size-2 shrink-0 rounded-full', TONE_BG[tone], pulse && 'ping', pulse && TONE_TEXT[tone], className)} />
}

const BADGE_TONE: Record<Tone, string> = {
  nv: 'border-accent/40 bg-accent/10 text-accent-2',
  warn: 'border-warn-line bg-warn-bg text-warn',
  crit: 'border-crit-line bg-crit-bg text-crit-2',
  info: 'border-info/40 bg-info/10 text-info',
  neutral: 'border-line-2 bg-raised text-fg-2',
}

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-[3px] font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.06em]',
        BADGE_TONE[tone],
        className,
      )}
    >
      {dot && <StatusDot tone={tone} pulse={tone !== 'neutral'} className="size-1.5" />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ health */


/** Status is always icon + text + color (never color alone). */
export function HealthBadge({ health, className, label }: { health: Health; className?: string; label?: string }) {
  const m = HEALTH_META[health]
  const Icon = m.icon
  return (
    <Badge tone={m.tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {label ?? m.label}
    </Badge>
  )
}

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent font-bold hover:bg-accent-2 hover:-translate-y-px disabled:translate-y-0 disabled:bg-accent/40',
  secondary: 'border border-control text-fg hover:bg-raised disabled:opacity-50',
  ghost: 'text-muted hover:bg-raised hover:text-fg disabled:opacity-50',
  danger: 'border border-crit-line bg-crit-bg text-crit-2 hover:border-crit disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  iconRight?: LucideIcon
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm transition-[background-color,border-color,color,transform] duration-150',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant !== 'primary' && 'font-medium',
        BTN_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {children}
      {IconRight && <IconRight className="size-4 shrink-0" aria-hidden />}
    </button>
  )
}

/* ------------------------------------------------------------------ data display */

/** Thin horizontal meter. `value` in 0–1. */
export function Meter({ value, tone = 'nv', className, label }: { value: number; tone?: Tone; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-line-2', className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', TONE_BG[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Minimal inline sparkline (decorative — values are always shown as text nearby). */
export function Sparkline({ values, tone = 'nv', className, height = 28, fill = true }: { values: number[]; tone?: Tone; className?: string; height?: number; fill?: boolean }) {
  const w = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 2 - ((v - min) / span) * (height - 4)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const color = TONE_COLOR[tone]
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }} aria-hidden="true">
      {fill && <path d={`${line} L${w},${height} L0,${height} Z`} fill={color} opacity={0.1} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface KpiProps {
  label: string
  value: ReactNode
  unit?: string
  delta?: ReactNode
  deltaTone?: Tone
  tone?: Tone
  icon?: ReactNode
  spark?: number[]
  footnote?: ReactNode
  className?: string
  onClick?: () => void
  actionLabel?: string
}

export function KpiCard({ label, value, unit, delta, deltaTone = 'nv', tone = 'neutral', icon, spark, footnote, className, onClick, actionLabel }: KpiProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow className="min-w-0">{label}</Eyebrow>
        {icon && <span className={cx('shrink-0', TONE_TEXT[tone])}>{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cx('num text-[28px] font-semibold leading-none', tone === 'neutral' ? 'text-fg' : TONE_TEXT[tone])}>{value}</span>
        {unit && <span className="num text-sm text-muted">{unit}</span>}
      </div>
      {spark && <Sparkline values={spark} tone={tone === 'neutral' ? 'info' : tone} height={24} />}
      {(delta || footnote) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
          {delta && <span className={cx('font-medium', TONE_TEXT[deltaTone])}>{delta}</span>}
          {footnote && <span className="text-muted">{footnote}</span>}
        </div>
      )}
    </>
  )
  const cls = cx('panel flex min-w-0 flex-col gap-2.5 p-4 text-left', className)
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-label={actionLabel} className={cx(cls, 'transition-colors hover:border-line-2 hover:bg-raised')}>
        {body}
      </button>
    )
  return <div className={cls}>{body}</div>
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-lg border border-line-2 bg-raised text-muted">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children && <p className="max-w-sm text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Switch({ checked, onChange, label, description, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} id={`${id}-label`} className="block text-[13px] font-medium text-fg">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50', checked ? 'border-accent/60 bg-accent/25' : 'border-field bg-deck')}
      >
        <span className={cx('inline-block size-4 rounded-full transition-transform duration-200', checked ? 'translate-x-[22px] bg-accent' : 'translate-x-[3px] bg-muted')} />
      </button>
    </div>
  )
}

/** Circular health gauge (0–100). */
export function HealthRing({ score, tone, size = 92, label = 'Health' }: { score: number; tone: Tone; size?: number; label?: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label} score ${score} of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line-2)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth="6" strokeDasharray={`${dash} ${c}`} className="transition-[stroke-dasharray] duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cx('num text-[22px] font-semibold leading-none', TONE_TEXT[tone])}>{score}</span>
        <span className="eyebrow mt-1">{label}</span>
      </div>
    </div>
  )
}

/** Key/value list used in drawers and detail cards. */
export function KeyValues({ items, className, cols = 2 }: { items: Array<[string, ReactNode]>; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-4 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="wrap-anywhere mt-0.5 text-[13px] text-fg-2">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
