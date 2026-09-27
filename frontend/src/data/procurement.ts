export interface Supplier {
  id: string
  name: string
  category: string
  otif: number
  rating: 'Preferred' | 'Approved' | 'Probation'
  contract: string
}

export interface Quotation {
  id: string
  rfq: string
  supplierId: string
  item: string
  qty: number
  unitPrice: number
  currency: 'USD'
  leadTimeDays: number
  validUntil: string
  terms: string
  status: 'Received' | 'Under review' | 'Clarification' | 'Awarded'
  /** Uploaded quotation PDF this record was extracted from (page cited by the assistant). */
  document: string
  page: number
}

export const SUPPLIERS: Supplier[] = [
  { id: 'sup_hydraflow', name: 'Hydraflow Pumps', category: 'Pumps & impellers', otif: 94, rating: 'Preferred', contract: 'MSA-2025-014' },
  { id: 'sup_crestline', name: 'Crestline Industrial', category: 'Pumps & impellers', otif: 81, rating: 'Probation', contract: 'Spot' },
  { id: 'sup_meridian', name: 'Meridian Seals', category: 'Seals & gaskets', otif: 91, rating: 'Approved', contract: 'MSA-2024-031' },
  { id: 'sup_apex', name: 'Apex Bearings Co.', category: 'Bearings', otif: 97, rating: 'Preferred', contract: 'MSA-2025-002' },
]

export const QUOTATIONS: Quotation[] = [
  { id: 'Q-7781', rfq: 'RFQ-2291', supplierId: 'sup_hydraflow', item: 'Impeller kit IMP-204-316SS-RC', qty: 2, unitPrice: 9200, currency: 'USD', leadTimeDays: 5, validUntil: '2026-10-15', terms: 'Net 30 · 24-month warranty', status: 'Under review', document: 'Hydraflow_Quotation_Q-7781.pdf', page: 1 },
  { id: 'CQ-5520', rfq: 'RFQ-2291', supplierId: 'sup_crestline', item: 'Impeller kit IMP-204-316SS-RC', qty: 2, unitPrice: 7650, currency: 'USD', leadTimeDays: 21, validUntil: '2026-10-05', terms: 'Prepayment 50% · 12-month warranty', status: 'Received', document: 'Crestline_Quotation_CQ-5520.pdf', page: 2 },
  { id: 'MS-3310', rfq: 'RFQ-2291', supplierId: 'sup_meridian', item: 'Mechanical seal cartridge (add-on)', qty: 4, unitPrice: 1410, currency: 'USD', leadTimeDays: 9, validUntil: '2026-10-20', terms: 'Net 45', status: 'Clarification', document: 'Meridian_Quotation_MS-3310.pdf', page: 1 },
  { id: 'AB-1190', rfq: 'RFQ-2287', supplierId: 'sup_apex', item: 'Bearing BRG-6320-2Z-C3', qty: 6, unitPrice: 1325, currency: 'USD', leadTimeDays: 6, validUntil: '2026-10-11', terms: 'Net 30 · consignment eligible', status: 'Awarded', document: 'Apex_Quotation_AB-1190.pdf', page: 1 },
]

export const supplierName = (id: string) => SUPPLIERS.find((s) => s.id === id)?.name ?? id
