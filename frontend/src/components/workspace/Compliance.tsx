import { PlayCircle, ScrollText, Wand2 } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { can } from '../../lib/access.ts'
import { describeError } from '../../lib/api.ts'
import type { AuditRunResponse, Rule, Violation } from '../../lib/apiContract.ts'
import type { Tone } from '../../lib/format.ts'
import { useNotify } from '../../lib/toast.ts'
import { useWorkspace } from '../../lib/workspaceContext.ts'
import { Badge, Button, EmptyState, Panel } from '../ui/primitives.tsx'

const SEVERITY_TONE: Record<Rule['severity'], Tone> = { CRITICAL: 'crit', WARNING: 'warn', INFO: 'info' }
const EXAMPLE = 'Flag any dairy batch in transit over 4°C for more than 12h'

const describe = (r: Rule) =>
  r.conditions.map((c) => `${c.field} ${c.op} ${c.value ?? c.field_ref ?? c.param ?? ''}`).join(' AND ')

/**
 * Intent-driven auditing (AGENTS.md "Audit.jsx"): plain-English policy → compiled rule →
 * operational audit. Live mode only — rules and evaluation run in FastAPI against DuckDB.
 */
export function ComplianceTab() {
  const { perms, live, commit } = useWorkspace()
  const notify = useNotify()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'compile' | 'run' | null>(null)
  const [result, setResult] = useState<AuditRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = { t: useId(), e: useId() }
  const canEdit = can(perms, 'settings', 'manage') || can(perms, 'inventory', 'manage')

  useEffect(() => {
    if (!live) return
    let alive = true
    live
      .listRules()
      .then((r) => alive && setRules(r))
      .catch((err) => alive && setError(describeError(err)))
    return () => {
      alive = false
    }
  }, [live])

  if (!live) {
    return (
      <Panel eyebrow="Autonomous auditing" title="Compliance">
        <EmptyState icon={ScrollText} title="Runs on the FastAPI backend">
          <p className="max-w-md text-[13px] text-muted">Set VITE_USE_MOCK=false and start the API (make dev) to compile policies into rules and run operational audits.</p>
        </EmptyState>
      </Panel>
    )
  }

  const compile = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return setError('Describe the policy in a sentence.')
    setBusy('compile')
    setError(null)
    try {
      const rule = await live.compileRule(text.trim())
      setRules((r) => [...(r ?? []), rule])
      setText('')
      notify(`${rule.id} saved · ${rule.severity}`, 'nv')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (rule: Rule) => {
    try {
      const next = await live.setRuleActive(rule.id, !rule.active)
      setRules((r) => (r ?? []).map((x) => (x.id === next.id ? next : x)))
    } catch (err) {
      notify(describeError(err), 'crit')
    }
  }

  const run = async () => {
    setBusy('run')
    try {
      const r = await live.runAudit()
      setResult(r)
      const crit = r.violations.filter((v) => v.severity === 'CRITICAL').length
      notify(`Audit complete · ${r.total_rules_evaluated} rules · ${r.violations.length} violated${crit ? ` (${crit} critical)` : ''}`, crit ? 'crit' : 'nv')
      await commit(live.snapshot()) // refreshes the audit trail and the global anomaly banner
    } catch (err) {
      notify(describeError(err), 'crit')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel eyebrow="Intent → rule · POST /api/audit/rules/compile" title="Describe a policy">
          {canEdit ? (
            <form onSubmit={compile} noValidate aria-describedby={error ? ids.e : undefined} className="space-y-2.5">
              <label htmlFor={ids.t} className="block text-xs font-medium text-muted">
                Plain-English policy — compiled into a structured rule and saved to rules.json
              </label>
              <textarea
                id={ids.t}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={EXAMPLE}
                className="w-full rounded-md border border-field bg-deck px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" variant="primary" icon={Wand2} disabled={busy !== null}>
                  {busy === 'compile' ? 'Compiling…' : 'Compile rule'}
                </Button>
                <button type="button" onClick={() => setText(EXAMPLE)} className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
                  Use example
                </button>
              </div>
              {error && (
                <p id={ids.e} role="alert" className="text-[13px] text-warn">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <p className="text-[13px] text-muted">Compiling rules needs manage on Settings or Inventory. You can still run the audit and see violations you are allowed to read.</p>
          )}
        </Panel>

        <Panel eyebrow={`Registry · ${rules?.length ?? '…'} rules`} title="Active rules" bodyClassName="p-0">
          {!rules ? (
            <p className="px-4 py-4 text-[13px] text-muted">{error ? 'Rules unavailable.' : 'Loading rules…'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <caption className="sr-only">Audit rules with severity, source and active state</caption>
                <thead>
                  <tr className="border-b border-line bg-deck">
                    {['Rule', 'Severity', 'Source', 'Active'].map((h) => (
                      <th key={h} scope="col" className="eyebrow px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-line/60 last:border-0 align-top">
                      <td className="px-3 py-2">
                        <p className="text-fg">{r.label}</p>
                        <p className="num mt-0.5 text-xs text-muted">
                          {r.id} · {r.table} · {describe(r)}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{r.source}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.active}
                          aria-label={`${r.active ? 'Pause' : 'Activate'} ${r.id}`}
                          disabled={!canEdit}
                          onClick={() => void toggle(r)}
                          className={`relative h-5 w-9 rounded-full border transition-colors disabled:opacity-60 ${r.active ? 'border-accent bg-accent/30' : 'border-line-2 bg-deck'}`}
                        >
                          <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${r.active ? 'left-[18px] bg-accent' : 'left-0.5 bg-muted'}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="POST /api/audit/run · RBAC-filtered"
        title="Operational audit"
        actions={
          <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => void run()} disabled={busy !== null}>
            {busy === 'run' ? 'Running…' : 'Run operational audit'}
          </Button>
        }
      >
        {!result ? (
          <p className="text-[13px] text-muted">Evaluates every active rule against the live DuckDB gold layer. Critical violations raise the anomaly banner for everyone allowed to see them.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-fg-2">
              {result.status} · {result.total_rules_evaluated} rules evaluated · <strong className="text-fg">{result.violations.length}</strong> violated
            </p>
            {result.violations.length === 0 && <p className="text-[13px] text-ok">No violations in your permitted scope.</p>}
            {result.violations.map((v) => (
              <ViolationCard key={v.rule_id} v={v} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function ViolationCard({ v }: { v: Violation }) {
  const cols = [...new Set(v.affected_records.flatMap((r) => Object.keys(r)))].slice(0, 7)
  return (
    <section className="rounded-md border border-line bg-surface p-3" aria-label={`${v.rule_id} violations`}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[v.severity]}>{v.severity}</Badge>
        <span className="text-[13px] font-semibold text-fg">{v.label}</span>
        <span className="num text-xs text-muted">
          {v.rule_id} · {v.affected_records.length} record{v.affected_records.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="num w-full text-left text-[11px]">
          <caption className="sr-only">Affected records for {v.rule_id}</caption>
          <thead>
            <tr className="border-b border-line bg-deck">
              {cols.map((c) => (
                <th key={c} scope="col" className="whitespace-nowrap px-2 py-1 font-medium text-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.affected_records.map((r, i) => (
              <tr key={i} className="border-b border-line/60 last:border-0">
                {cols.map((c) => (
                  <td key={c} className={`whitespace-nowrap px-2 py-1 ${c === 'status' ? 'font-bold text-crit-2' : 'text-fg-2'}`}>
                    {r[c] === null || r[c] === undefined ? '—' : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
