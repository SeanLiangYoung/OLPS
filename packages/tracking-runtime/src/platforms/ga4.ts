import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'
import {
  ensureGoogleStub,
  ensureGtagScript,
  updateGoogleConsent,
} from './google-shared.js'

export function loadGa4(config: TrackingConfig, state: ConsentState): void {
  if (!state.analytics) return
  const measurementId = config.connectors.ga4?.measurementId
  if (!measurementId) return
  ensureGoogleStub()
  updateGoogleConsent(state)
  ensureGtagScript(measurementId)
  window.gtag('config', measurementId, { send_page_view: false })
}

export function trackGa4Event(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.analytics || !config.connectors.ga4?.measurementId) return
  ensureGoogleStub()
  const sendTo = config.connectors.ga4.measurementId
  if (event === 'page_view') {
    window.gtag('event', 'page_view', { event_id: payload.event_id, send_to: sendTo })
    return
  }
  if (event === 'inquiry_submit') {
    window.gtag('event', 'generate_lead', { event_id: payload.event_id, send_to: sendTo })
    return
  }
  if (event === 'whatsapp_click' || event === 'phone_click' || event === 'email_click') {
    window.gtag('event', 'contact', {
      event_id: payload.event_id,
      method: event,
      send_to: sendTo,
    })
    return
  }
  if (event === 'form_start') {
    window.gtag('event', 'form_start', { event_id: payload.event_id, send_to: sendTo })
  }
}
