export type TrackingTexts = {
  bannerMessage: string
  acceptAll: string
  rejectAll: string
  customize: string
  save: string
  necessary: string
  analytics: string
  advertising: string
  cookieSettings: string
}

export type ConnectorPublicIds = {
  ga4?: { measurementId: string }
  googleAds?: { conversionId: string; conversionLabel?: string }
  gtm?: { containerId: string }
  meta?: { pixelId: string }
  tiktok?: { pixelId: string }
  linkedin?: { partnerId: string; conversionId?: string }
  clarity?: { projectId: string }
  uet?: { tagId: string }
}

export type ConversionFlags = {
  inquiry_submit?: boolean
  whatsapp_click?: boolean
  phone_click?: boolean
  email_click?: boolean
}

export type TrackingConfig = {
  connectors: ConnectorPublicIds
  conversions?: ConversionFlags
  cookiePolicyUrl: string
  locale: string
  texts?: Partial<TrackingTexts>
}

export type ConsentState = {
  analytics: boolean
  advertising: boolean
}

export type Attribution = {
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  ttclid?: string
  msclkid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  landingPage?: string
  referrer?: string
}

export type StandardEventName =
  | 'page_view'
  | 'inquiry_submit'
  | 'whatsapp_click'
  | 'phone_click'
  | 'email_click'
  | 'form_start'
  | string

export type EventPayload = Record<string, unknown> & {
  event_id: string
}

export type EventHandler = (payload: EventPayload) => void

export type OlpsGlobal = {
  on: (event: string, handler: EventHandler) => void
  emit: (event: string, payload?: Record<string, unknown>) => void
  getAttribution: () => Attribution
  getConsent: () => ConsentState | null
}
