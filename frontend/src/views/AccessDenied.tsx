import { ArrowLeft, Check, Lock, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/primitives.tsx'
import { navItem, type ViewId } from '../data/nav.ts'
import { roleDef } from '../lib/access.ts'
import { useNotify } from '../lib/toast.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

/**
 * Shown for any route the acting user may not open. A direct attempt on an
 * ungranted page is written to the shared security log (the backend would
 * return 403 for the page's data). UX mirror only — not the security boundary.
 */
export function AccessDenied({ page, onBack }: { page: ViewId; onBack: () => void }) {
  const { perms, ws, log, recordIncident, me } = useWorkspace()
  const notify = useNotify()
  const logged = useRef(false)
  const [requested, setRequested] = useState(false)
  const reason = perms.reason(page)
  const item = navItem(page)
  const Icon = item.icon
  const disabled = reason === 'module_disabled'
  const roles = perms.roles.map((r) => roleDef(r).label).join(' + ') || 'No role'

  useEffect(() => {
    if (logged.current || perms.reason(page) !== 'not_granted') return
    logged.current = true
    recordIncident({
      id: `inc_${Date.now().toString(36)}_rt`,
      at: new Date().toISOString(),
      tenantId: perms.tenantId,
      userId: me.userId,
      userName: me.name,
      roles: perms.roles,
      requestedResource: navItem(page).label,
      query: `GET #/${page}`,
      decision: 'DENY',
      stage: 'route',
      reason: `Route not granted to ${perms.roles.map((r) => roleDef(r).label).join(' + ') || 'this user'}`,
      chunksRetrieved: 0,
      sentToModel: false,
    })
  }, [page, perms, me, recordIncident])

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--header-h))] max-w-xl flex-col items-center justify-center px-5 py-10 text-center">
      <div className="relative">
        <span className="grid size-20 place-items-center rounded-full border border-line-2 bg-surface">
          <Icon className="size-8 text-muted" aria-hidden />
        </span>
        <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border border-warn/60 bg-canvas text-warn">
          <Lock className="size-4" aria-hidden />
        </span>
      </div>
      <p className="eyebrow mt-6 text-warn">{disabled ? 'Module not enabled' : '403 · Access denied'}</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-fg">{item.label}</h1>
      <p className="mt-2 text-sm text-muted">
        {disabled
          ? `${ws.tenant.name} has not enabled this module. An owner can turn it on in Settings → Enabled Modules.`
          : `Your role${perms.roles.length > 1 ? 's' : ''} (${roles}) do${perms.roles.length > 1 ? '' : 'es'} not include ${item.label}. Nothing from this page was loaded.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button icon={ArrowLeft} onClick={onBack}>
          Back to my workspace
        </Button>
        {!disabled && (
          <Button
            variant="primary"
            icon={requested ? Check : Send}
            disabled={requested}
            onClick={() => {
              setRequested(true)
              log('Access requested', `${roles} requested ${item.label}`, 'warn', 'team')
              notify(`Access request for ${item.label} sent to workspace owners (demo).`, 'info')
            }}
          >
            {requested ? 'Request sent' : 'Request access'}
          </Button>
        )}
      </div>
      <p className="mt-8 flex items-center gap-2 text-xs text-muted">
        <ShieldAlert className="size-3.5" aria-hidden /> {disabled ? 'Hidden in the UI; the backend also refuses disabled modules.' : 'Attempt recorded in the security log. In production the backend returns 403 for this data.'}
      </p>
    </div>
  )
}
