import { captureAttribution } from './attribution.js'
import { readTrackingConfig, resolveTexts } from './config.js'
import { createConsentController, readConsent } from './consent.js'
import { createOlpsGlobal, emit, installAutoEvents } from './events.js'
import { applyPlatforms, initPlatformDefaults } from './platforms/index.js'
import type { ConsentState, OlpsGlobal } from './types.js'

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

  let pageViewSent = false

  function onConsentChange(state: ConsentState): void {
    applyPlatforms(config, state)
    if (!pageViewSent) {
      pageViewSent = true
      emit('page_view', {
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
