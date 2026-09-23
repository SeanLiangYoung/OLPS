import type { SiteSettings } from './types.js'

export function defaultSiteSettings(screenCap = 20): SiteSettings {
  return {
    defaultLocale: 'en',
    locales: ['en'],
    screenCap,
    analyticsEnabled: true,
    mapsEnabled: false,
    mapsApiKey: '',
    whatsappEnabled: false,
    whatsappNumber: '',
    whatsappLabel: 'Chat on WhatsApp',
  }
}
