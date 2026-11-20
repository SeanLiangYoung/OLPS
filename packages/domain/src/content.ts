import type { BlockNode } from './blocks.js'
import type { LocaleCode } from './locales.js'
import type { MediaRef } from './media.js'

export type EntityId = string
export type IsoDateTime = string
export type SchemaVersion = 1
export type ContentStatus = 'draft' | 'published'
export type SiteStatus = 'unpublished' | 'published'

export type ManagedSeoFields = {
  title: string
  description: string
  ogImage: MediaRef | null
}

export type ContentRef =
  | { ref: 'page'; id: EntityId }
  | { ref: 'collection'; id: EntityId }
  | { ref: 'group'; id: EntityId }
  | { ref: 'item'; id: EntityId }

export type ContentTarget = ContentRef

export type InternalLink = {
  kind: 'internal'
  target: ContentRef
}

export type ExternalLink = {
  kind: 'external'
  url: string
  newWindow: boolean
}

export type LinkValue = InternalLink | ExternalLink

export type PageRole =
  | 'home'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'cookies'
  | 'thank-you'
  | 'not-found'

export type PageMeta = {
  schemaVersion: SchemaVersion
  pageId: EntityId
  role: PageRole | null
  template: string
  status: ContentStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type PageLocaleFile = {
  schemaVersion: SchemaVersion
  locale: LocaleCode
  slug: string
  title: string
  summary: string
  cover: MediaRef | null
  seo: ManagedSeoFields
  blocks: BlockNode[]
  sourceHash: string | null
  updatedAt: IsoDateTime
}

export type FieldType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'media'
  | 'mediaList'
  | 'link'
  | 'table'
  | 'reference'

export type CollectionLevel = {
  levelId: EntityId
  name: string
}

export type SelectOption = {
  value: string
  label: string
}

export type TableColumn = {
  key: string
  label: string
  type: 'text' | 'number'
}

export type FieldDefinition = {
  key: string
  type: FieldType
  label: string
  translatable: boolean
  required: boolean
  options?: SelectOption[]
  columns?: TableColumn[]
  referenceCollectionId?: EntityId
}

export type CollectionDefinition = {
  schemaVersion: SchemaVersion
  collectionId: EntityId
  name: string
  labels: Record<LocaleCode, string>
  prefix: string
  status: ContentStatus
  levels: CollectionLevel[]
  fields: FieldDefinition[]
  structuredData: 'Product' | 'NewsArticle' | 'Service' | null
  feed: boolean
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type FieldValue =
  | string
  | number
  | boolean
  | MediaRef
  | MediaRef[]
  | LinkValue
  | Array<Record<string, string | number>>
  | ContentRef
  | null

export type FieldValues = Record<string, FieldValue>

export type CollectionIndexLocaleFile = {
  schemaVersion: SchemaVersion
  locale: LocaleCode
  title: string
  summary: string
  cover: MediaRef | null
  seo: ManagedSeoFields
  blocks: BlockNode[]
  sourceHash: string | null
  updatedAt: IsoDateTime
}

export type GroupMeta = {
  schemaVersion: SchemaVersion
  groupId: EntityId
  parentGroupId: EntityId | null
  levelId: EntityId
  order: number
  status: ContentStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type GroupLocaleFile = CollectionIndexLocaleFile & {
  slug: string
}

export type ItemMeta = {
  schemaVersion: SchemaVersion
  itemId: EntityId
  primaryGroupId: EntityId | null
  groupIds: EntityId[]
  order: number
  publishedAt: IsoDateTime | null
  status: ContentStatus
  fields: FieldValues
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type ItemLocaleFile = GroupLocaleFile & {
  fields: FieldValues
}
