import type { EntityId } from './content.js'

export type BlockNode = {
  id: EntityId
  type: string
  props: Record<string, unknown>
  children: BlockNode[]
}

export type BlockSource = 'core' | 'theme' | 'plugin'

export type BlockFieldType =
  | 'text'
  | 'richtext'
  | 'media'
  | 'mediaList'
  | 'link'
  | 'select'
  | 'color'
  | 'number'
  | 'boolean'
  | 'list'

export type BlockFieldDefinition = {
  key: string
  type: BlockFieldType
  label: string
  required: boolean
  translatable: boolean
  default?: unknown
  options?: Array<{ value: string; label: string }>
  itemFields?: BlockFieldDefinition[]
  mediaKind?: 'image' | 'video'
}

export type BlockDefinition = {
  type: string
  source: BlockSource
  name: string
  description: string
  category: string
  fields: BlockFieldDefinition[]
  accepts: string[]
  preview: Record<string, unknown>
}

export const blockTypePattern = /^(?:core|theme)\/[a-z][a-z0-9-]*$|^plugin\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

export function isBlockType(value: string): boolean {
  return blockTypePattern.test(value)
}
