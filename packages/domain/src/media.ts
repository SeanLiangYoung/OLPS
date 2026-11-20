import type { EntityId, IsoDateTime, SchemaVersion } from './content.js'
import type { LocaleCode } from './locales.js'

export type MediaRef = {
  mediaId: EntityId
}

export type LocalizedMediaText = Record<LocaleCode, string>

export type MediaMeta = {
  schemaVersion: SchemaVersion
  mediaId: EntityId
  path: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  title: LocalizedMediaText
  alt: LocalizedMediaText
  caption: LocalizedMediaText
  uploadedBy: EntityId
  uploadedAt: IsoDateTime
  updatedAt: IsoDateTime
}

export const allowedMediaExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.mp4',
  '.webm',
  '.pdf',
] as const
