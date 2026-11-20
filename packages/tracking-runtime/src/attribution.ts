import { readJsonCookie, writeJsonCookie } from './cookies.js'
import type { Attribution } from './types.js'

export const ATTRIBUTION_COOKIE = 'olps_attribution'
const ATTRIBUTION_DAYS = 90

const CLICK_IDS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'ttclid',
  'msclkid',
] as const

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

export function captureAttribution(location: Location = window.location): Attribution {
  const existing = readJsonCookie<Attribution>(ATTRIBUTION_COOKIE) ?? {}
  const params = new URLSearchParams(location.search)
  const next: Attribution = { ...existing }

  for (const key of CLICK_IDS) {
    const value = params.get(key)
    if (value) next[key] = value
  }
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) next[key] = value
  }

  if (!next.landingPage) {
    next.landingPage = `${location.pathname}${location.search}`
  }
  if (!next.referrer && document.referrer) {
    next.referrer = document.referrer
  }

  writeJsonCookie(ATTRIBUTION_COOKIE, next, ATTRIBUTION_DAYS)
  return next
}

export function getAttribution(): Attribution {
  return readJsonCookie<Attribution>(ATTRIBUTION_COOKIE) ?? {}
}
