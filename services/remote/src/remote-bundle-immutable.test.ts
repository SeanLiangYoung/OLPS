import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import {
  initSiteRepository,
  manifestJsonForPublishedSite,
  pushBundleHttp,
  writeGitBundle,
} from './test-git-helpers.js'

const token = 'remote-test-token'

async function publishMarker(input: {
  baseUrl: string
  dataRoot: string
  remoteSiteId: string
  marker: string
  expectedPublishedCommitId: string | null
}): Promise<string> {
  const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
  const repoDir = path.join(input.dataRoot, 'r', `${input.marker}-${Date.now()}`)
  const { commitId } = await initSiteRepository(repoDir, {
    'olps.manifest.json': await manifestJsonForPublishedSite(input.dataRoot),
    'source/site-settings.json': settings,
    'public/index.html': `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>${input.marker}</body></html>`,
  })
  const bundlePath = path.join(input.dataRoot, 'b', `${input.marker}.bundle`)
  await writeGitBundle(repoDir, bundlePath)
  const pushRes = await pushBundleHttp({
    baseUrl: input.baseUrl,
    token,
    remoteSiteId: input.remoteSiteId,
    bundlePath,
    commitId,
    expectedPublishedCommitId: input.expectedPublishedCommitId,
  })
  expect(pushRes.status).toBe(200)
  const body = (await pushRes.json()) as { publishedCommitId: string }
  expect(body.publishedCommitId).toBe(commitId)
  return commitId
}

describe('GET bundle 按 commit 不可变存储', () => {
  it('V2 发布后磁盘上 V1 bundle 文件字节不变', async () => {
    const dataRoot = await makeIsolatedDataRoot('bundle-immutable')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const v1Commit = await publishMarker({
        baseUrl,
        dataRoot,
        remoteSiteId,
        marker: 'immutable-v1',
        expectedPublishedCommitId: null,
      })
      const v1Path = path.join(dataRoot, 'bundles', remoteSiteId, `${v1Commit}.bundle`)
      const v1BytesBefore = await fs.readFile(v1Path)

      await publishMarker({
        baseUrl,
        dataRoot,
        remoteSiteId,
        marker: 'immutable-v2',
        expectedPublishedCommitId: v1Commit,
      })

      const v1BytesAfter = await fs.readFile(v1Path)
      expect(Buffer.compare(v1BytesBefore, v1BytesAfter)).toBe(0)

      const getRes = await fetch(`${baseUrl}/api/remote/sites/${remoteSiteId}/bundle`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const current = Buffer.from(await getRes.arrayBuffer())
      expect(Buffer.compare(current, v1BytesBefore)).not.toBe(0)
    } finally {
      close()
    }
  })
})
