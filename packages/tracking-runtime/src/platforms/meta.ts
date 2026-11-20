import { loadScript } from './load-script.js'
import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'

type FbqFn = ((...args: unknown[]) => void) & {
  calls: unknown[][]
  queue: unknown[][]
  loaded?: boolean
  version?: string
}

declare global {
  interface Window {
    fbq: FbqFn
    _fbq: FbqFn
  }
}

function ensureFbq(): FbqFn {
  if (typeof window.fbq === 'function') {
    return window.fbq
  }
  const fbq = function (...args: unknown[]) {
    fbq.calls.push(args)
    fbq.queue.push(args)
  } as FbqFn
  fbq.calls = []
  fbq.queue = []
  fbq.loaded = true
  fbq.version = '2.0'
  window.fbq = fbq
  window._fbq = fbq
  return fbq
}

export function loadMeta(config: TrackingConfig, state: ConsentState): void {
  if (!state.advertising) return
  const pixelId = config.connectors.meta?.pixelId
  if (!pixelId) return
  const fbq = ensureFbq()
  fbq('consent', 'grant')
  loadScript('https://connect.facebook.net/en_US/fbevents.js')
  fbq('init', pixelId)
}

export function revokeMetaConsent(): void {
  const fbq = ensureFbq()
  fbq('consent', 'revoke')
}

export function trackMetaEvent(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.advertising || !config.connectors.meta?.pixelId) return
  const fbq = ensureFbq()
  if (event === 'page_view') {
    fbq('track', 'PageView', { eventID: payload.event_id })
    return
  }
  if (event === 'inquiry_submit' && config.conversions?.inquiry_submit !== false) {
    fbq('track', 'Lead', { eventID: payload.event_id })
    return
  }
  if (
    (event === 'whatsapp_click' && config.conversions?.whatsapp_click !== false) ||
    (event === 'phone_click' && config.conversions?.phone_click !== false) ||
    (event === 'email_click' && config.conversions?.email_click !== false)
  ) {
    fbq('track', 'Contact', { eventID: payload.event_id })
  }
}
