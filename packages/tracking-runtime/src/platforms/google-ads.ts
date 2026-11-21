import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'
import {
  ensureGoogleStub,
  ensureGtagScript,
  updateGoogleConsent,
} from './google-shared.js'

export function loadGoogleAds(config: TrackingConfig, state: ConsentState): void {
  if (!state.advertising) return
  const conversionId = config.connectors.googleAds?.conversionId
  if (!conversionId) return
  ensureGoogleStub()
  updateGoogleConsent(state)
  ensureGtagScript(conversionId)
  window.gtag('config', conversionId)
}

export function trackGoogleAdsEvent(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.advertising) return
  if (event !== 'inquiry_submit' || config.conversions?.inquiry_submit === false) return
  const ads = config.connectors.googleAds
  if (!ads?.conversionId) return
  ensureGoogleStub()
  const sendTo = ads.conversionLabel
    ? `${ads.conversionId}/${ads.conversionLabel}`
    : ads.conversionId
  window.gtag('event', 'conversion', {
    send_to: sendTo,
    event_id: payload.event_id,
    transaction_id: payload.event_id,
  })
}
