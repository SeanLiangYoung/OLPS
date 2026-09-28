import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { publicHtmlFromSettings, sandboxRoot, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'
import { git, gitOrThrow } from './git-exec.js'
import { resolveAbsoluteGitCommonDir } from './git-repo-layout.js'

function eightCharRunTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function longSandboxRootForRun(runTag: string): string {
  return path.join(process.cwd(), '.intermediate', `longxx-${runTag}`)
}

describe('linked worktree 深路径 Git bundle', () => {
  it('两草稿不同提交：push 发送各自 HEAD，pull 读取远端最新提交', async () => {
    const dataRoot = await makeIsolatedDataRoot('git-long-path')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsSeed = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('git-long-seed'),
        draftId: 'draft-git-long-seed',
        remote,
      })
      await wsSeed.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsSeed.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await wsSeed.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settings), 'utf8'),
      )
      await wsSeed.saveVersion('seed')
      const v0 = await wsSeed.push({ expectedPublishedCommitId: null })
      expect(v0.status).toBe('clean')

      const runTag = eightCharRunTag()
      const longRoot = longSandboxRootForRun(runTag)
      await fs.mkdir(longRoot, { recursive: true })

      const markerA = `long-path-worktree-a-${runTag}`
      const draftAId = randomUUID()
      const wsA = await SyncWorkspace.create({
        sandboxRoot: longRoot,
        draftId: draftAId,
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
      })
      const workspaceA = wsA.getState().workspacePath
      const commonDir = resolveAbsoluteGitCommonDir(workspaceA)
      const absGitDir = gitOrThrow(workspaceA, ['rev-parse', '--absolute-git-dir'])
      const absGitDirLen = absGitDir.length
      const pathEvidence = {
        absoluteGitDir: absGitDir,
        absoluteGitDirLength: absGitDirLen,
        gitCommonDir: commonDir,
        gitCommonDirLength: commonDir.length,
        workspacePath: workspaceA,
        longRoot,
      }
      expect(absGitDirLen, JSON.stringify(pathEvidence, null, 2)).toBeGreaterThanOrEqual(220)
      expect(absGitDirLen).toBeGreaterThan(commonDir.length)

      const probeBundle = path
        .join(longRoot, '.o', 'bundles', `probe-worktree-${runTag}.bundle`)
        .replace(/\\/g, '/')
      await fs.mkdir(path.dirname(probeBundle), { recursive: true })
      if (process.platform === 'win32') {
        const probeFromWorktree = git(workspaceA, ['bundle', 'create', probeBundle, 'HEAD'])
        expect(probeFromWorktree.status, JSON.stringify(pathEvidence, null, 2)).not.toBe(0)
        expect(`${probeFromWorktree.stderr}${probeFromWorktree.stdout}`).toMatch(/GIT_DIR.*too big/i)
      }

      await wsA.writeFile(
        `${SITE_PATHS.publicDir}/long-path-marker-a.txt`,
        Buffer.from(markerA, 'utf8'),
      )
      await wsA.saveVersion('worktree a marker')
      const headA = gitOrThrow(workspaceA, ['rev-parse', 'HEAD'])
      const pushA = await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })
      expect(pushA.status).toBe('clean')
      expect(pushA.publishedCommitId).toBe(headA)

      const pageA = await fetch(`${baseUrl}/s/${v0.remoteSiteId}/long-path-marker-a.txt`)
      expect(pageA.status).toBe(200)
      expect(await pageA.text()).toBe(markerA)

      const markerB = `long-path-worktree-b-${runTag}`
      const draftBId = randomUUID()
      const wsB = await SyncWorkspace.create({
        sandboxRoot: longRoot,
        draftId: draftBId,
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: pushA.publishedCommitId,
      })
      const workspaceB = wsB.getState().workspacePath
      await wsB.writeFile(
        `${SITE_PATHS.publicDir}/long-path-marker-b.txt`,
        Buffer.from(markerB, 'utf8'),
      )
      await wsB.saveVersion('worktree b marker')
      const headB = gitOrThrow(workspaceB, ['rev-parse', 'HEAD'])
      expect(headB).not.toBe(headA)
      const pushB = await wsB.push({ expectedPublishedCommitId: pushA.publishedCommitId })
      expect(pushB.status).toBe('clean')
      expect(pushB.publishedCommitId).toBe(headB)

      const siteRes = await fetch(`${baseUrl}/api/remote/sites/${v0.remoteSiteId}`, {
        headers: { Authorization: 'Bearer remote-test-token' },
      })
      const siteMeta = (await siteRes.json()) as { publishedCommitId: string }
      expect(siteMeta.publishedCommitId).toBe(pushB.publishedCommitId)

      const pageB = await fetch(`${baseUrl}/s/${v0.remoteSiteId}/long-path-marker-b.txt`)
      expect(await pageB.text()).toBe(markerB)

      const pulled = await wsA.pull()
      expect(pulled.status).toBe('clean')
      expect(gitOrThrow(workspaceA, ['rev-parse', 'HEAD'])).toBe(pushB.publishedCommitId)
      expect(
        (await wsA.readFile(`${SITE_PATHS.publicDir}/long-path-marker-b.txt`)).toString('utf8'),
      ).toBe(markerB)
      expect(
        (await wsA.readFile(`${SITE_PATHS.publicDir}/long-path-marker-a.txt`)).toString('utf8'),
      ).toBe(markerA)
    } finally {
      close()
    }
  })
})
