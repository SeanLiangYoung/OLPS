import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SITE_PATHS } from '@olps/sync'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'

function gitHead(workspacePath: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git rev-parse 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function workspaceFileSnapshot(sandboxId: string, pageId: string): string {
  const settings = fs.readFileSync(
    path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.siteSettings),
    'utf8',
  )
  const pagePath = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.pagesDir, `${pageId}.json`)
  const pageJson = fs.readFileSync(pagePath, 'utf8')
  return JSON.stringify({ settings, pageJson })
}

describe('continue pull 在撤销 site owner 后须拒绝', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  it(
    '真实 awaiting_user 且 pending pull：撤销 site owner 后 continue 须 403 且 Git/远端/文件不变',
    async () => {
      const regA = await registerUser(app, {
        account: 'continue-owner-a',
        password: 'continue-owner-pass',
        name: 'continue-owner-a',
      })
      const regB = await registerUser(app, {
        account: 'continue-owner-b',
        password: 'continue-owner-pass',
        name: 'continue-owner-b',
      })
      expect(regA.status).toBe(201)
      expect(regB.status).toBe(201)
      const tokenA = regA.accessToken
      const tokenB = regB.accessToken
      const userBId = String(regB.user.userId)

      const draftA = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenA,
        body: { name: 'Continue Owner Site' },
      })
      expect(draftA.status).toBe(201)
      const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

      const page = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
        token: tokenA,
        body: { kind: 'content', title: 'Shared', slug: 'continue-owner-shared' },
      })
      expect(page.status).toBe(201)
      const pageId = String((page.body.page as Record<string, unknown>).pageId)

      const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(pushV1.status).toBe(200)
      const siteId = String((pushV1.body.site as Record<string, unknown>).siteId)

      await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
        token: tokenA,
        body: { account: 'continue-owner-b' },
      })

      const draftB = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenB,
        body: { name: 'Continue fork B', siteId },
      })
      expect(draftB.status).toBe(201)
      const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
      const sandboxId = String((draftB.body.draft as Record<string, unknown>).sandboxId)
      const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)

      const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
      const pageOnB = (pagesB.body.pages as Array<Record<string, unknown>>).find(
        (p) => p.slug === 'continue-owner-shared',
      )!
      const pageIdOnB = String(pageOnB.pageId)

      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageId}`, {
        token: tokenA,
        body: { body: { html: '<h1>continue-owner-a</h1>' } },
      })
      await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })

      await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${pageIdOnB}`, {
        token: tokenB,
        body: { body: { html: '<h1>continue-owner-b</h1>' } },
      })

      const pullB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      expect(pullB.status).toBe(409)
      expect(String((pullB.body.draft as Record<string, unknown>).syncStatus)).toBe('awaiting_user')

      const siteBefore = await requestJson(app, 'GET', `/api/sites/${siteId}`, { token: tokenA })
      expect(siteBefore.status).toBe(200)
      const publishedCommitBefore = String(
        (siteBefore.body.site as Record<string, unknown>).publishedCommitId,
      )

      const metaBefore = await pool.query(
        `SELECT head_commit_id, pending_operation, sync_status, last_error FROM site_drafts WHERE draft_id=$1`,
        [draftBId],
      )
      const headBefore = gitHead(workspacePath)
      const filesBefore = workspaceFileSnapshot(sandboxId, pageIdOnB)

      const removed = await requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userBId}`, {
        token: tokenA,
      })
      expect(removed.status).toBe(200)

      const ownerCheck = await pool.query(
        `SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2`,
        [draftBId, userBId],
      )
      expect(ownerCheck.rowCount).toBe(1)

      const siteOwnerCheck = await pool.query(
        `SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2`,
        [siteId, userBId],
      )
      expect(siteOwnerCheck.rowCount).toBe(0)

      const cont = await requestJson(app, 'POST', `/api/drafts/${draftBId}/continue`, {
        token: tokenB,
        body: { userMessage: '不应执行到 Agent' },
      })
      expect(cont.status).toBe(403)

      const siteAfter = await requestJson(app, 'GET', `/api/sites/${siteId}`, { token: tokenA })
      expect(siteAfter.status).toBe(200)
      const publishedCommitAfter = String(
        (siteAfter.body.site as Record<string, unknown>).publishedCommitId,
      )

      const metaAfter = await pool.query(
        `SELECT head_commit_id, pending_operation, sync_status, last_error FROM site_drafts WHERE draft_id=$1`,
        [draftBId],
      )

      expect(JSON.stringify(metaAfter.rows[0])).toBe(JSON.stringify(metaBefore.rows[0]))
      expect(gitHead(workspacePath)).toBe(headBefore)
      expect(publishedCommitAfter).toBe(publishedCommitBefore)
      expect(workspaceFileSnapshot(sandboxId, pageIdOnB)).toBe(filesBefore)
    },
    1_200_000,
  )
})
