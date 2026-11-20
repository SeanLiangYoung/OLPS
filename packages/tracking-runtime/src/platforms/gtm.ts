import { loadScript } from './load-script.js'
import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'
import { ensureGoogleStub, updateGoogleConsent } from './google-shared.js'

declare global {
  interface Window {
    dataLayer: unknown[]
  }
}

export function loadGtm(config: TrackingConfig, state: ConsentState): void {
  if (!state.analytics) return
  const containerId = config.connectors.gtm?.containerId
  if (!containerId) return
  ensureGoogleStub()
  updateGoogleConsent(state)
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  loadScript(
    `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`,
  )
}

export function trackGtmEvent(event: string, payload: EventPayload): void {
  ensureGoogleStub()
  window.dataLayer.push({
    event,
    event_id: payload.event_id,
    ...payload,
  })
}
