import { createContext, useContext } from 'react'
import { isViewId, type ViewId } from '../data/nav.ts'

/**
 * Client-side route: `#/<view>` or `#/<view>/<tab>`.
 * Views push history entries (back/forward works); tab switches replace the
 * current entry so the URL stays shareable without flooding history.
 */
export interface ParsedRoute {
  view: ViewId | null
  tab: string | null
}

export function parseHash(hash: string = window.location.hash): ParsedRoute {
  const [v, t] = hash.replace(/^#\/?/, '').split('/')
  return { view: v && isViewId(v) ? v : null, tab: t ? decodeURIComponent(t) : null }
}

export const hashFor = (view: ViewId, tab?: string | null) => `#/${view}${tab ? `/${encodeURIComponent(tab)}` : ''}`

export interface RouteCtx {
  view: ViewId
  tab: string | null
  navigate: (view: ViewId, tab?: string) => void
  setTab: (tab: string) => void
}

export const RouteContext = createContext<RouteCtx | null>(null)

export function useRoute(): RouteCtx {
  const ctx = useContext(RouteContext)
  if (!ctx) throw new Error('useRoute must be used inside RouteContext.Provider')
  return ctx
}

/** Resolves the active tab for the current view from the URL, falling back to the first permitted tab. */
export function useTab<T extends string>(ids: readonly T[]): [T, (t: T) => void] {
  const { tab, setTab } = useRoute()
  const active = (ids as readonly string[]).includes(tab ?? '') ? (tab as T) : ids[0]
  return [active, setTab as (t: T) => void]
}
