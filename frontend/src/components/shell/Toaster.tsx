import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { cx, TONE_TEXT } from '../../lib/format.ts'
import type { ToastItem } from '../../lib/toast.ts'

/** Where toasts sit so they never cover the assistant launcher or the docked panel. */
export type ToastPlacement = 'above-launcher' | 'beside-dock' | 'top'

const PLACE: Record<ToastPlacement, CSSProperties> = {
  'above-launcher': { right: 16, bottom: 76 },
  'beside-dock': { right: 'calc(var(--dock-width) + 2 * var(--dock-gap))', bottom: 16 },
  top: { right: 16, top: 'calc(var(--header-h) + 12px)' },
}

export function Toaster({ toasts, onDismiss, placement }: { toasts: ToastItem[]; onDismiss: (id: number) => void; placement: ToastPlacement }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed flex w-[min(400px,calc(100vw-2rem))] flex-col gap-2" style={{ ...PLACE[placement], zIndex: 'var(--z-toast)' }}>
      {toasts.map((t) => {
        const Icon = t.tone === 'warn' || t.tone === 'crit' ? TriangleAlert : t.tone === 'info' ? Info : CircleCheck
        return (
          <div key={t.id} className="shadow-overlay pointer-events-auto flex animate-rise items-start gap-3 rounded-lg border border-line-2 bg-overlay px-4 py-3">
            <Icon className={cx('mt-0.5 size-4 shrink-0', TONE_TEXT[t.tone])} aria-hidden />
            <p className="flex-1 text-sm text-fg-2">{t.message}</p>
            <button type="button" onClick={() => onDismiss(t.id)} className="grid size-6 place-items-center rounded-sm text-muted hover:text-fg" aria-label="Dismiss notification">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
