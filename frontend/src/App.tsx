import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Shell } from './components/shell/Shell.tsx'
import { openMembership, saveWorkspace } from './lib/mockDb.ts'
import type { Workspace } from './lib/workspace.ts'
import { Login, type Session } from './views/Login.tsx'
import { WorkspaceChoice } from './views/WorkspaceChoice.tsx'

const Onboarding = lazy(() => import('./views/Onboarding.tsx').then((m) => ({ default: m.Onboarding })))

const SESSION_KEY = 'nexus.session'
const TENANT_KEY = 'nexus.tenant'

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — state stays in memory */
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readJson<Session>(SESSION_KEY))
  const [ws, setWsState] = useState<Workspace | null>(() => {
    const s = readJson<Session>(SESSION_KEY)
    const t = readJson<string>(TENANT_KEY)
    return s && t ? openMembership(t, s.email) : null
  })
  const [setup, setSetup] = useState(false)

  // Mock persistence (stands in for FastAPI + SQLite).
  useEffect(() => {
    if (ws) saveWorkspace(ws)
  }, [ws])

  const setWs = useCallback((fn: (w: Workspace) => Workspace) => setWsState((w) => (w ? fn(w) : w)), [])

  const enter = (w: Workspace) => {
    writeJson(TENANT_KEY, w.tenant.tenantId)
    window.location.hash = ''
    setSetup(false)
    setWsState({ ...w, previewRoles: null, previewUserId: null })
  }

  const login = (s: Session) => {
    writeJson(SESSION_KEY, s)
    setSession(s)
  }

  const logout = () => {
    writeJson(SESSION_KEY, null)
    writeJson(TENANT_KEY, null)
    window.location.hash = ''
    setWsState(null)
    setSetup(false)
    setSession(null)
  }

  const switchCompany = () => {
    writeJson(TENANT_KEY, null)
    window.location.hash = ''
    setWsState(null)
  }

  let screen
  if (!session) screen = <Login key="login" onLogin={login} />
  else if (ws) screen = <Shell key={`${ws.tenant.tenantId}-${ws.currentUserId}`} session={session} ws={ws} setWs={setWs} onLogout={logout} onSwitchCompany={switchCompany} />
  else if (setup) screen = <Onboarding key="setup" session={session} onLaunch={enter} onCancel={() => setSetup(false)} />
  else screen = <WorkspaceChoice key="choice" session={session} onEnter={enter} onSetup={() => setSetup(true)} onLogout={logout} />

  return (
    <div className="ambient min-h-dvh">
      <Suspense fallback={null}>{screen}</Suspense>
    </div>
  )
}
