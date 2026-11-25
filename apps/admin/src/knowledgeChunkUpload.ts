import { api, ApiError } from './api'

export type UploadProgress = {
  phase: 'uploading' | 'completing'
  bytesSent: number
  totalBytes: number
  /** 0–100 */
  percent: number
}

export type ZipUploadInput = {
  siteId: string
  draftId?: string
  file: File
  onProgress?: (progress: UploadProgress) => void
}

export type FolderUploadInput = {
  siteId: string
  draftId?: string
  sourceName: string
  files: File[]
  onProgress?: (progress: UploadProgress) => void
}

type SessionCreateResponse = {
  uploadId: string
  chunkBytes: number
  status: string
  bytesReceived: number
  received: Record<string, number>
}

type SessionStatus = {
  uploadId: string
  kind: 'zip' | 'files'
  totalBytes: number
  chunkBytes: number
  status: string
  received: Record<string, number>
  bytesReceived: number
  files: Array<{ relativePath: string; size: number }>
}

type ResumeRecord = {
  uploadId: string
  fingerprint: string
  kind: 'zip' | 'files'
  totalBytes: number
}

const RESUME_PREFIX = 'olps-knowledge-upload:'

function sessionsPath(siteId: string): string {
  return `/api/sites/${siteId}/knowledge-base/imports/sessions`
}

function resumeKey(siteId: string, fingerprint: string): string {
  return `${RESUME_PREFIX}${siteId}:${fingerprint}`
}

function readResume(siteId: string, fingerprint: string): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(resumeKey(siteId, fingerprint))
    if (!raw) return null
    return JSON.parse(raw) as ResumeRecord
  } catch {
    return null
  }
}

function writeResume(siteId: string, record: ResumeRecord): void {
  localStorage.setItem(resumeKey(siteId, record.fingerprint), JSON.stringify(record))
}

function clearResume(siteId: string, fingerprint: string): void {
  localStorage.removeItem(resumeKey(siteId, fingerprint))
}

function zipFingerprint(file: File): string {
  return `zip:${file.name}:${file.size}:${file.lastModified}`
}

function folderFingerprint(sourceName: string, files: File[]): string {
  const parts = files
    .map((file) => {
      const relative = file.webkitRelativePath || file.name
      return `${relative}:${file.size}:${file.lastModified}`
    })
    .sort()
  return `files:${sourceName}:${parts.join('|')}`
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function reportProgress(
  onProgress: ((progress: UploadProgress) => void) | undefined,
  phase: UploadProgress['phase'],
  bytesSent: number,
  totalBytes: number,
): void {
  if (!onProgress) return
  const percent = totalBytes <= 0 ? 100 : Math.min(100, Math.floor((bytesSent / totalBytes) * 100))
  onProgress({ phase, bytesSent, totalBytes, percent })
}

async function ensureSession(input: {
  siteId: string
  draftId?: string
  fingerprint: string
  kind: 'zip' | 'files'
  sourceName: string
  totalBytes: number
  files?: Array<{ relativePath: string; size: number }>
}): Promise<{ uploadId: string; chunkBytes: number; received: Record<string, number> }> {
  const existing = readResume(input.siteId, input.fingerprint)
  if (existing && existing.kind === input.kind && existing.totalBytes === input.totalBytes) {
    try {
      const session = await api<SessionStatus>('GET', `${sessionsPath(input.siteId)}/${existing.uploadId}`)
      if (session.status === 'uploading' && session.kind === input.kind) {
        return {
          uploadId: session.uploadId,
          chunkBytes: session.chunkBytes,
          received: session.received ?? {},
        }
      }
    } catch (reason) {
      if (!(reason instanceof ApiError) || (reason.status !== 404 && reason.code !== 'UPLOAD_NOT_FOUND')) {
        throw reason
      }
      clearResume(input.siteId, input.fingerprint)
    }
  }

  const body: Record<string, unknown> = {
    kind: input.kind,
    sourceName: input.sourceName,
    totalBytes: input.totalBytes,
  }
  if (input.draftId) body.draftId = input.draftId
  if (input.files) body.files = input.files

  const created = await api<SessionCreateResponse>('POST', sessionsPath(input.siteId), body)
  writeResume(input.siteId, {
    uploadId: created.uploadId,
    fingerprint: input.fingerprint,
    kind: input.kind,
    totalBytes: input.totalBytes,
  })
  return {
    uploadId: created.uploadId,
    chunkBytes: created.chunkBytes,
    received: created.received ?? {},
  }
}

async function putChunk(
  url: string,
  bytes: ArrayBuffer,
): Promise<{ bytesReceived: number }> {
  const sha = await sha256Hex(bytes)
  return api<{ bytesReceived: number }>('PUT', url, bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-chunk-sha256': sha,
    },
  })
}

/**
 * 分片上传 zip；中断后同一文件可续传。
 * @returns importId
 */
export async function uploadZipInChunks(input: ZipUploadInput): Promise<string> {
  const fingerprint = zipFingerprint(input.file)
  const session = await ensureSession({
    siteId: input.siteId,
    draftId: input.draftId,
    fingerprint,
    kind: 'zip',
    sourceName: input.file.name,
    totalBytes: input.file.size,
  })

  const chunkBytes = session.chunkBytes
  const totalBytes = input.file.size
  const chunkCount = Math.ceil(totalBytes / chunkBytes)
  let bytesSent = Object.values(session.received).reduce((sum, n) => sum + n, 0)
  reportProgress(input.onProgress, 'uploading', bytesSent, totalBytes)

  for (let index = 0; index < chunkCount; index += 1) {
    if (session.received[String(index)] !== undefined) {
      continue
    }
    const start = index * chunkBytes
    const end = Math.min(totalBytes, start + chunkBytes)
    const slice = await input.file.slice(start, end).arrayBuffer()
    const result = await putChunk(
      `${sessionsPath(input.siteId)}/${session.uploadId}/chunks/${index}`,
      slice,
    )
    session.received[String(index)] = slice.byteLength
    bytesSent = result.bytesReceived
    reportProgress(input.onProgress, 'uploading', bytesSent, totalBytes)
  }

  reportProgress(input.onProgress, 'completing', totalBytes, totalBytes)
  const completed = await api<{ importId: string }>(
    'POST',
    `${sessionsPath(input.siteId)}/${session.uploadId}/complete`,
  )
  clearResume(input.siteId, fingerprint)
  return completed.importId
}

/**
 * 按文件分片上传文件夹；中断后同一批文件可续传。
 * @returns importId
 */
export async function uploadFolderInChunks(input: FolderUploadInput): Promise<string> {
  const fileEntries = input.files.map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
    size: file.size,
  }))
  const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.size, 0)
  if (totalBytes <= 0) {
    throw new Error('文件夹为空')
  }
  const fingerprint = folderFingerprint(input.sourceName, input.files)
  const session = await ensureSession({
    siteId: input.siteId,
    draftId: input.draftId,
    fingerprint,
    kind: 'files',
    sourceName: input.sourceName,
    totalBytes,
    files: fileEntries.map((entry) => ({
      relativePath: entry.relativePath,
      size: entry.size,
    })),
  })

  const chunkBytes = session.chunkBytes
  let bytesSent = Object.values(session.received).reduce((sum, n) => sum + n, 0)
  reportProgress(input.onProgress, 'uploading', bytesSent, totalBytes)

  for (let fileIndex = 0; fileIndex < fileEntries.length; fileIndex += 1) {
    const entry = fileEntries[fileIndex]!
    const chunkCount = Math.ceil(entry.size / chunkBytes)
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const key = `${fileIndex}:${chunkIndex}`
      if (session.received[key] !== undefined) {
        continue
      }
      const start = chunkIndex * chunkBytes
      const end = Math.min(entry.size, start + chunkBytes)
      const slice = await entry.file.slice(start, end).arrayBuffer()
      const result = await putChunk(
        `${sessionsPath(input.siteId)}/${session.uploadId}/files/${fileIndex}/chunks/${chunkIndex}`,
        slice,
      )
      session.received[key] = slice.byteLength
      bytesSent = result.bytesReceived
      reportProgress(input.onProgress, 'uploading', bytesSent, totalBytes)
    }
  }

  reportProgress(input.onProgress, 'completing', totalBytes, totalBytes)
  const completed = await api<{ importId: string }>(
    'POST',
    `${sessionsPath(input.siteId)}/${session.uploadId}/complete`,
  )
  clearResume(input.siteId, fingerprint)
  return completed.importId
}

export function formatUploadBytes(bytes: number): string {
  const gib = 1024 * 1024 * 1024
  const mib = 1024 * 1024
  if (bytes >= gib) {
    return `${(bytes / gib).toFixed(2)} GB`
  }
  if (bytes >= mib) {
    return `${(bytes / mib).toFixed(1)} MB`
  }
  return `${bytes} B`
}
