import { Ban, Bot, CircleAlert, Clock, Database, FileText, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { AnswerView, AskOutcome } from '../../lib/assistant.ts'
import { cx } from '../../lib/format.ts'
import type { GateDecision } from '../../lib/guard.ts'
import type { SecurityIncident } from '../../lib/workspace.ts'
import { Badge, Button } from '../ui/primitives.tsx'

export function LoadingBlock({ label = 'Checking access, then retrieving permitted sources…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-3 text-[13px] text-muted" role="status" aria-live="polite">
      <LoaderCircle className="size-4 animate-spin text-info" aria-hidden />
      {label}
    </div>
  )
}

export function AnswerBody({ view, source, resourceLabel, compact }: { view: AnswerView; source: 'local' | 'live'; resourceLabel: string; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="nv">
          <ShieldCheck className="size-3" aria-hidden /> 200 · authorized
        </Badge>
        <Badge tone="neutral">{resourceLabel.split(' · ')[0]}</Badge>
        <Badge tone="info">{source === 'live' ? 'FastAPI /rag/query' : 'Local simulation'}</Badge>
      </div>
      {view.staleNotice && (
        <p className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Stale data · </strong>
            {view.staleNotice}
          </span>
        </p>
      )}
      <div className="space-y-2 text-sm leading-relaxed text-fg-2">
        {view.sentences.map((s, i) => (
          <p key={i}>
            {s.text}
            {s.cites.map((c) => (
              <sup key={c} className="num ml-0.5 rounded-sm border border-info/40 bg-info/10 px-1 text-[11px] font-bold text-info" aria-label={`source ${c}`}>
                {c}
              </sup>
            ))}
          </p>
        ))}
        {view.gaps.map((g) => (
          <p key={g} className="flex items-start gap-2 rounded-md border border-line-2 bg-raised px-3 py-2 text-[13px] text-fg-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> {g}
          </p>
        ))}
      </div>
      {view.citations.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Sources</p>
          <ol className="space-y-1">
            {view.citations.map((c) => (
              <li key={c.n} className="flex items-center gap-2 rounded-sm border border-line-2 bg-raised px-2 py-1 text-xs shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]">
                <span className="num grid h-5 min-w-5 shrink-0 place-items-center rounded-sm border border-info/40 bg-info/10 px-1 font-bold text-info">{c.n}</span>
                {c.kind === 'pdf' ? <FileText className="size-3.5 shrink-0 text-info" aria-hidden /> : <Database className="size-3.5 shrink-0 text-info" aria-hidden />}
                <span className="num wrap-anywhere min-w-0 flex-1 text-fg-2">
                  {c.label.split(' · p.')[0]}
                  {c.label.includes(' · p.') && <strong className="ml-1 font-bold text-fg">p.{c.label.split(' · p.')[1]}</strong>}
                </span>
                <span className="num flex shrink-0 items-center gap-1 text-muted">
                  <Clock className="size-3" aria-hidden />
                  {c.updatedAt}
                </span>
                {c.stale && <Badge tone="warn">Stale</Badge>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!compact && (
        <details className="group rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer select-none font-medium text-fg-2">How this answer was filtered</summary>
          <ol className="num mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Candidates', view.trace.candidates],
                ['→ Tenant', view.trace.afterTenant],
                ['→ Role / module', view.trace.afterPermission],
                ['→ Data scope', view.trace.afterScope],
              ] as const
            ).map(([k, v]) => (
              <li key={k} className="rounded-sm border border-line px-2 py-1.5">
                <span className="block text-muted">{k}</span>
                <span className="text-sm font-semibold text-fg">{v}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2">Filters run before any text is composed. In production FastAPI applies them inside the vector query; cached answers are keyed by tenant + user + grants.</p>
          <p className="mt-2 font-medium text-fg-2">FastAPI /rag/query response shape</p>
          <pre className="terminal wrap-anywhere mt-1 max-h-44 overflow-auto whitespace-pre-wrap p-2 text-[11px]">{JSON.stringify(view.response, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

export function DeniedBlock({ decision, incident, query }: { decision: GateDecision; incident: SecurityIncident; query?: string }) {
  return (
    <div role="alert" className="glow-crit rounded-lg border border-crit-line bg-crit-bg p-3.5">
      <p className="flex items-center gap-2 font-mono text-sm font-bold tracking-[0.04em] text-crit-2">
        <Ban className="size-4 shrink-0" aria-hidden /> 403 · PRE-RETRIEVAL ACCESS DENIED
      </p>
      <p className="mt-2 text-[13px] text-fg-2">
        {query ? <>“{query}” requested </> : 'Requested '}
        <strong className="font-semibold text-fg">{decision.resourceLabel}</strong>. {decision.reason}.
      </p>
      <ul className="mt-2.5 grid gap-1.5 text-xs sm:grid-cols-3">
        <li className="rounded-sm border border-crit-line bg-terminal px-2.5 py-1.5">
          <span className="block text-muted">Restricted chunks retrieved</span>
          <span className="num text-base font-bold text-fg">0</span>
        </li>
        <li className="rounded-sm border border-crit-line bg-terminal px-2.5 py-1.5">
          <span className="block text-muted">Sent to the model</span>
          <span className="text-sm font-bold text-fg">Nothing</span>
        </li>
        <li className="rounded-sm border border-crit-line bg-terminal px-2.5 py-1.5">
          <span className="block text-muted">Security incident</span>
          <span className="num wrap-anywhere text-xs font-semibold text-fg">{incident.id}</span>
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted">
        Blocked by the metadata ACL check before vector search or context construction · logged {new Date(incident.at).toLocaleTimeString('en-GB', { hour12: false })} for {incident.tenantId}.
      </p>
    </div>
  )
}

export function ErrorBlock({ message, onRetry, fallback, resourceLabel }: { message: string; onRetry?: () => void; fallback: AnswerView; resourceLabel: string }) {
  return (
    <div className="space-y-3">
      <div role="alert" className="rounded-lg border border-warn-line bg-warn-bg p-3 text-[13px] text-fg-2">
        <p className="flex items-center gap-2 font-semibold text-warn">
          <TriangleAlert className="size-4" aria-hidden /> Couldn't reach FastAPI /rag/query
        </p>
        <p className="mt-1 text-muted">{message}. Showing the local simulation below instead.</p>
        {onRetry && (
          <Button size="sm" className="mt-2" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      <AnswerBody view={fallback} source="local" resourceLabel={resourceLabel} compact />
    </div>
  )
}

export function OutcomeBlock({ outcome, query, onRetry, compact }: { outcome: AskOutcome; query?: string; onRetry?: () => void; compact?: boolean }) {
  if (outcome.kind === 'denied') return <DeniedBlock decision={outcome.decision} incident={outcome.incident} query={query} />
  if (outcome.kind === 'error') return <ErrorBlock message={outcome.message} onRetry={onRetry} fallback={outcome.fallback} resourceLabel={outcome.resourceLabel} />
  return <AnswerBody view={outcome.view} source={outcome.source} resourceLabel={outcome.resourceLabel} compact={compact} />
}

export function BotAvatar({ className }: { className?: string }) {
  return (
    <span className={cx('grid size-7 shrink-0 place-items-center rounded-md border border-accent/40 bg-accent/10', className)} aria-hidden>
      <Bot className="size-4 text-accent" />
    </span>
  )
}
