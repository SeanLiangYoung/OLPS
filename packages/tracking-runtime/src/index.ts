import { captureAttribution } from './attribution.js'
import { readTrackingConfig, resolveTexts } from './config.js'
import { createConsentController, readConsent } from './consent.js'
import { createOlpsGlobal, emit, installAutoEvents } from './events.js'
import { applyPlatforms, initPlatformDefaults } from './platforms/index.js'
import type { ConsentState, OlpsGlobal } from './types.js'
import { installNativeEvents } from './native-events.js'

declare global {
  interface Window {
    olps: OlpsGlobal
  }
}

function boot(): void {
  const config = readTrackingConfig()
  const texts = resolveTexts(config)
  captureAttribution()
  initPlatformDefaults()
  installAutoEvents()

  const pageViewSent = {analytics:false,advertising:false}
  let currentConsent:ConsentState={analytics:false,advertising:false}
  installNativeEvents(config,()=>currentConsent)

  function onConsentChange(state: ConsentState): void {
    currentConsent=state
    applyPlatforms(config, state)
    const analytics=state.analytics&&!pageViewSent.analytics
    const advertising=state.advertising&&!pageViewSent.advertising
    if (analytics||advertising) {
      pageViewSent.analytics ||= analytics
      pageViewSent.advertising ||= advertising
      emit('page_view', {
        pageViewCategory:analytics&&advertising?'all':analytics?'analytics':'advertising',
        page_location: window.location.href,
        page_title: document.title,
      })
    }
  }

  const consent = createConsentController({
    config,
    texts,
    onChange: onConsentChange,
  })

  window.olps = createOlpsGlobal(() => readConsent() ?? consent.getConsent())
}

boot()
