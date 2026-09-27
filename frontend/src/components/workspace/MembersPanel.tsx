import { Check, Copy, KeyRound, Minus, UserPlus, UserRoundPen } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { navItem, type ViewId } from '../../data/nav.ts'
import { ACTION_LABEL, effectivePermissions, newUserId, PROTOTYPE_ROLES, roleDef, ROLES, type Member, type RoleId, type Tenant } from '../../lib/access.ts'
import { cx } from '../../lib/format.ts'
import type { InviteCode } from '../../lib/workspace.ts'
import { Drawer } from '../ui/Drawer.tsx'
import { Badge, Button } from '../ui/primitives.tsx'

export function RoleChips({ roles }: { roles: RoleId[] }) {
  if (!roles.length) return <span className="text-xs italic text-muted">No role assigned</span>
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone={r === 'owner' || r === 'admin' ? 'nv' : 'info'} className="normal-case tracking-normal">
          {roleDef(r).label}
        </Badge>
      ))}
    </span>
  )
}

function RoleOption({ id, on, onToggle }: { id: RoleId; on: boolean; onToggle: (id: RoleId) => void }) {
  const r = roleDef(id)
  return (
    <label className={cx('grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2.5 rounded-md border px-3 py-2', on ? 'border-accent/50 bg-accent/10' : 'border-line-2 hover:bg-raised')}>
      <input type="checkbox" checked={on} onChange={() => onToggle(id)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
      <span className="text-[13px] font-medium text-fg">{r.label}</span>
      <span className="col-start-2 text-xs text-muted">{r.description}</span>
    </label>
  )
}

/** Native checkbox group — roles combine per user. Prototype roles first, preview roles behind a disclosure. */
export function RoleCheckboxes({ value, onChange, legend }: { value: RoleId[]; onChange: (r: RoleId[]) => void; legend: string }) {
  const toggle = (r: RoleId) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])
  const others = ROLES.filter((r) => r.id !== 'owner' && !PROTOTYPE_ROLES.includes(r.id))
  const [showMore, setShowMore] = useState(() => value.some((v) => others.some((o) => o.id === v)))
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-medium text-muted">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PROTOTYPE_ROLES.filter((r) => r !== 'owner').map((r) => (
          <RoleOption key={r} id={r} on={value.includes(r)} onToggle={toggle} />
        ))}
      </div>
      <details className="rounded-md border border-line px-3 py-2" open={showMore} onToggle={(e) => setShowMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-xs font-medium text-fg-2">More roles (UI preview roles — not in the prototype backend)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {others.map((r) => (
            <RoleOption key={r.id} id={r.id} on={value.includes(r.id)} onToggle={toggle} />
          ))}
        </div>
      </details>
    </fieldset>
  )
}

interface MembersProps {
  members: Member[]
  setMembers?: (fn: (m: Member[]) => Member[]) => void
  onEvent?: (action: string, detail: string) => void
  /** Draw its own border (false when placed inside a panel body). */
  framed?: boolean
}

export function MembersTable({ members, setMembers, onEvent, framed = true }: MembersProps) {
  const [editing, setEditing] = useState<Member | null>(null)
  const [draft, setDraft] = useState<RoleId[]>([])
  const editable = !!setMembers
  const save = () => {
    if (!editing) return
    setMembers!((all) => all.map((x) => (x.userId === editing.userId ? { ...x, roles: draft } : x)))
    onEvent?.('Role changed', `${editing.name}: ${draft.map((x) => roleDef(x).label).join(' + ') || 'no roles'}`)
    setEditing(null)
  }
  return (
    <>
      <div className={cx('overflow-x-auto', framed && 'rounded-lg border border-line')}>
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <caption className="sr-only">Members, their roles and status</caption>
          <thead>
            <tr className={cx('border-b border-line', framed && 'bg-deck')}>
              {['Member', 'Roles', 'Status', ''].map((h, i) => (
                <th key={i} scope="col" className="eyebrow px-3 py-2.5 font-medium">
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <p className="flex items-center gap-2.5 font-medium text-fg">
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 bg-raised font-mono text-[11px] font-bold text-fg">
                      {m.name
                        .split(' ')
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)}
                    </span>
                    {m.name}
                  </p>
                  <p className="wrap-anywhere pl-[42px] text-xs text-muted">{m.email}</p>
                </td>
                <td className="px-3 py-2.5">
                  <RoleChips roles={m.roles} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={m.status === 'active' ? 'nv' : 'warn'}>{m.status}</Badge>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {editable && !m.roles.includes('owner') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={UserRoundPen}
                      onClick={() => {
                        setDraft(m.roles)
                        setEditing(m)
                      }}
                      aria-label={`Edit roles for ${m.name}`}
                    >
                      Roles
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        eyebrow="Team & access · multi-role"
        title={editing ? `Roles for ${editing.name}` : ''}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save roles
            </Button>
          </>
        }
      >
        <RoleCheckboxes value={draft} onChange={setDraft} legend="Roles combine: effective access = union of role grants ∩ enabled modules." />
      </Drawer>
    </>
  )
}

export function InviteMemberForm({ members, setMembers, onEvent }: Required<Pick<MembersProps, 'setMembers'>> & MembersProps) {
  const nameId = useId()
  const emailId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<RoleId[]>(['truck_driver'])
  const [error, setError] = useState<string | null>(null)
  const invite = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Enter the person’s full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid work email, e.g. name@company.com.')
    if (!roles.length) return setError('Assign at least one role.')
    if (members.some((m) => m.email.toLowerCase() === email.toLowerCase())) return setError('That person is already a member.')
    setMembers((m) => [...m, { userId: newUserId(), name: name.trim(), email: email.trim(), roles, grants: [], status: 'invited' }])
    onEvent?.('Invite drafted', `${email.trim()} as ${roles.map((r) => roleDef(r).label).join(' + ')} (not sent — demo)`)
    setName('')
    setEmail('')
    setError(null)
  }
  const input = 'h-10 w-full rounded-md border border-field bg-deck px-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent'
  return (
    <form onSubmit={invite} className="space-y-3" noValidate aria-describedby={error ? `${emailId}-err` : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-muted">
            Full name
          </label>
          <input id={nameId} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={emailId} className="mb-1 block text-xs font-medium text-muted">
            Work email
          </label>
          <input id={emailId} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </div>
      </div>
      <RoleCheckboxes value={roles} onChange={setRoles} legend="Roles" />
      {error && (
        <p id={`${emailId}-err`} role="alert" className="text-[13px] text-crit-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">UI only — nothing is sent. Production: POST /invites via FastAPI.</p>
        <Button type="submit" variant="primary" icon={UserPlus}>
          Add invite
        </Button>
      </div>
    </form>
  )
}

/** Owner generates invitation codes (mock of POST /invites). Codes are redeemable after signing in as another user. */
export function InviteCodesPanel({ invites, onGenerate }: { invites: InviteCode[]; onGenerate: (roles: RoleId[]) => void }) {
  const [preset, setPreset] = useState<'driver' | 'procurement'>('driver')
  const [copied, setCopied] = useState<string | null>(null)
  const roles: RoleId[] = preset === 'driver' ? ['truck_driver'] : ['procurement_manager']
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(null), 1400)
    } catch {
      setCopied(null)
    }
  }
  return (
    <section className="space-y-3" aria-label="Invitation codes">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted" id="invite-role-label">
          Code for role
        </span>
        <div className="flex rounded-md border border-line-2 p-0.5" role="radiogroup" aria-labelledby="invite-role-label">
          {(
            [
              ['driver', 'Driver'],
              ['procurement', 'Procurement'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={preset === id}
              onClick={() => setPreset(id)}
              className={cx('h-8 rounded-sm px-3 text-[13px] font-medium', preset === id ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" icon={KeyRound} onClick={() => onGenerate(roles)} className="ml-auto">
          Generate code
        </Button>
      </div>
      {invites.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-2 px-3 py-3 text-[13px] text-muted">No codes yet. Generate one, then sign in as another email and choose “Join a company”.</p>
      ) : (
        <ul className="space-y-1.5">
          {invites.map((i) => (
            <li key={i.code} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
              <span className="num text-[15px] font-semibold tracking-[0.06em] text-fg">{i.code}</span>
              <RoleChips roles={i.roles} />
              <span className="ml-auto text-xs text-muted">{i.usedBy ? `redeemed by ${i.usedBy}` : 'unused'}</span>
              <Button size="sm" variant="ghost" icon={copied === i.code ? Check : Copy} onClick={() => void copy(i.code)} aria-label={`Copy ${i.code}`}>
                {copied === i.code ? 'Copied' : 'Copy'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const SHORT: Record<ViewId, string> = { dashboard: 'Overview', triage: 'Triage', manufacturing: 'Mfg', inventory: 'Inv', procurement: 'Proc', warehousing: 'Whse', distribution: 'Dist', transportation: 'Trans', crm: 'CRM', it: 'IT', knowledge: 'KB', data: 'Data', team: 'Team', settings: 'Settings' }

/** Members × pages, derived from roles ∪ grants ∩ enabled modules. Preview only — enforced server-side. */
export function PermissionMatrix({ tenant, members }: { tenant: Tenant; members: Member[] }) {
  const cols: ViewId[] = ['dashboard', ...tenant.enabledModules, ...(tenant.enabledModules.includes('manufacturing') ? (['triage'] as ViewId[]) : []), 'knowledge', 'data', 'team', 'settings']
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-xs">
        <caption className="sr-only">Pages each member can open</caption>
        <thead>
          <tr className="border-b border-line bg-deck">
            <th scope="col" className="eyebrow sticky left-0 bg-deck px-3 py-2 text-left font-medium">
              Member
            </th>
            {cols.map((c) => (
              <th key={c} scope="col" title={navItem(c).label} className="px-2 py-2 text-center font-mono font-medium text-muted">
                <abbr title={navItem(c).label} className="no-underline">
                  {SHORT[c]}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const p = effectivePermissions(tenant, m)
            return (
              <tr key={m.userId} className="border-b border-line last:border-0">
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 text-left font-medium text-fg-2">
                  {m.name}
                </th>
                {cols.map((c) => (
                  <td key={c} className="px-2 py-2 text-center">
                    {p.pages.has(c) ? <Check className="mx-auto size-3.5 text-accent" aria-label="allowed" /> : <Minus className="mx-auto size-3.5 text-faint" aria-label="no access" />}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Role → grants (module · actions · data scope) for the roles in use. */
export function RoleGrantsTable({ roles, tenant }: { roles: RoleId[]; tenant: Tenant }) {
  const enabled = new Set<ViewId>([...tenant.enabledModules, 'dashboard', 'knowledge', 'data', 'team', 'settings', ...(tenant.enabledModules.includes('manufacturing') ? (['triage'] as ViewId[]) : [])])
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-deck">
            {['Role', 'Resource', 'Actions', 'Data scope'].map((h) => (
              <th key={h} scope="col" className="eyebrow px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.flatMap((r) =>
            roleDef(r)
              .grants.filter((g) => enabled.has(g.resource))
              .map((g, i, arr) => (
                <tr key={`${r}-${g.resource}`} className={cx('border-line', i === arr.length - 1 ? 'border-b' : '')}>
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={arr.length} className="align-top px-3 py-2 text-[13px] font-medium text-fg">
                      {roleDef(r).label}
                    </th>
                  )}
                  <td className="px-3 py-1.5 text-fg-2">{navItem(g.resource).label}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {g.actions.map((a) => (
                        <span key={a} className="rounded-sm border border-line-2 bg-raised px-1.5 py-0.5 text-[11px] text-fg-2">
                          {ACTION_LABEL[a]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge tone={g.scope === 'assigned' ? 'warn' : 'neutral'}>{g.scope === 'assigned' ? 'Assigned only' : 'Whole tenant'}</Badge>
                  </td>
                </tr>
              )),
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Composite used by the onboarding wizard's Team step. */
export function MembersPanel({ tenant, members, setMembers, onEvent }: MembersProps & { tenant: Tenant }) {
  return (
    <div className="space-y-5">
      <MembersTable members={members} setMembers={setMembers} onEvent={onEvent} />
      {setMembers && (
        <div className="panel p-4">
          <p className="eyebrow mb-3">Invite a member</p>
          <InviteMemberForm members={members} setMembers={setMembers} onEvent={onEvent} />
        </div>
      )}
      <div>
        <p className="eyebrow mb-2">Module permission matrix</p>
        <PermissionMatrix tenant={tenant} members={members} />
      </div>
    </div>
  )
}
