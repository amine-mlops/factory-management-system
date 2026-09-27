import { ArrowLeft, ArrowRight, Building, CircleCheck, KeyRound, LogOut, Rocket, Sparkles, Users } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { StoryCards } from '../components/story/StoryCards.tsx'
import { RoleChips } from '../components/workspace/MembersPanel.tsx'
import { Logo } from '../components/ui/Logo.tsx'
import { Badge, Button, Eyebrow } from '../components/ui/primitives.tsx'
import { navItem } from '../data/nav.ts'
import { roleDef } from '../lib/access.ts'
import { joinWithCode, lookupInvite, membershipsFor, openDemoCompany, openMembership, previewPages } from '../lib/mockDb.ts'
import { DEMO_INVITES, type InviteCode, type Workspace } from '../lib/workspace.ts'
import type { Session } from './Login.tsx'

interface Props {
  session: Session
  onEnter: (ws: Workspace) => void
  onSetup: () => void
  onLogout: () => void
}

export function WorkspaceChoice({ session, onEnter, onSetup, onLogout }: Props) {
  const [mode, setMode] = useState<'choose' | 'join'>('choose')
  const memberships = membershipsFor(session.email)
  return (
    <main className="mx-auto flex min-h-screen max-w-[1180px] flex-col px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.18em] text-fg">NEXUS</p>
            <p className="eyebrow mt-1">Company workspaces</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right sm:block">
            <span className="block text-[13px] text-fg">{session.name}</span>
            <span className="block text-xs text-muted">{session.email}</span>
          </span>
          <button type="button" onClick={onLogout} className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-xs text-fg-2 hover:text-fg" aria-label="Sign out">
            <LogOut className="size-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-center py-10">
        {mode === 'choose' ? (
          <div className="animate-rise">
            <Eyebrow>Step 1 · Choose a path</Eyebrow>
            <h1 className="mt-3 text-[28px] font-semibold tracking-tight text-fg">Welcome, {session.name.split(' ')[0]}. Where are you working today?</h1>
            <p className="mt-2 max-w-2xl text-base text-muted">Each company is an isolated tenant with its own modules, knowledge base, data sources and roles.</p>

            {memberships.length > 0 && (
              <div className="mt-6">
                <Eyebrow className="mb-2">Your companies</Eyebrow>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {memberships.map((m) => (
                    <li key={m.tenantId}>
                      <button
                        type="button"
                        onClick={() => {
                          const w = openMembership(m.tenantId, session.email)
                          if (w) onEnter(w)
                        }}
                        className="panel flex w-full items-center gap-3 px-4 py-3 text-left hover:border-accent/60"
                      >
                        <Building className="size-4 shrink-0 text-accent" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">{m.tenantName}</span>
                          <span className="block truncate text-xs text-muted">{m.roles.map((r) => roleDef(r).label).join(' + ')}</span>
                        </span>
                        <ArrowRight className="size-4 text-faint" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <ChoiceCard
                icon={<Users className="size-5" aria-hidden />}
                eyebrow="Invitation"
                title="Join a company"
                body="Enter an invite code or paste an invite link. You'll see the company and the roles you're being granted before you join."
                bullets={['Role-scoped navigation', 'Only the modules you were granted', 'Owner can adjust roles later']}
                cta="Join with invite"
                onClick={() => setMode('join')}
              />
              <ChoiceCard
                primary
                icon={<Building className="size-5" aria-hidden />}
                eyebrow="Owner onboarding"
                title="Set up your company"
                body="Create the workspace: profile, supply-chain scope, knowledge base, data architecture, and team access — in five guided steps."
                bullets={['Pick from 8 supply-chain domains', 'Index PDFs for RAG (simulated)', 'Bronze → Silver → Gold mappings']}
                cta="Start setup"
                onClick={onSetup}
              />
            </div>

            <button type="button" onClick={() => onEnter(openDemoCompany(session.name, session.email))} className="mt-6 flex min-h-10 items-center gap-2 rounded-md text-[13px] text-muted hover:text-accent-2">
              <Sparkles className="size-3.5" aria-hidden /> Skip — open the pre-configured demo company (Acme Process Industries, all modules)
              <ArrowRight className="size-3.5" aria-hidden />
            </button>

            <section aria-labelledby="why-nexus" className="mt-10 border-t border-line pt-6">
              <h2 id="why-nexus" className="eyebrow mb-3">
                Why NEXUS
              </h2>
              <StoryCards compact className="lg:grid-cols-4" />
            </section>
          </div>
        ) : (
          <JoinFlow session={session} onBack={() => setMode('choose')} onEnter={onEnter} />
        )}
      </div>
      <p className="text-center text-xs text-faint">Demo workspace flows run entirely on local mock state — no invitations are sent and no data leaves the browser.</p>
    </main>
  )
}

function ChoiceCard(p: { icon: ReactNode; eyebrow: string; title: string; body: string; bullets: string[]; cta: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className={
        'panel brackets group flex flex-col p-6 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 ' +
        (p.primary ? 'border-accent/40 hover:border-accent/70' : 'hover:border-control')
      }
    >
      <span className={'grid size-11 place-items-center rounded-lg border ' + (p.primary ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line-2 text-fg-2')}>{p.icon}</span>
      <Eyebrow className="mt-5">{p.eyebrow}</Eyebrow>
      <span className="mt-2 text-[22px] font-semibold tracking-tight text-fg">{p.title}</span>
      <span className="mt-2 text-sm leading-relaxed text-muted">{p.body}</span>
      <ul className="mt-4 space-y-1.5">
        {p.bullets.map((b) => (
          <li key={b} className="flex items-center gap-2 text-[13px] text-fg-2">
            <CircleCheck className="size-3.5 text-accent" aria-hidden /> {b}
          </li>
        ))}
      </ul>
      <span className={'mt-6 inline-flex items-center gap-2 self-start rounded-md px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.12em] ' + (p.primary ? 'bg-accent text-on-accent' : 'border border-line-2 text-fg')}>
        {p.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  )
}

function JoinFlow({ session, onBack, onEnter }: { session: Session; onBack: () => void; onEnter: (ws: Workspace) => void }) {
  const [code, setCode] = useState('')
  const [found, setFound] = useState<{ invite: InviteCode; ws: Workspace | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = (e?: FormEvent, value = code) => {
    e?.preventDefault()
    const f = lookupInvite(value)
    setFound(f)
    setError(f ? null : 'Invite not recognized. Codes are case-insensitive — use a code your owner generated, or a demo code below.')
  }

  const tenantName = found?.ws?.tenant.name ?? 'Acme Process Industries'
  const pages = found ? previewPages(found.ws, found.invite.roles) : []
  const join = () => {
    const r = joinWithCode(code, session.name, session.email)
    if (r) onEnter(r.ws)
    else setError('This invite could not be redeemed.')
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-rise">
      <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" aria-hidden /> Back
      </button>
      <div className="panel p-6">
        <Eyebrow>Join a company workspace</Eyebrow>
        <h1 className="mt-2 text-[22px] font-semibold text-fg">Enter your invitation code or link</h1>
        <form onSubmit={check} className="mt-5 flex gap-2">
          <div className="flex flex-1 items-center gap-2.5 rounded-md border border-line-2 bg-deck/80 pl-3 focus-within:border-accent/70">
            <KeyRound className="size-4 text-faint" aria-hidden />
            <input
              aria-label="Invitation code or link"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ACME-DRV-7K2Q or https://…/join?code=…"
              className="num w-full bg-transparent py-2.5 pr-3 text-sm text-fg outline-none placeholder:text-faint"
            />
          </div>
          <button type="submit" className="rounded-md border border-line-2 px-4 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-fg hover:border-control">
            Check
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
          Demo codes:
          {DEMO_INVITES.map((i) => (
            <button
              key={i.code}
              type="button"
              onClick={() => {
                setCode(i.code)
                check(undefined, i.code)
              }}
              className="num rounded-sm border border-line px-2 py-0.5 text-fg-2 hover:border-accent/60 hover:text-accent"
            >
              {i.code}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-warn">
            {error}
          </p>
        )}

        {found && (
          <div className="mt-6 animate-rise rounded-lg border border-accent/40 bg-accent/[0.05] p-4" aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow className="text-accent">Invitation found · local mock of POST /invites/accept</Eyebrow>
                <p className="mt-2 text-lg font-semibold text-fg">{tenantName}</p>
                <p className="text-[13px] text-muted">
                  Code <span className="num text-fg-2">{found.invite.code}</span> · issued by {found.invite.createdBy}
                </p>
              </div>
              <Badge tone="nv" dot>
                Valid
              </Badge>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="eyebrow mb-2">Your roles</p>
                <RoleChips roles={found.invite.roles} />
              </div>
              <div>
                <p className="eyebrow mb-2">You will see</p>
                <p className="flex flex-wrap gap-1">
                  {pages.map((p) => (
                    <Badge key={p} tone="neutral" className="normal-case tracking-normal">
                      {navItem(p).label}
                    </Badge>
                  ))}
                </p>
              </div>
            </div>
            <Button variant="primary" icon={Rocket} onClick={join} className="mt-5 h-11 w-full">
              Join {tenantName}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
