import type { BlockNode } from '@olps/domain'
import type { JSONContent } from '@tiptap/core'
import type { Liquid } from 'liquidjs'
import type { FilterRuntime } from '../filters.js'
import { renderRichtext } from '../richtext.js'
import { validateBlockProps } from './props-schema.js'
import type { BlockRegistry } from './registry.js'
import type { RegisteredBlock } from './types.js'

export type CollectionListItem = {
  title: string
  url: string
}

export type RenderBlockTreeOptions = {
  objectPath: string
  engine: Liquid
  registry: BlockRegistry
  filterRuntime: FilterRuntime
  listItems?: CollectionListItem[]
  canvas?: boolean
}

export class BlockRenderError extends Error {
  readonly objectPath: string
  readonly blockId: string

  constructor(message: string, objectPath: string, blockId: string) {
    super(`${objectPath}#${blockId}: ${message}`)
    this.name = 'BlockRenderError'
    this.objectPath = objectPath
    this.blockId = blockId
  }
}

function requireDefinition(
  registry: BlockRegistry,
  node: BlockNode,
  objectPath: string,
): RegisteredBlock {
  const definition = registry.get(node.type)
  if (!definition) {
    throw new BlockRenderError(
      `未知区块类型：${node.type}`,
      objectPath,
      node.id,
    )
  }
  return definition
}

function assertChildrenAllowed(
  definition: RegisteredBlock,
  node: BlockNode,
  objectPath: string,
): void {
  if (node.children.length === 0) {
    return
  }
  if (definition.accepts.length === 0) {
    throw new BlockRenderError(
      `区块未声明 accepts，不能包含 children`,
      objectPath,
      node.id,
    )
  }
  for (const child of node.children) {
    if (!definition.accepts.includes(child.type)) {
      throw new BlockRenderError(
        `子区块类型不被允许：${child.type}`,
        objectPath,
        node.id,
      )
    }
  }
}

function assertPropsValid(
  definition: RegisteredBlock,
  node: BlockNode,
  objectPath: string,
): void {
  const errors = validateBlockProps(definition.type, definition.fields, node.props)
  if (errors.length === 0) {
    return
  }
  const detail = errors
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
    .join('; ')
  throw new BlockRenderError(`props 校验失败：${detail}`, objectPath, node.id)
}

function mediaIdFrom(value: unknown): string {
  if (
    typeof value === 'object'
    && value !== null
    && 'mediaId' in value
    && typeof (value as { mediaId: unknown }).mediaId === 'string'
  ) {
    return (value as { mediaId: string }).mediaId
  }
  throw new Error(`媒体字段格式无效：${JSON.stringify(value)}`)
}

function prepareProps(
  definition: RegisteredBlock,
  node: BlockNode,
  options: RenderBlockTreeOptions,
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...node.props }

  if (definition.type === 'core/text') {
    props.renderedContent = renderRichtext(node.props.content as JSONContent)
  }

  if (definition.type === 'core/image') {
    const mediaId = mediaIdFrom(node.props.image)
    const media = options.filterRuntime.mediaById[mediaId]
    if (!media) {
      throw new BlockRenderError(`找不到媒体：${mediaId}`, options.objectPath, node.id)
    }
    props.src = media.path.startsWith('/') ? media.path : `/${media.path}`
    props.alt = typeof node.props.alt === 'string' ? node.props.alt : ''
  }

  if (definition.type === 'core/button') {
    const link = node.props.link
    props.href = options.filterRuntime.resolveLink(link)
    props.newWindow =
      typeof link === 'object'
      && link !== null
      && 'kind' in link
      && (link as { kind: string }).kind === 'external'
      && (link as { newWindow?: boolean }).newWindow === true
  }

  if (definition.type === 'core/collection-list') {
    props.items = options.listItems ?? []
  }

  return props
}

async function renderNode(
  node: BlockNode,
  options: RenderBlockTreeOptions,
): Promise<string> {
  const definition = requireDefinition(options.registry, node, options.objectPath)
  assertChildrenAllowed(definition, node, options.objectPath)
  assertPropsValid(definition, node, options.objectPath)

  const childHtmlParts: string[] = []
  for (const child of node.children) {
    childHtmlParts.push(await renderNode(child, options))
  }

  const props = prepareProps(definition, node, options)
  const html = await options.engine.parseAndRender(definition.template, {
    block: {
      id: node.id,
      type: node.type,
      props,
      children: childHtmlParts.join(''),
    },
  })
  if (!options.canvas) {
    return html
  }
  return `<div data-olps-block="${node.id}" data-olps-block-type="${node.type}">${html}</div>`
}

export async function renderBlockTree(
  nodes: BlockNode[],
  options: RenderBlockTreeOptions,
): Promise<string> {
  const parts: string[] = []
  for (const node of nodes) {
    parts.push(await renderNode(node, options))
  }
  return parts.join('')
}
