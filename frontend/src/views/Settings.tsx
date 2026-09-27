import { Building2, Cable, HeartPulse, LayoutGrid, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Button, KeyValues, Panel, Switch } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import { ArchitectureStrip } from '../components/workspace/Architecture.tsx'
import { AccessModel } from '../components/workspace/Security.tsx'
import { MODULE_NAV, navItem, type ModuleId } from '../data/nav.ts'
import { API_URL, checkHealth, ENDPOINTS } from '../lib/api.ts'
import { isOwnerLike, moduleStage, roleDef, STAGE_LABEL } from '../lib/access.ts'
import { cx } from '../lib/format.ts'
import { useTab } from '../lib/route.ts'
import { useNotify } from '../lib/toast.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type SetTab = 'profile' | 'modules' | 'integrations' | 'security'

export function SettingsView() {
  const { ws, perms } = useWorkspace()
  const canEdit = isOwnerLike(perms.roles)
  const tabs: Array<TabDef<SetTab>> = [
    { id: 'profile', label: 'Company Profile', icon: Building2 },
    { id: 'modules', label: 'Enabled Modules', icon: LayoutGrid, badge: `${ws.tenant.enabledModules.length}/8`, badgeLabel: `${ws.tenant.enabledModules.length} of 8 modules enabled` },
    { id: 'integrations', label: 'Integrations', icon: Cable },
    { id: 'security', label: 'Security', icon: ShieldCheck },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  return (
    <Page>
      <PageHeader
        eyebrow={`Settings · ${ws.tenant.tenantId}`}
        title="Company settings"
        subtitle="Workspace configuration. Changes here update the local demo store; in production FastAPI is the source of truth."
        right={!canEdit ? <Badge tone="neutral">Read only</Badge> : undefined}
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Settings sections" idBase="set" />
      <TabPanel idBase="set" id={tab}>
        {tab === 'profile' && <ProfileTab canEdit={canEdit} />}
        {tab === 'modules' && <ModulesTab canEdit={canEdit} />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'security' && <SecurityTab />}
      </TabPanel>
    </Page>
  )
}

function ProfileTab({ canEdit }: { canEdit: boolean }) {
  const { ws, update, log } = useWorkspace()
  const notify = useNotify()
  const t = ws.tenant
  const [draft, setDraft] = useState({ name: t.name, industry: t.industry, size: t.size, locations: t.locations.join(', '), context: t.context })
  const [error, setError] = useState<string | null>(null)
  const ids = { n: useId(), i: useId(), s: useId(), l: useId(), c: useId(), e: useId() }
  const dirty = draft.name !== t.name || draft.industry !== t.industry || draft.size !== t.size || draft.locations !== t.locations.join(', ') || draft.context !== t.context
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return setError('Company name is required.')
    const locations = draft.locations.split(',').map((x) => x.trim()).filter(Boolean)
    if (!locations.length) return setError('Add at least one location.')
    setError(null)
    update((w) => ({ ...w, tenant: { ...w.tenant, name: draft.name.trim(), industry: draft.industry.trim(), size: draft.size, locations, context: draft.context.trim() } }))
    log('Company profile updated', draft.name.trim(), 'info', 'settings')
    notify('Company profile saved (demo store)', 'nv')
  }
  const field = 'h-10 w-full rounded-md border border-field bg-deck px-3 text-sm text-fg outline-none focus:border-accent disabled:opacity-70'
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel eyebrow="Profile" title={t.name}>
        <form onSubmit={save} noValidate aria-describedby={error ? ids.e : undefined} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.n} className="mb-1 block text-xs font-medium text-muted">
                Company name
              </label>
              <input id={ids.n} disabled={!canEdit} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={field} />
            </div>
            <div>
              <label htmlFor={ids.i} className="mb-1 block text-xs font-medium text-muted">
                Industry
              </label>
              <input id={ids.i} disabled={!canEdit} value={draft.industry} onChange={(e) => setDraft((d) => ({ ...d, industry: e.target.value }))} className={field} />
            </div>
            <div>
              <label htmlFor={ids.s} className="mb-1 block text-xs font-medium text-muted">
                Company size
              </label>
              <select id={ids.s} disabled={!canEdit} value={draft.size} onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value }))} className={field}>
                {['1–50', '50–200', '200–1,000', '1,000–5,000', '5,000+'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.l} className="mb-1 block text-xs font-medium text-muted">
                Locations (comma-separated)
              </label>
              <input id={ids.l} disabled={!canEdit} value={draft.locations} onChange={(e) => setDraft((d) => ({ ...d, locations: e.target.value }))} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor={ids.c} className="mb-1 block text-xs font-medium text-muted">
              Operational context (used to ground AI answers)
            </label>
            <textarea id={ids.c} disabled={!canEdit} rows={3} value={draft.context} onChange={(e) => setDraft((d) => ({ ...d, context: e.target.value }))} className="w-full rounded-md border border-field bg-deck px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-70" />
          </div>
          {error && (
            <p id={ids.e} role="alert" className="text-[13px] text-crit-2">
              {error}
            </p>
          )}
          {canEdit && (
            <div className="flex justify-end gap-2">
              <Button disabled={!dirty} onClick={() => setDraft({ name: t.name, industry: t.industry, size: t.size, locations: t.locations.join(', '), context: t.context })}>
                Reset
              </Button>
              <Button type="submit" variant="primary" disabled={!dirty}>
                Save profile
              </Button>
            </div>
          )}
        </form>
      </Panel>
      <Panel eyebrow="Tenant" title="Identifiers">
        <KeyValues
          cols={1}
          items={[
            ['Tenant ID', <span key="t" className="num">{t.tenantId}</span>],
            ['Created via', ws.origin === 'setup' ? 'Owner setup wizard' : ws.origin === 'join' ? 'Invite' : 'Demo seed'],
            ['Members', `${ws.members.length} (${ws.members.filter((m) => m.status === 'active').length} active)`],
            ['Knowledge base', `${ws.documents.length} PDFs`],
          ]}
        />
        <p className="mt-4 text-xs text-muted">The tenant ID is informational. FastAPI derives the tenant from the verified session — the browser never sends it as authority.</p>
      </Panel>
    </div>
  )
}

function ModulesTab({ canEdit }: { canEdit: boolean }) {
  const { ws, update, log } = useWorkspace()
  const toggle = (m: ModuleId) => {
    if (!canEdit) return
    const on = ws.tenant.enabledModules.includes(m)
    update((w) => ({ ...w, tenant: { ...w.tenant, enabledModules: on ? w.tenant.enabledModules.filter((x) => x !== m) : [...w.tenant.enabledModules, m] } }))
    log(on ? 'Module disabled' : 'Module enabled', navItem(m).label, on ? 'warn' : 'nv', 'settings')
  }
  const groups: Array<{ title: string; hint: string; ids: ModuleId[] }> = [
    { title: 'Integrated', hint: 'Wired to the FastAPI + SQLite prototype backend.', ids: MODULE_NAV.filter((m) => moduleStage(m.id) === 'integrated').map((m) => m.id) },
    { title: 'Demo module · simulated', hint: 'Fully usable on local mock data until a backend exists.', ids: MODULE_NAV.filter((m) => moduleStage(m.id) === 'simulated').map((m) => m.id) },
    { title: 'Coming soon', hint: 'Enable now; they light up as the backend ships them.', ids: MODULE_NAV.filter((m) => moduleStage(m.id) === 'soon').map((m) => m.id) },
  ]
  return (
    <div className="grid gap-4 @4xl:grid-cols-3">
      {groups.map((g) => (
        <Panel key={g.title} eyebrow={g.hint} title={g.title} bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {g.ids.map((id) => {
              const item = navItem(id)
              const Icon = item.icon
              const on = ws.tenant.enabledModules.includes(id)
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3">
                  <Icon className={cx('size-4 shrink-0', on ? 'text-fg-2' : 'text-muted')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Switch id={`mod-${id}`} checked={on} disabled={!canEdit} onChange={() => toggle(id)} label={item.label} description={`${STAGE_LABEL[moduleStage(id)]}${canEdit ? '' : ' · owner/admin only'}`} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      ))}
    </div>
  )
}

const ENDPOINT_STATUS: Partial<Record<keyof typeof ENDPOINTS, string>> = {
  health: 'Called on demand from this tab',
  ragQuery: 'Called by the assistant when mock mode is off',
  triageInfer: 'Called by the triage preview when mock mode is off',
}

function IntegrationsTab() {
  const { useMock, setUseMock, log } = useWorkspace()
  const [health, setHealth] = useState<{ ok: boolean; detail: string; ms: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const run = async () => {
    setChecking(true)
    setHealth(await checkHealth())
    setChecking(false)
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 @4xl:grid-cols-2">
        <Panel eyebrow="Data mode" title={useMock ? 'Local mock data' : 'FastAPI with local fallback'}>
          <Switch
            id="use-mock"
            checked={useMock}
            onChange={(v) => {
              setUseMock(v)
              log('Data mode changed', v ? 'USE_MOCK on — local mock store' : 'USE_MOCK off — assistant calls FastAPI, falls back locally', 'info', 'settings')
            }}
            label="Use local mock data (USE_MOCK)"
            description="On: every screen reads the local mock store. Off: the assistant calls POST /rag/query and shows an error plus a labelled local fallback if FastAPI is unreachable."
          />
          <p className="mt-3 text-xs text-muted">
            Backend URL <span className="num text-fg-2">{API_URL}</span> (VITE_API_URL). No tokens are stored in this repository.
          </p>
        </Panel>
        <Panel eyebrow="Connectivity" title="Backend health">
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={checking ? LoaderCircle : HeartPulse} onClick={() => void run()} disabled={checking}>
              {checking ? 'Checking…' : 'Check GET /health'}
            </Button>
            {health && (
              <span role="status" className={cx('text-[13px]', health.ok ? 'text-ok' : 'text-warn')}>
                {health.ok ? 'Reachable' : 'Unreachable'} · {health.detail} · {health.ms} ms
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Runs only when you press the button. Without a running backend the check reports “Unreachable” — that is expected in the demo.</p>
        </Panel>
      </div>
      <Panel eyebrow="api.ts · ENDPOINTS" title="Endpoint mapping" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <caption className="sr-only">Backend endpoints expected by this UI and how the demo uses them</caption>
            <thead>
              <tr className="border-b border-line">
                {['Key', 'Path', 'Used by this demo'].map((h) => (
                  <th key={h} scope="col" className="eyebrow px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(ENDPOINTS) as Array<keyof typeof ENDPOINTS>).map((k) => (
                <tr key={k} className="border-b border-line/60 last:border-0">
                  <td className="num px-3 py-1.5 text-fg-2">{k}</td>
                  <td className="num px-3 py-1.5 text-fg">{ENDPOINTS[k]}</td>
                  <td className="px-3 py-1.5 text-xs text-muted">{ENDPOINT_STATUS[k] ?? 'Mock store (to be implemented by the backend team)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <ArchitectureStrip />
    </div>
  )
}

function SecurityTab() {
  const { ws, me, realOwner, perms } = useWorkspace()
  return (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Panel eyebrow="How access is enforced" title="Access model">
        <AccessModel />
      </Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel eyebrow="This session" title="Identity & preview">
          <KeyValues
            items={[
              ['Acting as', me.name],
              ['Roles', perms.roles.map((r) => roleDef(r).label).join(' + ')],
              ['Tenant', <span key="t" className="num">{ws.tenant.tenantId}</span>],
              ['Preview as role', realOwner && (ws.previewRoles || ws.previewUserId) ? 'Active (UX only)' : 'Off'],
            ]}
          />
          <p className="mt-3 text-xs text-muted">“Preview as” only changes what this browser renders. Frontend checks are UX, not a security boundary — FastAPI authorizes every request.</p>
        </Panel>
        <Panel eyebrow="Backend requirements" title="CORS & credentials">
          <ul className="space-y-2 text-[13px] text-fg-2">
            <li>Allow only the UI origin; never combine wildcard origins with credentials.</li>
            <li>Derive tenant and user from the verified token on every request.</li>
            <li>Store connector secrets server-side; the UI never sees them.</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
