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

export const allowedVideoMimeTypes = ['video/mp4', 'video/webm'] as const

export function isAllowedVideoMimeType(mimeType: string): boolean {
  return (allowedVideoMimeTypes as readonly string[]).includes(mimeType)
}

export function mediaMatchesFieldKind(
  mimeType: string,
  kind: 'image' | 'video' | undefined,
): boolean {
  if (kind === 'video') {
    return isAllowedVideoMimeType(mimeType)
  }
  return mimeType.startsWith('image/')
}
