import { ArrowRight, Award, Ban, BadgeCheck, CircleCheck, Clock, FileText, FileWarning, LayoutDashboard, RotateCcw, Scale, ShieldAlert, Sparkles, TrendingDown, TriangleAlert, Truck, Undo2, Users } from 'lucide-react'
import { useState } from 'react'
import { AssistantPanel } from '../components/assistant/AssistantPanel.tsx'
import { Drawer } from '../components/ui/Drawer.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, Button, KeyValues, KpiCard, Meter, Panel } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import type { Quotation, Supplier } from '../data/procurement.ts'
import { can } from '../lib/access.ts'
import { canDecide, decideAction, supplierReturnsFor, type SupplierReturnView } from '../lib/expiry.ts'
import { cx, fmtTime, fmtUsd, type Tone } from '../lib/format.ts'
import { useRoute, useTab } from '../lib/route.ts'
import { useNotify } from '../lib/toast.ts'
import { useLocalBrief } from '../lib/useAsk.ts'
import { useOpsModel } from '../lib/useOps.ts'
import type { Workspace } from '../lib/workspace.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type PrTab = 'overview' | 'suppliers' | 'quotations' | 'ai'

const STATUS_TONE: Record<Quotation['status'], Tone> = { Received: 'info', 'Under review': 'warn', Clarification: 'neutral', Awarded: 'nv' }
const RATING_TONE: Record<Supplier['rating'], Tone> = { Preferred: 'nv', Approved: 'info', Probation: 'warn' }

/** Everything the procurement tabs share: RFQs, best-value flags, citation status and the guarded award action. */
function useProcurement() {
  const { ws, perms, update, log, me } = useWorkspace()
  const notify = useNotify()
  const returns = supplierReturnsFor(ws.expiry, perms, new Date())
  const decideReturn = (r: SupplierReturnView, status: 'approved' | 'dismissed' | 'proposed') => {
    if (!canDecide(perms, r.action)) return
    update((w) => ({ ...w, expiry: decideAction(w.expiry, r.action.id, status, me.email.split('@')[0] || me.name, new Date()) }))
    const verb = status === 'approved' ? 'approved' : status === 'dismissed' ? 'dismissed' : 'reopened'
    log(`Supplier return ${verb}`, `${r.action.id} · ${r.action.title}${status === 'approved' ? ' · supplier hand-off queued (simulated — nothing sent)' : ''}`, status === 'approved' ? 'nv' : 'info', 'procurement')
    notify(`${r.action.id} ${verb}${status === 'approved' ? ' — hand-off queued (simulated)' : ''}`, status === 'approved' ? 'nv' : 'info')
  }
  const manage = can(perms, 'procurement', 'manage')
  const indexed = new Set(ws.documents.filter((d) => d.status === 'indexed').map((d) => d.name))
  const rfqs = [...new Set(ws.quotations.map((q) => q.rfq))]
  const sup = (id: string) => ws.suppliers.find((s) => s.id === id)
  const award = (q: Quotation) => {
    if (!manage) return
    update((w) => ({ ...w, quotations: w.quotations.map((x) => (x.rfq === q.rfq && x.item === q.item ? { ...x, status: x.id === q.id ? 'Awarded' : 'Received' } : x)) }))
    log('Quotation awarded', `${q.id} (${sup(q.supplierId)?.name}) for ${q.rfq} — PO draft created (demo)`, 'nv', 'procurement')
    notify(`Awarded ${q.id} · purchase-order draft created (demo)`, 'nv')
  }
  return { ws, manage, indexed, rfqs, sup, award, returns, decideReturn, canDecideReturn: (r: SupplierReturnView) => canDecide(perms, r.action) }
}

type PrCtl = ReturnType<typeof useProcurement>

/** Best-value flags per item group: lowest unit price and shortest lead time (never color alone — icon + text). */
function flagsFor(quotes: Quotation[]) {
  const byItem = new Map<string, Quotation[]>()
  for (const q of quotes) byItem.set(q.item, [...(byItem.get(q.item) ?? []), q])
  const cheapest = new Set<string>()
  const fastest = new Set<string>()
  for (const group of byItem.values()) {
    if (group.length < 2) continue
    const minP = Math.min(...group.map((q) => q.unitPrice))
    const minL = Math.min(...group.map((q) => q.leadTimeDays))
    group.forEach((q) => {
      if (q.unitPrice === minP) cheapest.add(q.id)
      if (q.leadTimeDays === minL) fastest.add(q.id)
    })
  }
  return { cheapest, fastest }
}

function approvalNeeds(q: Quotation, s: Supplier | undefined): string[] {
  const out: string[] = []
  if (s?.rating === 'Probation') out.push('Supplier on probation → procurement-director approval')
  const pre = q.terms.match(/Prepayment (\d+)%/)
  if (pre && Number(pre[1]) > 30) out.push(`Prepayment ${pre[1]}% (> 30%) → procurement-director approval`)
  return out
}

export function ProcurementView() {
  const ctl = useProcurement()
  const model = useOpsModel()
  const [evidence, setEvidence] = useState<string | null>(null)
  const [supplier, setSupplier] = useState<string | null>(null)
  const awaiting = ctl.ws.quotations.filter((q) => q.status !== 'Awarded').length
  const tabs: Array<TabDef<PrTab>> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'suppliers', label: 'Suppliers', icon: Users },
    { id: 'quotations', label: 'Quotations', icon: Scale, badge: awaiting || undefined, badgeTone: 'warn', badgeLabel: `${awaiting} awaiting decision` },
    { id: 'ai', label: 'AI Comparison', icon: Sparkles },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))
  const q = ctl.ws.quotations.find((x) => x.id === evidence) ?? null
  const s = ctl.ws.suppliers.find((x) => x.id === supplier) ?? null

  return (
    <Page>
      <PageHeader
        eyebrow={`Procurement · ${ctl.ws.tenant.name}`}
        title="Suppliers & quotations"
        subtitle="Quotation facts are extracted from uploaded PDFs; every AI recommendation cites the page it used."
        right={
          <>
            <Badge tone="nv">Integrated module</Badge>
            <Badge tone={ctl.manage ? 'nv' : 'neutral'}>{ctl.manage ? 'Can award' : 'View only'}</Badge>
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Procurement sections" idBase="pr" />
      <TabPanel idBase="pr" id={tab}>
        {tab === 'overview' && <Overview ctl={ctl} model={model} onEvidence={setEvidence} />}
        {tab === 'suppliers' && <SuppliersTab ctl={ctl} onOpen={setSupplier} />}
        {tab === 'quotations' && <QuotationsTab ctl={ctl} onEvidence={setEvidence} />}
        {tab === 'ai' && <AiTab ctl={ctl} />}
      </TabPanel>
      <Drawer open={!!q} onClose={() => setEvidence(null)} eyebrow={q ? `${q.rfq} · comparison evidence` : undefined} title={q ? `${q.id} · ${ctl.sup(q.supplierId)?.name ?? ''}` : ''} width="lg" footer={q && ctl.manage && q.status !== 'Awarded' && <Button variant="primary" icon={Award} onClick={() => { ctl.award(q); setEvidence(null) }}>Award {q.id}</Button>}>
        {q && <QuoteEvidence q={q} ctl={ctl} />}
      </Drawer>
      <Drawer open={!!s} onClose={() => setSupplier(null)} eyebrow="Supplier" title={s?.name ?? ''}>
        {s && <SupplierDetails s={s} ctl={ctl} />}
      </Drawer>
    </Page>
  )
}

/* ------------------------------------------------------------ overview */

function Overview({ ctl, model, onEvidence }: { ctl: PrCtl; model: ReturnType<typeof useOpsModel>; onEvidence: (id: string) => void }) {
  const p = model.kpis.procurement
  const { setTab } = useRoute()
  const brief = useLocalBrief('Compare quotations for RFQ-2291', 'procurement')
  const exceptions = exceptionsFor(ctl.ws, ctl.indexed)
  return (
    <div className="space-y-4">
      {p && (
        <section aria-label="Procurement figures" className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <KpiCard label="Open RFQs" value={p.rfqs} delta={`${ctl.ws.quotations.length} quotations`} deltaTone="info" />
          <KpiCard label="Awaiting decision" value={p.awaiting} tone={p.awaitingValue ? 'warn' : 'neutral'} delta={p.awaitingValue ? `${fmtUsd(p.awaitingValue, false)} urgent` : 'nothing urgent'} deltaTone={p.awaitingValue ? 'warn' : 'nv'} />
          <KpiCard label="Suppliers" value={p.suppliers} delta={`${ctl.ws.suppliers.filter((s) => s.rating === 'Preferred').length} preferred`} deltaTone="nv" />
          <KpiCard label="Average OTIF" value={p.avgOtif} unit="%" delta="rolling 90 days" deltaTone="info" />
        </section>
      )}
      {ctl.returns.length > 0 && <SupplierReturns ctl={ctl} />}
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel eyebrow="Needs a decision" title={`${exceptions.length} exceptions`} bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {exceptions.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-4 py-3">
                <x.icon className={cx('mt-0.5 size-4 shrink-0', x.tone === 'warn' ? 'text-warn' : x.tone === 'crit' ? 'text-crit' : 'text-info')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-fg">{x.title}</span>
                  <span className="wrap-anywhere block text-xs text-muted">{x.detail}</span>
                </span>
                {x.quote && (
                  <Button size="sm" variant="ghost" onClick={() => onEvidence(x.quote!)} aria-label={`Evidence for ${x.quote}`}>
                    Evidence
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <section className="panel flex min-w-0 flex-col border-l-2 border-l-accent" aria-labelledby="rec-title">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div>
              <p className="eyebrow text-accent-2">Cited recommendation · RFQ-2291</p>
              <h2 id="rec-title" className="mt-1 text-[15px] font-semibold text-fg">
                Impeller kit for WO-48219
              </h2>
            </div>
            <Badge tone="info">Local simulation</Badge>
          </header>
          <div className="flex-1 space-y-2 p-4 text-[13px] leading-relaxed text-fg-2">
            {brief ? (
              <>
                {brief.sentences.slice(0, 3).map((s, i) => (
                  <p key={i}>
                    {s.text}
                    {s.cites.map((c) => (
                      <sup key={c} className="num ml-0.5 rounded-sm bg-info/15 px-1 text-[11px] font-semibold text-info" aria-label={`source ${c}`}>
                        {c}
                      </sup>
                    ))}
                  </p>
                ))}
                <ol className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
                  {brief.citations.slice(0, 4).map((c) => (
                    <li key={c.n} className="flex items-center gap-2 text-muted">
                      <span className="num w-4 text-info">{c.n}</span>
                      <FileText className="size-3.5 shrink-0" aria-hidden />
                      <span className="num wrap-anywhere min-w-0 flex-1 text-fg-2">{c.label}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-muted">Your roles can't query procurement records with AI.</p>
            )}
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
            <Button size="sm" onClick={() => setTab('ai')} icon={Sparkles}>
              Full AI comparison
            </Button>
            <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={() => setTab('quotations')}>
              Compare quotations
            </Button>
          </footer>
        </section>
      </div>
    </div>
  )
}

/** Supplier-return proposals routed to Procurement by the Perishable Expiry Guard — only the fields a return needs. */
function SupplierReturns({ ctl }: { ctl: PrCtl }) {
  return (
    <Panel eyebrow="From Perishable Expiry Guard · simulated agent" title="Supplier returns proposed" bodyClassName="p-0">
      <ul className="divide-y divide-line">
        {ctl.returns.map((r) => {
          const s = ctl.sup(r.supplierId)
          const a = r.action
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <RotateCcw className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-[220px] flex-1">
                <span className="block text-[13px] font-semibold text-fg">{a.title}</span>
                <span className="block text-xs text-muted">
                  {r.qty} {r.unit} · {r.sku} batch {r.batch} · {r.days} days of shelf life left · {s?.name ?? r.supplierId} · estimated credit {fmtUsd(a.valueProtected, false)}
                </span>
              </span>
              {a.status === 'proposed' ? <Badge tone="warn">Human approval required · supplier</Badge> : a.status === 'approved' ? <Badge tone="nv">Approved</Badge> : <Badge tone="neutral">Dismissed</Badge>}
              {ctl.canDecideReturn(r) ? (
                a.status === 'proposed' ? (
                  <span className="flex gap-2">
                    <Button size="sm" icon={Ban} onClick={() => ctl.decideReturn(r, 'dismissed')} aria-label={`Dismiss ${a.id}`}>
                      Dismiss
                    </Button>
                    <Button size="sm" variant="primary" icon={CircleCheck} onClick={() => ctl.decideReturn(r, 'approved')} aria-label={`Approve ${a.id}: ${a.title}`}>
                      Approve
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {a.decidedBy} · {a.decidedAt ? fmtTime(a.decidedAt) : ''}
                    <Button size="sm" variant="ghost" icon={Undo2} onClick={() => ctl.decideReturn(r, 'proposed')} aria-label={`Undo decision on ${a.id}`}>
                      Undo
                    </Button>
                  </span>
                )
              ) : (
                <span className="text-xs text-muted">View only</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Approving queues a return request in the demo store only — nothing is sent to the supplier. Other inventory lots are not visible here.</p>
    </Panel>
  )
}

interface PrException {
  id: string
  tone: Tone
  icon: typeof TriangleAlert
  title: string
  detail: string
  quote?: string
}

function exceptionsFor(ws: Workspace, indexed: Set<string>): PrException[] {
  const out: PrException[] = []
  const urgent = ws.quotations.filter((q) => q.rfq === 'RFQ-2291' && q.item.startsWith('Impeller'))
  if (urgent.length && !urgent.some((q) => q.status === 'Awarded')) {
    const value = Math.max(...urgent.map((q) => q.unitPrice * q.qty))
    out.push({ id: 'rfq', tone: 'warn', icon: Clock, title: 'RFQ-2291 awaiting award', detail: `Up to ${fmtUsd(value, false)} · the pump repair (WO-48219) waits on the impeller kit.`, quote: urgent[0]?.id })
  }
  for (const q of ws.quotations.filter((x) => x.status !== 'Awarded')) {
    const s = ws.suppliers.find((x) => x.id === q.supplierId)
    const needs = approvalNeeds(q, s)
    if (needs.length) out.push({ id: `ap-${q.id}`, tone: 'warn', icon: ShieldAlert, title: `${q.id} needs director approval`, detail: needs.join(' · '), quote: q.id })
    if (q.status === 'Clarification') out.push({ id: `cl-${q.id}`, tone: 'info', icon: FileWarning, title: `${q.id} waiting on supplier clarification`, detail: `${s?.name ?? q.supplierId} · ${q.item}`, quote: q.id })
    if (!indexed.has(q.document)) out.push({ id: `ix-${q.id}`, tone: 'info', icon: FileText, title: `${q.id} source PDF not indexed`, detail: `${q.document} — the assistant can cite the record but not the page.`, quote: q.id })
  }
  const card = ws.gold.find((g) => g.name === 'gold.supplier_scorecard')
  if (card && card.quality < 96) out.push({ id: 'dq', tone: 'info', icon: TrendingDown, title: 'Supplier scorecard quality below target', detail: `${card.name} at ${card.quality}% (S3 rows quarantined upstream); OTIF figures may lag.` })
  return out
}

/* ------------------------------------------------------------ suppliers */

function SuppliersTab({ ctl, onOpen }: { ctl: PrCtl; onOpen: (id: string) => void }) {
  return (
    <Panel eyebrow="Supplier master" title={`${ctl.ws.suppliers.length} suppliers`} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <caption className="sr-only">Suppliers with rating, on-time-in-full performance and open quotations</caption>
          <thead>
            <tr className="border-b border-line">
              {['Supplier', 'Category', 'Rating', 'OTIF (90 d)', 'Contract', 'Open quotes', ''].map((h) => (
                <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ctl.ws.suppliers.map((s) => {
              const open = ctl.ws.quotations.filter((q) => q.supplierId === s.id && q.status !== 'Awarded').length
              return (
                <tr key={s.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-fg">{s.name}</td>
                  <td className="px-3 py-2.5 text-fg-2">{s.category}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={RATING_TONE[s.rating]}>{s.rating}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="num w-10 text-fg">{s.otif}%</span>
                      <Meter value={s.otif / 100} tone={s.otif < 90 ? 'warn' : 'nv'} className="w-24" label={`${s.name} OTIF ${s.otif}%`} />
                    </div>
                  </td>
                  <td className="num px-3 py-2.5 text-fg-2">{s.contract}</td>
                  <td className="num px-3 py-2.5 text-fg-2">{open}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(s.id)} aria-label={`Details for ${s.name}`}>
                      Details
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function SupplierDetails({ s, ctl }: { s: Supplier; ctl: PrCtl }) {
  const quotes = ctl.ws.quotations.filter((q) => q.supplierId === s.id)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={RATING_TONE[s.rating]}>{s.rating}</Badge>
        <Badge tone="neutral">{s.contract}</Badge>
      </div>
      <KeyValues items={[['Category', s.category], ['OTIF (90 days)', `${s.otif}%`], ['Contract', s.contract], ['Quotations', String(quotes.length)]]} />
      {s.rating === 'Probation' && (
        <p className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-fg-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> Awards to suppliers on probation require procurement-director approval (Procurement_Policy_2026.pdf, p.6).
        </p>
      )}
      {ctl.returns.some((r) => r.supplierId === s.id) && (
        <div>
          <p className="eyebrow mb-2">Proposed returns</p>
          <ul className="space-y-1.5">
            {ctl.returns
              .filter((r) => r.supplierId === s.id)
              .map((r) => (
                <li key={r.action.id} className="rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                  <p className="text-fg-2">{r.action.title}</p>
                  <p className="text-xs text-muted">
                    {r.action.status} · estimated credit {fmtUsd(r.action.valueProtected, false)}
                  </p>
                </li>
              ))}
          </ul>
        </div>
      )}
      <div>
        <p className="eyebrow mb-2">Quotations</p>
        <ul className="space-y-1.5">
          {quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
              <span className="num text-fg">{q.id}</span>
              <span className="min-w-0 flex-1 text-muted">{q.item}</span>
              <Badge tone={STATUS_TONE[q.status]}>{q.status}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ quotations */

function QuotationsTab({ ctl, onEvidence }: { ctl: PrCtl; onEvidence: (id: string) => void }) {
  const [rfq, setRfq] = useState(ctl.rfqs.includes('RFQ-2291') ? 'RFQ-2291' : (ctl.rfqs[0] ?? ''))
  const quotes = ctl.ws.quotations.filter((q) => q.rfq === rfq)
  const { cheapest, fastest } = flagsFor(quotes)
  return (
    <Panel
      eyebrow="Comparison · extracted from quotation PDFs"
      title={`${rfq} · ${quotes.length} quotations`}
      bodyClassName="p-0"
      actions={
        <div className="flex rounded-md border border-line-2 p-0.5" role="group" aria-label="Request for quotation">
          {ctl.rfqs.map((r) => (
            <button key={r} type="button" aria-pressed={r === rfq} onClick={() => setRfq(r)} className={cx('num h-8 rounded-sm px-3 text-xs font-medium', r === rfq ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>
              {r}
            </button>
          ))}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[13px]">
          <caption className="sr-only">Quotations for {rfq}. Best value is marked with text, not colour alone.</caption>
          <thead>
            <tr className="border-b border-line">
              {['Quote / item', 'Supplier', 'Unit price', 'Lead time', 'Terms', 'Source', 'Status', ''].map((h) => (
                <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const s = ctl.sup(q.supplierId)
              const cited = ctl.indexed.has(q.document)
              const needs = approvalNeeds(q, s)
              return (
                <tr key={q.id} className={cx('border-b border-line/60 align-top last:border-0', q.status === 'Awarded' && 'bg-accent/[0.05]')}>
                  <td className="px-3 py-2.5">
                    <p className="num text-fg">{q.id}</p>
                    <p className="max-w-[200px] text-xs text-muted">{q.item}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-fg">{s?.name}</p>
                    {s && (
                      <p className={cx('text-xs', s.rating === 'Probation' ? 'text-warn' : 'text-muted')}>
                        {s.rating} · OTIF {s.otif}%
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="num text-fg">{fmtUsd(q.unitPrice, false)}</p>
                    <p className="num text-xs text-muted">
                      × {q.qty} = {fmtUsd(q.unitPrice * q.qty, false)}
                    </p>
                    {cheapest.has(q.id) && (
                      <Badge tone="nv" className="mt-1">
                        <BadgeCheck className="size-3" aria-hidden /> Lowest price
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className={cx('num', q.leadTimeDays > 14 ? 'text-warn' : 'text-fg')}>{q.leadTimeDays} days</p>
                    {fastest.has(q.id) && (
                      <Badge tone="nv" className="mt-1">
                        <Truck className="size-3" aria-hidden /> Fastest
                      </Badge>
                    )}
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5 text-xs text-fg-2">
                    {q.terms}
                    {needs.length > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-warn">
                        <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> Director approval
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className={cx('flex items-center gap-1', cited ? 'text-fg-2' : 'text-muted')}>
                      <FileText className="size-3.5 shrink-0" aria-hidden /> p.{q.page}
                    </span>
                    <span className={cx('mt-0.5 block', cited ? 'text-ok' : 'text-muted')}>{cited ? 'Indexed · citable' : 'Not indexed'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[q.status]}>{q.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => onEvidence(q.id)} aria-label={`Evidence for ${q.id}`}>
                        Evidence
                      </Button>
                      {ctl.manage && q.status !== 'Awarded' && (
                        <Button size="sm" icon={Award} onClick={() => ctl.award(q)} aria-label={`Award ${q.id} to ${s?.name ?? q.supplierId}`}>
                          Award
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Awarding one quotation for an item returns the others to “Received”. Awards create a purchase-order draft in the demo store only.</p>
    </Panel>
  )
}

function QuoteEvidence({ q, ctl }: { q: Quotation; ctl: PrCtl }) {
  const s = ctl.sup(q.supplierId)
  const needs = approvalNeeds(q, s)
  const cited = ctl.indexed.has(q.document)
  const policy = ctl.indexed.has('Procurement_Policy_2026.pdf')
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={STATUS_TONE[q.status]}>{q.status}</Badge>
        {cited ? <Badge tone="nv">Source indexed</Badge> : <Badge tone="warn">Source not indexed</Badge>}
      </div>
      <KeyValues
        items={[
          ['Item', q.item],
          ['Quantity', String(q.qty)],
          ['Unit price', fmtUsd(q.unitPrice, false)],
          ['Total', fmtUsd(q.unitPrice * q.qty, false)],
          ['Lead time', `${q.leadTimeDays} days`],
          ['Valid until', q.validUntil],
          ['Terms', q.terms],
          ['Supplier', s ? `${s.name} · ${s.rating} · OTIF ${s.otif}%` : q.supplierId],
        ]}
      />
      <div>
        <p className="eyebrow mb-2">Cited sources</p>
        <ol className="space-y-1.5 text-[13px]">
          <li className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
            <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="num wrap-anywhere block text-fg-2">
                {q.document} · p.{q.page}
              </span>
              <span className="block text-xs text-muted">{cited ? 'Extracted fields above come from this page.' : 'Not uploaded — values come from the structured record only.'}</span>
            </span>
          </li>
          {policy && (
            <li className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="num block text-fg-2">Procurement_Policy_2026.pdf · p.4, p.6</span>
                <span className="block text-xs text-muted">Lowest total cost that meets the required-by date; probation or prepayment above 30% needs director approval.</span>
              </span>
            </li>
          )}
        </ol>
      </div>
      <div>
        <p className="eyebrow mb-2">Approvals</p>
        {needs.length ? (
          <ul className="space-y-1.5">
            {needs.map((n) => (
              <li key={n} className="flex items-start gap-2 text-[13px] text-warn">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-fg-2">
            <CircleCheck className="size-4 text-ok" aria-hidden /> Standard approval path.
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ AI */

function AiTab({ ctl }: { ctl: PrCtl }) {
  const evidence = ['Hydraflow_Quotation_Q-7781.pdf', 'Crestline_Quotation_CQ-5520.pdf', 'Procurement_Policy_2026.pdf']
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <AssistantPanel context="procurement" title="Quotation comparison" initialQuery="Compare quotations for RFQ-2291" />
      <Panel eyebrow="Evidence the comparison uses" title="Source documents" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {evidence.map((name) => {
            const ok = ctl.indexed.has(name)
            return (
              <li key={name} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]">
                <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="num wrap-anywhere min-w-0 flex-1 text-fg-2">{name}</span>
                {ok ? <Badge tone="nv">Indexed</Badge> : <Badge tone="warn">Missing</Badge>}
              </li>
            )
          })}
        </ul>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">Driver routes, CRM data and other companies’ quotations are outside your grants and are refused before retrieval.</p>
      </Panel>
    </div>
  )
}
