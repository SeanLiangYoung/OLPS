import { readJsonCookie, writeJsonCookie } from './cookies.js'
import type { ConsentState, TrackingConfig, TrackingTexts } from './types.js'

export const CONSENT_COOKIE = 'olps_consent'
const CONSENT_DAYS = 180

export type ConsentChangeHandler = (state: ConsentState) => void

export function readConsent(): ConsentState | null {
  return readJsonCookie<ConsentState>(CONSENT_COOKIE)
}

export function writeConsent(state: ConsentState): void {
  writeJsonCookie(CONSENT_COOKIE, state, CONSENT_DAYS)
}

export function createConsentController(options: {
  config: TrackingConfig
  texts: TrackingTexts
  onChange: ConsentChangeHandler
}): {
  getConsent: () => ConsentState | null
  openSettings: () => void
} {
  const { config, texts, onChange } = options
  let banner: HTMLElement | null = null
  let customPanel: HTMLElement | null = null

  function hideBanner(): void {
    if (!banner) return
    banner.hidden = true
  }

  function showBanner(showCustom: boolean): void {
    if (!banner) {
      banner = buildBanner()
      document.body.appendChild(banner)
    }
    banner.hidden = false
    if (customPanel) {
      customPanel.hidden = !showCustom
    }
  }

  function apply(state: ConsentState): void {
    writeConsent(state)
    hideBanner()
    onChange(state)
  }

  function buildBanner(): HTMLElement {
    const root = document.createElement('div')
    root.setAttribute('data-olps-consent-banner', '')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-live', 'polite')
    root.style.cssText =
      'position:fixed;z-index:2147483646;left:0;right:0;bottom:0;padding:16px;background:#111;color:#fff;font:14px/1.4 sans-serif;'

    const message = document.createElement('p')
    message.textContent = texts.bannerMessage
    root.appendChild(message)

    const policy = document.createElement('a')
    policy.href = config.cookiePolicyUrl
    policy.textContent = 'Cookie'
    policy.style.color = '#9cf'
    root.appendChild(policy)

    customPanel = document.createElement('div')
    customPanel.setAttribute('data-olps-consent-custom-panel', '')
    customPanel.hidden = true
    customPanel.style.marginTop = '8px'

    const necessary = document.createElement('label')
    necessary.style.display = 'block'
    const necessaryInput = document.createElement('input')
    necessaryInput.type = 'checkbox'
    necessaryInput.checked = true
    necessaryInput.disabled = true
    necessary.appendChild(necessaryInput)
    necessary.appendChild(document.createTextNode(` ${texts.necessary}`))
    customPanel.appendChild(necessary)

    const analyticsLabel = document.createElement('label')
    analyticsLabel.style.display = 'block'
    const analyticsInput = document.createElement('input')
    analyticsInput.type = 'checkbox'
    analyticsInput.setAttribute('data-olps-consent-analytics', '')
    analyticsLabel.appendChild(analyticsInput)
    analyticsLabel.appendChild(document.createTextNode(` ${texts.analytics}`))
    customPanel.appendChild(analyticsLabel)

    const advertisingLabel = document.createElement('label')
    advertisingLabel.style.display = 'block'
    const advertisingInput = document.createElement('input')
    advertisingInput.type = 'checkbox'
    advertisingInput.setAttribute('data-olps-consent-advertising', '')
    advertisingLabel.appendChild(advertisingInput)
    advertisingLabel.appendChild(document.createTextNode(` ${texts.advertising}`))
    customPanel.appendChild(advertisingLabel)

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.setAttribute('data-olps-consent-save', '')
    saveButton.textContent = texts.save
    saveButton.addEventListener('click', () => {
      apply({
        analytics: analyticsInput.checked,
        advertising: advertisingInput.checked,
      })
    })
    customPanel.appendChild(saveButton)
    root.appendChild(customPanel)

    const actions = document.createElement('div')
    actions.style.marginTop = '12px'

    const acceptAll = document.createElement('button')
    acceptAll.type = 'button'
    acceptAll.setAttribute('data-olps-consent-accept-all', '')
    acceptAll.textContent = texts.acceptAll
    acceptAll.addEventListener('click', () => {
      apply({ analytics: true, advertising: true })
    })
    actions.appendChild(acceptAll)

    const rejectAll = document.createElement('button')
    rejectAll.type = 'button'
    rejectAll.setAttribute('data-olps-consent-reject-all', '')
    rejectAll.textContent = texts.rejectAll
    rejectAll.style.marginLeft = '8px'
    rejectAll.addEventListener('click', () => {
      apply({ analytics: false, advertising: false })
    })
    actions.appendChild(rejectAll)

    const customize = document.createElement('button')
    customize.type = 'button'
    customize.setAttribute('data-olps-consent-customize', '')
    customize.textContent = texts.customize
    customize.style.marginLeft = '8px'
    customize.addEventListener('click', () => {
      if (!customPanel) return
      customPanel.hidden = false
      const current = readConsent()
      analyticsInput.checked = current?.analytics === true
      advertisingInput.checked = current?.advertising === true
    })
    actions.appendChild(customize)

    root.appendChild(actions)
    return root
  }

  function openSettings(): void {
    showBanner(true)
  }

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest('[data-olps-cookie-settings]')
    if (!link) return
    event.preventDefault()
    openSettings()
  })

  const existing = readConsent()
  if (existing) {
    onChange(existing)
  } else {
    showBanner(false)
  }

  return {
    getConsent: readConsent,
    openSettings,
  }
}
