import { createContext, useContext } from 'react'
import type { Tone } from './format.ts'

export interface ToastItem {
  id: number
  message: string
  tone: Tone
}

export type Notify = (message: string, tone?: Tone) => void

export const ToastContext = createContext<Notify>(() => undefined)

export const useNotify = () => useContext(ToastContext)
