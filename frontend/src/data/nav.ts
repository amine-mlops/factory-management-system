import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Boxes,
  Database,
  Settings,
  Users,
  Factory,
  Headset,
  LayoutDashboard,
  Network,
  Server,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react'

export type ModuleId =
  | 'inventory'
  | 'transportation'
  | 'warehousing'
  | 'manufacturing'
  | 'procurement'
  | 'distribution'
  | 'crm'
  | 'it'

export type WorkspacePageId = 'knowledge' | 'data' | 'team' | 'settings'

export type ViewId = 'dashboard' | 'triage' | ModuleId | WorkspacePageId

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  hint: string
}

export const PRIMARY_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, hint: 'Company operations: map, alerts, next action' },
  { id: 'triage', label: 'Triage preview', icon: ShieldCheck, hint: 'Autonomous Triage · simulated machinery cockpit' },
]

export const MODULE_NAV: Array<NavItem & { id: ModuleId }> = [
  { id: 'manufacturing', label: 'Manufacturing', icon: Factory, hint: 'Lines, OEE, machinery health' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, hint: 'Perishable Expiry Guard · simulated agent' },
  { id: 'procurement', label: 'Procurement', icon: ShoppingCart, hint: 'Purchase orders & suppliers' },
  { id: 'warehousing', label: 'Warehousing', icon: Warehouse, hint: 'Zones, docks, pick rates' },
  { id: 'distribution', label: 'Distribution', icon: Network, hint: 'DC network & fulfilment' },
  { id: 'transportation', label: 'Transportation', icon: Truck, hint: 'Shipments & carriers' },
  { id: 'crm', label: 'Customer Service', icon: Headset, hint: 'CRM cases, SLAs, accounts' },
  { id: 'it', label: 'IT Services', icon: Server, hint: 'OT/IT services & integrations' },
]

export const WORKSPACE_NAV: Array<NavItem & { id: WorkspacePageId }> = [
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen, hint: 'PDFs indexed for permission-aware RAG' },
  { id: 'data', label: 'Data & Pipelines', icon: Database, hint: 'Sources, lineage, security incidents' },
  { id: 'team', label: 'Team & Access', icon: Users, hint: 'Members, invitations, roles, audit' },
  { id: 'settings', label: 'Settings', icon: Settings, hint: 'Profile, modules, integrations, security' },
]

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...MODULE_NAV, ...WORKSPACE_NAV]

export const MODULE_IDS: ModuleId[] = MODULE_NAV.map((m) => m.id)

export const isModuleId = (v: string): v is ModuleId => (MODULE_IDS as string[]).includes(v)

export const navItem = (id: ViewId): NavItem => ALL_NAV.find((n) => n.id === id) ?? PRIMARY_NAV[0]

export const isViewId = (v: string): v is ViewId => ALL_NAV.some((n) => n.id === v)
