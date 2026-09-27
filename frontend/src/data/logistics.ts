import type { UserId } from '../lib/access.ts'

export type ShipmentStatus = 'Scheduled' | 'Loading' | 'In transit' | 'Arrived' | 'Delivered' | 'Delayed'

export interface Shipment {
  id: string
  customer: string
  origin: string
  destination: string
  address: string
  window: string
  /** ETA from the Gold table — may be stale if the TMS refresh failed. */
  eta: string
  driverId: UserId | null
  driverName: string
  vehicle: string
  pallets: number
  weightKg: number
  handling: string
  status: ShipmentStatus
  stopOrder: number
}

export const DRIVER_USER_ID: UserId = 'usr_jlee'

export const SHIPMENTS: Shipment[] = [
  { id: 'SHP-88329', customer: 'Orion Chemicals', origin: 'Plant A', destination: 'Orion · Botlek terminal', address: 'Welplaatweg 12, Rotterdam', window: '09:30–10:30', eta: '10:05', driverId: 'usr_jlee', driverName: 'Jordan Lee', vehicle: 'TRK-14 · 18 t', pallets: 12, weightKg: 8400, handling: 'ADR class 8 — corrosive; keep upright', status: 'Delivered', stopOrder: 1 },
  { id: 'SHP-88335', customer: 'Helix Energy', origin: 'Plant A', destination: 'Helix · Maasvlakte plant', address: 'Europaweg 900, Rotterdam', window: '12:00–13:00', eta: '12:40', driverId: 'usr_jlee', driverName: 'Jordan Lee', vehicle: 'TRK-14 · 18 t', pallets: 8, weightKg: 5200, handling: 'Coolant modules — max stack 2', status: 'In transit', stopOrder: 2 },
  { id: 'SHP-88341', customer: 'Atlas Foods', origin: 'Plant A', destination: 'Atlas DC · Barendrecht', address: 'Dierensteinweg 30, Barendrecht', window: '15:00–16:00', eta: '15:20', driverId: 'usr_jlee', driverName: 'Jordan Lee', vehicle: 'TRK-14 · 18 t', pallets: 6, weightKg: 3100, handling: 'Food-grade — no co-loading with chemicals', status: 'Scheduled', stopOrder: 3 },
  { id: 'SHP-88331', customer: 'Plant A (inbound)', origin: 'Hydraflow Pumps', destination: 'Plant A · Dock D-01', address: 'Industrieweg 4, Rotterdam', window: '17:00–18:00', eta: '17:45', driverId: 'usr_rdiaz', driverName: 'Rafa Díaz', vehicle: 'TRK-09 · 7.5 t', pallets: 2, weightKg: 640, handling: 'Expedite — impeller kit for WO-48219', status: 'In transit', stopOrder: 1 },
  { id: 'SHP-88338', customer: 'Plant A (inbound)', origin: 'Port of Rotterdam', destination: 'Plant A · Dock D-06', address: 'Industrieweg 4, Rotterdam', window: '13:00–14:00', eta: '19:10', driverId: 'usr_rdiaz', driverName: 'Rafa Díaz', vehicle: 'TRK-09 · 7.5 t', pallets: 10, weightKg: 7800, handling: 'Customs hold released 12:40', status: 'Delayed', stopOrder: 2 },
  { id: 'SHP-88347', customer: 'Nordic Paper', origin: 'Plant A', destination: 'Nordic · Moerdijk', address: 'Middenweg 11, Moerdijk', window: 'Tomorrow 08:00–09:00', eta: 'Tomorrow 08:20', driverId: null, driverName: 'Unassigned', vehicle: '—', pallets: 14, weightKg: 9900, handling: 'Standard', status: 'Scheduled', stopOrder: 1 },
]

export interface StockItem {
  sku: string
  description: string
  category: string
  onHand: number
  reorderPoint: number
  reserved: number
  reservedFor?: string
  coverageDays: number
  location: string
  supplier: string
  leadTimeDays: number
}

export const STOCK: StockItem[] = [
  { sku: 'IMP-204-316SS-RC', description: 'Impeller, 316SS — P-204', category: 'Impellers', onHand: 1, reorderPoint: 2, reserved: 1, reservedFor: 'WO-48219', coverageDays: 9, location: 'MRO · B-03-2', supplier: 'Hydraflow Pumps', leadTimeDays: 12 },
  { sku: 'BRG-6320-2Z-C3', description: 'Deep-groove bearing — C-310 DE', category: 'Bearings', onHand: 2, reorderPoint: 4, reserved: 1, reservedFor: 'WO-48213', coverageDays: 12, location: 'MRO · A-11-4', supplier: 'Apex Bearings Co.', leadTimeDays: 6 },
  { sku: 'LUB-ISO-VG46', description: 'Turbine oil ISO VG 46 (208 L)', category: 'Lubricants', onHand: 3, reorderPoint: 5, reserved: 0, coverageDays: 11, location: 'Hazmat · H-02', supplier: 'Northline Lubricants', leadTimeDays: 4 },
  { sku: 'SEAL-M7N-45', description: 'Mechanical seal cartridge', category: 'Seals', onHand: 6, reorderPoint: 4, reserved: 0, coverageDays: 19, location: 'MRO · B-07-1', supplier: 'Meridian Seals', leadTimeDays: 9 },
  { sku: 'FLT-HYD-10U', description: 'Hydraulic filter 10 µm', category: 'Filters', onHand: 48, reorderPoint: 24, reserved: 6, coverageDays: 33, location: 'MRO · C-01-3', supplier: 'Meridian Seals', leadTimeDays: 5 },
  { sku: 'CM-40-FG', description: 'Coolant module CM-40 (finished good)', category: 'Finished goods', onHand: 184, reorderPoint: 120, reserved: 26, coverageDays: 14, location: 'Zone A · A-22', supplier: 'Plant A · Line 1', leadTimeDays: 2 },
]
