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
import { loadSiteRecord, releasePublicDir } from './site-store.js'

const token = 'secret-token'

async function publishMarker(
  baseUrl: string,
  dataRoot: string,
  remoteSiteId: string,
  marker: string,
  expectedPublished: string | null,
): Promise<{ commitId: string; publishedCommitId: string }> {
  const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
  const repoDir = path.join(dataRoot, 'r', marker)
  const { commitId } = await initSiteRepository(repoDir, {
    'olps.manifest.json': await manifestJsonForPublishedSite(dataRoot),
    'source/site-settings.json': settings,
    'public/index.html': `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>${marker}</body></html>`,
  })
  const bundlePath = path.join(dataRoot, 'b', `${marker}.bundle`)
  await writeGitBundle(repoDir, bundlePath)
  const pushRes = await pushBundleHttp({
    baseUrl,
    token,
    remoteSiteId,
    bundlePath,
    commitId,
    expectedPublishedCommitId: expectedPublished,
  })
  if (pushRes.status !== 200) {
    throw new Error(`publish 失败 ${pushRes.status}: ${await pushRes.text()}`)
  }
  const body = (await pushRes.json()) as { publishedCommitId: string }
  return { commitId, publishedCommitId: body.publishedCommitId }
}

describe('不可变发布目录与原子切换', () => {
  it('构建失败时保留旧 release 目录且站点记录仍指向旧 deployment', async () => {
    const dataRoot = await makeIsolatedDataRoot('atomic-fail')
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
      const good = await publishMarker(baseUrl, dataRoot, remoteSiteId, 'GOOD-V1', null)
      const recordBefore = await loadSiteRecord(dataRoot, remoteSiteId)
      if (!recordBefore?.deploymentId) {
        throw new Error('缺少 deploymentId')
      }
      const oldReleaseDir = releasePublicDir(dataRoot, remoteSiteId, recordBefore.deploymentId)
      await fs.access(oldReleaseDir)

      const failManifest = JSON.stringify({
        version: 1,
        verifyCommand: [process.execPath, '-e', 'process.exit(7)'],
      })
      const repoDir = path.join(dataRoot, 'tmp-repos', 'fail-build')
      const { commitId: failCommit } = await initSiteRepository(repoDir, {
        'olps.manifest.json': failManifest,
        'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>BAD</body></html>',
      })
      const bundlePath = path.join(dataRoot, 'tmp-bundles', 'fail.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const failPush = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId: failCommit,
        expectedPublishedCommitId: good.publishedCommitId,
      })
      expect(failPush.status).toBe(400)

      const recordAfter = await loadSiteRecord(dataRoot, remoteSiteId)
      expect(recordAfter?.publishedCommitId).toBe(good.publishedCommitId)
      expect(recordAfter?.deploymentId).toBe(recordBefore.deploymentId)
      await fs.access(oldReleaseDir)
      const page = await fetch(`${baseUrl}/s/${remoteSiteId}/index.html`)
      expect(await page.text()).toContain('GOOD-V1')
    } finally {
      close()
    }
  })

  it('切换完成后 publicUrl 为完整 URL 且 HTML Content-Type 正确', async () => {
    const dataRoot = await makeIsolatedDataRoot('mime-url')
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
      const published = await publishMarker(baseUrl, dataRoot, remoteSiteId, 'MIME-OK', null)
      const meta = await fetch(`${baseUrl}/api/remote/sites/${remoteSiteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const site = (await meta.json()) as { publicUrl: string }
      expect(site.publicUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/s/${remoteSiteId}/`))
      expect(site.publicUrl).not.toContain(':0/')
      const htmlRes = await fetch(site.publicUrl + 'index.html')
      expect(htmlRes.status).toBe(200)
      expect(htmlRes.headers.get('content-type') ?? '').toMatch(/text\/html/i)
      expect(await htmlRes.text()).toContain('MIME-OK')
      void published
    } finally {
      close()
    }
  })
})
