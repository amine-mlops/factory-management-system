import type { PresetId } from '../lib/types.ts'
import type { Tone } from '../lib/format.ts'

/** Machinery cards for the Manufacturing preview (mock data — Manufacturing is not integrated yet). */
export interface MachineCard {
  id: string
  name: string
  type: 'turbine' | 'pump' | 'compressor'
  location: string
  health: number
  status: string
  tone: Tone
  preset: PresetId
  vibration: number
  vibrationUnit: string
  rul: string
  trend: number[]
}

export const MACHINES: MachineCard[] = [
  {
    id: 'P-204',
    name: 'Cooling Water Pump',
    type: 'pump',
    location: 'Cooling Loop 2',
    health: 48,
    status: 'Cavitation risk',
    tone: 'crit',
    preset: 'pump_cavitation',
    vibration: 6.1,
    vibrationUnit: 'mm/s',
    rul: '96 h',
    trend: [2.0, 2.1, 2.0, 2.2, 2.4, 2.9, 3.6, 4.4, 5.1, 5.7, 6.1],
  },
  {
    id: 'C-310',
    name: 'Compressor Train B',
    type: 'compressor',
    location: 'Compression Bay 3',
    health: 61,
    status: 'Bearing degradation',
    tone: 'warn',
    preset: 'bearing_degradation',
    vibration: 5.8,
    vibrationUnit: 'mm/s',
    rul: '216 h',
    trend: [2.1, 2.2, 2.2, 2.4, 2.8, 3.3, 3.9, 4.5, 5.0, 5.4, 5.8],
  },
  {
    id: 'GT-101',
    name: 'Gas Turbine Generator 1',
    type: 'turbine',
    location: 'Turbine Hall',
    health: 96,
    status: 'Nominal',
    tone: 'nv',
    preset: 'healthy_baseline',
    vibration: 1.4,
    vibrationUnit: 'mm/s',
    rul: '11.8k h',
    trend: [1.4, 1.35, 1.42, 1.38, 1.4, 1.36, 1.41, 1.39, 1.37, 1.4, 1.4],
  },
]
