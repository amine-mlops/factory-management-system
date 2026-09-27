import { BookOpen, Layers, MessagesSquare } from 'lucide-react'
import { useCallback } from 'react'
import { AssistantPanel } from '../components/assistant/AssistantPanel.tsx'
import { Page, PageHeader } from '../components/ui/PageHeader.tsx'
import { Badge, KpiCard, Panel } from '../components/ui/primitives.tsx'
import { TabPanel, Tabs, type TabDef } from '../components/ui/Tabs.tsx'
import { DocumentTable, IngestionStatus, RagIndicator, UploadZone } from '../components/workspace/DocumentsPanel.tsx'
import { can, isOwnerLike } from '../lib/access.ts'
import { useTab } from '../lib/route.ts'
import { ragState, type KbDocument } from '../lib/workspace.ts'
import { useWorkspace } from '../lib/workspaceContext.ts'

type KbTab = 'documents' | 'ingestion' | 'ask'

/**
 * Documents only: upload → extraction → ACL tagging → index. Owners and data
 * architects (configure) manage the library; readers see only what their ACL allows.
 */
export function KnowledgeView() {
  const { ws, perms, update } = useWorkspace()
  const setDocs = useCallback((fn: (d: KbDocument[]) => KbDocument[]) => update((w) => ({ ...w, documents: fn(w.documents) })), [update])
  const canEdit = isOwnerLike(perms.roles) || can(perms, 'knowledge', 'configure')
  const owner = isOwnerLike(perms.roles)
  // Readers only list documents their ACL allows (same rule as retrieval); editors manage the whole library.
  const visible = canEdit ? ws.documents : ws.documents.filter((d) => d.visibility === 'Company' || (d.visibility === 'Module' && d.module && perms.pages.has(d.module)) || (d.visibility === 'Restricted' && owner))
  const rag = ragState(ws.documents)
  const tabs: Array<TabDef<KbTab>> = [
    { id: 'documents', label: 'Documents', icon: BookOpen, badge: visible.length, badgeLabel: `${visible.length} documents` },
    { id: 'ingestion', label: 'Ingestion Status', icon: Layers, badge: rag.pending || undefined, badgeTone: 'info', badgeLabel: `${rag.pending} processing` },
    { id: 'ask', label: 'Ask Company', icon: MessagesSquare },
  ]
  const [tab, setTab] = useTab(tabs.map((t) => t.id))

  return (
    <Page>
      <PageHeader
        eyebrow={`Knowledge · ${ws.tenant.name}`}
        title="Company knowledge base"
        subtitle="PDFs become permission-tagged chunks. Retrieval only ever sees chunks whose ACL matches the person asking."
        right={
          <>
            <Badge tone={rag.ready ? 'nv' : 'info'}>{rag.ready ? 'RAG-ready' : rag.pending ? 'Indexing' : 'Empty'}</Badge>
            {!canEdit && <Badge tone="neutral">Read only</Badge>}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Knowledge sections" idBase="kb" />
      <TabPanel idBase="kb" id={tab}>
        {tab === 'documents' && (
          <div className="space-y-4">
            {canEdit && <UploadZone setDocs={setDocs} compact />}
            <Panel eyebrow={canEdit ? 'Library · all documents' : 'Documents your role can read'} title={`${visible.length} documents`} bodyClassName="p-0">
              {visible.length ? (
                <DocumentTable docs={visible} setDocs={setDocs} readOnly={!canEdit} />
              ) : (
                <p className="px-4 py-6 text-[13px] text-muted">No documents yet{canEdit ? ' — drop PDFs above or add the demo set.' : '.'}</p>
              )}
            </Panel>
          </div>
        )}
        {tab === 'ingestion' && (
          <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
            <IngestionStatus docs={ws.documents} />
            <div className="flex min-w-0 flex-col gap-4">
              <RagIndicator docs={ws.documents} />
              <section aria-label="Index figures" className="grid grid-cols-2 gap-3">
                <KpiCard label="Indexed" value={`${rag.indexed}/${ws.documents.length}`} delta={rag.pending ? `${rag.pending} in progress` : 'complete'} deltaTone={rag.pending ? 'info' : 'nv'} />
                <KpiCard label="Chunks" value={rag.chunks.toLocaleString()} delta="~512 tokens each" deltaTone="info" />
              </section>
              <Panel eyebrow="Separation" title="Documents ≠ Gold tables">
                <p className="text-[13px] text-fg-2">Chunks carry tenant, module and role tags so the retriever can filter before ranking. Curated operational records live in Gold tables and are queried with row-level scopes instead.</p>
              </Panel>
            </div>
          </div>
        )}
        {tab === 'ask' && (
          <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
            <AssistantPanel context="knowledge" title="Ask company documents" eyebrow="Documents only · cited · permission-filtered" />
            <Panel eyebrow="How answers are filtered" title="Before retrieval">
              <ol className="space-y-2.5 text-[13px] text-fg-2">
                <li>
                  <span className="num mr-2 text-muted">1</span>Tenant — only {ws.tenant.name}.
                </li>
                <li>
                  <span className="num mr-2 text-muted">2</span>Role / module — chunks tagged for modules you can open.
                </li>
                <li>
                  <span className="num mr-2 text-muted">3</span>Scope — assigned-only roles see their own records.
                </li>
              </ol>
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">Questions about a module you can't open are refused with 403 before any chunk is read.</p>
            </Panel>
          </div>
        )}
      </TabPanel>
    </Page>
  )
}
