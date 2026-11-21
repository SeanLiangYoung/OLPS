import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertSafeGitCommitId, assertValidRemoteSiteId } from './validation.js'

export type SiteRecord = {
  remoteSiteId: string
  publishedCommitId: string | null
  deploymentId: string | null
  publicUrl: string
  createdAt: string
  updatedAt: string
}

function sitePath(dataRoot: string, remoteSiteId: string): string {
  return path.join(dataRoot, 'sites', `${remoteSiteId}.json`)
}

export function buildPublicUrl(publicBaseUrl: string, remoteSiteId: string): string {
  const base = publicBaseUrl.replace(/\/$/, '')
  return `${base}/s/${remoteSiteId}/`
}

export async function createSiteRecord(
  dataRoot: string,
  publicBaseUrl: string,
): Promise<SiteRecord> {
  await fs.mkdir(path.join(dataRoot, 'sites'), { recursive: true })
  const remoteSiteId = randomUUID()
  const now = new Date().toISOString()
  const record: SiteRecord = {
    remoteSiteId,
    publishedCommitId: null,
    deploymentId: null,
    publicUrl: buildPublicUrl(publicBaseUrl, remoteSiteId),
    createdAt: now,
    updatedAt: now,
  }
  await saveSiteRecord(dataRoot, record)
  return record
}

export async function loadSiteRecord(
  dataRoot: string,
  remoteSiteId: string,
): Promise<SiteRecord | null> {
  const filePath = sitePath(dataRoot, remoteSiteId)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw err
  }
  try {
    return JSON.parse(raw) as SiteRecord
  } catch {
    throw new Error(`站点记录 JSON 损坏: ${remoteSiteId}`)
  }
}

export async function saveSiteRecord(dataRoot: string, record: SiteRecord): Promise<void> {
  record.updatedAt = new Date().toISOString()
  await fs.mkdir(path.join(dataRoot, 'sites'), { recursive: true })
  const finalPath = sitePath(dataRoot, record.remoteSiteId)
  const tmpPath = path.join(
    path.dirname(finalPath),
    `.${record.remoteSiteId}.${randomUUID()}.tmp`,
  )
  const body = `${JSON.stringify(record, null, 2)}\n`
  await fs.writeFile(tmpPath, body, 'utf8')
  await fs.rename(tmpPath, finalPath)
}

export function releasePublicDir(
  dataRoot: string,
  remoteSiteId: string,
  deploymentId: string,
): string {
  return path.join(dataRoot, 'releases', remoteSiteId, deploymentId)
}

export function releaseServerConfigDir(dataRoot: string, remoteSiteId: string, deploymentId: string): string {
  return path.join(dataRoot, 'release-config', remoteSiteId, deploymentId)
}

function publishedReleaseRecordPath(dataRoot: string, remoteSiteId: string, commitId: string): string {
  assertValidRemoteSiteId(remoteSiteId)
  assertSafeGitCommitId(commitId)
  return path.join(dataRoot, 'published-releases', remoteSiteId, `${commitId}.json`)
}

export async function savePublishedReleaseRecord(dataRoot: string, record: SiteRecord): Promise<void> {
  if (!record.publishedCommitId || !record.deploymentId) throw new Error('发布记录缺少版本')
  const destination = publishedReleaseRecordPath(dataRoot, record.remoteSiteId, record.publishedCommitId)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`)
  await fs.rename(temporary, destination)
}

export async function loadPublishedReleaseRecord(dataRoot: string, remoteSiteId: string, commitId: string): Promise<SiteRecord | null> {
  let raw: string
  try { raw = await fs.readFile(publishedReleaseRecordPath(dataRoot, remoteSiteId, commitId), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const record = JSON.parse(raw) as SiteRecord
  if (record.remoteSiteId !== remoteSiteId || record.publishedCommitId !== commitId || !record.deploymentId) throw new Error('发布版本记录无效')
  assertValidRemoteSiteId(record.deploymentId)
  return record
}

export function bareRepoDir(dataRoot: string, remoteSiteId: string): string {
  return path.join(dataRoot, 'g', remoteSiteId)
}

export function publishedBundlePath(
  dataRoot: string,
  remoteSiteId: string,
  publishedCommitId: string,
): string {
  return path.join(dataRoot, 'bundles', remoteSiteId, `${publishedCommitId}.bundle`)
}

export async function savePublishedBundleBytes(
  dataRoot: string,
  remoteSiteId: string,
  publishedCommitId: string,
  bundleBytes: Buffer,
): Promise<void> {
  const finalPath = publishedBundlePath(dataRoot, remoteSiteId, publishedCommitId)
  await fs.mkdir(path.dirname(finalPath), { recursive: true })
  const tmpPath = path.join(path.dirname(finalPath), `.published.${randomUUID()}.tmp`)
  await fs.writeFile(tmpPath, bundleBytes)
  await fs.rename(tmpPath, finalPath)
}
