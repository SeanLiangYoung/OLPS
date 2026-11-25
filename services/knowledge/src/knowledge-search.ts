import fs from 'node:fs/promises'
import path from 'node:path'
import { listAllAssetMetaRecords, type AssetListItem, assetMetaToListItem } from './assets-catalog.js'
import { parseKnowledgeAssetRole, type KnowledgeAssetRole } from './asset-role.js'
import {
  InvalidProjectPathError,
  listProjectFiles,
} from './project-files.js'
import { assertLegalSiteId } from './site-id.js'

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

const SNIPPET_RADIUS = 80

export class KnowledgeSearchError extends Error {
  readonly code:
    | 'search_query_required'
    | 'search_bad_request'
    | 'invalid_role'
    | 'invalid_path'

  constructor(code: KnowledgeSearchError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type KnowledgeSearchHit = {
  path: string
  snippet: string
  assetId?: string
  role?: KnowledgeAssetRole
}

export type KnowledgeSearchResult = {
  hits: KnowledgeSearchHit[]
  /** 预留给后续向量检索扩展；本期恒为 null */
  embed: null
}

export type KnowledgeSearchBody = {
  query?: unknown
  role?: unknown
  pathPrefix?: unknown
}

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

function isTextPath(relativePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

function buildSnippet(text: string, query: string): string | null {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  if (index < 0) {
    return null
  }
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS)
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) {
    snippet = `…${snippet}`
  }
  if (end < text.length) {
    snippet = `${snippet}…`
  }
  return snippet
}

function assetSearchText(item: AssetListItem & { roleReason?: string }): string {
  const parts = [item.sourcePath, item.caption ?? '', item.roleReason ?? '', item.assetId]
  return parts.join('\n')
}

async function searchTextFiles(
  knowledgeRoot: string,
  siteId: string,
  query: string,
  pathPrefix: string | undefined,
): Promise<KnowledgeSearchHit[]> {
  const files = await listProjectFiles(knowledgeRoot, siteId, pathPrefix)
  const hits: KnowledgeSearchHit[] = []
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  for (const file of files) {
    if (!isTextPath(file.path)) {
      continue
    }
    const abs = path.join(projectDir, ...file.path.split('/'))
    const content = await fs.readFile(abs, 'utf8')
    const snippet = buildSnippet(content, query)
    if (snippet === null) {
      continue
    }
    hits.push({ path: file.path, snippet })
  }
  return hits
}

async function searchAssets(
  projectDir: string,
  query: string,
  roleFilter: KnowledgeAssetRole | undefined,
  pathPrefix: string | undefined,
): Promise<KnowledgeSearchHit[]> {
  const records = await listAllAssetMetaRecords(projectDir)
  const hits: KnowledgeSearchHit[] = []
  for (const meta of records) {
    const item = assetMetaToListItem(meta)
    if (roleFilter && item.role !== roleFilter) {
      continue
    }
    if (pathPrefix) {
      const normalizedPrefix = pathPrefix.replace(/\/+$/, '')
      const underPrefix =
        item.sourcePath === normalizedPrefix || item.sourcePath.startsWith(`${normalizedPrefix}/`)
      if (!underPrefix) {
        continue
      }
    }
    const searchable = assetSearchText({ ...item, roleReason: meta.roleReason })
    const snippet = buildSnippet(searchable, query)
    if (snippet === null) {
      continue
    }
    hits.push({
      path: item.sourcePath,
      snippet,
      assetId: item.assetId,
      role: item.role,
    })
  }
  return hits
}

function parseQuery(body: KnowledgeSearchBody): string {
  if (body.query === undefined || body.query === null) {
    throw new KnowledgeSearchError('search_query_required', 'query is required')
  }
  if (typeof body.query !== 'string') {
    throw new KnowledgeSearchError('search_query_required', 'query must be a string')
  }
  const query = body.query.trim()
  if (query === '') {
    throw new KnowledgeSearchError('search_query_required', 'query must not be empty')
  }
  return query
}

function parseRoleFilter(body: KnowledgeSearchBody): KnowledgeAssetRole | undefined {
  if (body.role === undefined || body.role === null) {
    return undefined
  }
  if (typeof body.role !== 'string' || body.role.trim() === '') {
    throw new KnowledgeSearchError('invalid_role', 'role must be a non-empty string')
  }
  const role = parseKnowledgeAssetRole(body.role)
  if (!role) {
    throw new KnowledgeSearchError('invalid_role', `invalid role: ${body.role}`)
  }
  return role
}

function parsePathPrefix(body: KnowledgeSearchBody): string | undefined {
  if (body.pathPrefix === undefined || body.pathPrefix === null) {
    return undefined
  }
  if (typeof body.pathPrefix !== 'string') {
    throw new KnowledgeSearchError('invalid_path', 'pathPrefix must be a string')
  }
  const trimmed = body.pathPrefix.trim()
  if (trimmed === '') {
    return undefined
  }
  return trimmed
}

export async function searchKnowledgeProject(
  knowledgeRoot: string,
  siteId: string,
  body: KnowledgeSearchBody,
): Promise<KnowledgeSearchResult> {
  const query = parseQuery(body)
  const roleFilter = parseRoleFilter(body)
  const pathPrefix = parsePathPrefix(body)
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)

  try {
    // 带 role 时只返回该类资产命中，避免混入无角色的 wiki/来源正文
    if (roleFilter) {
      const assetHits = await searchAssets(projectDir, query, roleFilter, pathPrefix)
      return { hits: assetHits, embed: null }
    }

    const textHits = await searchTextFiles(knowledgeRoot, siteId, query, pathPrefix)
    const assetHits = await searchAssets(projectDir, query, undefined, pathPrefix)
    const seen = new Set<string>()
    const hits: KnowledgeSearchHit[] = []
    for (const hit of [...textHits, ...assetHits]) {
      const key = hit.assetId ? `asset:${hit.assetId}` : `path:${hit.path}:${hit.snippet}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      hits.push(hit)
    }
    return { hits, embed: null }
  } catch (err) {
    if (err instanceof InvalidProjectPathError) {
      throw new KnowledgeSearchError('invalid_path', err.message)
    }
    throw err
  }
}
