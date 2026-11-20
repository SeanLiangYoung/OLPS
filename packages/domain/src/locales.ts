export type LocaleCode = string

export type LocaleDefinition = {
  code: LocaleCode
  dir: 'ltr' | 'rtl'
}

export const builtInLocales = ['en', 'zh-CN'] as const

export const rtlLanguageCodes = [
  'ar',
  'dv',
  'fa',
  'he',
  'ku',
  'ps',
  'sd',
  'ug',
  'ur',
] as const

export function canonicalizeLocale(locale: string): LocaleCode {
  return Intl.getCanonicalLocales(locale)[0]
}

export function isLocaleCode(locale: string): boolean {
  return Intl.getCanonicalLocales(locale)[0] === locale
}

export function getLocaleDirection(locale: string): LocaleDefinition['dir'] {
  const language = new Intl.Locale(locale).language
  return (rtlLanguageCodes as readonly string[]).includes(language) ? 'rtl' : 'ltr'
}
