import type {
  AgentAction,
  InferenceResult,
  PresetId,
  Signal,
  SignalKey,
  SpectrumBin,
  Telemetry,
} from './types.ts'

/**
 * Deterministic demo datasets. Pure module (no DOM / Vite APIs) so it can be
 * used by the app, by tests, and by `scripts/generate-mock.ts` to emit
 * `public/mock_data.json`.
 */

export const SAMPLES = 64
export const WINDOW_SECONDS = 2
export const DEVICE = 'NVIDIA A100-SXM4-80GB · Brev'

export interface PresetMeta {
  id: PresetId
  label: string
  assetId: string
  tagline: string
  tone: 'ok' | 'warn' | 'critical'
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'healthy_baseline',
    label: 'Healthy Baseline',
    assetId: 'GT-101',
    tagline: 'Gas turbine · nominal envelope',
    tone: 'ok',
  },
  {
    id: 'bearing_degradation',
    label: 'Bearing Degradation',
    assetId: 'C-310',
    tagline: 'Compressor · DE bearing wear',
    tone: 'warn',
  },
  {
    id: 'pump_cavitation',
    label: 'Pump Cavitation',
    assetId: 'P-204',
    tagline: 'Process pump · NPSH collapse',
    tone: 'critical',
  },
]

/* ---------------------------------------------------------------- helpers */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100
const smooth = (t: number) => t * t * (3 - 2 * t)
/** 0 before `start`, easing to 1 at t = 1. */
const ramp = (t: number, start: number) => (t <= start ? 0 : smooth((t - start) / (1 - start)))

function series(seed: number, fn: (t: number, noise: number, i: number) => number): number[] {
  const rand = rng(seed)
  return Array.from({ length: SAMPLES }, (_, i) => {
    const t = i / (SAMPLES - 1)
    return r2(fn(t, rand() * 2 - 1, i))
  })
}

function signal(
  key: SignalKey,
  values: number[],
  warn: number,
  alarm: number,
  limit: 'upper' | 'lower' = 'upper',
  current?: number,
): Signal {
  if (current !== undefined) values[values.length - 1] = current
  const meta: Record<SignalKey, { label: string; unit: string }> = {
    vibration: { label: 'Vibration velocity', unit: 'mm/s RMS' },
    pressure: { label: 'Discharge pressure', unit: 'bar' },
    bearing_temp: { label: 'Bearing temperature', unit: '°C' },
    torque: { label: 'Motor torque', unit: '%' },
  }
  return { key, ...meta[key], values, sample_rate_hz: 25600, warn, alarm, limit }
}

function spectrum(peaks: Array<[order: number, amp: number, width: number]>, floor: (o: number) => number, seed: number): SpectrumBin[] {
  const rand = rng(seed)
  const bins: SpectrumBin[] = []
  for (let order = 0.5; order <= 10.001; order += 0.25) {
    let amp = floor(order) * (0.8 + rand() * 0.4)
    for (const [o, a, w] of peaks) amp += a * Math.exp(-((order - o) ** 2) / (2 * w * w))
    bins.push({ order: r2(order), amplitude: r2(amp) })
  }
  return bins
}

function trace(steps: Array<[agent: string, action: string, ms: number]>): AgentAction[] {
  return steps.map(([agent, action, duration_ms], i) => ({
    step: i + 1,
    agent,
    action,
    status: 'complete',
    duration_ms,
  }))
}

function telemetry(request_id: string, timestamp: string, gpu_utilization: number, memory_used_gb: number): Telemetry {
  return {
    request_id,
    timestamp,
    latency_ms: 38,
    device: DEVICE,
    gpu_utilization,
    memory_used_gb,
    memory_total_gb: 80,
    status: 'operational',
  }
}

/* ---------------------------------------------------------------- presets */

function healthyBaseline(): InferenceResult {
  return {
    telemetry: telemetry('req_2c81e0f4-gt101', '2026-09-27T14:28:51.204Z', 41, 19.2),
    input: { source: 'opcua://plant-a/turbine-hall/GT-101', preset: 'Healthy Baseline', frame_id: 18344 },
    asset: {
      id: 'GT-101',
      name: 'Gas Turbine Generator 1',
      type: 'turbine',
      model: 'Industrial GT · 13 MW single-shaft',
      location: 'Plant A · Turbine Hall',
      rated_rpm: 3600,
      shaft_hz: 60,
      health_score: 96,
      remaining_useful_life_hours: 11800,
    },
    signals: [
      signal('vibration', series(11, (t, n) => 1.38 + 0.08 * Math.sin(t * 18) + n * 0.07), 2.8, 4.5, 'upper', 1.4),
      signal('pressure', series(12, (t, n) => 14.2 + 0.1 * Math.sin(t * 9) + n * 0.06), 15.5, 16.5, 'upper', 14.2),
      signal('bearing_temp', series(13, (t, n) => 67.8 + 0.6 * t + n * 0.15), 85, 95, 'upper', 68.4),
      signal('torque', series(14, (t, n) => 72 + 1.2 * Math.sin(t * 7) + n * 0.6), 90, 100),
    ],
    spectrum: spectrum([[1, 1.2, 0.08], [2, 0.18, 0.08], [3, 0.06, 0.08]], (o) => 0.05 + 0.004 * o, 15),
    detections: [],
    diagnosis: {
      fault: 'No anomaly — nominal operation',
      component: 'Full rotor train',
      failure_mode: 'None detected',
      confidence: 0.991,
      evidence: [
        '1× running speed dominant; higher harmonics < 15% of 1× amplitude',
        'Vibration 1.4 mm/s RMS — ISO 10816-3 zone A (new machine condition)',
        'All four channels within ±2σ of the 30-day learned baseline',
      ],
      anomaly_score: series(16, (t, n) => 0.12 + 0.03 * Math.sin(t * 11) + n * 0.025),
      threshold: 0.7,
    },
    summary: { total_detections: 0, critical_count: 0, overall_confidence: 0.991 },
    standards_validation: {
      engine: 'Deterministic physics & standards gate v2.4',
      verdict: 'NO_ACTION',
      independently_validated: true,
      rationale: 'All condition limits satisfied. No command generated; continuous monitoring continues.',
      checks: [
        { id: 'chk-1', standard: 'ISO 10816-3', parameter: 'Vibration velocity RMS', measured: 1.4, allowed_min: null, allowed_max: 2.8, unit: 'mm/s', result: 'PASS', scope: 'condition' },
        { id: 'chk-2', standard: 'OEM limit', parameter: 'Bearing temperature', measured: 68.4, allowed_min: null, allowed_max: 85, unit: '°C', result: 'PASS', scope: 'condition' },
        { id: 'chk-3', standard: 'ISO 3977-3', parameter: 'Compressor discharge pressure', measured: 14.2, allowed_min: null, allowed_max: 15.5, unit: 'bar', result: 'PASS', scope: 'condition' },
      ],
    },
    mitigation_command: null,
    maintenance_ticket: null,
    impact: {
      avoided_downtime_hours: 0,
      avoided_cost_usd: 0,
      throughput_maintained_pct: 100,
      traditional_outcome: 'Calendar-based inspection route · issues found only after an alarm',
      nexus_outcome: 'Continuous GPU-scored monitoring · verified healthy, zero operator effort',
    },
    actions: trace([
      ['Telemetry Ingest', 'Aligned 4 channels · 25.6 kHz capture + 64-min trend from OPC UA historian', 5],
      ['Neural Anomaly Engine', 'Scored window with temporal transformer (FP16 · TensorRT) · score 0.14', 22],
      ['Diagnosis Agent', 'Classified operating state: nominal · 99.1% confidence', 7],
      ['Physics & Standards Gate', 'Evaluated 3 deterministic checks · all PASS', 3],
      ['Action Generator', 'No intervention required · continue monitoring', 1],
    ]),
  }
}

function bearingDegradation(): InferenceResult {
  return {
    telemetry: telemetry('req_9b47d2aa-c310', '2026-09-27T14:30:17.862Z', 58, 22.7),
    input: { source: 'opcua://plant-a/compression/C-310', preset: 'Bearing Degradation', frame_id: 22917 },
    asset: {
      id: 'C-310',
      name: 'Centrifugal Compressor Train B',
      type: 'compressor',
      model: 'Centrifugal · 2-stage · 1.8 MW',
      location: 'Plant A · Compression Bay 3',
      rated_rpm: 2980,
      shaft_hz: 49.7,
      health_score: 61,
      remaining_useful_life_hours: 216,
    },
    signals: [
      signal('vibration', series(21, (t, n, i) => 2.1 + 3.5 * ramp(t, 0.45) + (i % 7 === 0 ? 0.55 * ramp(t, 0.5) : 0) + n * 0.12), 4.5, 7.1, 'upper', 5.8),
      signal('pressure', series(22, (t, n) => 8.4 - 0.25 * ramp(t, 0.6) + 0.08 * Math.sin(t * 12) + n * 0.05), 9.5, 10.2),
      signal('bearing_temp', series(23, (t, n) => 74 + 14.4 * ramp(t, 0.35) + n * 0.25), 85, 95, 'upper', 88.4),
      signal('torque', series(24, (t, n) => 81 + 3.2 * ramp(t, 0.6) * Math.sin(t * 60) + n * 0.7), 90, 100),
    ],
    spectrum: spectrum(
      [[1, 1.0, 0.08], [2, 0.22, 0.08], [3.2, 0.34, 0.07], [4.2, 1.35, 0.07], [5.2, 0.38, 0.07], [8.4, 0.26, 0.08]],
      (o) => 0.07 + 0.006 * o,
      25,
    ),
    detections: [
      { id: 'det-01', label: 'Inner-race defect harmonic (4.2×)', confidence: 0.978, severity: 'critical', signal: 'vibration', window: [36, 63], evidence: 'Non-linear harmonic at 4.2× shaft frequency (208.7 Hz) with ±1× sidebands' },
      { id: 'det-02', label: 'Bearing thermal drift', confidence: 0.942, severity: 'medium', signal: 'bearing_temp', window: [26, 63], evidence: '+14.4 °C across the 64-min window, r = 0.91 correlation with vibration RMS' },
      { id: 'det-03', label: 'Load-coupled torque ripple', confidence: 0.903, severity: 'low', signal: 'torque', window: [40, 63], evidence: '±3.2% ripple at 1× — consistent with rolling-element impacting' },
    ],
    diagnosis: {
      fault: 'Inner-race bearing wear',
      component: 'Drive-end rolling bearing (DE-6320)',
      failure_mode: 'Spalling / surface fatigue — early stage',
      confidence: 0.978,
      evidence: [
        'Non-linear harmonic at 4.2× shaft frequency (208.7 Hz) with ±1× modulation sidebands',
        'Vibration 5.8 mm/s RMS — up 176% vs 30-day baseline, kurtosis 6.3 (impulsive)',
        'Bearing temperature +14.4 °C across the 64-min window, correlated with vibration (r = 0.91)',
      ],
      anomaly_score: series(26, (t, n) => 0.18 + 0.76 * ramp(t, 0.4) + n * 0.03),
      threshold: 0.7,
    },
    summary: { total_detections: 3, critical_count: 1, overall_confidence: 0.978 },
    standards_validation: {
      engine: 'Deterministic physics & standards gate v2.4',
      verdict: 'INTERVENTION_AUTHORIZED',
      independently_validated: true,
      rationale: 'Condition violation confirmed by physics limits; proposed command stays inside the surge-safe operating envelope.',
      checks: [
        { id: 'chk-1', standard: 'ISO 10816-3', parameter: 'Vibration velocity RMS (zone B/C)', measured: 5.8, allowed_min: null, allowed_max: 4.5, unit: 'mm/s', result: 'VIOLATION', scope: 'condition' },
        { id: 'chk-2', standard: 'OEM limit', parameter: 'DE bearing temperature', measured: 88.4, allowed_min: null, allowed_max: 95, unit: '°C', result: 'PASS', scope: 'condition' },
        { id: 'chk-3', standard: 'API 617', parameter: 'Speed setpoint vs surge line', measured: 2622, allowed_min: 2380, allowed_max: 2980, unit: 'rpm', result: 'PASS', scope: 'command_envelope' },
        { id: 'chk-4', standard: 'Process spec', parameter: 'Discharge pressure after action', measured: 7.6, allowed_min: 7.0, allowed_max: null, unit: 'bar', result: 'PASS', scope: 'command_envelope' },
        { id: 'chk-5', standard: 'OEM lube spec', parameter: 'Lube-oil flow setpoint', measured: 42, allowed_min: 30, allowed_max: 48, unit: 'L/min', result: 'PASS', scope: 'command_envelope' },
      ],
    },
    mitigation_command: {
      command_id: 'CMD-C310-0927-0412',
      target: 'PLC-3 · Compressor Train B',
      protocol: 'OPC UA · IEC 62443 zone 2',
      mode: 'simulated',
      status: 'acknowledged',
      ack_ms: 212,
      intent: 'Unload the DE bearing and cut thermal stress while Train B stays online',
      operations: [
        { tag: 'C310.VFD.SPEED_SP', description: 'Reduce motor speed 12%', from: 2980, to: 2622, unit: 'rpm' },
        { tag: 'C310.LOAD.SP', description: 'Lower load setpoint', from: 100, to: 85, unit: '%' },
        { tag: 'C310.LUBE.FLOW_SP', description: 'Raise lube-oil flow', from: 35, to: 42, unit: 'L/min' },
      ],
    },
    maintenance_ticket: {
      ticket_id: 'WO-48213',
      system: 'CMMS (simulated)',
      severity: 'critical',
      title: 'Replace drive-end bearing on C-310',
      component: 'DE rolling bearing · position B2',
      replacement_sku: 'BRG-6320-2Z-C3',
      remaining_safe_hours: 216,
      inspection_window: 'Within 72 h · planned stop Sat 06:00–14:00',
      assigned_to: 'Rotating Equipment · Crew B',
      notes: 'Pull oil sample for ferrography; verify shaft alignment after replacement.',
    },
    impact: {
      avoided_downtime_hours: 18,
      avoided_cost_usd: 412000,
      throughput_maintained_pct: 88,
      traditional_outcome: 'Vibration alarm → emergency trip of Train B · 18 h unplanned downtime',
      nexus_outcome: 'Validated 12% speed reduction · Train B runs at 88% until the planned bearing swap',
    },
    actions: trace([
      ['Telemetry Ingest', 'Aligned 4 channels · 25.6 kHz capture + 64-min trend from OPC UA historian', 4],
      ['Neural Anomaly Engine', 'Scored window with temporal transformer (FP16 · TensorRT) · score 0.93', 21],
      ['Diagnosis Agent', 'Isolated 4.2× harmonic → inner-race wear · 97.8% confidence', 7],
      ['Physics & Standards Gate', 'ISO 10816-3 violation confirmed · command envelope 3/3 PASS', 3],
      ['Action Generator', 'Composed 3-tag PLC write set within validated envelope', 3],
      ['SCADA Bridge', 'Dispatched CMD-C310-0927-0412 · acknowledged (simulated)', 212],
      ['CMMS Agent', 'Created work order WO-48213 · parts reserved', 96],
    ]),
  }
}

function pumpCavitation(): InferenceResult {
  return {
    telemetry: telemetry('req_7f3a9c21-p204', '2026-09-27T14:32:08.412Z', 63, 23.4),
    input: { source: 'opcua://plant-a/cooling-loop-2/P-204', preset: 'Pump Cavitation', frame_id: 30452 },
    asset: {
      id: 'P-204',
      name: 'Cooling Water Pump P-204',
      type: 'pump',
      model: 'Centrifugal · end-suction · 250 kW',
      location: 'Plant A · Cooling Loop 2',
      rated_rpm: 1480,
      shaft_hz: 24.7,
      health_score: 48,
      remaining_useful_life_hours: 96,
    },
    signals: [
      signal('vibration', series(31, (t, n) => 2.0 + 4.1 * ramp(t, 0.5) + n * (0.12 + 0.55 * ramp(t, 0.5))), 2.8, 4.5, 'upper', 6.1),
      signal('pressure', series(32, (t, n) => 7.4 - 1.25 * ramp(t, 0.52) + 0.6 * ramp(t, 0.55) * Math.sin(t * 72) + n * 0.06), 6.5, 5.8, 'lower', 6.12),
      signal('bearing_temp', series(33, (t, n) => 64 + 7 * ramp(t, 0.4) + n * 0.2), 82, 90, 'upper', 71),
      signal('torque', series(34, (t, n) => 78 + 7.5 * ramp(t, 0.55) * Math.sin(t * 58) + n * (0.6 + 2 * ramp(t, 0.55))), 90, 100),
    ],
    spectrum: spectrum(
      [[1, 0.9, 0.08], [2, 0.24, 0.08], [5, 1.1, 0.09], [10, 0.42, 0.1]],
      (o) => 0.08 + 0.055 * o,
      35,
    ),
    detections: [
      { id: 'det-01', label: 'Cavitation broadband signature', confidence: 0.984, severity: 'critical', signal: 'vibration', window: [33, 63], evidence: 'Broadband HF energy 2–8 kHz up 11.4 dB; vane-pass (5×) with non-periodic sidebands' },
      { id: 'det-02', label: 'Discharge pressure instability', confidence: 0.971, severity: 'critical', signal: 'pressure', window: [35, 63], evidence: 'Pressure oscillation ±0.6 bar at 1.8 Hz; mean below 6.5 bar warning' },
      { id: 'det-03', label: 'Hydraulic torque fluctuation', confidence: 0.948, severity: 'medium', signal: 'torque', window: [38, 63], evidence: '±7.5% torque swing synchronous with pressure collapse events' },
    ],
    diagnosis: {
      fault: 'Suction cavitation',
      component: 'Impeller inlet · suction eye',
      failure_mode: 'Vapour-bubble collapse → impeller erosion & seal damage',
      confidence: 0.984,
      evidence: [
        'Broadband high-frequency energy (2–8 kHz) up 11.4 dB vs baseline',
        'Vane-pass harmonic at 5× shaft frequency with non-periodic sidebands',
        'NPSH margin ratio 0.93 — below the 1.10 minimum; discharge oscillating ±0.6 bar',
      ],
      anomaly_score: series(36, (t, n) => 0.16 + 0.8 * ramp(t, 0.46) + n * 0.03),
      threshold: 0.7,
    },
    summary: { total_detections: 3, critical_count: 2, overall_confidence: 0.984 },
    standards_validation: {
      engine: 'Deterministic physics & standards gate v2.4',
      verdict: 'INTERVENTION_AUTHORIZED',
      independently_validated: true,
      rationale: 'Two condition limits violated; every proposed setpoint verified inside the pump and process envelope before dispatch.',
      checks: [
        { id: 'chk-1', standard: 'ISO 10816-3', parameter: 'Vibration velocity RMS (zone C/D)', measured: 6.1, allowed_min: null, allowed_max: 4.5, unit: 'mm/s', result: 'VIOLATION', scope: 'condition' },
        { id: 'chk-2', standard: 'ANSI/HI 9.6.1', parameter: 'NPSH margin ratio (NPSHa / NPSHr)', measured: 0.93, allowed_min: 1.1, allowed_max: null, unit: '×', result: 'VIOLATION', scope: 'condition' },
        { id: 'chk-3', standard: 'OEM limit', parameter: 'Bearing temperature', measured: 71, allowed_min: null, allowed_max: 82, unit: '°C', result: 'PASS', scope: 'condition' },
        { id: 'chk-4', standard: 'Motor / VFD spec', parameter: 'Speed setpoint', measured: 1258, allowed_min: 1036, allowed_max: 1480, unit: 'rpm', result: 'PASS', scope: 'command_envelope' },
        { id: 'chk-5', standard: 'API 610', parameter: 'Minimum continuous stable flow', measured: 212, allowed_min: 140, allowed_max: null, unit: 'm³/h', result: 'PASS', scope: 'command_envelope' },
        { id: 'chk-6', standard: 'Process spec', parameter: 'Loop 2 header pressure after action', measured: 6.4, allowed_min: 6.0, allowed_max: null, unit: 'bar', result: 'PASS', scope: 'command_envelope' },
      ],
    },
    mitigation_command: {
      command_id: 'CMD-P204-0927-0418',
      target: 'PLC-7 · Cooling Water Loop 2',
      protocol: 'OPC UA · IEC 62443 zone 2',
      mode: 'simulated',
      status: 'acknowledged',
      ack_ms: 184,
      intent: 'Restore NPSH margin and suppress cavitation while Loop 2 keeps producing',
      operations: [
        { tag: 'P204.VFD.SPEED_SP', description: 'Reduce motor speed 15%', from: 1480, to: 1258, unit: 'rpm' },
        { tag: 'XV204.POS_SP', description: 'Open relief / recirculation valve', from: 0, to: 12, unit: '%' },
        { tag: 'TK201.LEVEL_SP', description: 'Raise suction tank level', from: 3.2, to: 3.5, unit: 'm' },
      ],
    },
    maintenance_ticket: {
      ticket_id: 'WO-48219',
      system: 'CMMS (simulated)',
      severity: 'critical',
      title: 'Inspect P-204 impeller for cavitation erosion',
      component: 'Impeller · suction eye / mechanical seal',
      replacement_sku: 'IMP-204-316SS-RC',
      remaining_safe_hours: 96,
      inspection_window: 'Next 48 h · Tue 22:00–02:00 low-demand window',
      assigned_to: 'Pump & Seal Team · Crew A',
      notes: 'Check suction strainer ΔP and seal faces; confirm NPSHa after tank level change.',
    },
    impact: {
      avoided_downtime_hours: 11.5,
      avoided_cost_usd: 286000,
      throughput_maintained_pct: 85,
      traditional_outcome: 'Low-pressure alarm → P-204 trips · Cooling Loop 2 offline 11.5 h',
      nexus_outcome: 'Speed −15%, recirculation +12% · cavitation suppressed, Loop 2 at 85% throughput',
    },
    actions: trace([
      ['Telemetry Ingest', 'Aligned 4 channels · 25.6 kHz capture + 64-min trend from OPC UA historian', 4],
      ['Neural Anomaly Engine', 'Scored window with temporal transformer (FP16 · TensorRT) · score 0.95', 21],
      ['Diagnosis Agent', 'Broadband HF + 5× vane-pass → suction cavitation · 98.4% confidence', 7],
      ['Physics & Standards Gate', 'ISO 10816-3 + NPSH violations confirmed · envelope 3/3 PASS', 3],
      ['Action Generator', 'Composed speed / valve / level write set within validated envelope', 3],
      ['SCADA Bridge', 'Dispatched CMD-P204-0927-0418 · acknowledged (simulated)', 184],
      ['CMMS Agent', 'Created work order WO-48219 · impeller kit reserved', 88],
    ]),
  }
}

const BUILDERS: Record<PresetId, () => InferenceResult> = {
  healthy_baseline: healthyBaseline,
  bearing_degradation: bearingDegradation,
  pump_cavitation: pumpCavitation,
}

/** Returns a fresh deep copy of the preset dataset. */
export function getPreset(id: PresetId): InferenceResult {
  return BUILDERS[id]()
}

export function presetMeta(id: PresetId): PresetMeta {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
