import { Bell, Building, Check, ChevronDown, CircleX, Database, HardDrive, Info, LogOut, Menu, Search, TriangleAlert, UserCog, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ViewId } from '../../data/nav.ts'
import { landingPage } from '../../lib/access.ts'
import { cx, fmtClock, TONE_TEXT } from '../../lib/format.ts'
import { useOpsModel } from '../../lib/useOps.ts'
import { useNow } from '../../lib/useNow.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import type { Session } from '../../views/Login.tsx'
import type { Persona } from './Shell.tsx'
import { Logo } from '../ui/Logo.tsx'

interface Props {
  session: Session
  onLogout: () => void
  onOpenPalette: () => void
  onToggleNav: () => void
  onNavigate: (v: ViewId, tab?: string) => void
  navOpen: boolean
  useMock: boolean
  tenantName: string
  onSwitchCompany: () => void
  personas: Persona[] | null
  activePersona: string
  onPersona: (p: Persona) => void
}

export function TopBar({ session, onLogout, onOpenPalette, onToggleNav, onNavigate, navOpen, useMock, tenantName, onSwitchCompany, personas, activePersona, onPersona }: Props) {
  const now = useNow()
  const { perms } = useWorkspace()
  return (
    <header className="sticky top-0 flex h-[var(--header-h)] items-center gap-2 border-b border-line bg-canvas px-3 sm:gap-3 sm:px-4" style={{ zIndex: 'var(--z-header)' }}>
      <button
        type="button"
        onClick={onToggleNav}
        className="grid size-10 shrink-0 place-items-center rounded-md border border-line text-fg-2 hover:text-fg lg:hidden"
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
        aria-controls="primary-nav"
      >
        {navOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
      </button>

      <button type="button" onClick={() => onNavigate(landingPage(perms))} className="flex min-w-0 items-center gap-3 rounded-md text-left" aria-label={`NEXUS home · ${tenantName}`}>
        <Logo />
        <span className="hidden min-w-0 sm:block">
          <span className="block font-mono text-sm font-semibold tracking-[0.16em] text-fg">NEXUS</span>
          <span className="block max-w-[220px] truncate text-xs text-muted">{tenantName}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-auto flex h-10 shrink-0 items-center gap-2.5 rounded-md border border-line bg-surface px-3 text-left text-sm text-muted transition-colors hover:border-line-2 hover:text-fg-2 md:ml-4 md:w-[clamp(180px,20vw,320px)]"
        aria-label="Search pages and actions"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate md:block">Search pages and actions…</span>
        <kbd className="hidden rounded-sm border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-muted md:block">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => perms.pages.has('settings') && onNavigate('settings', 'integrations')}
          disabled={!perms.pages.has('settings')}
          className={cx('hidden h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-medium xl:flex', useMock ? 'border-info/40 text-info' : 'border-accent/45 text-accent-2', 'disabled:cursor-default')}
          title={useMock ? 'USE_MOCK on — every screen reads the local mock store' : 'Assistant calls FastAPI; errors fall back to the local simulation'}
          aria-label={useMock ? 'Data mode: demo, local mock data' : 'Data mode: FastAPI with local fallback'}
        >
          {useMock ? <HardDrive className="size-3.5" aria-hidden /> : <Database className="size-3.5" aria-hidden />}
          {useMock ? 'Demo · mock data' : 'FastAPI · live mode'}
        </button>
        <time className="num hidden text-[13px] text-fg-2 2xl:block" dateTime={now.toISOString()} aria-label={`Local time ${fmtClock(now)}`}>
          {fmtClock(now)}
        </time>
        {personas && <PersonaSwitcher personas={personas} active={activePersona} onPick={onPersona} />}
        <AlertsMenu onNavigate={onNavigate} />
        <ProfileMenu session={session} onLogout={onLogout} onSwitchCompany={onSwitchCompany} />
      </div>
    </header>
  )
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

/** Role-projected alerts (the same list the overview shows) — never counts the viewer may not see. */
function AlertsMenu({ onNavigate }: { onNavigate: (v: ViewId, tab?: string) => void }) {
  const model = useOpsModel()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const n = model.alerts.length
  const crit = model.alerts.filter((a) => a.tone === 'crit').length
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="alerts-menu"
        className="relative grid size-10 place-items-center rounded-md border border-line text-fg-2 hover:border-line-2 hover:text-fg"
        aria-label={`Alerts: ${n} open${crit ? `, ${crit} critical` : ''}`}
      >
        <Bell className="size-4" aria-hidden />
        {n > 0 && <span className={cx('num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold', crit ? 'bg-crit text-on-crit' : 'bg-warn text-canvas')}>{n}</span>}
      </button>
      {open && (
        <div id="alerts-menu" className="shadow-overlay absolute right-0 top-12 w-[min(360px,calc(100vw-1.5rem))] animate-rise rounded-lg border border-line-2 bg-overlay p-1.5">
          <p className="eyebrow px-3 pb-1.5 pt-2">Alerts for your role</p>
          {n === 0 ? (
            <p className="px-3 pb-3 text-[13px] text-muted">Nothing needs attention in the modules you can see.</p>
          ) : (
            <ul>
              {model.alerts.map((a) => {
                const Icon = a.tone === 'crit' ? CircleX : a.tone === 'warn' ? TriangleAlert : Info
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        if (a.target) onNavigate(a.target.view, a.target.tab)
                      }}
                      className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-raised"
                    >
                      <Icon className={cx('mt-0.5 size-4 shrink-0', TONE_TEXT[a.tone])} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-fg">{a.title}</span>
                        <span className="block text-xs text-muted">{a.detail}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Owner-only "Preview as" control — instantly switches persona for the demo (UX only). */
function PersonaSwitcher({ personas, active, onPick }: { personas: Persona[]; active: string; onPick: (p: Persona) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const current = personas.find((p) => p.key === active)
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx('flex h-10 items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium', active === 'owner' ? 'border-line text-fg-2 hover:border-line-2' : 'border-info/60 bg-info/10 text-info')}
      >
        <UserCog className="size-4" aria-hidden />
        <span className="hidden md:inline">View as:</span> <span className="max-w-[120px] truncate">{current?.label ?? 'Custom'}</span>
        <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Preview as persona" className="shadow-overlay absolute right-0 top-12 w-72 animate-rise rounded-lg border border-line-2 bg-overlay p-1.5">
          <p className="eyebrow px-3 pb-2 pt-2">Owner only · preview as</p>
          {personas.map((p) => (
            <button
              key={p.key}
              role="menuitemradio"
              aria-checked={p.key === active}
              type="button"
              onClick={() => {
                setOpen(false)
                onPick(p)
              }}
              className={cx('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left', p.key === active ? 'bg-raised' : 'hover:bg-raised')}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{p.label}</span>
                <span className="block truncate text-xs text-muted">{p.sub}</span>
              </span>
              {p.key === active && <Check className="size-4 text-accent" aria-hidden />}
            </button>
          ))}
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Changes what this browser shows. Real authorization happens in FastAPI.</p>
        </div>
      )}
    </div>
  )
}

function ProfileMenu({ session, onLogout, onSwitchCompany }: { session: Session; onLogout: () => void; onSwitchCompany: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 items-center gap-2 rounded-md border border-line pl-1.5 pr-2 hover:border-line-2" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${session.name}`}>
        <span className="grid size-7 place-items-center rounded-sm bg-raised font-mono text-[11px] font-bold text-fg" aria-hidden>
          {session.initials}
        </span>
        <ChevronDown className={cx('size-3.5 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="shadow-overlay absolute right-0 top-12 w-64 animate-rise rounded-lg border border-line-2 bg-overlay p-1.5">
          <div className="border-b border-line px-3 pb-3 pt-2">
            <p className="text-sm font-semibold text-fg">{session.name}</p>
            <p className="wrap-anywhere text-xs text-muted">{session.email}</p>
          </div>
          <button role="menuitem" type="button" onClick={onSwitchCompany} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-fg-2 hover:bg-raised">
            <Building className="size-4 text-muted" aria-hidden /> Switch or join company
          </button>
          <button role="menuitem" type="button" onClick={onLogout} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-fg-2 hover:bg-crit/10 hover:text-fg">
            <LogOut className="size-4 text-muted" aria-hidden /> Sign out
          </button>
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Demo sign-in — authentication is simulated locally.</p>
        </div>
      )}
    </div>
  )
}
