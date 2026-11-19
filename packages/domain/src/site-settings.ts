import type { SiteSettings } from './types.js'

export function defaultSiteSettings(): SiteSettings {
  return {
    defaultLocale: 'en',
    locales: ['en'],
    analyticsEnabled: true,
    mapsEnabled: false,
    mapsApiKey: '',
    whatsappEnabled: false,
    whatsappNumber: '',
    whatsappLabel: 'Chat on WhatsApp',
  }
}
