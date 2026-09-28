import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import {
  initSiteRepository,
  manifestJsonForPublishedSite,
  pushBundleHttp,
  writeGitBundle,
} from './test-git-helpers.js'
import { fetchBundleToCandidateRef, ensureBareRepo } from './git-store.js'

const token = 'remote-test-token'

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${result.stderr || result.stdout}`)
  }
}

async function writeBundleWithNamedExportRef(
  repoDir: string,
  bundlePath: string,
): Promise<{ commitId: string; exportRef: string }> {
  const commitId = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
    .stdout!.trim()
  const exportRef = `refs/olps/bundle-export/${randomUUID()}`
  await fs.mkdir(path.dirname(bundlePath), { recursive: true })
  const bundleForGit = path.resolve(bundlePath).replace(/\\/g, '/')
  git(repoDir, ['update-ref', exportRef, commitId])
  try {
    git(repoDir, ['bundle', 'create', bundleForGit, exportRef])
  } finally {
    git(repoDir, ['update-ref', '-d', exportRef])
  }
  return { commitId, exportRef }
}

describe('bundle 导入 ref 选择', () => {
  it('HEAD bundle 与 refs/olps/bundle-export bundle 均可按 commitId 导入', async () => {
    const dataRoot = await makeIsolatedDataRoot('bundle-ref-head')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const manifest = await manifestJsonForPublishedSite(dataRoot)
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }

      const repoHead = path.join(dataRoot, 'r', 'head-bundle')
      const { commitId: headCommit } = await initSiteRepository(repoHead, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': settings,
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>head-bundle</body></html>',
      })
      const headBundle = path.join(dataRoot, 'b', 'head.bundle')
      await writeGitBundle(repoHead, headBundle)
      const pushHead = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath: headBundle,
        commitId: headCommit,
        expectedPublishedCommitId: null,
      })
      expect(pushHead.status).toBe(200)

      const repoOlps = path.join(dataRoot, 'r', 'olps-bundle')
      await initSiteRepository(repoOlps, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': settings,
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>olps-bundle</body></html>',
      })
      const olpsBundle = path.join(dataRoot, 'b', 'olps.bundle')
      const { commitId: olpsCommit } = await writeBundleWithNamedExportRef(repoOlps, olpsBundle)
      const pushOlps = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath: olpsBundle,
        commitId: olpsCommit,
        expectedPublishedCommitId: headCommit,
      })
      expect(pushOlps.status).toBe(200)
    } finally {
      close()
    }
  })

  it('bundle 内无匹配 commitId 时 fetchBundleToCandidateRef 拒绝', async () => {
    const dataRoot = await makeIsolatedDataRoot('bundle-ref-reject')
    const manifest = await manifestJsonForPublishedSite(dataRoot)
    const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
    const repoDir = path.join(dataRoot, 'r', 'reject')
    const { commitId } = await initSiteRepository(repoDir, {
      'olps.manifest.json': manifest,
      'source/site-settings.json': settings,
      'public/index.html':
        '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>x</body></html>',
    })
    const bundlePath = path.join(dataRoot, 'b', 'reject.bundle')
    await writeBundleWithNamedExportRef(repoDir, bundlePath)
    const bareDir = path.join(dataRoot, 'bare', 'reject')
    await ensureBareRepo(bareDir)
    const wrongCommit = '0'.repeat(40)
    await expect(fetchBundleToCandidateRef(bareDir, bundlePath, wrongCommit)).rejects.toThrow(
      /不含 commitId/,
    )
  })
})
