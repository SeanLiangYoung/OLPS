import { loadScript } from './load-script.js'
import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'

declare global {
  interface Window {
    uetq: unknown[]
  }
}

function ensureUetq(): unknown[] {
  window.uetq = window.uetq || []
  return window.uetq
}

export function loadUet(config: TrackingConfig, state: ConsentState): void {
  if (!state.advertising) return
  const tagId = config.connectors.uet?.tagId
  if (!tagId) return
  const uetq = ensureUetq()
  loadScript('https://bat.bing.com/bat.js')
  uetq.push('config', { ti: tagId, enableAutoSpaTracking: true })
  uetq.push('pageLoad')
}

export function trackUetEvent(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.advertising || !config.connectors.uet?.tagId) return
  const uetq = ensureUetq()
  if (event === 'page_view') {
    uetq.push('event', 'page_view', { event_id: payload.event_id })
    return
  }
  if (event === 'inquiry_submit' && config.conversions?.inquiry_submit !== false) {
    uetq.push('event', 'submit_lead_form', { event_id: payload.event_id })
    return
  }
  if (
    (event === 'whatsapp_click' && config.conversions?.whatsapp_click !== false) ||
    (event === 'phone_click' && config.conversions?.phone_click !== false) ||
    (event === 'email_click' && config.conversions?.email_click !== false)
  ) {
    uetq.push('event', 'contact', { event_id: payload.event_id })
  }
}
