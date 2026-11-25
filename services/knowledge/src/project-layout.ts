import fs from 'node:fs/promises'
import path from 'node:path'
import { assertLegalSiteId, isLegalSiteId } from './site-id.js'

export type ProjectSummary = {
  siteId: string
  pageCount: number
  assetCount: number
  lastImport: string | null
}

const INITIAL_WIKI_PAGES: ReadonlyArray<{ relativePath: string; content: string }> = [
  {
    relativePath: 'wiki/index.md',
    content: '# Knowledge index\n\n',
  },
  {
    relativePath: 'wiki/log.md',
    content: '# Change log\n\n',
  },
  {
    relativePath: 'wiki/overview.md',
    content: '# Overview\n\n',
  },
  {
    relativePath: 'wiki/assets-catalog.md',
    content: '# Assets catalog\n\n',
  },
]

const INITIAL_FILES: ReadonlyArray<{ relativePath: string; content: string }> = [
  {
    relativePath: 'purpose.md',
    content: '# Site knowledge purpose\n\n',
  },
  {
    relativePath: 'schema.md',
    content: '# Wiki schema\n\n',
  },
  {
    relativePath: '.olps-knowledge/fingerprints.json',
    content: '{}\n',
  },
  {
    relativePath: '.olps-knowledge/reviews.json',
    content: '[]\n',
  },
]

const INITIAL_DIRECTORIES = [
  'raw/sources',
  '.olps-knowledge/imports',
  '.olps-knowledge/asset-meta',
  '.olps-knowledge/extracted',
] as const

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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  if (await pathExists(filePath)) {
    return
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

async function mkdirIfMissing(dirPath: string): Promise<void> {
  if (await pathExists(dirPath)) {
    return
  }
  await fs.mkdir(dirPath, { recursive: true })
}

export async function ensureKnowledgeProject(knowledgeRoot: string, siteId: string): Promise<ProjectSummary> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  for (const dir of INITIAL_DIRECTORIES) {
    await mkdirIfMissing(path.join(projectDir, dir))
  }
  for (const file of INITIAL_FILES) {
    await writeFileIfMissing(path.join(projectDir, file.relativePath), file.content)
  }
  for (const page of INITIAL_WIKI_PAGES) {
    await writeFileIfMissing(path.join(projectDir, page.relativePath), page.content)
  }
  return readProjectSummary(knowledgeRoot, siteId)
}

export async function isKnowledgeProjectInitialized(knowledgeRoot: string, siteId: string): Promise<boolean> {
  assertLegalSiteId(siteId)
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  return pathExists(path.join(projectDir, 'purpose.md'))
}

async function countWikiPages(projectDir: string): Promise<number> {
  const wikiDir = path.join(projectDir, 'wiki')
  if (!(await pathExists(wikiDir))) {
    return 0
  }
  const entries = await fs.readdir(wikiDir, { withFileTypes: true })
  return entries.filter((ent) => ent.isFile() && ent.name.endsWith('.md')).length
}

async function readLastImport(projectDir: string): Promise<string | null> {
  const importsDir = path.join(projectDir, '.olps-knowledge', 'imports')
  if (!(await pathExists(importsDir))) {
    return null
  }
  const entries = await fs.readdir(importsDir, { withFileTypes: true })
  const ids = entries.filter((ent) => ent.isDirectory()).map((ent) => ent.name)
  if (ids.length === 0) {
    return null
  }
  ids.sort()
  return ids.at(-1) ?? null
}

export async function readProjectSummary(knowledgeRoot: string, siteId: string): Promise<ProjectSummary> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  return {
    siteId,
    pageCount: await countWikiPages(projectDir),
    assetCount: 0,
    lastImport: await readLastImport(projectDir),
  }
}

export async function listKnowledgeProjects(knowledgeRoot: string): Promise<ProjectSummary[]> {
  const root = path.resolve(knowledgeRoot)
  if (!(await pathExists(root))) {
    return []
  }
  const entries = await fs.readdir(root, { withFileTypes: true })
  const summaries: ProjectSummary[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) {
      continue
    }
    if (!isLegalSiteId(ent.name)) {
      continue
    }
    const initialized = await isKnowledgeProjectInitialized(root, ent.name)
    if (!initialized) {
      continue
    }
    summaries.push(await readProjectSummary(root, ent.name))
  }
  summaries.sort((a, b) => a.siteId.localeCompare(b.siteId))
  return summaries
}