import type { EntityId, ExternalLink, InternalLink, SchemaVersion } from './content.js'
import type { LocaleCode } from './locales.js'

export type MenuItem = {
  menuItemId: EntityId
  label: Record<LocaleCode, string>
  link: InternalLink | ExternalLink
  children: MenuItem[]
}

export type AppearanceConfig = {
  schemaVersion: SchemaVersion
  themeId: string
  themeSettings: Record<string, unknown>
  menus: Record<string, MenuItem[]>
}
