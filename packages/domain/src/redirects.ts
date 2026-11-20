import type { ContentRef, EntityId, IsoDateTime, SchemaVersion } from './content.js'
import type { LocaleCode } from './locales.js'

export type RedirectEntry = {
  redirectId: EntityId
  locale: LocaleCode
  from: string
  target: ContentRef
  createdAt: IsoDateTime
}

export type RedirectsConfig = {
  schemaVersion: SchemaVersion
  redirects: RedirectEntry[]
}
