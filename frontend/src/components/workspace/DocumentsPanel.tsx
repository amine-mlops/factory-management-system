import { CircleCheck, CloudUpload, FileText, LoaderCircle, Sparkles, Trash, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { MODULE_NAV } from '../../data/nav.ts'
import { cx } from '../../lib/format.ts'
import { aclLabel, DEMO_PDFS, DOC_CATEGORIES, DOC_STAGES, makeDoc, ragState, type DocVisibility, type KbDocument } from '../../lib/workspace.ts'
import { Badge, Button, Meter } from '../ui/primitives.tsx'

type SetDocs = (fn: (d: KbDocument[]) => KbDocument[]) => void

interface Props {
  docs: KbDocument[]
  setDocs: SetDocs
  readOnly?: boolean
}

export function RagIndicator({ docs, className }: { docs: KbDocument[]; className?: string }) {
  const r = ragState(docs)
  return (
    <div className={cx('flex items-center gap-3 rounded-md border px-3 py-2.5', r.ready ? 'border-accent/45 bg-accent/[0.06]' : 'border-line bg-deck', className)} role="status">
      {r.ready ? <CircleCheck className="size-4 shrink-0 text-ok" aria-hidden /> : r.pending ? <LoaderCircle className="size-4 shrink-0 animate-spin text-info" aria-hidden /> : <Sparkles className="size-4 shrink-0 text-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg">{r.ready ? 'RAG-ready' : r.pending ? `Indexing ${r.pending} document${r.pending > 1 ? 's' : ''}…` : 'No documents yet'}</p>
        <p className="num text-xs text-muted">
          {r.indexed} indexed · {r.chunks.toLocaleString()} chunks · local simulation
        </p>
      </div>
    </div>
  )
}

/** uploaded → extracted/chunked → ACL tagged → indexed, one segment per stage. */
export function Lifecycle({ doc }: { doc: KbDocument }) {
  const at = DOC_STAGES.findIndex((s) => s.id === doc.status)
  return (
    <div>
      <ol className="flex items-center gap-1" aria-label={`Lifecycle stage ${at + 1} of ${DOC_STAGES.length}: ${DOC_STAGES[at].label}`}>
        {DOC_STAGES.map((s, i) => (
          <li key={s.id} title={s.label} className={cx('h-1.5 w-7 rounded-full transition-colors duration-500', i < at || doc.status === 'indexed' ? 'bg-accent' : i === at ? 'animate-pulse bg-info' : 'bg-line-2')} />
        ))}
      </ol>
      <p className={cx('mt-1 flex items-center gap-1 text-xs', doc.status === 'indexed' ? 'text-accent-2' : 'text-info')}>
        {doc.status !== 'indexed' && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
        {DOC_STAGES[at].label}
      </p>
    </div>
  )
}

export function UploadZone({ setDocs, compact }: { setDocs: SetDocs; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    const pdfs = list.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    setRejected(pdfs.length < list.length ? `${list.length - pdfs.length} non-PDF file(s) skipped — PDF only.` : null)
    setDocs((d) => [...d, ...pdfs.map((f) => makeDoc({ name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), category: 'SOP / Procedure', visibility: 'Company' }))])
  }
  const addDemo = () =>
    setDocs((d) => {
      const have = new Set(d.map((x) => x.name))
      return [...d, ...DEMO_PDFS.filter((p) => !have.has(p.name)).map((p) => makeDoc(p))]
    })
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx('flex flex-wrap items-center gap-4 rounded-lg border border-dashed px-4 transition-colors', compact ? 'py-3' : 'py-5', dragging ? 'border-accent bg-accent/[0.06]' : 'border-line-2 bg-deck')}
    >
      <CloudUpload className={cx('size-6 shrink-0', dragging ? 'text-accent' : 'text-muted')} aria-hidden />
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-fg">Drop PDFs to add them to the knowledge base</p>
        <p className="mt-0.5 text-xs text-muted">Demo: files stay in this browser — extraction, ACL tagging and indexing are simulated locally.</p>
        {rejected && (
          <p className="mt-1 flex items-center gap-2 text-xs text-warn" role="status">
            {rejected}
            <button type="button" onClick={() => setRejected(null)} aria-label="Dismiss message" className="grid size-6 place-items-center rounded-sm hover:bg-raised">
              <X className="size-3" aria-hidden />
            </button>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>
          Browse PDFs
        </Button>
        <Button size="sm" icon={Sparkles} onClick={addDemo}>
          Add demo PDFs
        </Button>
      </div>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" tabIndex={-1} aria-label="Choose PDF files" onChange={(e) => addFiles(e.target.files)} />
    </div>
  )
}

export function DocumentTable({ docs, setDocs, readOnly }: Props) {
  const update = (id: string, patch: Partial<KbDocument>) => setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  if (!docs.length) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <caption className="sr-only">Documents with category, access control and processing stage</caption>
        <thead>
          <tr className="border-b border-line bg-deck">
            {['Document', 'Category', 'Access (ACL)', 'Lifecycle', ''].map((h) => (
              <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <p className="wrap-anywhere max-w-[300px] text-fg">{d.name}</p>
                    <p className="num text-xs text-muted">
                      {(d.sizeKb / 1024).toFixed(1)} MB{d.status === 'indexed' || d.status === 'tagging' ? ` · ${d.chunks} chunks` : ''}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <select aria-label={`Category for ${d.name}`} value={d.category} disabled={readOnly} onChange={(e) => update(d.id, { category: e.target.value })} className="h-8 rounded-md border border-field bg-deck px-2 text-xs text-fg-2 disabled:opacity-70">
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <select
                  aria-label={`Visibility for ${d.name}`}
                  value={d.visibility === 'Module' ? `Module:${d.module ?? 'manufacturing'}` : d.visibility}
                  disabled={readOnly}
                  onChange={(e) => {
                    const [v, m] = e.target.value.split(':')
                    update(d.id, { visibility: v as DocVisibility, module: m as KbDocument['module'] })
                  }}
                  className="h-8 rounded-md border border-field bg-deck px-2 text-xs text-fg-2 disabled:opacity-70"
                >
                  <option value="Company">Company-wide</option>
                  {MODULE_NAV.map((m) => (
                    <option key={m.id} value={`Module:${m.id}`}>
                      Module · {m.label}
                    </option>
                  ))}
                  <option value="Restricted">Restricted (owners)</option>
                </select>
                <p className="num mt-1 text-xs text-muted">{aclLabel(d)}</p>
              </td>
              <td className="w-[190px] px-3 py-2">
                <Lifecycle doc={d} />
              </td>
              <td className="px-3 py-2 text-right">
                {!readOnly && (
                  <button type="button" onClick={() => setDocs((all) => all.filter((x) => x.id !== d.id))} className="grid size-8 place-items-center rounded-md text-muted hover:bg-crit/10 hover:text-crit-2" aria-label={`Remove ${d.name}`}>
                    <Trash className="size-4" aria-hidden />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Composite used by the owner setup wizard. */
export function DocumentsPanel({ docs, setDocs, readOnly }: Props) {
  return (
    <div className="space-y-4">
      {!readOnly && <UploadZone setDocs={setDocs} />}
      <RagIndicator docs={docs} />
      <DocumentTable docs={docs} setDocs={setDocs} readOnly={readOnly} />
      <p className="text-xs text-muted">Document path: upload → extraction & validation → permission-tagged chunks → authorized retrieval. Chunks are not Gold tables — Gold holds curated operational records.</p>
    </div>
  )
}

/** Stage counters + per-document progress for the ingestion tab. */
export function IngestionStatus({ docs }: { docs: KbDocument[] }) {
  const counts = DOC_STAGES.map((s) => ({ ...s, n: docs.filter((d) => d.status === s.id).length }))
  const active = docs.filter((d) => d.status !== 'indexed')
  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-2 gap-3 @3xl:grid-cols-4" aria-label="Documents per lifecycle stage">
        {counts.map((c, i) => (
          <li key={c.id} className="panel p-4">
            <p className="eyebrow">
              {i + 1} · {c.label}
            </p>
            <p className="num mt-2 text-[28px] font-semibold leading-none text-fg">{c.n}</p>
            <p className="mt-1.5 text-xs text-muted">{c.id === 'indexed' ? 'searchable with ACL filters' : c.id === 'tagging' ? 'tenant · module · role tags' : c.id === 'extracting' ? 'text + ~512-token chunks' : 'stored in tenant storage'}</p>
          </li>
        ))}
      </ol>
      <div className="panel">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold text-fg">{active.length ? `${active.length} processing` : 'Processing queue empty'}</h2>
          <Badge tone="info">One document at a time · simulated</Badge>
        </header>
        {active.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">Every document has been extracted, ACL-tagged and indexed. Upload a PDF in Documents to watch the pipeline run.</p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="wrap-anywhere min-w-0 flex-1 text-[13px] text-fg-2">{d.name}</span>
                <Meter value={d.progress / 100} tone="info" className="w-32" label={`${d.name} ${d.progress}%`} />
                <span className="num w-10 text-right text-xs text-muted">{d.progress}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
