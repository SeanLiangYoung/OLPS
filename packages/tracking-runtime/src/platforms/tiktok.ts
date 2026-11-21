import { loadScript } from './load-script.js'
import type { ConsentState, EventPayload, TrackingConfig } from '../types.js'

type TtqFn = ((...args: unknown[]) => void) & {
  [key:string]:unknown
  calls: unknown[][]
  methods: string[]
  setAndDefer: (target: TtqFn, method: string) => void
  load: (pixelId: string) => void
  page: () => void
  track: (event: string, props?: Record<string, unknown>) => void
  instance: (pixelId: string) => TtqFn
  _i?: Record<string, TtqFn>
}

declare global {
  interface Window {
    TiktokAnalyticsObject: string
    ttq: TtqFn
  }
}

function ensureTtq(): TtqFn {
  if (typeof window.ttq === 'function') {
    return window.ttq
  }
  const ttq = function (...args: unknown[]) {
    ttq.calls.push(args)
  } as TtqFn
  ttq.calls = []
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']
  ttq.setAndDefer = (target, method) => {
    target[method] = function (...args: unknown[]) {
      target.calls.push([method, ...args])
    }
  }
  for (const method of ttq.methods) {
    ttq.setAndDefer(ttq, method)
  }
  ttq.instance = (pixelId) => {
    ttq._i = ttq._i || {}
    if (!ttq._i[pixelId]) {
      const inst = function (...args: unknown[]) {
        inst.calls.push(args)
      } as TtqFn
      inst.calls = []
      inst.methods = ttq.methods
      inst.setAndDefer = ttq.setAndDefer
      for (const method of ttq.methods) {
        inst.setAndDefer(inst, method)
      }
      ttq._i[pixelId] = inst
    }
    return ttq._i[pixelId]
  }
  ttq.load = (pixelId: string) => {
    ttq.calls.push(['load', pixelId])
    loadScript('https://analytics.tiktok.com/i18n/pixel/events.js')
  }
  ttq.page = () => {
    ttq.calls.push(['page'])
  }
  ttq.track = (event, props) => {
    ttq.calls.push(['track', event, props])
  }
  window.TiktokAnalyticsObject = 'ttq'
  window.ttq = ttq
  return ttq
}

export function loadTiktok(config: TrackingConfig, state: ConsentState): void {
  if (!state.advertising) return
  const pixelId = config.connectors.tiktok?.pixelId
  if (!pixelId) return
  const ttq = ensureTtq()
  ttq.load(pixelId)
  ttq.page()
}

export function trackTiktokEvent(
  config: TrackingConfig,
  state: ConsentState,
  event: string,
  payload: EventPayload,
): void {
  if (!state.advertising || !config.connectors.tiktok?.pixelId) return
  const ttq = ensureTtq()
  if (event === 'page_view') {
    ttq.track('Pageview', { event_id: payload.event_id })
    return
  }
  if (event === 'inquiry_submit' && config.conversions?.inquiry_submit !== false) {
    ttq.track('SubmitForm', { event_id: payload.event_id })
    return
  }
  if (
    (event === 'whatsapp_click' && config.conversions?.whatsapp_click !== false) ||
    (event === 'phone_click' && config.conversions?.phone_click !== false) ||
    (event === 'email_click' && config.conversions?.email_click !== false)
  ) {
    ttq.track('Contact', { event_id: payload.event_id })
  }
}
