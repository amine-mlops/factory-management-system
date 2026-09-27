import { ArrowRight, Ban, Cable, CircleX, Database, FileSearch, Network, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SystemMap } from '../components/map/SystemMap.tsx'
import { Drawer } from '../components/ui/Drawer.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Button, EmptyState, KpiCard, Panel } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import { DataPaths, PermissionSeparation } from '../components/workspace/Architecture.tsx'
import { ConnectorMonitor } from '../components/workspace/ConnectorMonitor.tsx'
import { GoldMappings, MedallionStrip, SourcesGrid } from '../components/workspace/PipelinePanel.tsx'
import { IncidentEvidence, IncidentTable } from '../components/workspace/Security.tsx'
import { can, isOwnerLike } from '../lib/access.ts'
import { summarize } from '../lib/expiry.ts'
import { cx } from '../lib/format.ts'
import { newestFirst } from '../lib/insights.ts'
import { useRoute, useTab } from '../lib/route.ts'
import { useOpsModel } from '../lib/useOps.ts'
import type { Connector, GoldDataset, SecurityIncident } from '../lib/workspace.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type DaTab = 'sources' | 'pipeline' | 'incidents'

interface Finding {
  id: string
  tone: 'crit' | 'warn'
  title: string
  detail: string
  fix?: string
  connector?: string
  target?: { view: 'inventory' | 'data'; tab: string }
}

/** Dense technical workspace: metadata, lineage and security evidence — never business records. */
export function DataArchitectView() {
  const { ws, perms } = useWorkspace()
  const model = useOpsModel()
  const findings = useFindings()
  const tabs: Array<TabDef<DaTab>> = [
    { id: 'sources', label: 'Sources', icon: Cable, badge: findings.length || undefined, badgeTone: findings.some((f) => f.tone === 'crit') ? 'crit' : 'warn', badgeLabel: `${findings.length} findings` },
    { id: 'pipeline', label: 'Pipeline Health', icon: Network },
    { id: 'incidents', label: 'Security Incidents', icon: ShieldAlert, badge: ws.incidents.length || undefined, badgeTone: 'crit', badgeLabel: `${ws.incidents.length} denied requests` },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const connected = ws.connectors.filter((c) => c.connected).length
  return (
    <Page wide>
      <PageHeader
        eyebrow={`Data architecture · ${ws.tenant.name}`}
        title="Data & pipelines"
        subtitle="Sources, validation, lineage and the security log. Configure access only — business records stay out of this view."
        right={
          <>
            <Badge tone="neutral">
              {connected}/{ws.connectors.length} sources connected
            </Badge>
            {model.staleSources > 0 && <Badge tone="warn">{model.staleSources} stale</Badge>}
            {!isOwnerLike(perms.roles) && !can(perms, 'transportation', 'read_records') && <Badge tone="info">Metadata only</Badge>}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Data sections" idBase="da" />
      <TabPanel idBase="da" id={tab}>
        {tab === 'sources' && <SourcesTab findings={findings} />}
        {tab === 'pipeline' && <PipelineTab />}
        {tab === 'incidents' && <IncidentsTab />}
      </TabPanel>
    </Page>
  )
}

function useFindings(): Finding[] {
  const { ws } = useWorkspace()
  return useMemo(() => {
    const out: Finding[] = []
    for (const c of ws.connectors.filter((x) => x.connected && x.lastRun.error)) {
      out.push({
        id: `c-${c.id}`,
        tone: c.lastRun.status === 'failed' ? 'crit' : 'warn',
        title: c.lastRun.status === 'failed' ? `${c.kind} refresh failed at ${c.lastRun.at}` : `${c.kind} validation warning`,
        detail: c.lastRun.error ?? '',
        fix: c.lastRun.action,
        connector: c.id,
      })
    }
    const ex = ws.expiry
    if (ex) {
      const s = summarize(ex, new Date())
      if (s.failingChecks)
        out.push({
          id: 'x-date',
          tone: 'warn',
          title: `Expiry feed: ${ex.feed.rejected.length} rows rejected`,
          detail: `${ex.feed.dataset}@${ex.feed.version} · check “expiry_date is a valid ISO date” failed; rows quarantined in Silver and excluded from agent scans.`,
          fix: 'Accept dd/mm/yyyy in the Silver contract or ask the WMS admin to export ISO dates; the month-13 row needs an upstream fix.',
          target: { view: 'inventory', tab: 'overview' },
        })
      if (s.warningChecks)
        out.push({ id: 'x-value', tone: 'warn', title: 'Expiry feed: valuation join warning', detail: ex.feed.checks.filter((c) => c.status === 'warn').map((c) => c.detail).join('; '), target: { view: 'inventory', tab: 'overview' } })
    }
    const stale = ws.gold.filter((g) => g.stale)
    for (const g of stale) out.push({ id: `g-${g.id}`, tone: 'warn', title: `${g.name} is stale`, detail: `Serving ${g.version} as of ${g.asOf}; consumers see a stale flag.` })
    return out
  }, [ws.connectors, ws.expiry, ws.gold])
}

function SourcesTab({ findings }: { findings: Finding[] }) {
  const { ws, perms, update } = useWorkspace()
  const { navigate } = useRoute()
  const [monitor, setMonitor] = useState<Connector | null>(null)
  const [separation, setSeparation] = useState(false)
  const canConfigure = can(perms, 'data', 'configure')
  const setConnectors = (fn: (c: Connector[]) => Connector[]) => update((w) => ({ ...w, connectors: fn(w.connectors) }))
  const dataset = (c: Connector) => (c.id === 'tms' ? ws.gold.find((g) => g.name === 'gold.shipments_eta') : c.id === 's3' ? ws.gold.find((g) => g.name === 'gold.supplier_scorecard') : ws.gold.find((g) => g.sources.includes(c.id)))
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Panel
        eyebrow="Mock connectors · credentials stay server-side"
        title="Source connectors"
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSeparation(true)}>
            Configure ≠ read
          </Button>
        }
      >
        <SourcesGrid connectors={ws.connectors} setConnectors={canConfigure ? setConnectors : undefined} />
        <p className="mt-3 text-xs text-muted">Connect / disconnect updates the demo store only. Row previews stay blocked without read access to the module.</p>
      </Panel>
      <Panel eyebrow="Stale & failed checks" title={findings.length ? `${findings.length} findings` : 'All checks passing'} bodyClassName="p-0">
        {findings.length === 0 ? (
          <EmptyState icon={Database} title="Nothing to fix">
            Every connector ran within SLA and passed validation.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {findings.map((f) => {
              const c = f.connector ? ws.connectors.find((x) => x.id === f.connector) : undefined
              return (
                <li key={f.id} className="px-4 py-3">
                  <p className="flex items-start gap-2 text-[13px] font-semibold text-fg">
                    {f.tone === 'crit' ? <CircleX className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
                    <span>
                      <span className="sr-only">{f.tone === 'crit' ? 'Critical: ' : 'Warning: '}</span>
                      {f.title}
                    </span>
                  </p>
                  <p className="wrap-anywhere mt-1 pl-6 text-xs text-muted">{f.detail}</p>
                  {f.fix && (
                    <p className="mt-1 flex items-start gap-1.5 pl-6 text-xs text-fg-2">
                      <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden /> {f.fix}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 pl-6">
                    {c && (
                      <Button size="sm" variant="ghost" icon={FileSearch} onClick={() => setMonitor(c)} aria-label={`Run details for ${c.kind}`}>
                        Run details
                      </Button>
                    )}
                    {f.target && perms.pages.has(f.target.view) && (
                      <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate(f.target!.view, f.target!.tab)}>
                        Open Expiry Guard checks
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      <Drawer open={!!monitor} onClose={() => setMonitor(null)} eyebrow="Monitored source" title={monitor?.name ?? ''} width="lg">
        {monitor && <ConnectorMonitor connector={monitor} dataset={dataset(monitor) as GoldDataset | undefined} level={3} className="border-0" />}
      </Drawer>
      <Drawer open={separation} onClose={() => setSeparation(false)} eyebrow="Permission model" title="Configure connection ≠ read business data" width="lg">
        <PermissionSeparation />
      </Drawer>
    </div>
  )
}

function PipelineTab() {
  const { ws, perms } = useWorkspace()
  const { navigate } = useRoute()
  const model = useOpsModel()
  return (
    <div className="space-y-4">
      <div className="grid gap-4 @6xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <SystemMap model={model} mode="technical" tenantName={ws.tenant.name} onOpen={(v, t) => navigate(v, t)} canOpenData={perms.pages.has('data')} />
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Pipeline figures" className="grid grid-cols-2 gap-3">
            <KpiCard label="Failed runs" value={model.kpis.data?.failed ?? 0} tone={model.kpis.data?.failed ? 'crit' : 'neutral'} delta="last cycle" deltaTone="info" />
            <KpiCard label="Stale datasets" value={model.kpis.data?.staleDatasets ?? 0} tone={model.kpis.data?.staleDatasets ? 'warn' : 'neutral'} delta="served with flag" deltaTone="info" />
            <KpiCard label="Rows quarantined" value={(model.kpis.data?.quarantined ?? 0) + ws.expiry.feed.rejected.length} delta="Silver validation" deltaTone="warn" />
            <KpiCard label="Gold datasets" value={ws.gold.length} delta={`${ws.gold.filter((g) => g.stale).length} stale`} deltaTone="info" />
          </section>
          <Panel eyebrow="Medallion" title="Bronze → Silver → Gold">
            <MedallionStrip connectors={ws.connectors} gold={ws.gold} enabledModules={ws.tenant.enabledModules} vertical />
          </Panel>
        </div>
      </div>
      <details className="panel group">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[13px] font-semibold text-fg">
          Data paths: records → Gold tables · documents → permission-tagged chunks
          <span className="text-xs font-normal text-muted group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-line p-4">
          <DataPaths />
        </div>
      </details>
      <details className="panel group">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[13px] font-semibold text-fg">
          Gold datasets → modules ({ws.gold.length})
          <span className="text-xs font-normal text-muted group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-line p-4">
          <GoldMappings gold={ws.gold} connectors={ws.connectors} enabledModules={ws.tenant.enabledModules} />
        </div>
      </details>
    </div>
  )
}

function IncidentsTab() {
  const { ws } = useWorkspace()
  const [filter, setFilter] = useState<'all' | SecurityIncident['stage']>('all')
  const [open, setOpen] = useState<SecurityIncident | null>(null)
  const all = newestFirst(ws.incidents)
  const rows = all.filter((i) => filter === 'all' || i.stage === filter)
  return (
    <div className="space-y-4">
      <section aria-label="Incident figures" className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <KpiCard label="Denied requests" value={all.length} tone={all.length ? 'crit' : 'neutral'} delta="all time (demo store)" deltaTone="info" />
        <KpiCard label="Pre-retrieval" value={all.filter((i) => i.stage === 'pre-retrieval').length} delta="AI queries blocked" deltaTone="info" />
        <KpiCard label="Route guard" value={all.filter((i) => i.stage === 'route').length} delta="direct page attempts" deltaTone="info" />
        <KpiCard label="Restricted chunks retrieved" value={all.reduce((s, i) => s + i.chunksRetrieved, 0)} tone="nv" delta="nothing sent to the model" deltaTone="nv" />
      </section>
      <Panel
        eyebrow="Real time · shared across personas"
        title="Security incident log"
        bodyClassName="p-0"
        actions={
          <div className="flex rounded-md border border-line-2 p-0.5" role="group" aria-label="Filter by stage">
            {(
              [
                ['all', 'All'],
                ['pre-retrieval', 'Pre-retrieval'],
                ['route', 'Route'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cx('h-8 rounded-sm px-2.5 text-xs font-medium', filter === id ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon={Ban} title="No denied requests">
            Ask a restricted question as a driver or procurement user to see the 403 path appear here.
          </EmptyState>
        ) : (
          <IncidentTable incidents={rows} onSelect={setOpen} newestId={all[0]?.id} />
        )}
      </Panel>
      <Drawer open={!!open} onClose={() => setOpen(null)} eyebrow="Security event · evidence" title="Denied request" width="lg">
        {open && <IncidentEvidence incident={open} />}
      </Drawer>
    </div>
  )
}
