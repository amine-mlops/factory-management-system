export type Tone = 'nv' | 'warn' | 'crit' | 'info' | 'neutral'

/** Operational health of a module / node. Always rendered as icon + text + color. */
export type Health = 'healthy' | 'warning' | 'critical' | 'soon' | 'disabled'

const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const int = new Intl.NumberFormat('en-US')

export const fmtUsd = (v: number, compact = true) => (compact ? usdCompact : usdFull).format(v)
export const fmtInt = (v: number) => int.format(Math.round(v))
export const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`
export const fmtNum = (v: number, digits = 1) => v.toFixed(digits)

export function fmtClock(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** HH:MM:SS (24 h) for an ISO timestamp. */
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false })

export function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export const TONE_TEXT: Record<Tone, string> = {
  nv: 'text-accent',
  warn: 'text-warn',
  crit: 'text-crit',
  info: 'text-info',
  neutral: 'text-fg-2',
}

export const TONE_BORDER: Record<Tone, string> = {
  nv: 'border-accent/45',
  warn: 'border-warn/50',
  crit: 'border-crit/55',
  info: 'border-info/45',
  neutral: 'border-line-2',
}

export const TONE_BG: Record<Tone, string> = {
  nv: 'bg-accent',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-info',
  neutral: 'bg-muted',
}

/** Semantic color references for SVG fills/strokes (CSS vars resolve in presentation attributes). */
export const TONE_COLOR: Record<Tone, string> = {
  nv: 'var(--color-accent)',
  warn: 'var(--color-warn)',
  crit: 'var(--color-crit)',
  info: 'var(--color-info)',
  neutral: 'var(--color-muted)',
}

export const severityTone = (s: 'low' | 'medium' | 'critical'): Tone => (s === 'critical' ? 'crit' : s === 'medium' ? 'warn' : 'info')

export const healthTone = (score: number): Tone => (score >= 80 ? 'nv' : score >= 60 ? 'warn' : 'crit')

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
