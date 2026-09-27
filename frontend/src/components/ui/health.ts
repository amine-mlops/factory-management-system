import { CircleCheck, CircleDashed, CircleX, Minus, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Health, Tone } from '../../lib/format.ts'

/** Health vocabulary shared by the map, sidebar and badges — always icon + text + colour. */
export const HEALTH_META: Record<Health, { label: string; tone: Tone; icon: LucideIcon }> = {
  healthy: { label: 'Healthy', tone: 'nv', icon: CircleCheck },
  warning: { label: 'Warning', tone: 'warn', icon: TriangleAlert },
  critical: { label: 'Critical', tone: 'crit', icon: CircleX },
  soon: { label: 'Coming soon', tone: 'neutral', icon: CircleDashed },
  disabled: { label: 'Not enabled', tone: 'neutral', icon: Minus },
}
