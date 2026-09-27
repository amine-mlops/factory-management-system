import { ArrowLeft, ArrowRight, Check, CircleAlert, Plug, Rocket, ShieldAlert, X } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { DocumentsPanel } from '../components/workspace/DocumentsPanel.tsx'
import { InviteCodesPanel, MembersPanel, RoleChips } from '../components/workspace/MembersPanel.tsx'
import { PipelinePanel } from '../components/workspace/PipelinePanel.tsx'
import { Logo } from '../components/ui/Logo.tsx'
import { Badge, Button, Eyebrow } from '../components/ui/primitives.tsx'
import { MODULE_NAV, navItem, type ModuleId } from '../data/nav.ts'
import { moduleStage, STAGE_LABEL, type Member, type RoleId } from '../lib/access.ts'
import { cx } from '../lib/format.ts'
import { useDocProcessor } from '../lib/useDocProcessor.ts'
import { connect, emptyDraft, generateInvite, ownerMember, ragState, workspaceFromDraft, type Connector, type GoldDataset, type KbDocument, type SetupDraft, type Workspace } from '../lib/workspace.ts'
import type { Session } from './Login.tsx'

const STEPS = [
  { id: 'profile', label: 'Company profile', hint: 'Name, industry, sites' },
  { id: 'scope', label: 'Supply-chain scope', hint: 'Enabled modules' },
  { id: 'knowledge', label: 'Knowledge base', hint: 'PDFs → RAG index' },
  { id: 'data', label: 'Data architecture', hint: 'Sources & Gold layer' },
  { id: 'team', label: 'Team & access', hint: 'Members & roles' },
  { id: 'review', label: 'Review & launch', hint: 'Confirm setup' },
] as const

const MODULE_BLURB: Record<ModuleId, string> = {
  procurement: 'POs, suppliers, expedites',
  inventory: 'Stock, spares, reorder points',
  transportation: 'Routes, loads, driver briefings',
  warehousing: 'Docks, zones, pick waves',
  manufacturing: 'Lines, OEE + Autonomous Triage',
  distribution: 'DC network & fulfilment',
  crm: 'Cases, SLAs, accounts',
  it: 'Integrations & platform health',
}

const inputCls = 'w-full rounded-md border border-line-2 bg-deck px-3 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus:border-accent/70'

export function Onboarding({ session, onLaunch, onCancel }: { session: Session; onLaunch: (ws: Workspace) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<SetupDraft>(() => {
    const d = emptyDraft()
    d.tenant.name = 'Acme Process Industries'
    d.tenant.context = 'Continuous cooling-water and compression loops; unplanned trips cost ≈ $25k/h.'
    return d
  })
  const [locInput, setLocInput] = useState('')

  const setDocs = useCallback((fn: (d: KbDocument[]) => KbDocument[]) => setDraft((x) => ({ ...x, documents: fn(x.documents) })), [])
  const setConnectors = useCallback((fn: (c: Connector[]) => Connector[]) => setDraft((x) => ({ ...x, connectors: fn(x.connectors) })), [])
  const setGold = useCallback((fn: (g: GoldDataset[]) => GoldDataset[]) => setDraft((x) => ({ ...x, gold: fn(x.gold) })), [])
  const setMembers = useCallback((fn: (m: Member[]) => Member[]) => setDraft((x) => ({ ...x, members: fn(x.members) })), [])
  useDocProcessor(draft.documents, setDocs)

  const t = draft.tenant
  const setTenant = (patch: Partial<SetupDraft['tenant']>) => setDraft((x) => ({ ...x, tenant: { ...x.tenant, ...patch } }))
  const toggleModule = (m: ModuleId) => setTenant({ enabledModules: t.enabledModules.includes(m) ? t.enabledModules.filter((x) => x !== m) : [...t.enabledModules, m] })

  const blocker = step === 0 && !t.name.trim() ? 'Company name is required.' : step === 1 && t.enabledModules.length === 0 ? 'Select at least one module.' : null
  const owner = ownerMember(session.name, session.email)
  const previewTenant = { ...t, tenantId: 'tnt_draft' as const }

  const addLocation = () => {
    const v = locInput.trim()
    if (v && !t.locations.includes(v)) setTenant({ locations: [...t.locations, v] })
    setLocInput('')
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.18em] text-fg">NEXUS</p>
            <p className="eyebrow mt-1">Company setup · owner</p>
          </div>
        </div>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-xs text-fg-2 hover:text-fg">
          <X className="size-3.5" aria-hidden /> Exit setup
        </button>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Setup progress" className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <p className="num mb-3 text-xs text-muted">
            Step {step + 1} of {STEPS.length}
          </p>
          <ol className="flex gap-1.5 overflow-x-auto lg:flex-col">
            {STEPS.map((s, i) => (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => setStep(i)}
                  aria-current={i === step ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left disabled:cursor-not-allowed', i === step ? 'bg-accent/[0.09]' : i < step ? 'hover:bg-raised' : '')}
                >
                  <span className={cx('num grid size-6 shrink-0 place-items-center rounded-sm border text-[11px]', i < step ? 'border-accent bg-accent text-on-accent' : i === step ? 'border-accent text-accent' : 'border-line-2 text-faint')}>
                    {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="hidden lg:block">
                    <span className={cx('block text-sm font-medium', i <= step ? 'text-fg' : 'text-faint')}>{s.label}</span>
                    <span className="block text-xs text-faint">{s.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="panel @container min-w-0 p-5 sm:p-6" aria-labelledby="step-title">
          <Eyebrow>
            Step {step + 1} · {STEPS[step].hint}
          </Eyebrow>
          <h1 id="step-title" className="mb-5 mt-2 text-[22px] font-semibold tracking-tight text-fg">
            {STEPS[step].label}
          </h1>

          <div key={step} className="animate-rise">
            {step === 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Company name" id="co-name">
                  <input id="co-name" className={inputCls} value={t.name} onChange={(e) => setTenant({ name: e.target.value })} placeholder="Acme Process Industries" />
                </Field>
                <Field label="Industry" id="co-ind">
                  <select id="co-ind" className={inputCls} value={t.industry} onChange={(e) => setTenant({ industry: e.target.value })}>
                    {['Process manufacturing', 'Discrete manufacturing', 'Energy & utilities', 'Food & beverage', 'Chemicals', 'Logistics'].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Company size" id="co-size">
                  <select id="co-size" className={inputCls} value={t.size} onChange={(e) => setTenant({ size: e.target.value })}>
                    {['1–200', '200–1,000', '1,000–5,000', '5,000+'].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Locations" id="co-loc">
                  <div className="flex gap-2">
                    <input
                      id="co-loc"
                      className={inputCls}
                      value={locInput}
                      onChange={(e) => setLocInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addLocation()
                        }
                      }}
                      placeholder="Add a site, press Enter"
                    />
                    <button type="button" onClick={addLocation} className="rounded-md border border-line-2 px-3 text-[13px] text-fg-2 hover:text-fg">
                      Add
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.locations.map((l) => (
                      <span key={l} className="flex items-center gap-1 rounded-sm border border-line bg-deck px-2 py-0.5 text-xs text-fg-2">
                        {l}
                        <button type="button" onClick={() => setTenant({ locations: t.locations.filter((x) => x !== l) })} aria-label={`Remove ${l}`} className="text-faint hover:text-fg">
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Operational context" id="co-ctx">
                    <textarea id="co-ctx" rows={3} className={inputCls} value={t.context} onChange={(e) => setTenant({ context: e.target.value })} placeholder="What does the plant run? What does downtime cost?" />
                  </Field>
                  <p className="mt-1.5 text-xs text-faint">Used to ground AI briefings for this tenant only.</p>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">Only selected modules appear in this workspace's navigation.</p>
                  <button type="button" onClick={() => setTenant({ enabledModules: t.enabledModules.length === 8 ? [] : MODULE_NAV.map((m) => m.id) })} className="text-[13px] text-accent hover:text-accent-2">
                    {t.enabledModules.length === 8 ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Supply-chain modules">
                  {(['procurement', 'inventory', 'transportation', 'warehousing', 'manufacturing', 'distribution', 'crm', 'it'] as ModuleId[]).map((m) => {
                    const on = t.enabledModules.includes(m)
                    const item = navItem(m)
                    const Icon = item.icon
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleModule(m)}
                        className={cx('relative flex flex-col gap-2 rounded-lg border p-3.5 text-left transition-colors', on ? 'border-accent/60 bg-accent/[0.07]' : 'border-line bg-deck/50 hover:border-line-2')}
                      >
                        <span className={cx('absolute right-3 top-3 grid size-4 place-items-center rounded-sm border', on ? 'border-accent bg-accent text-on-accent' : 'border-line-2')}>{on && <Check className="size-3" aria-hidden />}</span>
                        <Icon className={cx('size-5', on ? 'text-accent' : 'text-muted')} aria-hidden />
                        <span className="text-sm font-medium text-fg">{item.label}</span>
                        <span className="text-xs text-muted">{MODULE_BLURB[m]}</span>
                        <span className={cx('font-mono text-[11px] font-semibold uppercase tracking-[0.08em]', moduleStage(m) === 'integrated' ? 'text-accent-2' : moduleStage(m) === 'simulated' ? 'text-info' : 'text-muted')}>{STAGE_LABEL[moduleStage(m)]}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-3 text-[13px] text-muted">Transportation and Procurement are integrated with the FastAPI prototype; Inventory runs the Perishable Expiry Guard as a simulated demo module. The other five can be enabled now and light up as they ship.{t.enabledModules.includes('manufacturing') ? ' Manufacturing also unlocks the Autonomous Triage preview.' : ''}</p>
              </div>
            )}

            {step === 2 && <DocumentsPanel docs={draft.documents} setDocs={setDocs} />}

            {step === 3 && (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">Connect mock sources; map Gold datasets to the modules you enabled.</p>
                  <Button size="sm" icon={Plug} onClick={() => setConnectors((c) => c.map(connect))}>
                    Connect all demo sources
                  </Button>
                </div>
                <PipelinePanel connectors={draft.connectors} gold={draft.gold} enabledModules={t.enabledModules} setConnectors={setConnectors} setGold={setGold} />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
              <InviteCodesPanel
                invites={draft.invites}
                onGenerate={(roles: RoleId[]) =>
                  setDraft((x) => {
                    const probe = workspaceFromDraft(x, owner)
                    return { ...x, invites: [generateInvite({ ...probe, invites: x.invites }, roles, owner.name), ...x.invites] }
                  })
                }
              />
              <MembersPanel tenant={previewTenant} members={[owner, ...draft.members]} setMembers={(fn) => setMembers((m) => fn([owner, ...m]).filter((x) => x.userId !== owner.userId))} />
              </div>
            )}

            {step === 5 && <Review draft={draft} />}
          </div>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <Button icon={ArrowLeft} onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {blocker && (
              <p className="flex items-center gap-1.5 text-[13px] text-warn" role="status">
                <CircleAlert className="size-3.5" aria-hidden /> {blocker}
              </p>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" iconRight={ArrowRight} disabled={!!blocker} onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="primary" icon={Rocket} onClick={() => onLaunch(workspaceFromDraft(draft, owner))}>
                Launch workspace
              </Button>
            )}
          </footer>
        </section>
      </div>
    </main>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-2 block">
        {label}
      </label>
      {children}
    </div>
  )
}

function Review({ draft }: { draft: SetupDraft }) {
  const rag = ragState(draft.documents)
  const connected = draft.connectors.filter((c) => c.connected)
  const unassigned = draft.members.filter((m) => m.roles.length === 0)
  const rows: Array<[string, ReactNode, boolean]> = [
    ['Company', `${draft.tenant.name} · ${draft.tenant.industry} · ${draft.tenant.size} · ${draft.tenant.locations.join(', ') || 'no sites'}`, true],
    [
      'Modules',
      <span key="modules" className="flex flex-wrap gap-1">
        {draft.tenant.enabledModules.map((m) => (
          <Badge key={m} tone="nv" className="normal-case tracking-normal">
            {navItem(m).label}
          </Badge>
        ))}
      </span>,
      draft.tenant.enabledModules.length > 0,
    ],
    ['Knowledge base', `${draft.documents.length} documents · ${rag.indexed} indexed · ${rag.chunks} chunks ${rag.ready ? '· RAG-ready' : ''}`, draft.documents.length > 0],
    ['Data sources', `${connected.length}/${draft.connectors.length} connected · ${connected.filter((c) => c.warning).length} warnings`, connected.length > 0],
    ['Invitation codes', draft.invites.length ? draft.invites.map((i) => `${i.code} (${i.roles.join(' + ')})`).join(' · ') : 'none generated', draft.invites.length > 0],
    [
      'Team',
      <span key="team" className="space-y-1.5">
        {draft.members.map((m) => (
          <span key={m.userId} className="flex flex-wrap items-center gap-2">
            <span className="text-fg-2">{m.name}</span> <RoleChips roles={m.roles} />
          </span>
        ))}
      </span>,
      unassigned.length === 0,
    ],
  ]
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-lg border border-line">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-start">
            <dt className="eyebrow pt-0.5">{k}</dt>
            <dd className="text-sm text-fg-2">{v}</dd>
            <span className={cx('font-mono text-[11px] font-semibold', ok ? 'text-accent' : 'text-warn')}>{ok ? 'READY' : 'REVIEW'}</span>
          </div>
        ))}
      </dl>
      <div className="flex items-start gap-3 rounded-lg border border-warn-line bg-warn-bg px-4 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <p className="text-[13px] text-fg-2">
          <span className="font-semibold text-fg">Demo boundary.</span> Launching creates local mock state only. In production the FastAPI backend creates the tenant, sends invites, stores documents and enforces tenant
          isolation and role/module authorization on every API and RAG request — hiding navigation in the browser is not security.
        </p>
      </div>
    </div>
  )
}
