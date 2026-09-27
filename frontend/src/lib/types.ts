/**
 * NEXUS inference contract — shared by mock data (public/mock_data.json),
 * in-code presets and the live FastAPI `POST /infer` endpoint.
 *
 * The legacy keys `telemetry`, `input`, `detections`, `summary` and `actions`
 * are preserved for backend compatibility; the triage-specific blocks
 * (`asset`, `signals`, `diagnosis`, `standards_validation`, `mitigation_command`,
 * `maintenance_ticket`, `impact`) carry the closed-loop mitigation story.
 */

export type Severity = 'low' | 'medium' | 'critical'
export type SignalKey = 'vibration' | 'pressure' | 'bearing_temp' | 'torque'
export type PresetId = 'healthy_baseline' | 'bearing_degradation' | 'pump_cavitation'

export interface Telemetry {
  request_id: string
  timestamp: string
  latency_ms: number
  device: string
  gpu_utilization: number
  memory_used_gb: number
  memory_total_gb: number
  status: 'operational' | 'degraded'
}

export interface InputMeta {
  source: string
  preset: string
  /** Index of the analysed telemetry window (kept as `frame_id` for backend compatibility). */
  frame_id: number
}

export interface Asset {
  id: string
  name: string
  type: 'turbine' | 'pump' | 'compressor'
  model: string
  location: string
  rated_rpm: number
  shaft_hz: number
  health_score: number
  remaining_useful_life_hours: number
}

export interface Signal {
  key: SignalKey
  label: string
  unit: string
  /** Down-sampled window, oldest → newest. */
  values: number[]
  sample_rate_hz: number
  warn: number
  alarm: number
  /** Direction in which the limit applies. */
  limit: 'upper' | 'lower'
}

export interface SpectrumBin {
  /** Multiple of shaft frequency (1× = running speed). */
  order: number
  amplitude: number
}

export interface Detection {
  id: string
  label: string
  confidence: number
  severity: Severity
  signal: SignalKey
  /** Sample indices [start, end] within the signal window. */
  window: [number, number]
  evidence: string
}

export interface Diagnosis {
  fault: string
  component: string
  failure_mode: string
  confidence: number
  evidence: string[]
  anomaly_score: number[]
  threshold: number
}

export interface Summary {
  total_detections: number
  critical_count: number
  overall_confidence: number
}

export type GateResult = 'PASS' | 'VIOLATION'

export interface StandardsCheck {
  id: string
  standard: string
  parameter: string
  measured: number
  allowed_min: number | null
  allowed_max: number | null
  unit: string
  result: GateResult
  scope: 'condition' | 'command_envelope'
}

export interface StandardsValidation {
  engine: string
  verdict: 'NO_ACTION' | 'INTERVENTION_AUTHORIZED' | 'INTERVENTION_BLOCKED'
  independently_validated: boolean
  checks: StandardsCheck[]
  rationale: string
}

export interface CommandOperation {
  tag: string
  description: string
  from: number
  to: number
  unit: string
}

export interface MitigationCommand {
  command_id: string
  target: string
  protocol: string
  mode: 'simulated'
  status: 'acknowledged' | 'pending' | 'rejected'
  ack_ms: number
  operations: CommandOperation[]
  intent: string
}

export interface MaintenanceTicket {
  ticket_id: string
  system: string
  severity: Severity
  title: string
  component: string
  replacement_sku: string
  remaining_safe_hours: number
  inspection_window: string
  assigned_to: string
  notes: string
}

export interface Impact {
  avoided_downtime_hours: number
  avoided_cost_usd: number
  throughput_maintained_pct: number
  traditional_outcome: string
  nexus_outcome: string
}

export interface AgentAction {
  step: number
  agent: string
  action: string
  status: 'complete' | 'running'
  duration_ms: number
}

export interface InferenceResult {
  telemetry: Telemetry
  input: InputMeta
  asset: Asset
  signals: Signal[]
  spectrum: SpectrumBin[]
  detections: Detection[]
  diagnosis: Diagnosis
  summary: Summary
  standards_validation: StandardsValidation
  mitigation_command: MitigationCommand | null
  maintenance_ticket: MaintenanceTicket | null
  impact: Impact
  actions: AgentAction[]
}

export interface InferenceRequest {
  asset_id: string
  preset: PresetId
  model: string
  anomaly_threshold: number
  safety_margin_pct: number
  source: string
}
