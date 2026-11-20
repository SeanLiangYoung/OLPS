import {
  assertValidSchema,
  type BlockFieldDefinition,
} from '@olps/domain'
import type { SourceReader } from '../source-reader.js'
import { coreBlocks } from './core/index.js'
import type { RegisteredBlock } from './types.js'

export type LoadBlockRegistryOptions = {
  themeId: string
  enabledPluginIds: string[]
}

export class BlockRegistry {
  private readonly blocks = new Map<string, RegisteredBlock>()

  constructor(definitions: RegisteredBlock[]) {
    for (const definition of definitions) {
      this.blocks.set(definition.type, definition)
    }
  }

  has(type: string): boolean {
    return this.blocks.has(type)
  }

  get(type: string): RegisteredBlock | undefined {
    return this.blocks.get(type)
  }

  list(): RegisteredBlock[] {
    return [...this.blocks.values()]
  }
}

type SectionFile = {
  schemaVersion: 1
  name: string
  description: string
  category: string
  fields: BlockFieldDefinition[]
  accepts: string[]
  preview: Record<string, unknown>
}

async function listOrEmpty(reader: SourceReader, relativePath: string): Promise<string[]> {
  try {
    return await reader.list(relativePath)
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && (error as { code?: string }).code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }
}

async function loadSectionBlock(
  reader: SourceReader,
  sectionDirectory: string,
  type: string,
  source: RegisteredBlock['source'],
): Promise<RegisteredBlock> {
  const sectionJsonPath = `${sectionDirectory}/section.json`
  const sectionLiquidPath = `${sectionDirectory}/section.liquid`
  const raw = JSON.parse(await reader.readText(sectionJsonPath)) as unknown
  assertValidSchema('section', raw, sectionJsonPath)
  const section = raw as SectionFile
  const template = await reader.readText(sectionLiquidPath)
  return {
    type,
    source,
    name: section.name,
    description: section.description,
    category: section.category,
    fields: section.fields,
    accepts: section.accepts,
    preview: section.preview,
    template,
  }
}

export async function loadBlockRegistry(
  reader: SourceReader,
  options: LoadBlockRegistryOptions,
): Promise<BlockRegistry> {
  const definitions: RegisteredBlock[] = [...coreBlocks]

  const themeSectionsRoot = `themes/${options.themeId}/sections`
  const themeSectionNames = await listOrEmpty(reader, themeSectionsRoot)
  for (const sectionName of themeSectionNames) {
    if (sectionName.startsWith('.')) {
      continue
    }
    definitions.push(
      await loadSectionBlock(
        reader,
        `${themeSectionsRoot}/${sectionName}`,
        `theme/${sectionName}`,
        'theme',
      ),
    )
  }

  for (const pluginId of options.enabledPluginIds) {
    const pluginSectionsRoot = `plugins/${pluginId}/sections`
    const pluginSectionNames = await listOrEmpty(reader, pluginSectionsRoot)
    for (const sectionName of pluginSectionNames) {
      if (sectionName.startsWith('.')) {
        continue
      }
      definitions.push(
        await loadSectionBlock(
          reader,
          `${pluginSectionsRoot}/${sectionName}`,
          `plugin/${pluginId}/${sectionName}`,
          'plugin',
        ),
      )
    }
  }

  return new BlockRegistry(definitions)
}
