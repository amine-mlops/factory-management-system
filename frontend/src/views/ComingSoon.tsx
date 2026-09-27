import { Eye, EyeOff, Hourglass, PlugZap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Eyebrow } from '../components/ui/primitives.tsx'
import { navItem, type ModuleId } from '../data/nav.ts'

const PLANNED: Partial<Record<ModuleId, string[]>> = {
  warehousing: ['Dock scheduling', 'Zone capacity', 'Pick-wave release'],
  manufacturing: ['Line OEE', 'Machinery health', 'Autonomous Triage (preview available)'],
  distribution: ['DC network balance', 'Fill-rate tracking', 'Backorder alerts'],
  crm: ['Customer cases & SLAs', 'Proactive throughput notices', 'Account health'],
  it: ['Integration health', 'Connector credentials (server-side)', 'Platform SLOs'],
}

/** Module enabled for the company but not yet wired to the FastAPI prototype backend. */
export function ComingSoonGate({ module, preview }: { module: ModuleId; preview: ReactNode }) {
  const [show, setShow] = useState(false)
  const item = navItem(module)
  const Icon = item.icon
  return (
    <div>
      <div className="mx-auto max-w-[1680px] px-4 pt-5 sm:px-6">
        <section className="panel relative overflow-hidden p-6 sm:p-8">
          <div className="flex flex-wrap items-start gap-5">
            <span className="grid size-14 shrink-0 place-items-center rounded-lg border border-line-2 bg-deck text-fg-2">
              <Icon className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">
                  <Hourglass className="size-3" aria-hidden /> Coming soon
                </Badge>
                <Badge tone="neutral">Enabled for future integration</Badge>
              </div>
              <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-fg">{item.label}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                This module is switched on for your company, but it is not built yet: the FastAPI prototype implements Transportation and Procurement, and Inventory runs as a simulated demo module. Nothing here is live data.
              </p>
              <Eyebrow className="mb-2 mt-5">Planned capabilities</Eyebrow>
              <ul className="flex flex-wrap gap-2">
                {(PLANNED[module] ?? []).map((p) => (
                  <li key={p} className="flex items-center gap-1.5 rounded-md border border-line bg-deck px-2.5 py-1.5 text-[13px] text-fg-2">
                    <PlugZap className="size-3.5 text-muted" aria-hidden /> {p}
                  </li>
                ))}
              </ul>
            </div>
            <Button icon={show ? EyeOff : Eye} onClick={() => setShow((s) => !s)} aria-expanded={show} aria-controls={`preview-${module}`} className="self-start">
              {show ? 'Hide preview' : 'Show UI preview (sample data)'}
            </Button>
          </div>
        </section>
      </div>
      {show && (
        <div id={`preview-${module}`} className="relative animate-fade">
          <p className="mx-auto mt-4 flex max-w-[1680px] items-center gap-2 px-4 sm:px-6">
            <Badge tone="info">Sample data · not connected</Badge>
            <span className="text-xs text-muted">A UI preview of the planned module — every figure below is illustrative.</span>
          </p>
          {preview}
        </div>
      )}
    </div>
  )
}
