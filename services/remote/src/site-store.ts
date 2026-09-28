import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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
