import { ArrowRight, FileStack, Layers, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ViewId } from '../../data/nav.ts'
import { cx } from '../../lib/format.ts'

export type StoryId = 'silos' | 'access' | 'field' | 'solution'

interface StoryDef {
  id: StoryId
  icon: LucideIcon
  kicker: string
  title: string
  body: string
  /** One-line version for in-app strips. */
  short: string
}

/** The product story in four short cards — problem framing only, no invented evidence. */
const STORY: StoryDef[] = [
  {
    id: 'silos',
    icon: FileStack,
    kicker: 'Problem',
    title: 'Information silos',
    body: 'Safety manuals, delivery SOPs, supplier contracts and quotes sit in PDFs, email and paper — finding the current version can take 20–30 minutes.',
    short: 'Manuals, SOPs, contracts and quotes scattered across PDFs, email and paper.',
  },
  {
    id: 'access',
    icon: ShieldCheck,
    kicker: 'Problem',
    title: 'Fragile access',
    body: 'Smaller industrial companies need simple multi-tenant software that never exposes vendor prices or contracts to drivers.',
    short: 'Vendor prices and contracts must never reach the wrong role.',
  },
  {
    id: 'field',
    icon: Smartphone,
    kicker: 'Problem',
    title: 'Field friction',
    body: 'Drivers and procurement staff need short, current briefings — not long manuals.',
    short: 'Drivers and buyers need short, current briefings.',
  },
  {
    id: 'solution',
    icon: Layers,
    kicker: 'Solution',
    title: 'Modular, grounded, role-aware',
    body: 'Enable only the modules you need, invite people with strict roles, upload company PDFs, and ask an assistant grounded only in facts you may see.',
    short: 'Pick modules, invite with strict roles, ask a grounded assistant.',
  },
]

export interface StoryProof {
  /** Live, state-derived evidence shown under the card (omit when the viewer may not see it). */
  text?: ReactNode
  link?: { label: string; view: ViewId; tab?: string }
}

interface Props {
  proofs?: Partial<Record<StoryId, StoryProof>>
  onOpen?: (view: ViewId, tab?: string) => void
  /** Denser variant for narrow side panels (login). */
  compact?: boolean
  /** One-line bodies in a single row — for in-app strips where the page content must stay above the fold. */
  brief?: boolean
  className?: string
  headingLevel?: 2 | 3
}

export function StoryCards({ proofs, onOpen, compact, brief, className, headingLevel = 3 }: Props) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <ul className={cx('grid gap-3', compact ? 'grid-cols-1 sm:grid-cols-2' : brief ? 'grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-4' : 'grid-cols-1 @2xl:grid-cols-2 @6xl:grid-cols-4', className)}>
      {STORY.map((c) => {
        const Icon = c.icon
        const proof = proofs?.[c.id]
        const solution = c.id === 'solution'
        return (
          <li key={c.id} className={cx('flex flex-col rounded-lg border bg-surface', brief ? 'p-3' : 'p-3.5', solution ? 'border-accent/40' : 'border-line')}>
            <div className="flex items-center gap-2">
              <span className={cx('grid size-7 shrink-0 place-items-center rounded-md border', solution ? 'border-accent/40 text-accent-2' : 'border-line-2 text-fg-2')}>
                <Icon className="size-4" aria-hidden />
              </span>
              {brief ? (
                <H className="text-[13px] font-semibold leading-tight text-fg">
                  <span className={cx('eyebrow block', solution && 'text-accent-2')}>{c.kicker}</span>
                  {c.title}
                </H>
              ) : (
                <p className={cx('eyebrow', solution && 'text-accent-2')}>{c.kicker}</p>
              )}
            </div>
            {!brief && <H className="mt-2 text-sm font-semibold text-fg">{c.title}</H>}
            <p className={cx('text-xs leading-relaxed text-muted', brief ? 'mt-1.5' : 'mt-1')}>{brief ? c.short : c.body}</p>
            {(proof?.text || proof?.link) && (
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2.5">
                {proof.text && <p className="text-xs text-fg-2">{proof.text}</p>}
                {proof.link && onOpen && (
                  <button type="button" onClick={() => onOpen(proof.link!.view, proof.link!.tab)} className="flex min-h-8 items-center gap-1 rounded-sm text-xs font-medium text-accent-2 hover:text-fg">
                    {proof.link.label} <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
