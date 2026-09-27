import { Cpu, Database, HardDrive } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { MODULE_NAV, PRIMARY_NAV, WORKSPACE_NAV, type NavItem, type ViewId } from '../../data/nav.ts'
import { moduleStage, roleDef } from '../../lib/access.ts'
import { cx } from '../../lib/format.ts'
import { useOpsModel } from '../../lib/useOps.ts'
import { useMediaQuery } from '../../lib/useNow.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import { HEALTH_META } from '../ui/health.ts'
import { StatusDot } from '../ui/primitives.tsx'

interface Props {
  view: ViewId
  onNavigate: (v: ViewId) => void
  open: boolean
  onClose: () => void
}

const STAGE_ORDER = { integrated: 0, simulated: 1, soon: 2 } as const

/** Role-filtered navigation (UX only — FastAPI re-checks every request). Health comes from the role-projected ops model. */
export function Sidebar({ view, onNavigate, open, onClose }: Props) {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { perms, me, ws, useMock } = useWorkspace()
  const model = useOpsModel()
  const primary = PRIMARY_NAV.filter((n) => perms.pages.has(n.id))
  const modules = MODULE_NAV.filter((n) => perms.pages.has(n.id)).sort((a, b) => STAGE_ORDER[moduleStage(a.id)] - STAGE_ORDER[moduleStage(b.id)])
  const workspace = WORKSPACE_NAV.filter((n) => perms.pages.has(n.id))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div className={cx('fixed inset-0 top-[var(--header-h)] bg-canvas/70 transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} style={{ zIndex: 'var(--z-sidebar)' }} onClick={onClose} aria-hidden />
      <nav
        id="primary-nav"
        aria-label="Primary"
        inert={!desktop && !open}
        className={cx(
          'fixed bottom-0 left-0 top-[var(--header-h)] flex w-[256px] flex-col border-r border-line bg-deck transition-transform duration-200',
          'lg:sticky lg:h-[calc(100dvh-var(--header-h))] lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ zIndex: 'var(--z-sidebar)' }}
      >
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-4 rounded-md border border-line bg-surface px-3 py-2">
            <p className="truncate text-[13px] font-medium text-fg">{me.name}</p>
            <p className="truncate text-xs text-muted">{perms.roles.map((r) => roleDef(r).label).join(' + ') || 'No role'}</p>
          </div>
          {primary.length > 0 && (
            <ul className="space-y-0.5">
              {primary.map((item) => (
                <li key={item.id}>
                  <NavButton item={item} active={view === item.id} onClick={() => onNavigate(item.id)}>
                    {item.id === 'triage' && <Tag>Preview</Tag>}
                    {item.id === 'dashboard' && model.hub.attention > 0 && <HealthDot health={model.hub.health} />}
                  </NavButton>
                </li>
              ))}
            </ul>
          )}
          {modules.length > 0 && <p className="eyebrow px-2.5 pb-2 pt-5">Modules</p>}
          <ul className="space-y-0.5">
            {modules.map((item) => {
              const stage = moduleStage(item.id)
              const m = model.modules.find((x) => x.id === item.id)
              return (
                <li key={item.id}>
                  <NavButton item={item} active={view === item.id} onClick={() => onNavigate(item.id)}>
                    {stage === 'soon' ? <Tag>Soon</Tag> : stage === 'simulated' ? <Tag>Demo</Tag> : null}
                    {stage !== 'soon' && m && (m.business || m.tech) && <HealthDot health={m.health} />}
                  </NavButton>
                </li>
              )
            })}
          </ul>
          {workspace.length > 0 && <p className="eyebrow px-2.5 pb-2 pt-5">Workspace</p>}
          <ul className="space-y-0.5">
            {workspace.map((item) => (
              <li key={item.id}>
                <NavButton item={item} active={view === item.id} onClick={() => onNavigate(item.id)}>
                  {item.id === 'data' && ws.incidents.length > 0 && (
                    <span className="num rounded-sm border border-crit-line bg-crit-bg px-1.5 text-[11px] font-semibold text-crit-2">
                      {ws.incidents.length}
                      <span className="sr-only"> security incidents</span>
                    </span>
                  )}
                </NavButton>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line p-3">
          <div className="rounded-lg border border-line bg-surface p-3 text-xs">
            <p className="eyebrow mb-2">Environment</p>
            <p className="flex items-center gap-2 text-fg-2">
              {useMock ? <HardDrive className="size-3.5 text-info" aria-hidden /> : <Database className="size-3.5 text-accent" aria-hidden />}
              {useMock ? 'Demo · local mock store' : 'FastAPI + local fallback'}
            </p>
            <p className="mt-1.5 flex items-center gap-2 text-muted">
              <Cpu className="size-3.5" aria-hidden /> NVIDIA NIM · architecture target
            </p>
          </div>
        </div>
      </nav>
    </>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-sm border border-line-2 px-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{children}</span>
}

function HealthDot({ health }: { health: keyof typeof HEALTH_META }) {
  const meta = HEALTH_META[health]
  if (health === 'soon' || health === 'disabled') return null
  return (
    <>
      <StatusDot tone={meta.tone} className={health === 'critical' ? 'animate-pulse-dot' : undefined} />
      <span className="sr-only">, status {meta.label}</span>
    </>
  )
}

function NavButton({ item, active, onClick, children }: { item: NavItem; active: boolean; onClick: () => void; children?: ReactNode }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={item.hint}
      className={cx('group relative flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors', active ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-raised/70 hover:text-fg')}
    >
      <span className={cx('absolute inset-y-2 left-0 w-0.5 rounded-full', active ? 'bg-accent' : 'bg-transparent')} aria-hidden />
      <Icon className={cx('size-[18px] shrink-0', active ? 'text-accent' : 'text-muted group-hover:text-fg-2')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {children}
    </button>
  )
}
