import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { DraftSyncStatus } from '@olps/domain'
import { SITE_PATHS } from '@olps/sync'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { openDraftWorkspace } from './workspace-factory.js'
import {
  applyRemoteEnv,
  restartDedicatedRemote,
  snapshotRemoteEnv,
  startDedicatedRemote,
} from './test-support/dedicated-remote-harness.js'
import { appConfig } from './config.js'

const LEGAL_DRAFT_SYNC_STATUSES: DraftSyncStatus[] = [
  'clean',
  'dirty',
  'merge_conflict',
  'awaiting_user',
  'validation_failed',
]

function gitHeadForSandbox(sandboxId: string): string {
  const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git rev-parse 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function sandboxFilesSnapshot(sandboxId: string): string {
  const settings = fs.readFileSync(
    path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.siteSettings),
    'utf8',
  )
  const pagesDir = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.pagesDir)
  const pageParts = fs
    .readdirSync(pagesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const full = path.join(pagesDir, name)
      return `${name}:${fs.readFileSync(full, 'utf8')}`
    })
  return JSON.stringify({ settings, pages: pageParts.join('\n---\n') })
}

describe('远端进程终止后 pull 持久化错误并可重试', () => {
  const pool = createTestPool()
  let restoredEnv = snapshotRemoteEnv()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    restoredEnv = snapshotRemoteEnv()
    await resetTestDatabase()
  })

  afterAll(async () => {
    applyRemoteEnv(restoredEnv.baseUrl, restoredEnv.token)
    await pool.end()
  })

  it('pull 远端不可达时记录 error 与 pending pull，重启同一 dataRoot 后重试成功', async () => {
    let session = await startDedicatedRemote('remote-pull-retry-test')
    applyRemoteEnv(session.baseUrl, session.token)
    try {
      const regA = await registerUser(app, {
        account: 'remote-pull-a',
        password: 'remote-pull-pass',
        name: 'remote-pull-a',
      })
      const regB = await registerUser(app, {
        account: 'remote-pull-b',
        password: 'remote-pull-pass',
        name: 'remote-pull-b',
      })
      expect(regA.status).toBe(201)
      expect(regB.status).toBe(201)
      const tokenA = regA.accessToken
      const tokenB = regB.accessToken

      const remoteMarker = 'remote-pull-remote-marker-3c8e'

      const draftA = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenA,
        body: { name: 'Remote Pull Site' },
      })
      expect(draftA.status).toBe(201)
      const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

      const pageA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
        token: tokenA,
        body: { kind: 'content', title: 'Shared', slug: 'remote-pull-shared' },
      })
      expect(pageA.status).toBe(201)
      const pageIdA = String((pageA.body.page as Record<string, unknown>).pageId)

      const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(
        pushV1.status,
        JSON.stringify({ status: pushV1.status, error: pushV1.body.error }, null, 2),
      ).toBe(200)
      const siteId = String((pushV1.body.site as Record<string, unknown>).siteId)

      await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
        token: tokenA,
        body: { account: 'remote-pull-b' },
      })

      const draftB = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenB,
        body: { name: 'Remote Pull Fork', siteId },
      })
      expect(draftB.status).toBe(201)
      const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
      const sandboxId = String((draftB.body.draft as Record<string, unknown>).sandboxId)

      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageIdA}`, {
        token: tokenA,
        body: { body: { html: `<h1>${remoteMarker}</h1>` } },
      })
      const pushV2 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(pushV2.status).toBe(200)

      const headBefore = gitHeadForSandbox(sandboxId)
      const filesBefore = sandboxFilesSnapshot(sandboxId)

      session.close()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500)
      })

      const pullFail = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      expect(
        pullFail.status,
        JSON.stringify({ status: pullFail.status, error: pullFail.body.error, draft: pullFail.body.draft }, null, 2),
      ).toBe(503)
      expect(String(pullFail.body.error ?? '')).not.toBe('')

      const row = await pool.query(
        `SELECT head_commit_id, pending_operation, last_error, sync_status, status, site_id, remote_site_id, base_commit_id, sandbox_id
         FROM site_drafts WHERE draft_id=$1`,
        [draftBId],
      )
      expect(row.rowCount).toBe(1)
      expect(String(row.rows[0]!.pending_operation)).toBe('pull')
      expect(String(row.rows[0]!.last_error ?? '')).not.toBe('')
      expect(String(row.rows[0]!.status)).toBe('error')
      expect(String(row.rows[0]!.head_commit_id)).toBe(headBefore)
      expect(gitHeadForSandbox(sandboxId)).toBe(headBefore)
      expect(sandboxFilesSnapshot(sandboxId)).toBe(filesBefore)

      const draftReadable = await requestJson(app, 'GET', `/api/drafts/${draftBId}`, { token: tokenB })
      expect(draftReadable.status).toBe(200)
      const draftAfterFail = draftReadable.body.draft as Record<string, unknown>
      expect(String(draftAfterFail.status)).toBe('error')
      expect(String(draftAfterFail.pendingOperation)).toBe('pull')
      expect(String(draftAfterFail.lastError ?? '')).not.toBe('')

      const workspace = await openDraftWorkspace({
        draftId: draftBId,
        sandboxId: String(row.rows[0]!.sandbox_id),
        siteId: String(row.rows[0]!.site_id),
        draftRemoteSiteId: row.rows[0]!.remote_site_id ? String(row.rows[0]!.remote_site_id) : null,
        baseCommitId: row.rows[0]!.base_commit_id ? String(row.rows[0]!.base_commit_id) : null,
        headCommitId: headBefore,
      })
      const workspaceSyncStatus = workspace.getState().status
      expect(LEGAL_DRAFT_SYNC_STATUSES).toContain(workspaceSyncStatus)
      expect(String(row.rows[0]!.sync_status)).toBe(workspaceSyncStatus)
      expect(String(draftAfterFail.syncStatus)).toBe(workspaceSyncStatus)

      session = await restartDedicatedRemote(session.dataRoot, 'remote-pull-retry-test')
      applyRemoteEnv(session.baseUrl, session.token)

      const pullRetry = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      expect(
        pullRetry.status,
        JSON.stringify({ status: pullRetry.status, error: pullRetry.body.error, draft: pullRetry.body.draft }, null, 2),
      ).toBe(200)

      const draftAfterRetry = pullRetry.body.draft as Record<string, unknown>
      expect(draftAfterRetry.pendingOperation).toBeNull()
      expect(String(draftAfterRetry.status)).toBe('active')

      const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
      const pageOnB = (pagesB.body.pages as Array<Record<string, unknown>>).find(
        (p) => p.slug === 'remote-pull-shared',
      )!
      const body = pageOnB.body as Record<string, unknown>
      const html = typeof body.html === 'string' ? body.html : ''
      expect(html).toContain(remoteMarker)
    } finally {
      session.close()
      applyRemoteEnv(restoredEnv.baseUrl, restoredEnv.token)
    }
  })
})
