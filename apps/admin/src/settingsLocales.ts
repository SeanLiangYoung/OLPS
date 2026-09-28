import type { SiteSettings } from './types'

export function parseLocalesText(localesText: string): string[] {
  return localesText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function buildDraftSettingsForSave(
  settings: SiteSettings,
  localesText: string,
): SiteSettings {
  const locales = parseLocalesText(localesText)
  if (!locales.length) {
    throw new Error('至少填写一种语言')
  }
  const defaultLocale = settings.defaultLocale.trim()
  if (!defaultLocale) {
    throw new Error('请填写默认语言')
  }
  if (!locales.includes(defaultLocale)) {
    throw new Error('默认语言必须包含在语言列表中')
  }
  return {
    ...settings,
    locales,
    defaultLocale,
  }
}
