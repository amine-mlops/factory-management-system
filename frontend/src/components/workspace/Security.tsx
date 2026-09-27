import { Ban, CircleCheck, Cpu, FileSearch, ShieldCheck, UserRoundX } from 'lucide-react'
import { roleDef } from '../../lib/access.ts'
import { cx, fmtTime } from '../../lib/format.ts'
import { newestFirst } from '../../lib/insights.ts'
import type { SecurityIncident } from '../../lib/workspace.ts'
import { Badge, KeyValues } from '../ui/primitives.tsx'

const rolesOf = (i: SecurityIncident) => i.roles.map((r) => roleDef(r).label).join(' + ')

/** Compact incident list for summaries (owner security tab). */
export function IncidentList({ incidents, limit = 5, onSelect }: { incidents: SecurityIncident[]; limit?: number; onSelect?: (i: SecurityIncident) => void }) {
  const rows = newestFirst(incidents).slice(0, limit)
  if (!rows.length)
    return (
      <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted">
        <CircleCheck className="size-4 text-ok" aria-hidden /> No denied requests recorded.
      </p>
    )
  return (
    <ol className="divide-y divide-line" aria-live="polite">
      {rows.map((i) => {
        const body = (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-crit-line bg-crit-bg text-crit-2" aria-hidden>
              {i.stage === 'route' ? <UserRoundX className="size-4" /> : <Ban className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium text-fg">{i.userName}</span>
                <span className="text-muted">{rolesOf(i)}</span>
                <time className="num ml-auto text-xs text-muted" dateTime={i.at}>
                  {fmtTime(i.at)}
                </time>
              </span>
              <span className="wrap-anywhere mt-0.5 block text-[13px] text-fg-2">
                {i.requestedResource} · <span className="text-muted">“{i.query}”</span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="crit">403 · {i.stage}</Badge>
                <span className="num text-xs text-muted">{i.chunksRetrieved} chunks · not sent to model</span>
              </span>
            </span>
          </>
        )
        return (
          <li key={i.id}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(i)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-raised" aria-label={`Evidence for denied request by ${i.userName} at ${fmtTime(i.at)}`}>
                {body}
              </button>
            ) : (
              <div className="flex items-start gap-3 px-4 py-3">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Dense incident table for the Data Architect / security reviewer. Rows open an evidence drawer. */
export function IncidentTable({ incidents, onSelect, newestId }: { incidents: SecurityIncident[]; onSelect: (i: SecurityIncident) => void; newestId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-[13px]">
        <caption className="sr-only">Denied requests, newest first. Select a row to open the evidence.</caption>
        <thead>
          <tr className="border-b border-line">
            {['Time', 'User / roles', 'Requested resource', 'Stage', 'Reason', 'Retrieved', ''].map((h) => (
              <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-live="polite">
          {incidents.map((r) => (
            <tr key={r.id} className={cx('border-b border-line/60 last:border-0', r.id === newestId && 'bg-crit/[0.06]')}>
              <td className="num whitespace-nowrap px-3 py-2 text-fg-2">
                <time dateTime={r.at}>{fmtTime(r.at)}</time>
              </td>
              <td className="px-3 py-2">
                <p className="text-fg">{r.userName}</p>
                <p className="text-xs text-muted">{rolesOf(r)}</p>
              </td>
              <td className="px-3 py-2">
                <p className="text-fg-2">{r.requestedResource}</p>
                <p className="wrap-anywhere max-w-[260px] text-xs text-muted">“{r.query}”</p>
              </td>
              <td className="px-3 py-2">
                <Badge tone="crit">
                  <Ban className="size-3" aria-hidden /> 403 · {r.stage}
                </Badge>
              </td>
              <td className="wrap-anywhere max-w-[260px] px-3 py-2 text-fg-2">{r.reason}</td>
              <td className="num whitespace-nowrap px-3 py-2 text-fg-2">
                {r.chunksRetrieved} chunks
                <p className="text-xs text-muted">0 to model</p>
              </td>
              <td className="px-3 py-2 text-right">
                <button type="button" onClick={() => onSelect(r)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-control px-2.5 text-xs font-medium text-fg-2 hover:bg-raised hover:text-fg" aria-label={`Open evidence for ${r.userName} at ${fmtTime(r.at)}`}>
                  <FileSearch className="size-3.5" aria-hidden /> Evidence
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Evidence for one denial: every field the backend event would carry, plus the decision path. */
export function IncidentEvidence({ incident: i }: { incident: SecurityIncident }) {
  const steps: Array<[string, string, boolean]> = [
    ['Identity resolved', `${i.userName} · ${rolesOf(i)} · tenant ${i.tenantId}`, true],
    ['Target classified', i.requestedResource, true],
    ['ACL / grant check', `DENY — ${i.reason}`, false],
    ['Vector search', 'Skipped — no query was run', false],
    ['Context sent to model', 'Nothing — generation never started', false],
    ['Security event written', `${i.id} at ${fmtTime(i.at)}`, true],
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="crit">
          <Ban className="size-3" aria-hidden /> 403 {i.decision}
        </Badge>
        <Badge tone="neutral">{i.stage === 'route' ? 'Route guard' : 'Pre-retrieval gate'}</Badge>
      </div>
      <KeyValues
        items={[
          ['Time', <time key="t" className="num" dateTime={i.at}>{new Date(i.at).toLocaleString('en-GB', { hour12: false })}</time>],
          ['Tenant', <span key="tn" className="num">{i.tenantId}</span>],
          ['User', `${i.userName} (${i.userId})`],
          ['Roles', rolesOf(i)],
          ['Requested resource', i.requestedResource],
          ['Query / route', <span key="q" className="num">{i.query}</span>],
          ['Chunks retrieved', <span key="c" className="num">{i.chunksRetrieved}</span>],
          ['Sent to model', 'No'],
        ]}
      />
      <div>
        <p className="eyebrow mb-2">Decision path</p>
        <ol className="space-y-1.5">
          {steps.map(([k, v, ok], n) => (
            <li key={k} className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
              <span className="num w-5 shrink-0 text-muted">{n + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg">{k}</span>
                <span className={cx('wrap-anywhere block text-xs', ok ? 'text-muted' : 'text-crit-2')}>{v}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted">Local simulation of the FastAPI security event (GET /audit/security-events). In production this record is written server-side from the verified token — the browser cannot create or edit it.</p>
    </div>
  )
}

const MODEL: Array<[string, string, 'simulated' | 'target']> = [
  ['Default deny', 'A request is refused unless an effective grant includes the action.', 'simulated'],
  ['Tenant isolation', 'Tenant comes from the verified session — never from the request body.', 'simulated'],
  ['ACL before retrieval', 'Role, module and data-scope filters run before vector search.', 'simulated'],
  ['Audited denials', 'Every 403 writes a security event with 0 chunks retrieved.', 'simulated'],
  ['NVIDIA NeMo Guardrails', 'Topical and tool-use rails on top of — never instead of — the ACL.', 'target'],
]

export function AccessModel() {
  return (
    <ul className="space-y-2">
      {MODEL.map(([k, v, st]) => (
        <li key={k} className="flex items-start gap-2.5 text-[13px]">
          {st === 'target' ? <Cpu className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-medium text-fg">
              {k}
              <Badge tone={st === 'target' ? 'neutral' : 'info'}>{st === 'target' ? 'Architecture target' : 'Simulated in demo'}</Badge>
            </span>
            <span className="mt-0.5 block text-muted">{v}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
