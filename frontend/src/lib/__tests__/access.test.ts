import { describe, expect, it } from 'vitest'
import { can, effectivePermissions, landingPage, scopeOf, type Member } from '../access.ts'
import { authorizeQuery } from '../guard.ts'
import { answer, buildCorpus, QUESTIONS, retrieve } from '../rag.ts'
import { acceptInvite, demoWorkspace, generateInvite } from '../workspace.ts'

const ws = demoWorkspace('Alex Moreno', 'operator@nexus-demo.io')
const member = (id: string) => ws.members.find((m) => m.userId === id) as Member
const driver = effectivePermissions(ws.tenant, member('usr_jlee'))
const owner = effectivePermissions(ws.tenant, member('usr_owner'))

describe('effective permissions (module + action + scope)', () => {
  it('driver sees Transportation only, with assigned scope and status updates', () => {
    expect([...driver.pages]).toEqual(['transportation'])
    expect(scopeOf(driver, 'transportation')).toBe('assigned')
    expect(can(driver, 'transportation', 'update_status')).toBe(true)
    expect(can(driver, 'transportation', 'manage')).toBe(false)
    expect(landingPage(driver)).toBe('transportation')
  })

  it('default-denies procurement, CRM and settings for the driver', () => {
    for (const p of ['procurement', 'crm', 'settings', 'data'] as const) expect(driver.pages.has(p)).toBe(false)
    expect(driver.reason('procurement')).toBe('not_granted')
  })

  it('separates configuring a connection from reading records', () => {
    const arch = effectivePermissions(ws.tenant, member('usr_owner'), ['data_architect'])
    expect(can(arch, 'data', 'configure')).toBe(true)
    expect(can(arch, 'transportation', 'read_records')).toBe(false)
  })

  it('disabled modules are unavailable even for owners', () => {
    const t = { ...ws.tenant, enabledModules: ['transportation' as const, 'procurement' as const] }
    const p = effectivePermissions(t, member('usr_owner'))
    expect(p.reason('crm')).toBe('module_disabled')
    expect(p.pages.has('triage')).toBe(false)
  })
})

describe('pre-retrieval gate', () => {
  it('denies the CRM margins negative test for a driver', () => {
    const d = authorizeQuery('Show executive CRM margins', driver, 'transportation')
    expect(d.allowed).toBe(false)
    expect(d.resource).toBe('crm')
  })
  it('denies cross-tenant requests even for owners', () => {
    expect(authorizeQuery('List Borealis Foods deliveries', owner, 'transportation').resource).toBe('cross_tenant')
  })
  it('allows a driver shift briefing', () => {
    expect(authorizeQuery('Brief me on my shift', driver, 'transportation').allowed).toBe(true)
  })
})

describe('permission-aware retrieval', () => {
  const corpus = buildCorpus(ws)
  it('filters other tenants and other drivers before composing', () => {
    const t = retrieve(corpus, driver, 'usr_jlee', ['rundown'])
    expect(t.chunks.every((c) => c.tenantId === ws.tenant.tenantId)).toBe(true)
    expect(t.candidates).toBeGreaterThan(t.afterTenant)
    expect(t.chunks.filter((c) => c.source.kind === 'record').every((c) => c.assignedTo === 'usr_jlee')).toBe(true)
  })
  it('cites sources and flags stale ETAs instead of presenting them as current', () => {
    const q = QUESTIONS.transportation![0]
    const a = answer(q, retrieve(corpus, driver, 'usr_jlee', q.topics), { ws, userId: 'usr_jlee', perms: driver })
    expect(a.citations.length).toBeGreaterThan(0)
    expect(a.staleNotice).toMatch(/stale/i)
  })
  it('procurement comparison is grounded in quotation PDFs', () => {
    const buyer = effectivePermissions(ws.tenant, member('usr_owner'), ['procurement_manager'])
    const q = QUESTIONS.procurement![0]
    const a = answer(q, retrieve(corpus, buyer, 'usr_owner', q.topics), { ws, userId: 'usr_owner', perms: buyer })
    const docs = a.citations.map((c) => (c.source.kind === 'pdf' ? c.source.name : ''))
    expect(docs).toContain('Hydraflow_Quotation_Q-7781.pdf')
    expect(a.citations.some((c) => c.tenantId !== ws.tenant.tenantId)).toBe(false)
  })
})

describe('invitation codes', () => {
  it('driver invite claims the driver seat so assigned deliveries resolve', () => {
    const fresh = { ...ws, members: ws.members.filter((m) => m.userId !== 'usr_jlee') }
    const inv = generateInvite(fresh, ['truck_driver'], 'Alex')
    expect(inv.code).toMatch(/-DRV-/)
    const { ws: joined, userId } = acceptInvite({ ...fresh, invites: [inv] }, inv, 'New Driver', 'new.driver@x.io')
    expect(userId).toBe('usr_jlee')
    expect(joined.shipments.filter((s) => s.driverId === userId).length).toBe(3)
  })
})
