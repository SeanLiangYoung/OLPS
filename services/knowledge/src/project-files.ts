import fs from 'node:fs/promises'
import path from 'node:path'
import { assertLegalSiteId } from './site-id.js'

export class InvalidProjectPathError extends Error {
  readonly kind = 'invalid_path' as const
}

export class ProjectFileNotFoundError extends Error {
  readonly kind = 'file_not_found' as const
}

export type ProjectFileEntry = {
  path: string
  size: number
}

export type ProjectFileContent =
  | {
      path: string
      binary: false
      content: string
      size: number
    }
  | {
      path: string
      binary: true
      size: number
    }

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
  '.svg',
  '.mdx',
])

function resolveProjectDir(knowledgeRoot: string, siteId: string): string {
  assertLegalSiteId(siteId)
  const root = path.resolve(knowledgeRoot)
  const projectDir = path.resolve(root, siteId)
  const relative = path.relative(root, projectDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`siteId escapes knowledge root: ${siteId}`)
  }
  return projectDir
}

function toPosixRelative(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed === '') {
    throw new InvalidProjectPathError('empty path')
  }
  const posix = trimmed.split('\\').join('/')
  if (posix.includes('..')) {
    throw new InvalidProjectPathError('path contains dotdot')
  }
  const parts = posix.split('/').filter((segment) => segment.length > 0)
  if (parts.some((segment) => segment === '..')) {
    throw new InvalidProjectPathError('path contains dotdot segment')
  }
  return parts.join('/')
}

function assertAllowedRelativePath(relativePath: string, allowRootNames: boolean): string {
  const norm = toPosixRelative(relativePath)
  if (allowRootNames && (norm === 'raw' || norm === 'wiki')) {
    return norm
  }
  if (!norm.startsWith('raw/') && !norm.startsWith('wiki/')) {
    throw new InvalidProjectPathError('path outside raw or wiki')
  }
  return norm
}

function resolveAllowedAbsolutePath(projectDir: string, relativePath: string): string {
  const norm = assertAllowedRelativePath(relativePath, false)
  const abs = path.resolve(projectDir, ...norm.split('/'))
  const rawRoot = path.resolve(projectDir, 'raw')
  const wikiRoot = path.resolve(projectDir, 'wiki')
  const underRaw = abs === rawRoot || abs.startsWith(`${rawRoot}${path.sep}`)
  const underWiki = abs === wikiRoot || abs.startsWith(`${wikiRoot}${path.sep}`)
  if (!underRaw && !underWiki) {
    throw new InvalidProjectPathError('resolved path outside allowed subtree')
  }
  return abs
}

function resolveListRoot(projectDir: string, prefix: string | undefined): string {
  if (prefix === undefined || prefix.trim() === '') {
    return projectDir
  }
  const norm = assertAllowedRelativePath(prefix, true)
  return path.resolve(projectDir, ...norm.split('/'))
}

function isTextFile(fileName: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

async function walkFiles(
  projectDir: string,
  listRoot: string,
  listAllRoots: boolean,
  files: ProjectFileEntry[],
): Promise<void> {
  const rawRoot = path.resolve(projectDir, 'raw')
  const wikiRoot = path.resolve(projectDir, 'wiki')

  async function walkDir(absDir: string): Promise<void> {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[]
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return
      }
      throw err
    }
    for (const ent of entries) {
      const abs = path.join(absDir, ent.name)
      if (ent.isDirectory()) {
        await walkDir(abs)
      } else if (ent.isFile()) {
        const rel = path.relative(projectDir, abs).split(path.sep).join('/')
        files.push({
          path: rel,
          size: (await fs.stat(abs)).size,
        })
      }
    }
  }

  if (listAllRoots) {
    await walkDir(rawRoot)
    await walkDir(wikiRoot)
    return
  }

  const underRaw = listRoot === rawRoot || listRoot.startsWith(`${rawRoot}${path.sep}`)
  const underWiki = listRoot === wikiRoot || listRoot.startsWith(`${wikiRoot}${path.sep}`)
  if (!underRaw && !underWiki) {
    throw new InvalidProjectPathError('prefix outside allowed subtree')
  }
  await walkDir(listRoot)
}

export async function listProjectFiles(
  knowledgeRoot: string,
  siteId: string,
  prefix: string | undefined,
): Promise<ProjectFileEntry[]> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const listAllRoots = prefix === undefined || prefix.trim() === ''
  const listRoot = resolveListRoot(projectDir, prefix)
  const files: ProjectFileEntry[] = []
  await walkFiles(projectDir, listRoot, listAllRoots, files)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

export async function readProjectFileContent(
  knowledgeRoot: string,
  siteId: string,
  relativePath: string,
): Promise<ProjectFileContent> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const norm = assertAllowedRelativePath(relativePath, false)
  const abs = resolveAllowedAbsolutePath(projectDir, norm)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(abs)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      throw new ProjectFileNotFoundError(`file not found: ${norm}`)
    }
    throw err
  }
  if (!stat.isFile()) {
    throw new ProjectFileNotFoundError(`not a file: ${norm}`)
  }
  if (isTextFile(path.basename(abs))) {
    const content = await fs.readFile(abs, 'utf8')
    return {
      path: norm,
      binary: false,
      content,
      size: stat.size,
    }
  }
  return {
    path: norm,
    binary: true,
    size: stat.size,
  }
}