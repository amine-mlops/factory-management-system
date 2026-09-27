import type { ViewId } from '../data/nav.ts'
import { can, roleDef, type Action, type EffectivePermissions, type UserId } from './access.ts'
import type { SecurityIncident } from './workspace.ts'

/**
 * Pre-retrieval authorization gate — LOCAL SIMULATION.
 *
 * Production (FastAPI /rag/query): resolve identity from the verified token,
 * classify the request's target resources, and deny BEFORE any vector search
 * or context construction when the caller lacks the required grant (default
 * deny). Denials return HTTP 403 and are written to the server-side security
 * log. NVIDIA NeMo Guardrails (architecture target) adds topical/tool-safety
 * rails on top — it complements, and never replaces, this ACL check.
 */

type Resource = ViewId | 'cross_tenant'

interface Rule {
  resource: Resource
  label: string
  pattern: RegExp
}

/** First match is the primary target; every matched resource must be authorized. */
const RULES: Rule[] = [
  { resource: 'cross_tenant', label: 'Another tenant (Borealis Foods)', pattern: /\bborealis\b|other (company|tenant)/i },
  { resource: 'crm', label: 'CRM · customer accounts & margins', pattern: /\b(crm|customers?|margins?|accounts?|cases?|churn)\b/i },
  { resource: 'procurement', label: 'Procurement · quotations & supplier pricing', pattern: /\b(procure\w*|purchase|po|suppliers?|pricing|prices?|contracts?|quot\w*|rfq\w*|award\w*)\b/i },
  // "expiry scan/feed/checks" is pipeline metadata, not lot records — excluded here so it classifies as data.
  { resource: 'inventory', label: 'Inventory · lots, expiry & stock', pattern: /\b(inventory|stock|spares?|reorder|lots?|shelf[- ]?life|fefo|perishabl\w*|markdowns?|expir(?:y|es|ed|ing|e)(?![- ](?:scans?|feeds?|checks?|rules?|pipelines?|agent)))\b/i },
  { resource: 'manufacturing', label: 'Manufacturing · lines & machinery', pattern: /\b(manufactur\w*|oee|pumps?|turbines?|compressors?|triage|cavitation)\b/i },
  { resource: 'settings', label: 'Company settings · payroll & admin', pattern: /\b(salary|salaries|payroll|admin\w*)\b/i },
  { resource: 'data', label: 'Data & pipelines · sources, lineage, security log', pattern: /\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|tms|wms|erp|s3|datasets?|incidents?|denied|security|scans?|feeds?|validation|rejected)\b/i },
  { resource: 'transportation', label: 'Transportation · shipments', pattern: /\b(routes?|delivery|deliveries|shipments?|loads?|stops?|etas?|handling|brief\w*|shift|driver|dispatch)\b/i },
]

/** What each resource requires. Modules need record access; aggregate views filter per module at retrieval. */
function required(r: ViewId): Action[] {
  if (r === 'data') return ['view', 'query_ai']
  if (r === 'settings') return ['manage']
  if (r === 'dashboard' || r === 'knowledge' || r === 'team' || r === 'triage') return ['view']
  return ['query_ai', 'read_records']
}

const LABELS: Partial<Record<ViewId, string>> = {
  dashboard: 'Company overview',
  knowledge: 'Knowledge base',
  team: 'Team & access',
  triage: 'Autonomous triage',
}

export interface GateDecision {
  allowed: boolean
  status: 200 | 403
  stage: 'pre-retrieval'
  resource: Resource
  resourceLabel: string
  reason: string
}

/** Words that make a question about pipeline metadata rather than business records. */
const TECHNICAL = /\b(pipelines?|connectors?|schemas?|ingest\w*|bronze|silver|gold|lineage|quarantin\w*|refresh\w*|feeds?|scans?|validation|freshness|datasets?|rejected)\b/i
const BUSINESS: ViewId[] = ['transportation', 'procurement', 'inventory', 'manufacturing', 'warehousing', 'distribution', 'crm', 'it']

export function authorizeQuery(query: string, perms: EffectivePermissions, context: ViewId): GateDecision {
  const d = classify(query, perms, context)
  // Data roles may ask how a module's feed behaves without reading its records: answer from pipeline
  // metadata only. Retrieval still drops every business record the caller cannot read.
  if (!d.allowed && BUSINESS.includes(d.resource as ViewId) && TECHNICAL.test(query) && can(perms, 'data', 'view') && can(perms, 'data', 'query_ai')) {
    return { allowed: true, status: 200, stage: 'pre-retrieval', resource: 'data', resourceLabel: 'Data & pipelines · metadata only', reason: `Metadata only — ${d.resourceLabel.split(' · ')[0]} records stay filtered at retrieval` }
  }
  return d
}

function classify(query: string, perms: EffectivePermissions, context: ViewId): GateDecision {
  const hits = RULES.filter((r) => r.pattern.test(query))
  const targets: Rule[] = hits.length ? hits : [{ resource: context, label: LABELS[context] ?? context, pattern: /./ }]
  const primary = targets[0]
  const deny = (r: Resource, label: string, reason: string): GateDecision => ({ allowed: false, status: 403, stage: 'pre-retrieval', resource: r, resourceLabel: label, reason })

  if (targets.some((t) => t.resource === 'cross_tenant')) {
    return deny('cross_tenant', 'Another tenant (Borealis Foods)', `Cross-tenant request — caller is bound to ${perms.tenantId}`)
  }
  for (const t of targets) {
    const r = t.resource as ViewId
    const missing = required(r).filter((a) => !can(perms, r, a))
    if (missing.length) {
      const name = t.label.split(' · ')[0]
      const why =
        perms.reason(r) === 'module_disabled'
          ? `${name} is not enabled for this company`
          : `${perms.roles.map((x) => roleDef(x).label).join(' + ')} lacks ${missing.join(' + ')} on ${name}`
      return deny(r, t.label, why)
    }
  }
  return { allowed: true, status: 200, stage: 'pre-retrieval', resource: primary.resource, resourceLabel: primary.label, reason: 'Authorized' }
}

export function incidentFor(query: string, d: GateDecision, perms: EffectivePermissions, user: { userId: UserId; name: string }): SecurityIncident {
  return {
    id: `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    tenantId: perms.tenantId,
    userId: user.userId,
    userName: user.name,
    roles: perms.roles,
    requestedResource: d.resourceLabel,
    query,
    decision: 'DENY',
    stage: 'pre-retrieval',
    reason: d.reason,
    chunksRetrieved: 0,
    sentToModel: false,
  }
}
