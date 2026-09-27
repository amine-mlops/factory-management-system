import type { Tone } from '../lib/format.ts'
import type { ModuleId } from './nav.ts'

export interface ModuleKpi {
  label: string
  value: string
  unit?: string
  delta: string
  deltaTone: Tone
  tone?: Tone
}

export type ModuleChart =
  | { kind: 'bars'; title: string; caption: string; unit: string; target?: { value: number; label: string }; data: Array<{ label: string; value: number; tone?: Tone }> }
  | { kind: 'progress'; title: string; caption: string; data: Array<{ label: string; value: number; detail: string; tone?: Tone }> }

export type Cell = string | { text: string; tone: Tone }

export interface ModuleTable {
  title: string
  columns: Array<{ key: string; label: string; align?: 'right'; mono?: boolean }>
  rows: Array<Record<string, Cell>>
}

export interface ModuleConfig {
  id: ModuleId
  eyebrow: string
  title: string
  description: string
  /** Matching Python backend module in the original repository, if any. */
  backend?: string
  kpis: ModuleKpi[]
  chart: ModuleChart
  table: ModuleTable
  action: { label: string; toast: string }
  secondary?: { label: string; toast: string }
}

export const MODULES: Record<ModuleId, ModuleConfig> = {
  manufacturing: {
    id: 'manufacturing',
    eyebrow: 'Operations · Plant A',
    title: 'Manufacturing',
    description: 'Line performance, production orders and rotating-equipment health feeding the autonomous triage agent.',
    backend: 'backend/modules/operations.py',
    kpis: [
      { label: 'Overall OEE', value: '87.2', unit: '%', delta: '+1.8 pts WoW', deltaTone: 'nv' },
      { label: 'Throughput', value: '1,284', unit: 'u/h', delta: '97% of plan', deltaTone: 'nv' },
      { label: 'Line availability', value: '96.1', unit: '%', delta: '0 unplanned stops', deltaTone: 'nv' },
      { label: 'Scrap rate', value: '1.3', unit: '%', delta: '−0.2 pts', deltaTone: 'nv' },
    ],
    chart: {
      kind: 'bars',
      title: 'OEE by production line',
      caption: 'Current shift · target 85%',
      unit: '%',
      target: { value: 85, label: 'Target 85%' },
      data: [
        { label: 'Line 1', value: 91.4 },
        { label: 'Line 2', value: 88.9 },
        { label: 'Line 3', value: 84.2, tone: 'warn' },
        { label: 'Line 4', value: 89.7 },
        { label: 'Utilities', value: 82.5, tone: 'warn' },
        { label: 'Packaging', value: 90.3 },
      ],
    },
    table: {
      title: 'Active production orders',
      columns: [
        { key: 'id', label: 'Order', mono: true },
        { key: 'product', label: 'Product' },
        { key: 'line', label: 'Line' },
        { key: 'progress', label: 'Progress', align: 'right', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { id: 'MO-77412', product: 'Coolant module CM-40', line: 'Line 1', progress: '82%', status: { text: 'On track', tone: 'nv' } },
        { id: 'MO-77415', product: 'Heat exchanger HX-12', line: 'Line 2', progress: '64%', status: { text: 'On track', tone: 'nv' } },
        { id: 'MO-77418', product: 'Pump housing PH-7', line: 'Line 3', progress: '41%', status: { text: 'Reduced rate', tone: 'warn' } },
        { id: 'MO-77421', product: 'Valve body VB-3', line: 'Line 4', progress: '23%', status: { text: 'On track', tone: 'nv' } },
        { id: 'MO-77425', product: 'Compressor skid CS-2', line: 'Packaging', progress: '9%', status: { text: 'Queued', tone: 'info' } },
      ],
    },
    action: { label: 'Open machinery triage', toast: '' },
    secondary: { label: 'Export shift report', toast: 'Shift report SR-0927-B exported (demo)' },
  },
  inventory: {
    id: 'inventory',
    eyebrow: 'Supply chain · Materials',
    title: 'Inventory',
    description: 'Stock positions, critical spares and reorder signals — spares are auto-reserved when the triage agent opens a work order.',
    kpis: [
      { label: 'Inventory value', value: '$18.4', unit: 'M', delta: '−2.1% MoM', deltaTone: 'nv' },
      { label: 'Stock accuracy', value: '99.2', unit: '%', delta: '+0.3 pts', deltaTone: 'nv' },
      { label: 'Days of supply', value: '23.6', unit: 'd', delta: 'target 20–30', deltaTone: 'info' },
      { label: 'Below reorder point', value: '14', unit: 'SKUs', delta: '2 critical spares', deltaTone: 'warn', tone: 'warn' },
    ],
    chart: {
      kind: 'bars',
      title: 'Coverage by category',
      caption: 'Days of supply · safety stock 14 d',
      unit: 'd',
      target: { value: 14, label: 'Safety 14 d' },
      data: [
        { label: 'MRO spares', value: 41 },
        { label: 'Bearings', value: 12, tone: 'warn' },
        { label: 'Seals', value: 19 },
        { label: 'Impellers', value: 9, tone: 'crit' },
        { label: 'Lubricants', value: 27 },
        { label: 'Filters', value: 33 },
      ],
    },
    table: {
      title: 'Critical spares watchlist',
      columns: [
        { key: 'sku', label: 'SKU', mono: true },
        { key: 'desc', label: 'Description' },
        { key: 'onhand', label: 'On hand', align: 'right', mono: true },
        { key: 'rop', label: 'Reorder pt', align: 'right', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { sku: 'IMP-204-316SS-RC', desc: 'Impeller, 316SS, P-204', onhand: '1', rop: '2', status: { text: 'Reserved · WO-48219', tone: 'warn' } },
        { sku: 'BRG-6320-2Z-C3', desc: 'Deep-groove bearing, C-310 DE', onhand: '2', rop: '4', status: { text: 'Reserved · WO-48213', tone: 'warn' } },
        { sku: 'SEAL-M7N-45', desc: 'Mechanical seal cartridge', onhand: '6', rop: '4', status: { text: 'In stock', tone: 'nv' } },
        { sku: 'FLT-HYD-10U', desc: 'Hydraulic filter 10 µm', onhand: '48', rop: '24', status: { text: 'In stock', tone: 'nv' } },
        { sku: 'LUB-ISO-VG46', desc: 'Turbine oil ISO VG 46 (208 L)', onhand: '3', rop: '5', status: { text: 'Below ROP', tone: 'crit' } },
      ],
    },
    action: { label: 'Create replenishment', toast: 'Replenishment request RQ-2291 drafted for 14 SKUs (demo)' },
  },
  procurement: {
    id: 'procurement',
    eyebrow: 'Supply chain · Sourcing',
    title: 'Procurement',
    description: 'Purchase orders, supplier performance and expedites triggered by predictive maintenance demand.',
    backend: 'backend/modules/procurement.py',
    kpis: [
      { label: 'Open purchase orders', value: '214', delta: '$6.2M committed', deltaTone: 'info' },
      { label: 'Spend under contract', value: '87', unit: '%', delta: '+4 pts QoQ', deltaTone: 'nv' },
      { label: 'Supplier OTIF', value: '92.4', unit: '%', delta: '−0.8 pts', deltaTone: 'warn' },
      { label: 'PO cycle time', value: '4.2', unit: 'd', delta: '−1.1 d vs Q2', deltaTone: 'nv' },
    ],
    chart: {
      kind: 'progress',
      title: 'Supplier scorecards',
      caption: 'OTIF · rolling 90 days',
      data: [
        { label: 'Apex Bearings Co.', value: 0.97, detail: '97%' },
        { label: 'Hydraflow Pumps', value: 0.94, detail: '94%' },
        { label: 'Meridian Seals', value: 0.91, detail: '91%' },
        { label: 'Northline Lubricants', value: 0.86, detail: '86%', tone: 'warn' },
        { label: 'Crestline Electrical', value: 0.81, detail: '81%', tone: 'warn' },
      ],
    },
    table: {
      title: 'Recent purchase orders',
      columns: [
        { key: 'po', label: 'PO', mono: true },
        { key: 'supplier', label: 'Supplier' },
        { key: 'category', label: 'Category' },
        { key: 'value', label: 'Value', align: 'right', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { po: 'PO-90318', supplier: 'Hydraflow Pumps', category: 'Impeller kit · expedite', value: '$18,400', status: { text: 'Expedite · WO-48219', tone: 'warn' } },
        { po: 'PO-90311', supplier: 'Apex Bearings Co.', category: 'Bearings', value: '$7,950', status: { text: 'Confirmed', tone: 'nv' } },
        { po: 'PO-90307', supplier: 'Northline Lubricants', category: 'Lubricants', value: '$12,200', status: { text: 'Awaiting ASN', tone: 'info' } },
        { po: 'PO-90299', supplier: 'Meridian Seals', category: 'Seals', value: '$5,640', status: { text: 'Received', tone: 'nv' } },
        { po: 'PO-90288', supplier: 'Crestline Electrical', category: 'VFD spares', value: '$31,900', status: { text: 'Late 3 d', tone: 'crit' } },
      ],
    },
    action: { label: 'Create purchase order', toast: 'Purchase order draft PO-90321 created (demo)' },
  },
  warehousing: {
    id: 'warehousing',
    eyebrow: 'Supply chain · Storage',
    title: 'Warehousing',
    description: 'Zone capacity, dock scheduling and pick productivity across the plant warehouse and MRO stores.',
    kpis: [
      { label: 'Capacity utilization', value: '78', unit: '%', delta: '+3 pts WoW', deltaTone: 'info' },
      { label: 'Picks per hour', value: '412', delta: '+6% vs plan', deltaTone: 'nv' },
      { label: 'Dock-to-stock', value: '3.1', unit: 'h', delta: 'target ≤ 4 h', deltaTone: 'nv' },
      { label: 'Order accuracy', value: '99.6', unit: '%', delta: 'stable', deltaTone: 'nv' },
    ],
    chart: {
      kind: 'bars',
      title: 'Zone utilization',
      caption: 'Occupied locations · alert at 90%',
      unit: '%',
      target: { value: 90, label: 'Alert 90%' },
      data: [
        { label: 'Zone A', value: 72 },
        { label: 'Zone B', value: 86 },
        { label: 'Zone C', value: 93, tone: 'warn' },
        { label: 'MRO', value: 64 },
        { label: 'Cold', value: 58 },
        { label: 'Hazmat', value: 77 },
      ],
    },
    table: {
      title: 'Dock schedule',
      columns: [
        { key: 'dock', label: 'Dock', mono: true },
        { key: 'type', label: 'Type' },
        { key: 'ref', label: 'Reference', mono: true },
        { key: 'time', label: 'Slot', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { dock: 'D-01', type: 'Inbound', ref: 'ASN-55120', time: '14:30', status: { text: 'Unloading', tone: 'info' } },
        { dock: 'D-02', type: 'Outbound', ref: 'SHP-88341', time: '14:45', status: { text: 'Loading', tone: 'info' } },
        { dock: 'D-03', type: 'Inbound', ref: 'ASN-55124', time: '15:10', status: { text: 'Scheduled', tone: 'neutral' } },
        { dock: 'D-05', type: 'Outbound', ref: 'SHP-88347', time: '15:30', status: { text: 'Staged', tone: 'nv' } },
        { dock: 'D-06', type: 'Inbound', ref: 'ASN-55131', time: '16:00', status: { text: 'Carrier late', tone: 'warn' } },
      ],
    },
    action: { label: 'Release pick wave', toast: 'Pick wave W-1182 released · 64 lines (demo)' },
  },
  distribution: {
    id: 'distribution',
    eyebrow: 'Supply chain · Fulfilment',
    title: 'Distribution',
    description: 'Distribution-center network, fill rates and backorders for finished goods.',
    kpis: [
      { label: 'Orders fulfilled today', value: '1,942', delta: '+8% vs avg', deltaTone: 'nv' },
      { label: 'Fill rate', value: '97.3', unit: '%', delta: '+0.4 pts', deltaTone: 'nv' },
      { label: 'Backorders', value: '38', delta: '−12 since Mon', deltaTone: 'nv', tone: 'warn' },
      { label: 'Network utilization', value: '81', unit: '%', delta: 'balanced', deltaTone: 'info' },
    ],
    chart: {
      kind: 'bars',
      title: 'Outbound volume by region',
      caption: 'Pallets shipped · last 24 h',
      unit: 'plt',
      data: [
        { label: 'North', value: 412 },
        { label: 'Central', value: 538 },
        { label: 'South', value: 356 },
        { label: 'West', value: 297 },
        { label: 'Export', value: 181 },
      ],
    },
    table: {
      title: 'Distribution centers',
      columns: [
        { key: 'dc', label: 'DC', mono: true },
        { key: 'city', label: 'Location' },
        { key: 'util', label: 'Utilization', align: 'right', mono: true },
        { key: 'fill', label: 'Fill rate', align: 'right', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { dc: 'DC-N1', city: 'Northgate', util: '84%', fill: '98.1%', status: { text: 'Nominal', tone: 'nv' } },
        { dc: 'DC-C2', city: 'Central Park', util: '91%', fill: '96.4%', status: { text: 'High load', tone: 'warn' } },
        { dc: 'DC-S1', city: 'Southport', util: '76%', fill: '97.9%', status: { text: 'Nominal', tone: 'nv' } },
        { dc: 'DC-W3', city: 'Westfield', util: '69%', fill: '98.6%', status: { text: 'Nominal', tone: 'nv' } },
      ],
    },
    action: { label: 'Rebalance network', toast: 'Rebalance plan RB-044 simulated · 120 pallets DC-C2 → DC-W3 (demo)' },
  },
  transportation: {
    id: 'transportation',
    eyebrow: 'Supply chain · Logistics',
    title: 'Transportation',
    description: 'In-transit shipments, carrier performance and freight cost across inbound and outbound lanes.',
    kpis: [
      { label: 'Shipments in transit', value: '86', delta: '12 arriving today', deltaTone: 'info' },
      { label: 'On-time delivery', value: '94.8', unit: '%', delta: '−0.6 pts', deltaTone: 'warn' },
      { label: 'Avg transit time', value: '2.4', unit: 'd', delta: '−0.2 d', deltaTone: 'nv' },
      { label: 'Freight cost / t', value: '$61.2', delta: '+1.9% MoM', deltaTone: 'warn' },
    ],
    chart: {
      kind: 'progress',
      title: 'Carrier on-time performance',
      caption: 'Last 30 days',
      data: [
        { label: 'Vector Freight', value: 0.98, detail: '98%' },
        { label: 'BlueLine Logistics', value: 0.96, detail: '96%' },
        { label: 'Summit Haulage', value: 0.93, detail: '93%' },
        { label: 'Harbor Express', value: 0.88, detail: '88%', tone: 'warn' },
      ],
    },
    table: {
      title: 'Shipments',
      columns: [
        { key: 'id', label: 'Shipment', mono: true },
        { key: 'lane', label: 'Lane' },
        { key: 'carrier', label: 'Carrier' },
        { key: 'eta', label: 'ETA', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { id: 'SHP-88329', lane: 'Plant A → DC-C2', carrier: 'Vector Freight', eta: '15:20', status: { text: 'On time', tone: 'nv' } },
        { id: 'SHP-88331', lane: 'Hydraflow → Plant A', carrier: 'Summit Haulage', eta: '17:45', status: { text: 'Expedited', tone: 'info' } },
        { id: 'SHP-88335', lane: 'Plant A → DC-N1', carrier: 'BlueLine Logistics', eta: 'Tomorrow', status: { text: 'On time', tone: 'nv' } },
        { id: 'SHP-88338', lane: 'Port → Plant A', carrier: 'Harbor Express', eta: '+6 h', status: { text: 'Delayed', tone: 'warn' } },
      ],
    },
    action: { label: 'Book carrier', toast: 'Carrier booking BK-7731 requested with Vector Freight (demo)' },
  },
  crm: {
    id: 'crm',
    eyebrow: 'Customers · Service',
    title: 'Customer Service / CRM',
    description: 'Customer cases, SLA compliance and at-risk accounts — proactive notices when mitigation reduces throughput.',
    backend: 'backend/modules/crm.py',
    kpis: [
      { label: 'Open cases', value: '47', delta: '−9 vs last week', deltaTone: 'nv' },
      { label: 'CSAT', value: '4.6', unit: '/ 5', delta: '+0.1', deltaTone: 'nv' },
      { label: 'First response', value: '18', unit: 'min', delta: 'SLA 30 min', deltaTone: 'nv' },
      { label: 'At-risk accounts', value: '3', delta: 'renewals < 60 d', deltaTone: 'warn', tone: 'warn' },
    ],
    chart: {
      kind: 'progress',
      title: 'SLA compliance by queue',
      caption: 'Resolved within SLA · 30 days',
      data: [
        { label: 'Order status', value: 0.97, detail: '97%' },
        { label: 'Technical support', value: 0.93, detail: '93%' },
        { label: 'Returns & RMA', value: 0.9, detail: '90%' },
        { label: 'Billing', value: 0.84, detail: '84%', tone: 'warn' },
      ],
    },
    table: {
      title: 'Priority cases',
      columns: [
        { key: 'id', label: 'Case', mono: true },
        { key: 'account', label: 'Account' },
        { key: 'subject', label: 'Subject' },
        { key: 'age', label: 'Age', align: 'right', mono: true },
        { key: 'status', label: 'Priority' },
      ],
      rows: [
        { id: 'CS-20931', account: 'Orion Chemicals', subject: 'Delivery window for CM-40 batch', age: '2 h', status: { text: 'High', tone: 'warn' } },
        { id: 'CS-20928', account: 'Helix Energy', subject: 'Proactive notice: Loop 2 at 85%', age: '14 m', status: { text: 'Info', tone: 'info' } },
        { id: 'CS-20917', account: 'Atlas Foods', subject: 'Certificate of conformity request', age: '1 d', status: { text: 'Normal', tone: 'neutral' } },
        { id: 'CS-20904', account: 'Nordic Paper', subject: 'Invoice discrepancy INV-4471', age: '2 d', status: { text: 'High', tone: 'warn' } },
      ],
    },
    action: { label: 'New case', toast: 'Case CS-20934 opened and routed to Technical support (demo)' },
  },
  it: {
    id: 'it',
    eyebrow: 'Platform · OT / IT',
    title: 'Information Technology',
    description: 'Health of the OT/IT integration layer — SCADA gateway, historian, CMMS and the planned GPU inference service (architecture target).',
    kpis: [
      { label: 'Platform uptime', value: '99.98', unit: '%', delta: '30-day SLO 99.9%', deltaTone: 'nv' },
      { label: 'OT/IT endpoints', value: '1,326', delta: '+18 onboarded', deltaTone: 'info' },
      { label: 'Security incidents', value: '0', delta: 'critical · 30 d', deltaTone: 'nv', tone: 'nv' },
      { label: 'GPU inference nodes', value: '—', delta: 'Architecture target · not provisioned', deltaTone: 'info' },
    ],
    chart: {
      kind: 'progress',
      title: 'Service availability',
      caption: 'Rolling 30 days',
      data: [
        { label: 'NEXUS web API (sample)', value: 0.9999, detail: '99.99%' },
        { label: 'OPC UA historian', value: 0.9996, detail: '99.96%' },
        { label: 'SCADA gateway (IEC 62443)', value: 0.9993, detail: '99.93%' },
        { label: 'CMMS integration', value: 0.9971, detail: '99.71%', tone: 'warn' },
      ],
    },
    table: {
      title: 'Integrations',
      columns: [
        { key: 'svc', label: 'Service' },
        { key: 'endpoint', label: 'Endpoint', mono: true },
        { key: 'latency', label: 'p95', align: 'right', mono: true },
        { key: 'status', label: 'Status' },
      ],
      rows: [
        { svc: 'Inference service (NVIDIA NIM target)', endpoint: 'POST /triage/infer', latency: '—', status: { text: 'Not deployed', tone: 'neutral' } },
        { svc: 'OPC UA historian', endpoint: 'opc.tcp://hist-01:4840', latency: '12 ms', status: { text: 'Operational', tone: 'nv' } },
        { svc: 'SCADA write gateway', endpoint: 'plc-gw.zone2', latency: '184 ms', status: { text: 'Simulation mode', tone: 'info' } },
        { svc: 'CMMS work orders', endpoint: 'cmms/api/v2', latency: '96 ms', status: { text: 'Degraded retries', tone: 'warn' } },
      ],
    },
    action: { label: 'Run health check', toast: 'Sample health check (demo) · 3 of 4 services reachable, inference not deployed' },
  },
}
