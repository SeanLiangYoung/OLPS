import { loadScript } from './load-script.js'
import type { ConsentState } from '../types.js'

type GtagFn = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: GtagFn
  }
}

let gtagLoaded = false

export function ensureGoogleStub(): void {
  window.dataLayer = window.dataLayer || []
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer.push(args)
    }
  }
}

export function applyGoogleConsentDefault(): void {
  ensureGoogleStub()
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  })
}

export function updateGoogleConsent(state: ConsentState): void {
  ensureGoogleStub()
  window.gtag('consent', 'update', {
    ad_storage: state.advertising ? 'granted' : 'denied',
    ad_user_data: state.advertising ? 'granted' : 'denied',
    ad_personalization: state.advertising ? 'granted' : 'denied',
    analytics_storage: state.analytics ? 'granted' : 'denied',
  })
}

export function ensureGtagScript(id: string): void {
  if (gtagLoaded) return
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`)
  window.gtag('js', new Date())
  gtagLoaded = true
}
