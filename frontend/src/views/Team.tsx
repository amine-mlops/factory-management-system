import { KeyRound, ListChecks, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Panel, StatusDot } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import { InviteCodesPanel, InviteMemberForm, MembersTable, PermissionMatrix, RoleGrantsTable } from '../components/workspace/MembersPanel.tsx'
import { navItem, type ViewId } from '../data/nav.ts'
import { isOwnerLike, roleDef, type Member, type RoleId } from '../lib/access.ts'
import { cx } from '../lib/format.ts'
import { useTab } from '../lib/route.ts'
import { generateInvite } from '../lib/workspace.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type TeamTab = 'members' | 'invitations' | 'roles' | 'audit'

export function TeamView() {
  const { ws, perms, update, log, me } = useWorkspace()
  const canEdit = isOwnerLike(perms.roles)
  const setMembers = useCallback((fn: (m: Member[]) => Member[]) => update((w) => ({ ...w, members: fn(w.members) })), [update])
  const active = ws.members.filter((m) => m.status === 'active').length
  const unused = ws.invites.filter((i) => !i.usedBy).length
  const tabs: Array<TabDef<TeamTab>> = [
    { id: 'members', label: 'Members', icon: Users, badge: ws.members.length, badgeLabel: `${ws.members.length} members` },
    { id: 'invitations', label: 'Invitations', icon: KeyRound, badge: unused || undefined, badgeTone: 'info', badgeLabel: `${unused} unused codes` },
    { id: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
    { id: 'audit', label: 'Audit', icon: ScrollText },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const rolesInUse = [...new Set(ws.members.flatMap((m) => m.roles))] as RoleId[]
  const onEvent = (a: string, d: string) => log(a, d, 'info', 'team')

  return (
    <Page>
      <PageHeader
        eyebrow={`Team & access · ${ws.tenant.name}`}
        title="People and permissions"
        subtitle="Roles combine per person. Effective access = role grants ∪ explicit grants ∩ modules enabled for this company."
        right={
          <>
            <Badge tone="nv">{active} active</Badge>
            <Badge tone="warn">{ws.members.length - active} invited</Badge>
            {!canEdit && <Badge tone="neutral">Read only</Badge>}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Team sections" idBase="team" />
      <TabPanel idBase="team" id={tab}>
        {tab === 'members' && (
          <Panel eyebrow="Members" title={`${ws.members.length} people`} bodyClassName="p-0">
            <MembersTable members={ws.members} setMembers={canEdit ? setMembers : undefined} onEvent={onEvent} framed={false} />
          </Panel>
        )}
        {tab === 'invitations' && (
          <div className="grid gap-4 @4xl:grid-cols-2">
            <Panel eyebrow="Invitation codes · mock of POST /invites" title="Share a join code">
              {canEdit ? (
                <InviteCodesPanel
                  invites={ws.invites}
                  onGenerate={(roles) => {
                    const inv = generateInvite(ws, roles, me.name)
                    update((w) => ({ ...w, invites: [inv, ...w.invites] }))
                    log('Invitation code generated', `${inv.code} → ${roles.map((r) => roleDef(r).label).join(' + ')}`, 'nv', 'team')
                  }}
                />
              ) : (
                <p className="text-[13px] text-muted">Only owners and admins can create invitation codes.</p>
              )}
            </Panel>
            <Panel eyebrow="Invite by email" title="Add a member">
              {canEdit ? <InviteMemberForm members={ws.members} setMembers={setMembers} onEvent={onEvent} /> : <p className="text-[13px] text-muted">Only owners and admins can invite members.</p>}
            </Panel>
          </div>
        )}
        {tab === 'roles' && (
          <div className="grid gap-4 @6xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel eyebrow="Module + action + data scope" title="Role grants in use">
              <RoleGrantsTable roles={rolesInUse} tenant={ws.tenant} />
            </Panel>
            <Panel eyebrow="Derived · preview only" title="Who can open what">
              <PermissionMatrix tenant={ws.tenant} members={ws.members} />
              <p className="mt-3 text-xs text-muted">The matrix mirrors what FastAPI computes from its own role store; the browser never sends roles as authority.</p>
            </Panel>
          </div>
        )}
        {tab === 'audit' && <AuditLog />}
      </TabPanel>
    </Page>
  )
}

const FILTERS: Array<{ id: 'all' | ViewId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'team', label: 'Team' },
  { id: 'data', label: 'Data & security' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'settings', label: 'Settings' },
]

function AuditLog() {
  const { ws } = useWorkspace()
  const [filter, setFilter] = useState<'all' | ViewId>('all')
  const rows = ws.audit.filter((e) => filter === 'all' || e.resource === filter)
  return (
    <Panel
      eyebrow="Mock audit trail · newest first"
      title={`${rows.length} events`}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cx('h-8 rounded-md border px-2.5 text-xs font-medium', filter === f.id ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg')}>
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted">
          <ListChecks className="size-4" aria-hidden /> No events for this filter yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <caption className="sr-only">Audit events</caption>
            <thead>
              <tr className="border-b border-line">
                {['Time', 'Actor', 'Event', 'Detail', 'Area'].map((h) => (
                  <th key={h} scope="col" className="eyebrow px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="num whitespace-nowrap px-3 py-2 text-fg-2">{e.time}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-fg-2">{e.actor}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex items-center gap-2 font-medium text-fg">
                      <StatusDot tone={e.tone} /> {e.action}
                    </span>
                  </td>
                  <td className="wrap-anywhere px-3 py-2 text-muted">{e.detail}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{e.resource ? navItem(e.resource).label : 'Admin'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
