import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImportPathError, normalizeSourceRelativePath } from './import-path.js'
import { extractZipFromFilePath } from './import-zip.js'
import {
  createKnowledgeImportFromPreparedFiles,
  ImportRequestError,
} from './import-service.js'
import { isKnowledgeProjectInitialized } from './project-layout.js'
import { assertLegalSiteId } from './site-id.js'
import type { KnowledgeServiceConfig } from './types.js'

export type UploadSessionKind = 'zip' | 'files'

export type UploadSessionFileSpec = {
  relativePath: string
  size: number
}

export type UploadSessionManifest = {
  uploadId: string
  siteId: string
  sourceName: string
  kind: UploadSessionKind
  totalBytes: number
  chunkBytes: number
  draftId: string | null
  sha256: string | null
  files: UploadSessionFileSpec[]
  /** zip：已收分片 index → 字节数；files：`${fileIndex}:${chunkIndex}` → 字节数 */
  received: Record<string, number>
  status: 'uploading' | 'assembling' | 'completed' | 'failed'
  importId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export class UploadSessionError extends Error {
  constructor(
    readonly code:
      | 'upload_bad_request'
      | 'upload_not_found'
      | 'upload_conflict'
      | 'upload_incomplete'
      | 'project_not_found'
      | 'import_total_size_exceeded'
      | 'import_file_size_exceeded'
      | 'import_invalid_path'
      | 'import_empty_package'
      | 'import_invalid_zip',
    message: string,
  ) {
    super(message)
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

function uploadRoot(projectDir: string, uploadId: string): string {
  return path.join(projectDir, '.olps-knowledge', 'uploads', uploadId)
}

function manifestPath(projectDir: string, uploadId: string): string {
  return path.join(uploadRoot(projectDir, uploadId), 'manifest.json')
}

async function readManifest(projectDir: string, uploadId: string): Promise<UploadSessionManifest> {
  try {
    const raw = await fs.readFile(manifestPath(projectDir, uploadId), 'utf8')
    return JSON.parse(raw) as UploadSessionManifest
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      throw new UploadSessionError('upload_not_found', `upload not found: ${uploadId}`)
    }
    throw err
  }
}

async function writeManifest(projectDir: string, manifest: UploadSessionManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString()
  const filePath = manifestPath(projectDir, manifest.uploadId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function expectedChunkCount(totalBytes: number, chunkBytes: number): number {
  if (totalBytes <= 0) return 0
  return Math.ceil(totalBytes / chunkBytes)
}

function chunkByteSize(totalBytes: number, chunkBytes: number, index: number): number {
  const count = expectedChunkCount(totalBytes, chunkBytes)
  if (index < 0 || index >= count) {
    throw new UploadSessionError('upload_bad_request', `chunk index out of range: ${index}`)
  }
  if (index < count - 1) return chunkBytes
  return totalBytes - chunkBytes * (count - 1)
}

async function hashBuffer(bytes: Buffer): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

async function assembleChunkFiles(
  chunkDir: string,
  chunkCount: number,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, Buffer.alloc(0))
  for (let index = 0; index < chunkCount; index += 1) {
    const chunkPath = path.join(chunkDir, String(index))
    const data = await fs.readFile(chunkPath)
    await fs.appendFile(outputPath, data)
  }
}

export type CreateUploadSessionInput = {
  sourceName?: string
  draftId?: string
  kind: UploadSessionKind
  totalBytes: number
  chunkBytes?: number
  sha256?: string
  files?: UploadSessionFileSpec[]
}

export async function createUploadSession(
  config: KnowledgeServiceConfig,
  siteId: string,
  input: CreateUploadSessionInput,
): Promise<UploadSessionManifest> {
  const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
  if (!exists) {
    throw new UploadSessionError('project_not_found', 'project not initialized')
  }
  if (!Number.isInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new UploadSessionError('upload_bad_request', 'totalBytes must be a positive integer')
  }
  if (input.totalBytes > config.importMaxBytes) {
    throw new UploadSessionError('import_total_size_exceeded', 'total size exceeded')
  }
  const chunkBytes =
    input.chunkBytes && Number.isInteger(input.chunkBytes) && input.chunkBytes > 0
      ? input.chunkBytes
      : config.uploadChunkBytes
  if (chunkBytes > config.uploadChunkBytes * 2) {
    throw new UploadSessionError('upload_bad_request', 'chunkBytes too large')
  }

  let files: UploadSessionFileSpec[] = []
  if (input.kind === 'files') {
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new UploadSessionError('import_empty_package', 'files list required')
    }
    let sum = 0
    for (const item of input.files) {
      let relativePath: string
      try {
        relativePath = normalizeSourceRelativePath(item.relativePath)
      } catch (err) {
        if (err instanceof ImportPathError) {
          throw new UploadSessionError('import_invalid_path', err.message)
        }
        throw err
      }
      if (!Number.isInteger(item.size) || item.size <= 0) {
        throw new UploadSessionError('upload_bad_request', `invalid file size: ${relativePath}`)
      }
      if (item.size > config.singleFileMaxBytes) {
        throw new UploadSessionError('import_file_size_exceeded', `file too large: ${relativePath}`)
      }
      sum += item.size
      files.push({ relativePath, size: item.size })
    }
    if (sum !== input.totalBytes) {
      throw new UploadSessionError('upload_bad_request', 'files sizes must sum to totalBytes')
    }
  } else if (input.kind !== 'zip') {
    throw new UploadSessionError('upload_bad_request', 'kind must be zip or files')
  } else if (input.files && input.files.length > 0) {
    throw new UploadSessionError('upload_bad_request', 'zip session must not include files list')
  }

  const uploadId = randomUUID()
  const now = new Date().toISOString()
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const manifest: UploadSessionManifest = {
    uploadId,
    siteId,
    sourceName: input.sourceName?.trim() || 'import',
    kind: input.kind,
    totalBytes: input.totalBytes,
    chunkBytes,
    draftId: input.draftId?.trim() || null,
    sha256: input.sha256?.trim() || null,
    files,
    received: {},
    status: 'uploading',
    importId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(path.join(uploadRoot(projectDir, uploadId), 'chunks'), { recursive: true })
  await writeManifest(projectDir, manifest)
  return manifest
}

export async function getUploadSession(
  config: KnowledgeServiceConfig,
  siteId: string,
  uploadId: string,
): Promise<UploadSessionManifest> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const manifest = await readManifest(projectDir, uploadId)
  if (manifest.siteId !== siteId) {
    throw new UploadSessionError('upload_not_found', `upload not found: ${uploadId}`)
  }
  return manifest
}

export async function putUploadZipChunk(
  config: KnowledgeServiceConfig,
  siteId: string,
  uploadId: string,
  chunkIndex: number,
  bytes: Buffer,
  chunkSha256?: string,
): Promise<UploadSessionManifest> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const manifest = await readManifest(projectDir, uploadId)
  if (manifest.siteId !== siteId) {
    throw new UploadSessionError('upload_not_found', `upload not found: ${uploadId}`)
  }
  if (manifest.kind !== 'zip') {
    throw new UploadSessionError('upload_bad_request', 'not a zip upload session')
  }
  if (manifest.status !== 'uploading') {
    throw new UploadSessionError('upload_conflict', `upload status is ${manifest.status}`)
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new UploadSessionError('upload_bad_request', 'invalid chunk index')
  }
  const expectedSize = chunkByteSize(manifest.totalBytes, manifest.chunkBytes, chunkIndex)
  if (bytes.length !== expectedSize) {
    throw new UploadSessionError(
      'upload_bad_request',
      `chunk ${chunkIndex} size mismatch: got ${bytes.length}, expected ${expectedSize}`,
    )
  }
  if (chunkSha256) {
    const actual = await hashBuffer(bytes)
    if (actual !== chunkSha256.toLowerCase()) {
      throw new UploadSessionError('upload_bad_request', `chunk ${chunkIndex} sha256 mismatch`)
    }
  }
  const key = String(chunkIndex)
  const chunkPath = path.join(uploadRoot(projectDir, uploadId), 'chunks', key)
  const existing = manifest.received[key]
  if (existing !== undefined) {
    if (existing === bytes.length) {
      return manifest
    }
    throw new UploadSessionError('upload_conflict', `chunk ${chunkIndex} already received with different size`)
  }
  await fs.writeFile(chunkPath, bytes)
  manifest.received[key] = bytes.length
  await writeManifest(projectDir, manifest)
  return manifest
}

export async function putUploadFileChunk(
  config: KnowledgeServiceConfig,
  siteId: string,
  uploadId: string,
  fileIndex: number,
  chunkIndex: number,
  bytes: Buffer,
  chunkSha256?: string,
): Promise<UploadSessionManifest> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const manifest = await readManifest(projectDir, uploadId)
  if (manifest.siteId !== siteId) {
    throw new UploadSessionError('upload_not_found', `upload not found: ${uploadId}`)
  }
  if (manifest.kind !== 'files') {
    throw new UploadSessionError('upload_bad_request', 'not a files upload session')
  }
  if (manifest.status !== 'uploading') {
    throw new UploadSessionError('upload_conflict', `upload status is ${manifest.status}`)
  }
  const fileSpec = manifest.files[fileIndex]
  if (!fileSpec) {
    throw new UploadSessionError('upload_bad_request', `file index out of range: ${fileIndex}`)
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new UploadSessionError('upload_bad_request', 'invalid chunk index')
  }
  const expectedSize = chunkByteSize(fileSpec.size, manifest.chunkBytes, chunkIndex)
  if (bytes.length !== expectedSize) {
    throw new UploadSessionError(
      'upload_bad_request',
      `file ${fileIndex} chunk ${chunkIndex} size mismatch`,
    )
  }
  if (chunkSha256) {
    const actual = await hashBuffer(bytes)
    if (actual !== chunkSha256.toLowerCase()) {
      throw new UploadSessionError('upload_bad_request', `chunk sha256 mismatch`)
    }
  }
  const key = `${fileIndex}:${chunkIndex}`
  const existing = manifest.received[key]
  if (existing !== undefined) {
    if (existing === bytes.length) {
      return manifest
    }
    throw new UploadSessionError('upload_conflict', `chunk already received with different size`)
  }
  const chunkDir = path.join(uploadRoot(projectDir, uploadId), 'file-chunks', String(fileIndex))
  await fs.mkdir(chunkDir, { recursive: true })
  await fs.writeFile(path.join(chunkDir, String(chunkIndex)), bytes)
  manifest.received[key] = bytes.length
  await writeManifest(projectDir, manifest)
  return manifest
}

function assertZipChunksComplete(manifest: UploadSessionManifest): number {
  const count = expectedChunkCount(manifest.totalBytes, manifest.chunkBytes)
  for (let index = 0; index < count; index += 1) {
    const size = manifest.received[String(index)]
    if (size === undefined) {
      throw new UploadSessionError('upload_incomplete', `missing chunk ${index}`)
    }
    if (size !== chunkByteSize(manifest.totalBytes, manifest.chunkBytes, index)) {
      throw new UploadSessionError('upload_incomplete', `chunk ${index} incomplete`)
    }
  }
  return count
}

function assertFileChunksComplete(manifest: UploadSessionManifest): void {
  for (let fileIndex = 0; fileIndex < manifest.files.length; fileIndex += 1) {
    const fileSpec = manifest.files[fileIndex]!
    const count = expectedChunkCount(fileSpec.size, manifest.chunkBytes)
    for (let chunkIndex = 0; chunkIndex < count; chunkIndex += 1) {
      const key = `${fileIndex}:${chunkIndex}`
      const size = manifest.received[key]
      if (size === undefined) {
        throw new UploadSessionError('upload_incomplete', `missing ${key}`)
      }
      if (size !== chunkByteSize(fileSpec.size, manifest.chunkBytes, chunkIndex)) {
        throw new UploadSessionError('upload_incomplete', `incomplete ${key}`)
      }
    }
  }
}

export async function completeUploadSession(
  config: KnowledgeServiceConfig,
  siteId: string,
  uploadId: string,
): Promise<{ importId: string; status: 'queued' }> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const manifest = await readManifest(projectDir, uploadId)
  if (manifest.siteId !== siteId) {
    throw new UploadSessionError('upload_not_found', `upload not found: ${uploadId}`)
  }
  if (manifest.importId) {
    return { importId: manifest.importId, status: 'queued' }
  }
  if (manifest.status === 'assembling') {
    throw new UploadSessionError('upload_conflict', 'upload is assembling')
  }
  if (manifest.status === 'failed') {
    throw new UploadSessionError('upload_conflict', manifest.error ?? 'upload failed')
  }
  if (manifest.status !== 'uploading' && manifest.status !== 'completed') {
    throw new UploadSessionError('upload_conflict', `upload status is ${manifest.status}`)
  }

  if (manifest.kind === 'zip') {
    assertZipChunksComplete(manifest)
  } else {
    assertFileChunksComplete(manifest)
  }

  manifest.status = 'assembling'
  await writeManifest(projectDir, manifest)

  try {
    const root = uploadRoot(projectDir, uploadId)
    let prepared
    if (manifest.kind === 'zip') {
      const chunkCount = expectedChunkCount(manifest.totalBytes, manifest.chunkBytes)
      const packagePath = path.join(root, 'package.zip')
      await assembleChunkFiles(path.join(root, 'chunks'), chunkCount, packagePath)
      if (manifest.sha256) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(packagePath)) {
          hash.update(chunk)
        }
        if (hash.digest('hex') !== manifest.sha256.toLowerCase()) {
          throw new UploadSessionError('upload_bad_request', 'assembled zip sha256 mismatch')
        }
      }
      const extractDir = path.join(root, 'extracted')
      prepared = await extractZipFromFilePath(packagePath, extractDir, {
        importMaxBytes: config.importMaxBytes,
        singleFileMaxBytes: config.singleFileMaxBytes,
      })
    } else {
      prepared = []
      for (let fileIndex = 0; fileIndex < manifest.files.length; fileIndex += 1) {
        const fileSpec = manifest.files[fileIndex]!
        const chunkCount = expectedChunkCount(fileSpec.size, manifest.chunkBytes)
        const assembledPath = path.join(root, 'assembled-files', ...fileSpec.relativePath.split('/'))
        await assembleChunkFiles(
          path.join(root, 'file-chunks', String(fileIndex)),
          chunkCount,
          assembledPath,
        )
        prepared.push({ relativePath: fileSpec.relativePath, filePath: assembledPath })
      }
    }

    const created = await createKnowledgeImportFromPreparedFiles(config, siteId, {
      sourceName: manifest.sourceName,
      draftId: manifest.draftId ?? undefined,
      files: prepared,
    })
    manifest.status = 'completed'
    manifest.importId = created.importId
    manifest.error = null
    await writeManifest(projectDir, manifest)
    return created
  } catch (err) {
    manifest.status = 'failed'
    if (err instanceof UploadSessionError) {
      manifest.error = err.message
      await writeManifest(projectDir, manifest)
      throw err
    }
    if (err instanceof ImportRequestError) {
      manifest.error = err.message
      await writeManifest(projectDir, manifest)
      const mapped: UploadSessionError['code'] =
        err.code === 'project_not_found'
          ? 'project_not_found'
          : err.code === 'import_total_size_exceeded'
            ? 'import_total_size_exceeded'
            : err.code === 'import_file_size_exceeded'
              ? 'import_file_size_exceeded'
              : err.code === 'import_invalid_path'
                ? 'import_invalid_path'
                : err.code === 'import_empty_package'
                  ? 'import_empty_package'
                  : err.code === 'import_invalid_zip'
                    ? 'import_invalid_zip'
                    : 'upload_bad_request'
      throw new UploadSessionError(mapped, err.message)
    }
    manifest.error = err instanceof Error ? err.message : String(err)
    await writeManifest(projectDir, manifest)
    throw err
  }
}

export function bytesReceived(manifest: UploadSessionManifest): number {
  return Object.values(manifest.received).reduce((sum, value) => sum + value, 0)
}
