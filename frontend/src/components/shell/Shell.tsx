import { Eye, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MODULES } from '../../data/modules.ts'
import { isModuleId, navItem, type ViewId } from '../../data/nav.ts'
import { USE_MOCK_DEFAULT } from '../../lib/api.ts'
import { effectivePermissions, IMPLEMENTED_MODULES, isOwnerLike, landingPage, roleDef, type Member, type RoleId, type UserId } from '../../lib/access.ts'
import { scanDue, withScan } from '../../lib/expiry.ts'
import type { Tone } from '../../lib/format.ts'
import { hashFor, parseHash, RouteContext, type RouteCtx } from '../../lib/route.ts'
import { ToastContext, type ToastItem } from '../../lib/toast.ts'
import type { PresetId } from '../../lib/types.ts'
import { useDocProcessor } from '../../lib/useDocProcessor.ts'
import { useMediaQuery } from '../../lib/useNow.ts'
import { useTriage } from '../../lib/useTriage.ts'
import { auditEvent, type KbDocument, type SecurityIncident, type Workspace } from '../../lib/workspace.ts'
import { WorkspaceContext, type WorkspaceCtx } from '../../lib/workspaceContext.ts'
import { AccessDenied } from '../../views/AccessDenied.tsx'
import { ComingSoonGate } from '../../views/ComingSoon.tsx'
import type { Session } from '../../views/Login.tsx'
import { AssistantDock } from '../assistant/AssistantDock.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { Sidebar } from './Sidebar.tsx'
import { Toaster } from './Toaster.tsx'
import { TopBar } from './TopBar.tsx'

// Workspaces are code-split so each persona only downloads what it opens.
const AdminHome = lazy(() => import('../../views/AdminHome.tsx').then((m) => ({ default: m.AdminHome })))
const TransportationView = lazy(() => import('../../views/Transportation.tsx').then((m) => ({ default: m.TransportationView })))
const ProcurementView = lazy(() => import('../../views/Procurement.tsx').then((m) => ({ default: m.ProcurementView })))
const InventoryView = lazy(() => import('../../views/Inventory.tsx').then((m) => ({ default: m.InventoryView })))
const KnowledgeView = lazy(() => import('../../views/Knowledge.tsx').then((m) => ({ default: m.KnowledgeView })))
const TeamView = lazy(() => import('../../views/Team.tsx').then((m) => ({ default: m.TeamView })))
const SettingsView = lazy(() => import('../../views/Settings.tsx').then((m) => ({ default: m.SettingsView })))
const DataArchitectView = lazy(() => import('../../views/DataArchitect.tsx').then((m) => ({ default: m.DataArchitectView })))
const TriageView = lazy(() => import('../../views/TriageView.tsx').then((m) => ({ default: m.TriageView })))
const ModuleView = lazy(() => import('../../views/ModuleView.tsx').then((m) => ({ default: m.ModuleView })))

export interface NavActions {
  navigate: (v: ViewId, tab?: string) => void
  openTriage: (preset: PresetId, autoRun?: boolean) => void
}

export interface Persona {
  key: string
  label: string
  sub: string
  userId: UserId | null
  roles: RoleId[] | null
}

const DOCK_KEY = 'nexus.dock.open'
/** Open by default only where docking still leaves a two-column page (≥1600 px); remembered per viewer afterwards. */
const readDock = () => {
  try {
    const v = localStorage.getItem(DOCK_KEY)
    if (v !== null) return v === '1'
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1600px)').matches === true
}

interface Props {
  session: Session
  ws: Workspace
  setWs: (fn: (w: Workspace) => Workspace) => void
  onLogout: () => void
  onSwitchCompany: () => void
}

export function Shell({ session, ws, setWs, onLogout, onSwitchCompany }: Props) {
  const [useMock, setUseMock] = useState(USE_MOCK_DEFAULT)
  const triage = useTriage(useMock, setUseMock)
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dockOpen, setDockOpenState] = useState(readDock)
  const wide = useMediaQuery('(min-width: 1280px)')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const mainRef = useRef<HTMLElement>(null)
  const toastId = useRef(0)

  /* ---------------- identity & permissions (UX only — FastAPI authorizes real sessions) */
  // Member objects come straight from workspace state, so these stay referentially stable between renders.
  const realMe: Member = useMemo(
    () => ws.members.find((m) => m.userId === ws.currentUserId) ?? { userId: ws.currentUserId, name: session.name, email: session.email, roles: [], grants: [], status: 'active' },
    [ws.members, ws.currentUserId, session.name, session.email],
  )
  const realOwner = isOwnerLike(realMe.roles)
  const previewMember = useMemo(() => (ws.previewUserId ? ws.members.find((m) => m.userId === ws.previewUserId) : undefined), [ws.members, ws.previewUserId])
  const acting: Member = useMemo(() => {
    if (previewMember) return previewMember
    if (!ws.previewRoles?.length) return realMe
    // A driver-role preview acts as the seeded driver seat so "assigned deliveries" resolve.
    const seat = ws.members.find((m) => m.userId === 'usr_jlee')
    const base: Member = ws.previewRoles.includes('truck_driver') ? { ...(seat ?? { ...realMe, name: 'Driver (preview)' }), userId: 'usr_jlee' } : realMe
    return { ...base, roles: ws.previewRoles }
  }, [previewMember, ws.previewRoles, ws.members, realMe])
  const perms = useMemo(() => effectivePermissions(ws.tenant, acting, previewMember ? null : ws.previewRoles), [ws.tenant, acting, previewMember, ws.previewRoles])

  /* ---------------- route: #/view/tab (views push history, tabs replace) */
  const [route, setRoute] = useState(() => {
    const r = parseHash()
    return { view: r.view ?? landingPage(perms), tab: r.tab }
  })
  const initialRoute = useRef(route)
  useEffect(() => {
    // Make the landing route addressable without adding a history entry.
    if (!parseHash().view) history.replaceState(null, '', hashFor(initialRoute.current.view, initialRoute.current.tab))
    const onHash = () => {
      const r = parseHash()
      if (r.view) setRoute({ view: r.view, tab: r.tab })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((v: ViewId, tab?: string) => {
    const h = hashFor(v, tab)
    if (window.location.hash !== h) window.location.hash = h
    setRoute({ view: v, tab: tab ?? null })
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }, [])
  const setTab = useCallback(
    (tab: string) => {
      history.replaceState(null, '', hashFor(route.view, tab))
      setRoute((r) => ({ ...r, tab }))
    },
    [route.view],
  )
  const routeCtx: RouteCtx = useMemo(() => ({ view: route.view, tab: route.tab, navigate, setTab }), [route, navigate, setTab])
  const view = route.view

  /* ---------------- shared services */
  const notify = useCallback((message: string, tone: Tone = 'nv') => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-2), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const actorName = acting.email.split('@')[0] || acting.name
  const log = useCallback(
    (action: string, detail: string, tone: Tone = 'info', resource?: ViewId) => setWs((w) => ({ ...w, audit: [auditEvent(actorName, action, detail, tone, resource), ...w.audit].slice(0, 60) })),
    [setWs, actorName],
  )
  const recordIncident = useCallback(
    (i: SecurityIncident) =>
      setWs((w) => ({
        ...w,
        incidents: [i, ...w.incidents].slice(0, 50),
        audit: [auditEvent(actorName, 'Access denied (403)', `${i.requestedResource} · ${i.stage} · 0 chunks`, 'crit', 'data'), ...w.audit].slice(0, 60),
      })),
    [setWs, actorName],
  )

  // Simulated document processing continues across pages.
  const setDocs = useCallback((fn: (d: KbDocument[]) => KbDocument[]) => setWs((w) => ({ ...w, documents: fn(w.documents) })), [setWs])
  useDocProcessor(ws.documents, setDocs)

  // Simulated Expiry Guard schedule: runs a scan whenever the cadence has elapsed (catches up once after a gap).
  useEffect(() => {
    const tick = () => setWs((w) => (w.tenant.enabledModules.includes('inventory') && scanDue(w.expiry, new Date()) ? withScan(w, new Date(), 'schedule') : w))
    tick()
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [setWs])

  const ctx: WorkspaceCtx = { ws, update: setWs, me: acting, actingUserId: acting.userId, realOwner, perms, log, recordIncident, useMock, setUseMock }

  /* ---------------- persona preview (owner-only UX) */
  const personas = useMemo<Persona[]>(() => {
    const find = (r: RoleId) => ws.members.find((m) => m.roles.includes(r) && m.userId !== realMe.userId)
    const driver = find('truck_driver')
    const buyer = find('procurement_manager')
    const arch = find('data_architect')
    return [
      { key: 'owner', label: 'Owner', sub: `${realMe.name} · you`, userId: null, roles: null },
      { key: 'driver', label: 'Driver', sub: driver ? `${driver.name}${driver.status === 'invited' ? ' · invited' : ''}` : 'role preset', userId: driver?.userId ?? null, roles: driver ? null : ['truck_driver'] },
      { key: 'procurement', label: 'Procurement', sub: buyer ? `${buyer.name}${buyer.status === 'invited' ? ' · invited' : ''}` : 'role preset', userId: buyer?.userId ?? null, roles: buyer ? null : ['procurement_manager'] },
      { key: 'architect', label: 'Data Architect', sub: arch ? `${arch.name} · technical view` : 'technical view', userId: arch?.userId ?? null, roles: arch ? null : ['data_architect'] },
    ]
  }, [ws.members, realMe.userId, realMe.name])
  const activePersona = !ws.previewUserId && !ws.previewRoles ? 'owner' : (personas.find((p) => (p.userId && p.userId === ws.previewUserId) || (!p.userId && p.roles && ws.previewRoles?.join() === p.roles.join()))?.key ?? 'custom')

  const setPersona = (p: Persona) => {
    const next = { ...ws, previewUserId: p.userId, previewRoles: p.userId ? null : p.roles }
    setWs(() => next)
    if (p.key !== 'owner') log('Preview as role', `${realMe.name} previewing ${p.label} (UX only — backend authorizes real sessions)`, 'info', 'team')
    const m = p.userId ? next.members.find((x) => x.userId === p.userId)! : p.roles ? { ...(p.roles.includes('truck_driver') ? { ...realMe, userId: 'usr_jlee' as UserId } : realMe), roles: p.roles } : realMe
    navigate(landingPage(effectivePermissions(next.tenant, m, p.userId ? null : p.roles)))
  }

  /* ---------------- triage deep links */
  const { setPreset, preset, run, phase } = triage
  const openTriage = useCallback(
    (p: PresetId, runNow = false) => {
      navigate('triage')
      if (runNow) void run(p)
      else if (p !== preset || phase === 'idle') setPreset(p)
    },
    [navigate, setPreset, preset, phase, run],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setDockOpen = (open: boolean) => {
    setDockOpenState(open)
    try {
      localStorage.setItem(DOCK_KEY, open ? '1' : '0')
    } catch {
      /* per-viewer convenience only */
    }
  }

  const actions: NavActions = { navigate, openTriage }
  const allowed = perms.pages.has(view)
  const docked = wide && dockOpen

  const page = () => {
    if (!allowed) return <AccessDenied page={view} onBack={() => navigate(landingPage(perms))} />
    if (view === 'dashboard') return <AdminHome />
    if (view === 'triage') return <TriageView triage={triage} />
    if (view === 'transportation') return <TransportationView />
    if (view === 'procurement') return <ProcurementView />
    if (view === 'inventory') return <InventoryView />
    if (view === 'knowledge') return <KnowledgeView />
    if (view === 'data') return <DataArchitectView />
    if (view === 'team') return <TeamView />
    if (view === 'settings') return <SettingsView />
    if (isModuleId(view) && !IMPLEMENTED_MODULES.includes(view)) return <ComingSoonGate module={view} preview={<ModuleView config={MODULES[view]} {...actions} />} />
    return null
  }

  const mainStyle: CSSProperties | undefined = docked ? { paddingRight: 'calc(var(--dock-width) + 2 * var(--dock-gap))' } : undefined

  return (
    <WorkspaceContext.Provider value={ctx}>
      <RouteContext.Provider value={routeCtx}>
        <ToastContext.Provider value={notify}>
          <a
            href="#main"
            onClick={(e) => {
              e.preventDefault()
              mainRef.current?.focus()
            }}
            className="sr-only rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
            style={{ zIndex: 'var(--z-toast)' }}
          >
            Skip to content
          </a>
          <TopBar
            session={session}
            tenantName={ws.tenant.name}
            onLogout={onLogout}
            onSwitchCompany={onSwitchCompany}
            onOpenPalette={() => setPaletteOpen(true)}
            onToggleNav={() => setNavOpen((o) => !o)}
            navOpen={navOpen}
            useMock={useMock}
            onNavigate={navigate}
            personas={realOwner ? personas : null}
            activePersona={activePersona}
            onPersona={setPersona}
          />
          {activePersona !== 'owner' && realOwner && (
            <div className="sticky top-[var(--header-h)] flex items-center gap-3 border-b border-info/40 bg-overlay px-4 py-2" style={{ zIndex: 'var(--z-sidebar)' }} role="status">
              <Eye className="size-4 shrink-0 text-info" aria-hidden />
              <p className="min-w-0 flex-1 text-[13px] text-fg-2">
                Previewing as <span className="font-semibold text-fg">{acting.name}</span> · {perms.roles.map((r) => roleDef(r).label).join(' + ')} — navigation, data and the assistant reflect this persona. UX preview only; FastAPI authorizes real sessions.
              </p>
              <button type="button" onClick={() => setPersona(personas[0])} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-info/50 px-2.5 text-xs font-semibold text-info hover:bg-info/10">
                <X className="size-3.5" aria-hidden /> Exit preview
              </button>
            </div>
          )}
          <div className="flex">
            <Sidebar view={view} onNavigate={navigate} open={navOpen} onClose={() => setNavOpen(false)} />
            <main id="main" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 outline-none" style={mainStyle}>
              <p className="sr-only" aria-live="polite">
                {navItem(view).label}
              </p>
              <div key={`${view}-${activePersona}`} className="animate-fade">
                <Suspense fallback={<p className="px-6 py-10 text-sm text-muted">Loading workspace…</p>}>{page()}</Suspense>
              </div>
            </main>
          </div>
          <AssistantDock open={dockOpen} onOpenChange={setDockOpen} view={allowed ? view : landingPage(perms)} docked={docked} />
          {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} allowed={perms.pages} {...actions} />}
          <Toaster toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} placement={docked ? 'beside-dock' : dockOpen ? 'top' : 'above-launcher'} />
        </ToastContext.Provider>
      </RouteContext.Provider>
    </WorkspaceContext.Provider>
  )
}
