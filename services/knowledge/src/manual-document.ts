import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  readFingerprintStore,
  writeFingerprintStore,
  type FingerprintEntry,
} from './project-fingerprints.js'
import { writeExtractedTextRecord, type ExtractedTextRecord } from './manual-extracted.js'
import { assertLegalSiteId } from './site-id.js'

export class ManualDocumentError extends Error {
  readonly code:
    | 'project_not_found'
    | 'document_not_found'
    | 'document_exists'
    | 'invalid_request'

  constructor(code: ManualDocumentError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type ManualDocumentInput = {
  documentId: string
  title: string
  content: string
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

export function manualRawSourcePath(documentId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new ManualDocumentError('invalid_request', 'documentId 必须为 UUID')
  }
  return `raw/sources/manual/${documentId}.md`
}

export function manualWikiPath(documentId: string): string {
  return `wiki/sources/manual/${documentId}.md`
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function formatRawMarkdown(title: string, content: string): string {
  const trimmedTitle = title.trim()
  const body = content.replace(/\r\n/g, '\n')
  return `# ${trimmedTitle}\n\n${body}`
}

function formatWikiMarkdown(documentId: string, title: string, content: string): string {
  const trimmedTitle = title.trim()
  const body = content.replace(/\r\n/g, '\n')
  return `---\ntitle: ${JSON.stringify(trimmedTitle)}\nkind: manual\ndocumentId: ${documentId}\n---\n\n${body}\n`
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function writeFileEnsuringParent(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf8')
}

async function upsertManualAuthorityFiles(
  projectDir: string,
  input: ManualDocumentInput,
): Promise<{ sourcePath: string; wikiPath: string; fingerprint: string; extracted: ExtractedTextRecord }> {
  const sourcePath = manualRawSourcePath(input.documentId)
  const wikiPath = manualWikiPath(input.documentId)
  const rawMarkdown = formatRawMarkdown(input.title, input.content)
  const wikiMarkdown = formatWikiMarkdown(input.documentId, input.title, input.content)
  const fingerprint = sha256Hex(rawMarkdown)
  const rawAbs = path.join(projectDir, ...sourcePath.split('/'))
  const wikiAbs = path.join(projectDir, ...wikiPath.split('/'))
  await writeFileEnsuringParent(rawAbs, rawMarkdown)
  await writeFileEnsuringParent(wikiAbs, wikiMarkdown)
  const extracted: ExtractedTextRecord = {
    sourcePath,
    text: rawMarkdown,
    importId: '',
    fingerprint,
  }
  await writeExtractedTextRecord(projectDir, sourcePath, extracted)
  const store = await readFingerprintStore(projectDir)
  const entry: FingerprintEntry = {
    sha256: fingerprint,
    kind: 'text',
    extractedRelativePath: `.olps-knowledge/extracted/${sourcePath}.json`,
  }
  store[sourcePath] = entry
  await writeFingerprintStore(projectDir, store)
  return { sourcePath, wikiPath, fingerprint, extracted }
}

export async function createManualDocument(
  knowledgeRoot: string,
  siteId: string,
  input: ManualDocumentInput,
): Promise<{ sourcePath: string; wikiPath: string; fingerprint: string }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  if (!(await pathExists(projectDir))) {
    throw new ManualDocumentError('project_not_found', `project not found: ${siteId}`)
  }
  const sourcePath = manualRawSourcePath(input.documentId)
  const rawAbs = path.join(projectDir, ...sourcePath.split('/'))
  if (await pathExists(rawAbs)) {
    throw new ManualDocumentError('document_exists', `manual document exists: ${input.documentId}`)
  }
  const written = await upsertManualAuthorityFiles(projectDir, input)
  return {
    sourcePath: written.sourcePath,
    wikiPath: written.wikiPath,
    fingerprint: written.fingerprint,
  }
}

export async function updateManualDocument(
  knowledgeRoot: string,
  siteId: string,
  input: ManualDocumentInput,
): Promise<{ sourcePath: string; wikiPath: string; fingerprint: string }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  if (!(await pathExists(projectDir))) {
    throw new ManualDocumentError('project_not_found', `project not found: ${siteId}`)
  }
  const sourcePath = manualRawSourcePath(input.documentId)
  const rawAbs = path.join(projectDir, ...sourcePath.split('/'))
  if (!(await pathExists(rawAbs))) {
    throw new ManualDocumentError('document_not_found', `manual document missing: ${input.documentId}`)
  }
  const written = await upsertManualAuthorityFiles(projectDir, input)
  return {
    sourcePath: written.sourcePath,
    wikiPath: written.wikiPath,
    fingerprint: written.fingerprint,
  }
}

export async function deleteManualDocument(
  knowledgeRoot: string,
  siteId: string,
  documentId: string,
): Promise<void> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  if (!(await pathExists(projectDir))) {
    throw new ManualDocumentError('project_not_found', `project not found: ${siteId}`)
  }
  const sourcePath = manualRawSourcePath(documentId)
  const wikiPath = manualWikiPath(documentId)
  const rawAbs = path.join(projectDir, ...sourcePath.split('/'))
  if (!(await pathExists(rawAbs))) {
    throw new ManualDocumentError('document_not_found', `manual document missing: ${documentId}`)
  }
  await fs.rm(rawAbs, { force: true })
  const wikiAbs = path.join(projectDir, ...wikiPath.split('/'))
  await fs.rm(wikiAbs, { force: true })
  const extractedAbs = path.join(projectDir, '.olps-knowledge', 'extracted', `${sourcePath}.json`)
  await fs.rm(extractedAbs, { force: true })
  const store = await readFingerprintStore(projectDir)
  delete store[sourcePath]
  await writeFingerprintStore(projectDir, store)
}

export function parseManualRawMarkdown(rawMarkdown: string): { title: string; content: string } {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n')
  const titleMatch = /^# (.+)\n/m.exec(normalized)
  if (!titleMatch) {
    throw new ManualDocumentError('invalid_request', 'manual raw 缺少标题')
  }
  const title = titleMatch[1].trim()
  const content = normalized.replace(/^# .+\n\n?/, '')
  return { title, content }
}

export async function readManualDocumentAuthority(
  knowledgeRoot: string,
  siteId: string,
  documentId: string,
): Promise<{ title: string; content: string; sourcePath: string; wikiPath: string; fingerprint: string }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const sourcePath = manualRawSourcePath(documentId)
  const rawAbs = path.join(projectDir, ...sourcePath.split('/'))
  const rawMarkdown = await fs.readFile(rawAbs, 'utf8')
  const { title, content } = parseManualRawMarkdown(rawMarkdown)
  const fingerprint = sha256Hex(rawMarkdown)
  return {
    title,
    content,
    sourcePath,
    wikiPath: manualWikiPath(documentId),
    fingerprint,
  }
}

export async function copyManualDocumentBetweenSites(input: {
  knowledgeRoot: string
  sourceSiteId: string
  targetSiteId: string
  sourceDocumentId: string
  newDocumentId: string
}): Promise<{ sourcePath: string; wikiPath: string; fingerprint: string; title: string; content: string }> {
  const source = await readManualDocumentAuthority(input.knowledgeRoot, input.sourceSiteId, input.sourceDocumentId)
  const written = await createManualDocument(input.knowledgeRoot, input.targetSiteId, {
    documentId: input.newDocumentId,
    title: source.title,
    content: source.content,
  })
  return { ...written, title: source.title, content: source.content }
}