import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyncRemoteConfig } from './types.js'

export type RemoteSiteInfo = {
  remoteSiteId: string
  publishedCommitId: string | null
  publicUrl: string
  deploymentId: string | null
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export async function remoteCreateSite(
  remote: SyncRemoteConfig,
): Promise<{ remoteSiteId: string; publicUrl: string }> {
  const res = await fetch(`${remote.baseUrl.replace(/\/$/, '')}/api/remote/sites`, {
    method: 'POST',
    headers: {
      ...authHeaders(remote.token),
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`创建远端站点失败 ${res.status}: ${body}`)
  }
  return (await res.json()) as { remoteSiteId: string; publicUrl: string }
}

export async function remoteGetSite(
  remote: SyncRemoteConfig,
  remoteSiteId: string,
): Promise<RemoteSiteInfo> {
  const base = remote.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/remote/sites/${encodeURIComponent(remoteSiteId)}`, {
    headers: authHeaders(remote.token),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`读取远端站点失败 ${res.status}: ${body}`)
  }
  return (await res.json()) as RemoteSiteInfo
}

export async function remoteDownloadBundle(
  remote: SyncRemoteConfig,
  remoteSiteId: string,
  destPath: string,
): Promise<void> {
  const base = remote.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/remote/sites/${encodeURIComponent(remoteSiteId)}/bundle`, {
    headers: authHeaders(remote.token),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`下载 bundle 失败 ${res.status}: ${body}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.writeFile(destPath, buf)
}

export type RemotePushResponse = {
  publishedCommitId: string
  deploymentId: string
  publicUrl: string
}

export class RemotePushError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function remotePushBundle(input: {
  remote: SyncRemoteConfig
  remoteSiteId: string
  bundlePath: string
  commitId: string
  expectedPublishedCommitId: string | null
}): Promise<RemotePushResponse> {
  const base = input.remote.baseUrl.replace(/\/$/, '')
  const bundleBytes = await fs.readFile(input.bundlePath)
  const res = await fetch(
    `${base}/api/remote/sites/${encodeURIComponent(input.remoteSiteId)}/push`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(input.remote.token),
        'Content-Type': 'application/octet-stream',
        'X-Commit-Id': input.commitId,
        'X-Expected-Published-Commit-Id': input.expectedPublishedCommitId ?? '',
      },
      body: bundleBytes,
    },
  )
  if (res.status === 409) {
    const body = await res.text()
    throw new RemotePushError(`远端发布版本冲突: ${body}`, 409)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new RemotePushError(`远端 push 失败 ${res.status}: ${body}`, res.status)
  }
  return (await res.json()) as RemotePushResponse
}
