import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'
import { on } from '../events.js'
import { applyGoogleConsentDefault, updateGoogleConsent } from './google-shared.js'
import { loadGa4, trackGa4Event } from './ga4.js'
import { loadGoogleAds, trackGoogleAdsEvent } from './google-ads.js'
import { loadGtm, trackGtmEvent } from './gtm.js'
import { loadMeta, revokeMetaConsent, trackMetaEvent } from './meta.js'
import { loadTiktok, trackTiktokEvent } from './tiktok.js'
import { loadLinkedIn, trackLinkedInEvent } from './linkedin.js'
import { loadClarity } from './clarity.js'
import { loadUet, trackUetEvent } from './uet.js'

let currentConsent: ConsentState | null = null
let platformsReady = false

export function initPlatformDefaults(): void {
  applyGoogleConsentDefault()
  revokeMetaConsent()
}

export function applyPlatforms(config: TrackingConfig, state: ConsentState): void {
  currentConsent = state
  updateGoogleConsent(state)

  if (!state.advertising) {
    revokeMetaConsent()
  }

  if (state.analytics) {
    loadGa4(config, state)
    loadGtm(config, state)
    loadClarity(config, state)
  }

  if (state.advertising) {
    loadGoogleAds(config, state)
    loadMeta(config, state)
    loadTiktok(config, state)
    loadLinkedIn(config, state)
    loadUet(config, state)
  }

  if (!platformsReady) {
    platformsReady = true
    on('*', (payload) => {
      const eventName = String(payload.event ?? '')
      if (!eventName || !currentConsent) return
      const category=eventName==='page_view'?payload.pageViewCategory:undefined
      const consent={analytics:currentConsent.analytics&&category!=='advertising',advertising:currentConsent.advertising&&category!=='analytics'}
      dispatchToPlatforms(config, consent, eventName, payload)
    })
  }
}

function dispatchToPlatforms(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  trackGa4Event(config, state, event, payload)
  trackGoogleAdsEvent(config, state, event, payload)
  if (state.analytics && config.connectors.gtm?.containerId) {
    const mapped =
      event === 'inquiry_submit'
        ? 'generate_lead'
        : event === 'whatsapp_click' ||
            event === 'phone_click' ||
            event === 'email_click'
          ? 'contact'
          : event
    trackGtmEvent(mapped, payload)
  }
  trackMetaEvent(config, state, event, payload)
  trackTiktokEvent(config, state, event, payload)
  trackLinkedInEvent(config, state, event, payload)
  trackUetEvent(config, state, event, payload)
}
