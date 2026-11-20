import { Liquid, type FS } from 'liquidjs'
import type { SourceReader } from './source-reader.js'

export type LiquidRoots = {
  themeRoot: string
  pluginRoots: string[]
}

export type LiquidTemplateFiles = Map<string, string>

export class LiquidPathError extends Error {
  readonly objectPath: string

  constructor(message: string, objectPath: string) {
    super(`${objectPath}: ${message}`)
    this.name = 'LiquidPathError'
    this.objectPath = objectPath
  }
}

function normalizeVirtualPath(value: string): string {
  const replaced = value.replace(/\\/g, '/')
  const parts = replaced.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (resolved.length === 0) {
        throw new LiquidPathError(`路径越界：${value}`, value)
      }
      resolved.pop()
      continue
    }
    resolved.push(part)
  }
  return resolved.join('/')
}

function ensureExtension(file: string, ext: string): string {
  if (!ext) {
    return file
  }
  if (file.endsWith(ext)) {
    return file
  }
  return `${file}${ext}`
}

function isUnderRoot(file: string, root: string): boolean {
  if (root === '') {
    return false
  }
  return file === root || file.startsWith(`${root}/`)
}

export function isAllowedLiquidPath(file: string, roots: LiquidRoots): boolean {
  const normalized = normalizeVirtualPath(file)
  if (isUnderRoot(normalized, normalizeVirtualPath(roots.themeRoot))) {
    return true
  }
  return roots.pluginRoots.some((root) =>
    isUnderRoot(normalized, normalizeVirtualPath(root)),
  )
}

function isSkippableFile(entry: string): boolean {
  return /\.[a-z0-9]+$/i.test(entry) && !entry.endsWith('.liquid')
}

async function collectLiquidFiles(
  reader: SourceReader,
  directory: string,
  files: LiquidTemplateFiles,
): Promise<void> {
  let entries: string[]
  try {
    entries = await reader.list(directory)
  } catch (error) {
    if (isMissingPathError(error) || isNotDirectoryError(error)) {
      return
    }
    throw error
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }
    const childPath = directory === '' ? entry : `${directory}/${entry}`
    if (entry.endsWith('.liquid')) {
      files.set(childPath, await reader.readText(childPath))
      continue
    }
    if (isSkippableFile(entry)) {
      continue
    }
    await collectLiquidFiles(reader, childPath, files)
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return (error as { code?: string }).code === 'ENOENT'
}

function isNotDirectoryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return (error as { code?: string }).code === 'ENOTDIR'
}

export async function loadLiquidTemplateFiles(
  reader: SourceReader,
  roots: LiquidRoots,
): Promise<LiquidTemplateFiles> {
  const files: LiquidTemplateFiles = new Map()
  await collectLiquidFiles(reader, roots.themeRoot, files)
  for (const pluginRoot of roots.pluginRoots) {
    await collectLiquidFiles(reader, pluginRoot, files)
  }
  return files
}

function createMemoryFs(
  files: LiquidTemplateFiles,
  roots: LiquidRoots,
): FS {
  const resolvePath = (dir: string, file: string, ext: string): string => {
    const base = dir && dir !== '.' ? `${dir}/${file}` : file
    const withExt = ensureExtension(base.replace(/\\/g, '/'), ext)
    return normalizeVirtualPath(withExt)
  }

  const assertAllowed = (filepath: string): string => {
    const normalized = normalizeVirtualPath(filepath)
    if (!isAllowedLiquidPath(normalized, roots)) {
      throw new LiquidPathError(
        `禁止读取主题与已启用插件目录以外的模板：${normalized}`,
        normalized,
      )
    }
    return normalized
  }

  return {
    sep: '/',
    resolve: resolvePath,
    dirname: (file: string) => {
      const normalized = normalizeVirtualPath(file)
      const index = normalized.lastIndexOf('/')
      if (index <= 0) {
        return ''
      }
      return normalized.slice(0, index)
    },
    exists: async (filepath: string) => {
      const normalized = assertAllowed(filepath)
      return files.has(normalized)
    },
    existsSync: (filepath: string) => {
      const normalized = assertAllowed(filepath)
      return files.has(normalized)
    },
    contains: async (root: string, file: string) => {
      const normalizedRoot = normalizeVirtualPath(root || roots.themeRoot)
      const normalizedFile = normalizeVirtualPath(file)
      if (!isAllowedLiquidPath(normalizedFile, roots)) {
        return false
      }
      return isUnderRoot(normalizedFile, normalizedRoot)
        || roots.pluginRoots.some((pluginRoot) =>
          isUnderRoot(normalizedFile, normalizeVirtualPath(pluginRoot)),
        )
    },
    containsSync: (root: string, file: string) => {
      const normalizedRoot = normalizeVirtualPath(root || roots.themeRoot)
      const normalizedFile = normalizeVirtualPath(file)
      if (!isAllowedLiquidPath(normalizedFile, roots)) {
        return false
      }
      return isUnderRoot(normalizedFile, normalizedRoot)
        || roots.pluginRoots.some((pluginRoot) =>
          isUnderRoot(normalizedFile, normalizeVirtualPath(pluginRoot)),
        )
    },
    readFile: async (filepath: string) => {
      const normalized = assertAllowed(filepath)
      const content = files.get(normalized)
      if (content === undefined) {
        throw new LiquidPathError(`模板不存在：${normalized}`, normalized)
      }
      return content
    },
    readFileSync: (filepath: string) => {
      const normalized = assertAllowed(filepath)
      const content = files.get(normalized)
      if (content === undefined) {
        throw new LiquidPathError(`模板不存在：${normalized}`, normalized)
      }
      return content
    },
  }
}

export type CreateLiquidEngineOptions = {
  files: LiquidTemplateFiles
  roots: LiquidRoots
}

export function createLiquidEngine(options: CreateLiquidEngineOptions): Liquid {
  const roots: LiquidRoots = {
    themeRoot: normalizeVirtualPath(options.roots.themeRoot),
    pluginRoots: options.roots.pluginRoots.map((root) => normalizeVirtualPath(root)),
  }

  return new Liquid({
    fs: createMemoryFs(options.files, roots),
    root: [roots.themeRoot, ...roots.pluginRoots],
    partials: [roots.themeRoot, ...roots.pluginRoots],
    layouts: [roots.themeRoot, ...roots.pluginRoots],
    relativeReference: true,
    extname: '.liquid',
    strictFilters: true,
    strictVariables: true,
  })
}
