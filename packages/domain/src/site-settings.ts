import type { EntityId, SchemaVersion } from './content.js'
import type { LocaleCode, LocaleDefinition } from './locales.js'

export type CompanyInfo = {
  name: string
  address: string
  phone: string
  email: string
}

export type SocialLink = {
  platform: string
  url: string
}

export type ManagedSiteSettings = {
  schemaVersion: SchemaVersion
  siteName: string
  siteUrl: string
  company: CompanyInfo
  iconMediaId: EntityId | null
  socialLinks: SocialLink[]
  locales: LocaleDefinition[]
  defaultLocale: LocaleCode
  search: {
    allowIndexing: boolean
    allowAiSearch: boolean
    allowAiTraining: boolean
  }
}
