import type { SourceReader } from './source-reader.js'

export type PackageStringTable = {
  source: string
  strings: Record<string, string>
}

export type LoadPackageStringsOptions = {
  themeId: string
  enabledPluginIds: string[]
}

export class I18nLookupError extends Error {
  readonly locale: string
  readonly source: string
  readonly key: string

  constructor(locale: string, source: string, key: string) {
    super(`缺少固定文字：locale=${locale} source=${source} key=${key}`)
    this.name = 'I18nLookupError'
    this.locale = locale
    this.source = source
    this.key = key
  }
}

type LanguageFile = {
  schemaVersion: 1
  strings: Record<string, string>
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

async function readLanguageFile(
  reader: SourceReader,
  relativePath: string,
): Promise<Record<string, string>> {
  const raw = JSON.parse(await reader.readText(relativePath)) as LanguageFile
  return raw.strings
}

async function loadLanguageDirectory(
  reader: SourceReader,
  directory: string,
  sourcePrefix: string,
  tables: PackageStringTable[],
): Promise<void> {
  const entries = await listOrEmpty(reader, directory)
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const locale = entry.slice(0, -'.json'.length)
    const strings = await readLanguageFile(reader, `${directory}/${entry}`)
    tables.push({
      source: `${sourcePrefix}:${locale}`,
      strings,
    })
  }
}

export async function loadPackageStrings(
  reader: SourceReader,
  options: LoadPackageStringsOptions,
): Promise<PackageStringTable[]> {
  const tables: PackageStringTable[] = []
  await loadLanguageDirectory(
    reader,
    `themes/${options.themeId}/languages`,
    `theme:${options.themeId}`,
    tables,
  )
  for (const pluginId of options.enabledPluginIds) {
    await loadLanguageDirectory(
      reader,
      `plugins/${pluginId}/languages`,
      `plugin:${pluginId}`,
      tables,
    )
  }
  return tables
}

export type LookupI18nStringInput = {
  locale: string
  key: string
  siteStrings: Record<string, string>
  themeId: string
  enabledPluginIds: string[]
  packages: PackageStringTable[]
}

function namespacedKey(kind: 'theme' | 'plugin', id: string, key: string): string {
  return `${kind}:${id}:${key}`
}

export function lookupI18nString(input: LookupI18nStringInput): string {
  const { locale, key, siteStrings, themeId, enabledPluginIds, packages } = input

  const themeOverride = siteStrings[namespacedKey('theme', themeId, key)]
  if (themeOverride !== undefined) {
    return themeOverride
  }

  for (const pluginId of enabledPluginIds) {
    const pluginOverride = siteStrings[namespacedKey('plugin', pluginId, key)]
    if (pluginOverride !== undefined) {
      return pluginOverride
    }
  }

  const themeTable = packages.find(
    (table) => table.source === `theme:${themeId}:${locale}`,
  )
  if (themeTable && themeTable.strings[key] !== undefined) {
    return themeTable.strings[key]
  }

  for (const pluginId of enabledPluginIds) {
    const pluginTable = packages.find(
      (table) => table.source === `plugin:${pluginId}:${locale}`,
    )
    if (pluginTable && pluginTable.strings[key] !== undefined) {
      return pluginTable.strings[key]
    }
  }

  throw new I18nLookupError(locale, `theme:${themeId}`, key)
}

export async function buildLocaleStringMap(
  reader: SourceReader,
  options: {
    locale: string
    themeId: string
    enabledPluginIds: string[]
    siteStrings: Record<string, string>
  },
): Promise<Record<string, string>> {
  const packages = await loadPackageStrings(reader, {
    themeId: options.themeId,
    enabledPluginIds: options.enabledPluginIds,
  })

  const merged: Record<string, string> = {}

  const themeTable = packages.find(
    (table) => table.source === `theme:${options.themeId}:${options.locale}`,
  )
  if (themeTable) {
    Object.assign(merged, themeTable.strings)
  }

  for (const pluginId of options.enabledPluginIds) {
    const pluginTable = packages.find(
      (table) => table.source === `plugin:${pluginId}:${options.locale}`,
    )
    if (pluginTable) {
      Object.assign(merged, pluginTable.strings)
    }
  }

  for (const [namespaced, value] of Object.entries(options.siteStrings)) {
    const match = /^(theme|plugin):([^:]+):(.+)$/.exec(namespaced)
    if (!match) {
      continue
    }
    const [, kind, id, shortKey] = match
    if (kind === 'theme' && id === options.themeId) {
      merged[shortKey] = value
      continue
    }
    if (kind === 'plugin' && options.enabledPluginIds.includes(id)) {
      merged[shortKey] = value
    }
  }

  return merged
}
