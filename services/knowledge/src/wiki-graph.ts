import fs from 'node:fs/promises'
import path from 'node:path'
import { listAllAssetMetaRecords } from './assets-catalog.js'
import { readFingerprintStore } from './project-fingerprints.js'
import { assertLegalSiteId } from './site-id.js'

export type KnowledgeGraphNodeType =
  | 'overview'
  | 'source'
  | 'synthesis'
  | 'entity'
  | 'concept'
  | 'asset'
  | 'other'

export type KnowledgeGraphNode = {
  id: string
  label: string
  type: KnowledgeGraphNodeType
  path: string
  linkCount: number
}

export type KnowledgeGraphEdge = {
  source: string
  target: string
  weight: number
}

export type KnowledgeGraphResult = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
const MD_LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g
const HIDDEN_BASENAMES = new Set(['log.md'])

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

async function walkMarkdownFiles(absDir: string, projectDir: string): Promise<string[]> {
  const results: string[] = []
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await walkMarkdownFiles(abs, projectDir)))
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
      continue
    }
    const rel = path.relative(projectDir, abs).split(path.sep).join('/')
    results.push(rel)
  }
  results.sort()
  return results
}

function nodeIdFromWikiPath(wikiPath: string): string {
  const base = path.posix.basename(wikiPath)
  return base.replace(/\.md$/i, '')
}

function extractTitle(content: string, fileName: string): string {
  const fmTitle = /^title:\s*(.+)$/m.exec(content)
  if (fmTitle) {
    const raw = fmTitle[1]!.trim().replace(/^["']|["']$/g, '')
    if (raw) return raw
  }
  const heading = /^#\s+(.+)$/m.exec(content)
  if (heading?.[1]?.trim()) {
    return heading[1].trim()
  }
  return fileName.replace(/\.md$/i, '').replace(/-/g, ' ')
}

function extractType(content: string, wikiPath: string): KnowledgeGraphNodeType {
  const kindMatch = /^kind:\s*(.+)$/m.exec(content)
  const kind = kindMatch?.[1]?.trim().replace(/^["']|["']$/g, '').toLowerCase() ?? ''
  if (kind === 'imported_source' || kind.includes('source')) return 'source'
  if (kind === 'manual' || kind.includes('manual')) return 'other'
  if (kind === 'overview') return 'overview'
  if (kind === 'entity') return 'entity'
  if (kind === 'concept') return 'concept'
  if (kind === 'synthesis') return 'synthesis'

  const posix = wikiPath.split('\\').join('/')
  if (posix === 'wiki/overview.md' || posix === 'wiki/index.md') return 'overview'
  if (posix === 'wiki/assets-catalog.md') return 'synthesis'
  if (posix.startsWith('wiki/sources/')) return 'source'
  if (posix.includes('/entities/')) return 'entity'
  if (posix.includes('/concepts/')) return 'concept'
  return 'other'
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(WIKILINK_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]?.trim()
    if (raw) links.push(raw)
  }
  return links
}

function extractMarkdownTargets(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(MD_LINK_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const href = match[2]?.trim() ?? ''
    if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
      continue
    }
    const cleaned = href.split('#')[0]!.split('?')[0]!.trim()
    if (!cleaned) continue
    const base = path.posix.basename(cleaned).replace(/\.md$/i, '')
    if (base) links.push(base)
  }
  return links
}

function targetAliases(value: string): string[] {
  const trimmed = value.trim()
  const base = path.posix.basename(trimmed).replace(/\.md$/i, '')
  const lower = base.toLowerCase()
  return Array.from(new Set([base, lower, lower.replace(/\s+/g, '-')]))
}

function buildTargetIndex(ids: Iterable<string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const id of ids) {
    index.set(id, id)
  }
  for (const id of ids) {
    for (const alias of targetAliases(id).slice(1)) {
      if (!index.has(alias)) {
        index.set(alias, id)
      }
    }
  }
  return index
}

function resolveTarget(raw: string, index: ReadonlyMap<string, string>): string | null {
  for (const alias of targetAliases(raw)) {
    const hit = index.get(alias)
    if (hit) return hit
  }
  return null
}

function addEdge(
  edges: KnowledgeGraphEdge[],
  seen: Set<string>,
  source: string,
  target: string,
  weight: number,
): void {
  if (source === target) return
  const key = source < target ? `${source}:::${target}` : `${target}:::${source}`
  if (seen.has(key)) return
  seen.add(key)
  edges.push({ source, target, weight })
}

function parentDirKey(sourcePath: string): string {
  const posix = sourcePath.split('\\').join('/')
  const parts = posix.split('/')
  parts.pop()
  return parts.join('/')
}

export async function buildKnowledgeGraph(
  knowledgeRoot: string,
  siteId: string,
): Promise<KnowledgeGraphResult> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const wikiRoot = path.join(projectDir, 'wiki')
  const wikiFiles = await walkMarkdownFiles(wikiRoot, projectDir)

  type DraftNode = {
    id: string
    label: string
    type: KnowledgeGraphNodeType
    path: string
    links: string[]
  }

  const nodeMap = new Map<string, DraftNode>()
  for (const wikiPath of wikiFiles) {
    const base = path.posix.basename(wikiPath)
    if (HIDDEN_BASENAMES.has(base.toLowerCase())) {
      continue
    }
    const abs = path.join(projectDir, ...wikiPath.split('/'))
    const content = await fs.readFile(abs, 'utf8')
    const id = nodeIdFromWikiPath(wikiPath)
    if (nodeMap.has(id)) {
      continue
    }
    nodeMap.set(id, {
      id,
      label: extractTitle(content, base),
      type: extractType(content, wikiPath),
      path: wikiPath,
      links: Array.from(new Set([...extractWikilinks(content), ...extractMarkdownTargets(content)])),
    })
  }

  const assets = await listAllAssetMetaRecords(projectDir)
  for (const asset of assets) {
    const id = `asset:${asset.assetId}`
    nodeMap.set(id, {
      id,
      label: path.posix.basename(asset.sourcePath.split('\\').join('/')) || asset.assetId,
      type: 'asset',
      path: asset.sourcePath,
      links: [],
    })
  }

  const edges: KnowledgeGraphEdge[] = []
  const seen = new Set<string>()
  const targetIndex = buildTargetIndex(
    [...nodeMap.keys()].filter((id) => !id.startsWith('asset:')),
  )

  for (const node of nodeMap.values()) {
    if (node.id.startsWith('asset:')) continue
    for (const link of node.links) {
      const target = resolveTarget(link, targetIndex)
      if (!target) continue
      addEdge(edges, seen, node.id, target, 1)
    }
  }

  const overview =
    [...nodeMap.values()].find((item) => item.path === 'wiki/overview.md') ??
    [...nodeMap.values()].find((item) => item.type === 'overview')
  if (overview) {
    for (const node of nodeMap.values()) {
      if (node.id === overview.id || node.type === 'asset') continue
      addEdge(edges, seen, overview.id, node.id, 0.4)
    }
  }

  const store = await readFingerprintStore(projectDir)
  const wikiByDir = new Map<string, string[]>()
  for (const [sourcePath, entry] of Object.entries(store)) {
    if (!entry.wikiPath) continue
    const wikiId = nodeIdFromWikiPath(entry.wikiPath)
    if (!nodeMap.has(wikiId)) continue
    const dir = parentDirKey(sourcePath)
    const list = wikiByDir.get(dir) ?? []
    list.push(wikiId)
    wikiByDir.set(dir, list)
  }

  for (const asset of assets) {
    const assetId = `asset:${asset.assetId}`
    const dir = parentDirKey(asset.sourcePath)
    const relatedWiki = wikiByDir.get(dir) ?? []
    if (relatedWiki.length > 0) {
      for (const wikiId of relatedWiki) {
        addEdge(edges, seen, wikiId, assetId, 0.7)
      }
    } else if (overview) {
      addEdge(edges, seen, overview.id, assetId, 0.3)
    }
  }

  const linkCounts = new Map<string, number>()
  for (const id of nodeMap.keys()) {
    linkCounts.set(id, 0)
  }
  for (const edge of edges) {
    linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1)
    linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1)
  }

  const nodes: KnowledgeGraphNode[] = [...nodeMap.values()].map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    path: node.path,
    linkCount: linkCounts.get(node.id) ?? 0,
  }))
  nodes.sort((a, b) => a.id.localeCompare(b.id))
  edges.sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))

  return { nodes, edges }
}
