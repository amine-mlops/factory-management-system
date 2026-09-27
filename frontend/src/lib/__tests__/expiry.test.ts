import { describe, expect, it } from 'vitest'
import { effectivePermissions, type Member } from '../access.ts'
import { askAssistant } from '../assistant.ts'
import { assessLots, decideAction, runScan, summarize, supplierReturnsFor, updateRules } from '../expiry.ts'
import { authorizeQuery } from '../guard.ts'
import { buildOpsModel } from '../insights.ts'
import { demoWorkspace } from '../workspace.ts'

const now = new Date()
const ws = demoWorkspace('Alex Moreno', 'operator@nexus-demo.io')
const member = (id: string) => ws.members.find((m) => m.userId === id) as Member
const owner = effectivePermissions(ws.tenant, member('usr_owner'))
const driver = effectivePermissions(ws.tenant, member('usr_jlee'))
const buyer = effectivePermissions(ws.tenant, member('usr_owner'), ['procurement_manager'])
const arch = effectivePermissions(ws.tenant, member('usr_pshah'))
const Q = 'Which lots expire in the next 14 days and what should we do?'

describe('Perishable Expiry Guard logic', () => {
  it('classifies healthy / warning / critical lots and values at-risk stock', () => {
    const lots = assessLots(ws.expiry, now)
    expect(new Set(lots.map((l) => l.severity))).toEqual(new Set(['healthy', 'warning', 'critical']))
    const s = summarize(ws.expiry, now)
    expect(s.critical).toBe(3)
    expect(s.valueAtRisk).toBe(lots.filter((l) => l.severity !== 'healthy').reduce((a, l) => a + l.value, 0))
    expect(s.topAction?.id).toBe('ACT-1041')
  })

  it('rule changes are validated, versioned and re-classify lots', () => {
    expect('error' in updateRules(ws.expiry, { warningDays: 3 }, 'alex', now)).toBe(true)
    const res = updateRules(ws.expiry, { criticalDays: 12 }, 'alex', now)
    if ('error' in res) throw new Error(res.error)
    expect(res.state.rules.version).toBe(ws.expiry.rules.version + 1)
    expect(summarize(res.state, now).critical).toBeGreaterThan(summarize(ws.expiry, now).critical)
  })

  it('decisions change status without executing anything; scans record partial runs', () => {
    const next = decideAction(ws.expiry, 'ACT-1041', 'approved', 'alex', now)
    expect(next.actions.find((a) => a.id === 'ACT-1041')?.status).toBe('approved')
    const { run } = runScan(next, now, 'manual')
    expect(run.status).toBe('partial')
    expect(run.rowsRejected).toBe(2)
  })
})

describe('role projection', () => {
  it('drivers and procurement cannot open Inventory; data architects get configure only', () => {
    expect(driver.pages.has('inventory')).toBe(false)
    expect(buyer.pages.has('inventory')).toBe(false)
    expect(arch.pages.has('inventory')).toBe(true)
    expect(buildOpsModel(ws, arch, now).kpis.expiry).toBeNull()
    expect(buildOpsModel(ws, owner, now).kpis.expiry?.critical).toBe(3)
  })

  it('procurement sees supplier-return proposals only', () => {
    const r = supplierReturnsFor(ws.expiry, buyer, now)
    expect(r.map((x) => x.action.kind)).toEqual(['supplier_return'])
    expect(supplierReturnsFor(ws.expiry, driver, now)).toEqual([])
  })

  it('technical map diagnostics never carry lot values', () => {
    const inv = buildOpsModel(ws, arch, now).modules.find((m) => m.id === 'inventory')!
    expect(inv.business).toBeNull()
    expect(inv.problems.join(' ')).not.toMatch(/\$/)
    expect(inv.tech?.short).toMatch(/rows rejected/)
  })
})

describe('pre-retrieval gate for expiry questions', () => {
  it('denies drivers, procurement and data architects before retrieval', () => {
    for (const p of [driver, buyer, arch]) {
      const d = authorizeQuery(Q, p, 'dashboard')
      expect(d.allowed).toBe(false)
      expect(d.resource).toBe('inventory')
    }
  })
  it('lets data architects ask about the expiry feed as metadata only', () => {
    const d = authorizeQuery('Why did the expiry scan reject rows?', arch, 'data')
    expect(d.allowed).toBe(true)
    expect(d.resource).toBe('data')
  })
  it('answers owners with cited lots, proposals and the shelf-life policy', async () => {
    const out = await askAssistant(Q, { ws, perms: owner, userId: 'usr_owner', userName: 'Alex', context: 'inventory', useMock: true })
    expect(out.kind).toBe('answer')
    if (out.kind !== 'answer') return
    const labels = out.view.citations.map((c) => c.label).join(' ')
    expect(labels).toMatch(/gold\.lot_expiry/)
    expect(labels).toMatch(/Shelf_Life_and_FEFO_Policy_2026\.pdf/)
    expect(out.view.gaps.join(' ')).toMatch(/failed validation/)
  })
  it('logs a 403 incident for a driver asking the same question', async () => {
    const out = await askAssistant(Q, { ws, perms: driver, userId: 'usr_jlee', userName: 'Jordan', context: 'transportation', useMock: true })
    expect(out.kind).toBe('denied')
    if (out.kind === 'denied') expect(out.incident.chunksRetrieved).toBe(0)
  })
})
