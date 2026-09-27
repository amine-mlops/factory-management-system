import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Shell } from './components/shell/Shell.tsx'
import { describeError } from './lib/api.ts'
import { live } from './lib/live.ts'
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

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? 'U') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Live mode: authenticate against FastAPI; the returned session is display-only (the token is the authority). */
async function liveAuthenticate(email: string, password: string): Promise<Session> {
  const r = await live!.login(email, password)
  return { name: r.user.name, email: r.user.email, role: 'Member', initials: initials(r.user.name) }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const s = readJson<Session>(SESSION_KEY)
    return live && s && !live.hasToken() ? null : s
  })
  const [ws, setWsState] = useState<Workspace | null>(() => {
    if (live) return null // hydrated from GET /api/workspace below
    const s = readJson<Session>(SESSION_KEY)
    const t = readJson<string>(TENANT_KEY)
    return s && t ? openMembership(t, s.email) : null
  })
  const [setup, setSetup] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  // Mock persistence (stands in for FastAPI). Live mode never writes local copies of server data.
  useEffect(() => {
    if (ws && !live) saveWorkspace(ws)
  }, [ws])

  // Live mode: a reload with a token and a selected company re-hydrates from the server.
  useEffect(() => {
    if (!live || !session || ws || !readJson<string>(TENANT_KEY)) return
    let alive = true
    live
      .snapshot()
      .then((w) => alive && setWsState(w))
      .catch((err) => {
        if (!alive) return
        setBootError(describeError(err))
        writeJson(TENANT_KEY, null)
      })
    return () => {
      alive = false
    }
  }, [session, ws])

  const setWs = useCallback((fn: (w: Workspace) => Workspace) => setWsState((w) => (w ? fn(w) : w)), [])

  const enter = (w: Workspace) => {
    writeJson(TENANT_KEY, w.tenant.tenantId)
    window.location.hash = ''
    setSetup(false)
    setBootError(null)
    setWsState({ ...w, previewRoles: null, previewUserId: null })
  }

  const login = (s: Session) => {
    writeJson(SESSION_KEY, s)
    setSession(s)
  }

  const logout = () => {
    live?.logout()
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
  if (!session) screen = <Login key="login" onLogin={login} authenticate={live ? liveAuthenticate : undefined} />
  else if (ws) screen = <Shell key={`${ws.tenant.tenantId}-${ws.currentUserId}`} session={session} ws={ws} setWs={setWs} replaceWs={enter} onLogout={logout} onSwitchCompany={switchCompany} />
  else if (setup) screen = <Onboarding key="setup" session={session} onLaunch={enter} onCancel={() => setSetup(false)} />
  else screen = <WorkspaceChoice key="choice" session={session} onEnter={enter} onSetup={() => setSetup(true)} onLogout={logout} notice={bootError} />

  return (
    <div className="ambient min-h-dvh">
      <Suspense fallback={null}>{screen}</Suspense>
    </div>
  )
}
