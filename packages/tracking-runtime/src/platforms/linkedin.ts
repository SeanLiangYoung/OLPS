import { loadScript } from './load-script.js'
import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'

type LintrkFn = ((...args: unknown[]) => void) & {
  calls: unknown[][]
  q?: unknown[][]
}

declare global {
  interface Window {
    _linkedin_data_partner_ids: string[]
    lintrk: LintrkFn
  }
}

function ensureLinkedIn(partnerId: string): LintrkFn {
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || []
  if (!window._linkedin_data_partner_ids.includes(partnerId)) {
    window._linkedin_data_partner_ids.push(partnerId)
  }
  if (typeof window.lintrk === 'function') {
    return window.lintrk
  }
  const lintrk = function (...args: unknown[]) {
    lintrk.calls.push(args)
    lintrk.q = lintrk.q || []
    lintrk.q.push(args)
  } as LintrkFn
  lintrk.calls = []
  lintrk.q = []
  window.lintrk = lintrk
  return lintrk
}

export function loadLinkedIn(config: TrackingConfig, state: ConsentState): void {
  if (!state.advertising) return
  const partnerId = config.connectors.linkedin?.partnerId
  if (!partnerId) return
  ensureLinkedIn(partnerId)
  loadScript('https://snap.licdn.com/li.lms-analytics/insight.min.js')
}

export function trackLinkedInEvent(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.advertising) return
  const conversionId = config.connectors.linkedin?.conversionId
  if (!conversionId) return
  if (event !== 'inquiry_submit' || config.conversions?.inquiry_submit === false) return
  const partnerId = config.connectors.linkedin?.partnerId
  if (!partnerId) return
  const lintrk = ensureLinkedIn(partnerId)
  lintrk('track', { conversion_id: conversionId, event_id: payload.event_id })
}
