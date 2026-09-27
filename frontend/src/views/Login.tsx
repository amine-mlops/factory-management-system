import { ArrowRight, Eye, EyeOff, Info, KeyRound, LoaderCircle, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { StoryCards } from '../components/story/StoryCards.tsx'
import { Logo } from '../components/ui/Logo.tsx'
import { cx, delay } from '../lib/format.ts'
import { prefersReducedMotion } from '../lib/useNow.ts'

export interface Session {
  name: string
  email: string
  role: string
  initials: string
}

const DEMO_CREDENTIALS = { email: 'operator@nexus-demo.io', password: 'brev-a100' }

const DEMO_SESSION: Session = { name: 'Alex Moreno', email: DEMO_CREDENTIALS.email, role: 'Owner · demo company', initials: 'AM' }

function sessionFor(email: string): Session {
  if (email.toLowerCase() === DEMO_CREDENTIALS.email) return DEMO_SESSION
  const local = email.split('@')[0] ?? 'operator'
  const parts = local.split(/[._-]+/).filter(Boolean)
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || 'Operator'
  const initials = (parts[0]?.[0] ?? 'O').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
  return { name, email, role: 'Member', initials }
}

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState(DEMO_CREDENTIALS.email)
  const [password, setPassword] = useState(DEMO_CREDENTIALS.password)
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null)

  const enter = async (session: Session, mode: 'form' | 'demo') => {
    setBusy(mode)
    await delay(prefersReducedMotion() ? 0 : 520)
    onLogin(session)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid work email address.')
    if (password.length < 4) return setError('Password must be at least 4 characters.')
    setError(null)
    void enter(sessionFor(email.trim()), 'form')
  }

  return (
    <main className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Product story */}
      <section className="hidden flex-col justify-between gap-8 border-r border-line bg-deck/60 px-10 py-10 lg:flex xl:px-14" aria-labelledby="story-title">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-mono text-base font-semibold tracking-[0.16em] text-fg">NEXUS</p>
            <p className="text-xs text-muted">Supply-chain operations workspace</p>
          </div>
        </div>
        <div className="max-w-2xl">
          <h1 id="story-title" className="text-[28px] font-semibold leading-tight tracking-tight text-fg">
            The right operational answer for every role — and nothing more.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-2">A modular, multi-tenant workspace for industrial teams: dashboards, briefings and a cited assistant grounded only in each person’s authorized company facts.</p>
          <StoryCards compact className="mt-6" />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted">
          <Info className="size-3.5 shrink-0" aria-hidden /> Demo environment — sign-in, company data and AI answers are simulated locally in this browser.
        </p>
      </section>

      {/* Auth side */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px] animate-rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <p className="font-mono text-base font-semibold tracking-[0.18em] text-fg">NEXUS</p>
          </div>

          <div className="panel p-7">
            <p className="eyebrow">Demo sign-in</p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-fg">Sign in to NEXUS</h2>
            <p className="mt-1.5 text-sm text-muted">Authentication is simulated locally — use any work email or the demo account.</p>

            <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
              <Field id="email" label="Work email" icon={<Mail className="size-4" aria-hidden />}>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent py-2.5 pr-3 text-base text-fg outline-none placeholder:text-faint"
                  placeholder="name@company.com"
                  aria-invalid={error?.includes('email') || undefined}
                />
              </Field>
              <Field id="password" label="Password" icon={<Lock className="size-4" aria-hidden />}>
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent py-2.5 text-base text-fg outline-none placeholder:text-faint"
                  placeholder="••••••••"
                  aria-invalid={error?.includes('Password') || undefined}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="mr-1 rounded-sm p-1.5 text-muted hover:text-fg"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </Field>

              <p role="alert" className={cx('min-h-5 text-sm text-crit', !error && 'invisible')}>
                {error ?? '—'}
              </p>

              <button
                type="submit"
                disabled={busy !== null}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-control bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-overlay disabled:opacity-60"
              >
                {busy === 'form' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
                {busy === 'form' ? 'Authenticating…' : 'Sign in'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              <span className="eyebrow">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <button
              type="button"
              onClick={() => void enter(DEMO_SESSION, 'demo')}
              disabled={busy !== null}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-70"
            >
              {busy === 'demo' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
              {busy === 'demo' ? 'Opening workspace…' : 'Enter demo workspace'}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>

            <div className="mt-6 rounded-md border border-dashed border-line-2 px-3.5 py-3 text-xs text-muted">
              <p className="eyebrow mb-2">Demo credentials</p>
              <p className="num text-fg-2">
                {DEMO_CREDENTIALS.email} <span className="text-faint">/</span> {DEMO_CREDENTIALS.password}
              </p>
            </div>
          </div>

          <div className="mt-6 lg:hidden">
            <StoryCards compact />
          </div>
        </div>
      </section>
    </main>
  )
}

function Field({ id, label, icon, children }: { id: string; label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2.5 rounded-md border border-field bg-deck pl-3 transition-colors focus-within:border-accent">
        <span className="text-faint">{icon}</span>
        {children}
      </div>
    </div>
  )
}
