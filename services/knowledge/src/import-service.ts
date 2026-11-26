import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readFingerprintStore } from './project-fingerprints.js'
import { isKnowledgeProjectInitialized } from './project-layout.js'
import { assertLegalSiteId } from './site-id.js'
import { ImportPathError, normalizeSourceRelativePath } from './import-path.js'
import { extractZipFiles, ImportZipError, type ExtractedZipFile } from './import-zip.js'
import { enqueueSiteWork } from './import-queue.js'
import { processImportedSources } from './source-processing.js'
import { projectImportedSourceDocuments, rebuildKnowledgeProjection } from './projection-sync.js'
import type { KnowledgeServiceConfig } from './types.js'
import type { KnowledgeAiConfig } from './ai-config.js'
import { runIngestPipeline } from './ingest-service.js'
import { runAssetRoleIdentification } from './asset-role-identification.js'
import {
  createPendingImportItems,
  ensureImportItems,
  listFailedImportItemPaths,
  readImportItems,
  summarizeImportItems,
  writeImportItems,
  type ImportItem,
} from './import-items.js'
import { ingestProgressRelativePath } from './source-wiki-path.js'

function createLiveSourceProjector(
  knowledgeRoot: string,
  databaseUrl: string | undefined,
  siteId: string,
  importId: string,
): ((sourcePath: string) => Promise<void>) | undefined {
  const trimmed = databaseUrl?.trim()
  if (!trimmed) return undefined
  return async (sourcePath: string) => {
    await projectImportedSourceDocuments({
      knowledgeRoot,
      databaseUrl: trimmed,
      siteId,
      importId,
      sourcePath,
    })
  }
}

export type ImportStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type ImportStatusRecord = {
  importId: string
  siteId: string
  sourceName: string
  draftId: string | null
  status: ImportStatus
  stats: {
    fileCount: number
    totalBytes: number
    writtenPaths: string[]
    extracted: number
    skipped: number
    fingerprintSkips: number
    assetsRegistered: number
    ingestPagesWritten: number
    ingestPagesSkipped: number
    ingestPagesCreated?: number
    ingestPagesUpdated?: number
    ingestRejectedUpdates?: number
    ingestPagesFailed?: number
    ingestPagesDuplicated?: number
    sourceBytesWritten?: number
    ingestDisabled?: boolean
    assetRolesIdentified?: number
    assetRoleReviewsAdded?: number
    itemSucceeded?: number
    itemFailed?: number
    itemSkippedDuplicate?: number
    itemSkippedUnsupported?: number
  }
  items?: ImportItem[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export type CreateImportBody = {
  sourceName?: string
  draftId?: string
  zipBase64?: string
  files?: Array<{ relativePath: string; contentBase64: string }>
}

export class ImportRequestError extends Error {
  readonly code:
    | 'import_bad_request'
    | 'import_total_size_exceeded'
    | 'import_file_size_exceeded'
    | 'import_invalid_zip'
    | 'import_empty_package'
    | 'import_invalid_path'
    | 'project_not_found'
    | 'import_not_found'
    | 'import_not_retryable'
    | 'import_retry_empty'

  constructor(
    code: ImportRequestError['code'],
    message: string,
  ) {
    super(message)
    this.code = code
  }
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

function importStatusPath(projectDir: string, importId: string): string {
  return path.join(projectDir, '.olps-knowledge', 'imports', importId, 'status.json')
}

async function writeImportStatus(projectDir: string, record: ImportStatusRecord): Promise<void> {
  const filePath = importStatusPath(projectDir, record.importId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  record.updatedAt = new Date().toISOString()
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

async function readImportStatusFile(
  knowledgeRoot: string,
  siteId: string,
  importId: string,
): Promise<ImportStatusRecord> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const filePath = importStatusPath(projectDir, importId)
  let lastSyntax: SyntaxError | null = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        throw new ImportRequestError('import_not_found', `import not found: ${importId}`)
      }
      throw err
    }
    try {
      return JSON.parse(raw) as ImportStatusRecord
    } catch (err) {
      if (err instanceof SyntaxError) {
        lastSyntax = err
        await new Promise((resolve) => setTimeout(resolve, 5))
        continue
      }
      throw err
    }
  }
  throw lastSyntax ?? new Error(`import status unreadable: ${importId}`)
}

export async function getImportStatus(
  knowledgeRoot: string,
  siteId: string,
  importId: string,
): Promise<ImportStatusRecord> {
  const exists = await isKnowledgeProjectInitialized(knowledgeRoot, siteId)
  if (!exists) {
    throw new ImportRequestError('project_not_found', 'project not initialized')
  }
  const record = await readImportStatusFile(knowledgeRoot, siteId, importId)
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const itemsFile = await readImportItems(projectDir, importId)
  if (itemsFile) {
    record.items = itemsFile.items
    const summary = summarizeImportItems(itemsFile.items)
    record.stats.itemSucceeded = summary.itemSucceeded
    record.stats.itemFailed = summary.itemFailed
    record.stats.itemSkippedDuplicate = summary.itemSkippedDuplicate
    record.stats.itemSkippedUnsupported = summary.itemSkippedUnsupported
  }
  return record
}

function decodeBase64Payload(label: string, encoded: string): Buffer {
  const trimmed = encoded.trim()
  if (!trimmed) {
    throw new ImportRequestError('import_bad_request', `${label} base64 empty`)
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(trimmed, 'base64')
  } catch {
    throw new ImportRequestError('import_bad_request', `${label} base64 invalid`)
  }
  if (bytes.length === 0 && trimmed.length > 0) {
    throw new ImportRequestError('import_bad_request', `${label} base64 invalid`)
  }
  return bytes
}

function mapZipError(error: unknown): never {
  if (error instanceof ImportZipError) {
    throw new ImportRequestError(error.code, error.message)
  }
  if (error instanceof ImportPathError) {
    throw new ImportRequestError('import_invalid_path', error.message)
  }
  throw error
}

async function materializeImportFiles(
  body: CreateImportBody,
  limits: Pick<KnowledgeServiceConfig, 'importMaxBytes' | 'singleFileMaxBytes'>,
): Promise<ExtractedZipFile[]> {
  const hasZip = typeof body.zipBase64 === 'string' && body.zipBase64.trim() !== ''
  const hasFiles = Array.isArray(body.files)

  if (hasZip && hasFiles) {
    throw new ImportRequestError('import_bad_request', 'zipBase64 and files are mutually exclusive')
  }
  if (!hasZip && !hasFiles) {
    throw new ImportRequestError('import_bad_request', 'require zipBase64 or files')
  }

  if (hasZip) {
    const zipBytes = decodeBase64Payload('zip', body.zipBase64!)
    try {
      return await extractZipFiles(zipBytes, {
        importMaxBytes: limits.importMaxBytes,
        singleFileMaxBytes: limits.singleFileMaxBytes,
      })
    } catch (err) {
      mapZipError(err)
    }
  }

  const fileList = body.files!
  if (fileList.length === 0) {
    throw new ImportRequestError('import_empty_package', 'no files in package')
  }

  const extracted: ExtractedZipFile[] = []
  let totalBytes = 0
  for (const item of fileList) {
    let relativePath: string
    try {
      relativePath = normalizeSourceRelativePath(item.relativePath)
    } catch (err) {
      if (err instanceof ImportPathError) {
        throw new ImportRequestError('import_invalid_path', err.message)
      }
      throw err
    }
    const bytes = decodeBase64Payload(`file ${relativePath}`, item.contentBase64)
    if (bytes.length === 0) {
      throw new ImportRequestError('import_empty_package', 'file entry is empty')
    }
    if (bytes.length > limits.singleFileMaxBytes) {
      throw new ImportRequestError('import_file_size_exceeded', `file too large: ${relativePath}`)
    }
    totalBytes += bytes.length
    if (totalBytes > limits.importMaxBytes) {
      throw new ImportRequestError('import_total_size_exceeded', 'total size exceeded')
    }
    extracted.push({ relativePath, bytes })
  }

  if (extracted.length === 0) {
    throw new ImportRequestError('import_empty_package', 'no files in package')
  }

  return extracted
}

async function hashFileContents(file: ExtractedZipFile): Promise<{ fingerprint: string; byteLength: number }> {
  if (file.filePath) {
    const hash = createHash('sha256')
    let byteLength = 0
    for await (const chunk of createReadStream(file.filePath)) {
      hash.update(chunk)
      byteLength += chunk.length
    }
    return { fingerprint: hash.digest('hex'), byteLength }
  }
  if (!file.bytes) {
    throw new Error(`导入文件缺少内容: ${file.relativePath}`)
  }
  return {
    fingerprint: createHash('sha256').update(file.bytes).digest('hex'),
    byteLength: file.bytes.length,
  }
}

async function writeSourcesToDisk(
  projectDir: string,
  files: ExtractedZipFile[],
): Promise<{ writtenPaths: string[]; sourceBytesWritten: number }> {
  const store = await readFingerprintStore(projectDir)
  const writtenPaths: string[] = []
  let sourceBytesWritten = 0
  for (const file of files) {
    const relUnderSources = path.posix.join('raw/sources', file.relativePath.split(path.sep).join('/'))
    const { fingerprint, byteLength } = await hashFileContents(file)
    const existing = store[relUnderSources]
    writtenPaths.push(relUnderSources)
    if (existing?.sha256 === fingerprint) {
      continue
    }
    const abs = path.join(projectDir, ...relUnderSources.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    if (file.filePath) {
      await fs.copyFile(file.filePath, abs)
    } else if (file.bytes) {
      await fs.writeFile(abs, file.bytes)
    } else {
      throw new Error(`导入文件缺少内容: ${file.relativePath}`)
    }
    sourceBytesWritten += byteLength
  }
  writtenPaths.sort()
  return { writtenPaths, sourceBytesWritten }
}

async function attachItemSummary(projectDir: string, record: ImportStatusRecord): Promise<void> {
  const itemsFile = await readImportItems(projectDir, record.importId)
  if (!itemsFile) {
    return
  }
  record.items = itemsFile.items
  const summary = summarizeImportItems(itemsFile.items)
  record.stats.itemSucceeded = summary.itemSucceeded
  record.stats.itemFailed = summary.itemFailed
  record.stats.itemSkippedDuplicate = summary.itemSkippedDuplicate
  record.stats.itemSkippedUnsupported = summary.itemSkippedUnsupported
  if (summary.itemFailed > 0) {
    const failedMessages = itemsFile.items
      .filter((item) => item.status === 'failed' && item.error)
      .map((item) => `${item.sourcePath}: ${item.error}`)
    record.error = failedMessages.slice(0, 5).join('；') || `${summary.itemFailed} 个资料处理失败`
  } else {
    record.error = null
  }
}

async function runImportJob(
  config: KnowledgeServiceConfig,
  siteId: string,
  importId: string,
  files: ExtractedZipFile[],
): Promise<void> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  let record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
  record.status = 'processing'
  await writeImportStatus(projectDir, record)

  try {
    const { writtenPaths, sourceBytesWritten } = await writeSourcesToDisk(projectDir, files)
    await ensureImportItems(projectDir, importId, writtenPaths)
    let totalBytes = 0
    for (const file of files) {
      if (file.bytes) {
        totalBytes += file.bytes.length
      } else if (file.filePath) {
        totalBytes += (await fs.stat(file.filePath)).size
      }
    }
    const processingStats = await processImportedSources(projectDir, writtenPaths, importId)
    const ingestDisabled = process.env.KNOWLEDGE_DISABLE_INGEST === '1'
    const ingestStats = ingestDisabled
      ? {
          pagesWritten: 0,
          pagesSkipped: 0,
          pagesCreated: 0,
          pagesUpdated: 0,
          rejectedUpdates: 0,
          pagesFailed: 0,
          pagesDuplicated: 0,
        }
      : await runIngestPipeline({
          projectDir,
          importId,
          writtenPaths,
          projectSource: createLiveSourceProjector(config.knowledgeRoot, config.databaseUrl, siteId, importId),
        })
    const roleStats = ingestDisabled
      ? { identified: 0, skippedAlready: 0, reviewsAdded: 0 }
      : await runAssetRoleIdentification({
          projectDir,
          importId,
          writtenPaths,
        })
    if (ingestDisabled) {
      const itemsFile = await readImportItems(projectDir, importId)
      if (itemsFile) {
        const now = new Date().toISOString()
        for (const item of itemsFile.items) {
          if (item.status === 'pending') {
            item.status = 'succeeded'
            item.updatedAt = now
          }
        }
        await writeImportItems(projectDir, itemsFile)
      }
    }
    record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
    record.stats = {
      fileCount: files.length,
      totalBytes,
      writtenPaths,
      extracted: processingStats.extracted,
      skipped: processingStats.skipped,
      fingerprintSkips: processingStats.fingerprintSkips,
      assetsRegistered: processingStats.assetsRegistered,
      ingestPagesWritten: ingestStats.pagesWritten,
      ingestPagesSkipped: ingestStats.pagesSkipped,
      ingestPagesCreated: ingestStats.pagesCreated,
      ingestPagesUpdated: ingestStats.pagesUpdated,
      ingestRejectedUpdates: ingestStats.rejectedUpdates,
      ingestPagesFailed: ingestStats.pagesFailed,
      ingestPagesDuplicated: ingestStats.pagesDuplicated,
      sourceBytesWritten,
      ingestDisabled,
      assetRolesIdentified: roleStats.identified,
      assetRoleReviewsAdded: roleStats.reviewsAdded,
    }
    await attachItemSummary(projectDir, record)
    if (config.databaseUrl) {
      await rebuildKnowledgeProjection({
        knowledgeRoot: config.knowledgeRoot,
        databaseUrl: config.databaseUrl,
        siteId,
        importId,
        importRecord: record,
      })
    }
    record.status = 'completed'
    await writeImportStatus(projectDir, record)
  } catch (err) {
    record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
    record.status = 'failed'
    record.error = err instanceof Error ? err.message : String(err)
    await attachItemSummary(projectDir, record)
    await writeImportStatus(projectDir, record)
  }
}

async function clearIngestProgressForPaths(
  projectDir: string,
  importId: string,
  sourcePaths: string[],
): Promise<void> {
  const rel = ingestProgressRelativePath(importId)
  const abs = path.join(projectDir, ...rel.split('/'))
  let progress: {
    importId: string
    completedSourcePaths: string[]
    failedSourcePaths: string[]
    metaPagesUpdated: boolean
  }
  try {
    const raw = await fs.readFile(abs, 'utf8')
    progress = JSON.parse(raw) as typeof progress
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      progress = {
        importId,
        completedSourcePaths: [],
        failedSourcePaths: [],
        metaPagesUpdated: false,
      }
    } else {
      throw err
    }
  }
  const remove = new Set(sourcePaths)
  progress.completedSourcePaths = (progress.completedSourcePaths ?? []).filter((item) => !remove.has(item))
  progress.failedSourcePaths = (progress.failedSourcePaths ?? []).filter((item) => !remove.has(item))
  progress.metaPagesUpdated = false
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, `${JSON.stringify(progress, null, 2)}\n`, 'utf8')
}

async function runRetryImportJob(
  config: KnowledgeServiceConfig,
  siteId: string,
  importId: string,
  sourcePaths: string[],
): Promise<void> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  let record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
  record.status = 'processing'
  record.error = null
  await writeImportStatus(projectDir, record)

  try {
    await clearIngestProgressForPaths(projectDir, importId, sourcePaths)
    const processingStats = await processImportedSources(projectDir, sourcePaths, importId)
    const ingestDisabled = process.env.KNOWLEDGE_DISABLE_INGEST === '1'
    const ingestStats = ingestDisabled
      ? {
          pagesWritten: 0,
          pagesSkipped: 0,
          pagesCreated: 0,
          pagesUpdated: 0,
          rejectedUpdates: 0,
          pagesFailed: 0,
          pagesDuplicated: 0,
        }
      : await runIngestPipeline({
          projectDir,
          importId,
          writtenPaths: sourcePaths,
          resume: true,
          projectSource: createLiveSourceProjector(config.knowledgeRoot, config.databaseUrl, siteId, importId),
        })
    const roleStats = ingestDisabled
      ? { identified: 0, skippedAlready: 0, reviewsAdded: 0 }
      : await runAssetRoleIdentification({
          projectDir,
          importId,
          writtenPaths: sourcePaths,
        })
    record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
    record.stats.extracted = (record.stats.extracted ?? 0) + processingStats.extracted
    record.stats.skipped = (record.stats.skipped ?? 0) + processingStats.skipped
    record.stats.fingerprintSkips = (record.stats.fingerprintSkips ?? 0) + processingStats.fingerprintSkips
    record.stats.assetsRegistered = (record.stats.assetsRegistered ?? 0) + processingStats.assetsRegistered
    record.stats.ingestPagesWritten = (record.stats.ingestPagesWritten ?? 0) + ingestStats.pagesWritten
    record.stats.ingestPagesSkipped = (record.stats.ingestPagesSkipped ?? 0) + ingestStats.pagesSkipped
    record.stats.ingestPagesCreated = (record.stats.ingestPagesCreated ?? 0) + ingestStats.pagesCreated
    record.stats.ingestPagesUpdated = (record.stats.ingestPagesUpdated ?? 0) + ingestStats.pagesUpdated
    record.stats.ingestRejectedUpdates = (record.stats.ingestRejectedUpdates ?? 0) + ingestStats.rejectedUpdates
    record.stats.ingestPagesFailed = ingestStats.pagesFailed
    record.stats.ingestPagesDuplicated = (record.stats.ingestPagesDuplicated ?? 0) + ingestStats.pagesDuplicated
    record.stats.assetRolesIdentified = (record.stats.assetRolesIdentified ?? 0) + roleStats.identified
    record.stats.assetRoleReviewsAdded = (record.stats.assetRoleReviewsAdded ?? 0) + roleStats.reviewsAdded
    await attachItemSummary(projectDir, record)
    if (config.databaseUrl) {
      await rebuildKnowledgeProjection({
        knowledgeRoot: config.knowledgeRoot,
        databaseUrl: config.databaseUrl,
        siteId,
        importId,
        importRecord: record,
      })
    }
    record.status = 'completed'
    await writeImportStatus(projectDir, record)
  } catch (err) {
    record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
    record.status = 'failed'
    record.error = err instanceof Error ? err.message : String(err)
    await attachItemSummary(projectDir, record)
    await writeImportStatus(projectDir, record)
  }
}

export async function createKnowledgeImport(
  config: KnowledgeServiceConfig,
  siteId: string,
  body: CreateImportBody,
): Promise<{ importId: string; status: 'queued' }> {
  const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
  if (!exists) {
    throw new ImportRequestError('project_not_found', 'project not initialized')
  }

  const files = await materializeImportFiles(body, config)
  const importId = randomUUID()
  const sourceName = body.sourceName?.trim() || 'import'
  const draftId = body.draftId?.trim() || null
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const now = new Date().toISOString()

  const record: ImportStatusRecord = {
    importId,
    siteId,
    sourceName,
    draftId,
    status: 'queued',
    stats: {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + (file.bytes?.length ?? 0), 0),
      writtenPaths: [],
      extracted: 0,
      skipped: 0,
      fingerprintSkips: 0,
      assetsRegistered: 0,
      ingestPagesWritten: 0,
      ingestPagesSkipped: 0,
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  await writeImportStatus(projectDir, record)
  const pendingPaths = files.map((file) => path.posix.join('raw/sources', file.relativePath.split(path.sep).join('/')))
  await writeImportItems(projectDir, createPendingImportItems(importId, pendingPaths))

  void enqueueSiteWork(siteId, () => runImportJob(config, siteId, importId, files))

  return { importId, status: 'queued' }
}

export async function createKnowledgeImportFromPreparedFiles(
  config: KnowledgeServiceConfig,
  siteId: string,
  input: {
    sourceName?: string
    draftId?: string | null
    files: ExtractedZipFile[]
  },
): Promise<{ importId: string; status: 'queued' }> {
  const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
  if (!exists) {
    throw new ImportRequestError('project_not_found', 'project not initialized')
  }
  if (!input.files.length) {
    throw new ImportRequestError('import_empty_package', 'no files in package')
  }

  let totalBytes = 0
  for (const file of input.files) {
    let size = 0
    if (file.bytes) {
      size = file.bytes.length
    } else if (file.filePath) {
      size = (await fs.stat(file.filePath)).size
    } else {
      throw new ImportRequestError('import_bad_request', `file missing content: ${file.relativePath}`)
    }
    if (size > config.singleFileMaxBytes) {
      throw new ImportRequestError('import_file_size_exceeded', `file too large: ${file.relativePath}`)
    }
    totalBytes += size
  }
  if (totalBytes > config.importMaxBytes) {
    throw new ImportRequestError('import_total_size_exceeded', 'total size exceeded')
  }

  const importId = randomUUID()
  const sourceName = input.sourceName?.trim() || 'import'
  const draftId = input.draftId?.trim() || null
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const now = new Date().toISOString()
  const record: ImportStatusRecord = {
    importId,
    siteId,
    sourceName,
    draftId,
    status: 'queued',
    stats: {
      fileCount: input.files.length,
      totalBytes,
      writtenPaths: [],
      extracted: 0,
      skipped: 0,
      fingerprintSkips: 0,
      assetsRegistered: 0,
      ingestPagesWritten: 0,
      ingestPagesSkipped: 0,
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  await writeImportStatus(projectDir, record)
  const pendingPaths = input.files.map((file) =>
    path.posix.join('raw/sources', file.relativePath.split(path.sep).join('/')),
  )
  await writeImportItems(projectDir, createPendingImportItems(importId, pendingPaths))
  void enqueueSiteWork(siteId, () => runImportJob(config, siteId, importId, input.files))
  return { importId, status: 'queued' }
}

export async function retryFailedImportItems(
  config: KnowledgeServiceConfig,
  siteId: string,
  importId: string,
  body?: { sourcePaths?: string[] },
): Promise<{ importId: string; status: ImportStatus; retriedSourcePaths: string[] }> {
  const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
  if (!exists) {
    throw new ImportRequestError('project_not_found', 'project not initialized')
  }
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const record = await readImportStatusFile(config.knowledgeRoot, siteId, importId)
  if (record.status === 'queued' || record.status === 'processing') {
    throw new ImportRequestError('import_not_retryable', `import 当前状态不可重试: ${record.status}`)
  }
  const itemsFile = await readImportItems(projectDir, importId)
  if (!itemsFile) {
    throw new ImportRequestError('import_bad_request', 'import 缺少 items，无法重试')
  }
  const retriedSourcePaths = listFailedImportItemPaths(itemsFile.items, body?.sourcePaths)
  if (retriedSourcePaths.length === 0) {
    throw new ImportRequestError('import_retry_empty', '没有可重试的失败资料')
  }
  const now = new Date().toISOString()
  for (const item of itemsFile.items) {
    if (!retriedSourcePaths.includes(item.sourcePath)) {
      continue
    }
    item.status = 'pending'
    item.error = null
    item.updatedAt = now
  }
  await writeImportItems(projectDir, itemsFile)
  record.status = 'queued'
  record.error = null
  await writeImportStatus(projectDir, record)
  void enqueueSiteWork(siteId, () => runRetryImportJob(config, siteId, importId, retriedSourcePaths))
  return { importId, status: 'queued', retriedSourcePaths }
}

export async function resumeIngestForImport(input: {
  knowledgeRoot: string
  siteId: string
  importId: string
  ai: KnowledgeAiConfig
  databaseUrl?: string
}): Promise<{ pagesWritten: number; pagesSkipped: number }> {
  const projectDir = resolveProjectDir(input.knowledgeRoot, input.siteId)
  const record = await readImportStatusFile(input.knowledgeRoot, input.siteId, input.importId)
  const writtenPaths = record.stats.writtenPaths
  if (!writtenPaths || writtenPaths.length === 0) {
    throw new ImportRequestError('import_bad_request', 'import 缺少 writtenPaths，无法续跑 Ingest')
  }
  await ensureImportItems(projectDir, input.importId, writtenPaths)
  const ingestStats = await runIngestPipeline({
    projectDir,
    importId: input.importId,
    writtenPaths,
    ai: input.ai,
    resume: true,
    projectSource: createLiveSourceProjector(input.knowledgeRoot, input.databaseUrl, input.siteId, input.importId),
  })
  record.stats.ingestPagesWritten = (record.stats.ingestPagesWritten ?? 0) + ingestStats.pagesWritten
  record.stats.ingestPagesSkipped = (record.stats.ingestPagesSkipped ?? 0) + ingestStats.pagesSkipped
  record.stats.ingestPagesFailed = ingestStats.pagesFailed
  record.stats.ingestPagesDuplicated = (record.stats.ingestPagesDuplicated ?? 0) + ingestStats.pagesDuplicated
  await attachItemSummary(projectDir, record)
  record.status = 'completed'
  await writeImportStatus(projectDir, record)
  return ingestStats
}