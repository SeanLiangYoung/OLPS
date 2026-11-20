import { loadScript } from './load-script.js'
import type { ConsentState, TrackingConfig } from '../types.js'

type ClarityFn = ((...args: unknown[]) => void) & {
  calls: unknown[][]
  q?: unknown[][]
}

declare global {
  interface Window {
    clarity: ClarityFn
  }
}

function ensureClarity(): ClarityFn {
  if (typeof window.clarity === 'function') {
    return window.clarity
  }
  const clarity = function (...args: unknown[]) {
    clarity.calls.push(args)
    clarity.q = clarity.q || []
    clarity.q.push(args)
  } as ClarityFn
  clarity.calls = []
  clarity.q = []
  window.clarity = clarity
  return clarity
}

export function loadClarity(config: TrackingConfig, state: ConsentState): void {
  if (!state.analytics) return
  const projectId = config.connectors.clarity?.projectId
  if (!projectId) return
  ensureClarity()
  loadScript(`https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`)
}
