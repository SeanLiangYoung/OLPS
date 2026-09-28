import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'
import {
  installReindexFailTrigger,
  removeReindexFailTrigger,
  REINDEX_FAIL_SQLSTATE,
} from './test-support/reindex-fail-trigger.js'

function gitHead(sandboxId: string): string {
  const cwd = path.join(appConfig.sandboxRoot, sandboxId)
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git rev-parse 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

describe('push 远端成功但 reindex 失败时须持久化 HEAD/pending 并可重试', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await removeReindexFailTrigger(pool)
    await pool.end()
  })

  it('pages 触发器使 reindex 失败：远端已含新 marker，DB 记录 pending/error/HEAD，移除触发器后重试成功', async () => {
    await removeReindexFailTrigger(pool)
    const reg = await registerUser(app, {
      account: 'push-reindex-fail',
      password: 'push-reindex-fail-pass',
      name: 'push-reindex-fail',
    })
    expect(reg.status).toBe(201)
    const token = reg.accessToken

    const markerV1 = 'reindex-fail-v1-aa11'
    const markerV2 = 'reindex-fail-v2-bb22'

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Push Reindex Fail' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const sandboxId = String((created.body.draft as Record<string, unknown>).sandboxId)

    const pageRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'One', slug: 'reindex-fail-page' },
    })
    expect(pageRes.status).toBe(201)
    const pageId = String((pageRes.body.page as Record<string, unknown>).pageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: { body: { html: `<h1>${markerV1}</h1>` } },
    })

    const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(
      pushV1.status,
      JSON.stringify({ status: pushV1.status, error: pushV1.body.error }, null, 2),
    ).toBe(200)
    const publicUrl = String((pushV1.body.site as Record<string, unknown>).publicUrl).replace(/\/+$/, '')

    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: { body: { html: `<h1>${markerV2}</h1>` } },
    })

    await installReindexFailTrigger(pool, draftId)
    await pool.query(`DELETE FROM pages WHERE draft_id=$1`, [draftId])
    try {
      const pushFail = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
      expect(pushFail.status).not.toBe(200)

      const row = await pool.query(
        `SELECT head_commit_id, pending_operation, last_error FROM site_drafts WHERE draft_id=$1`,
        [draftId],
      )
      expect(String(row.rows[0]!.pending_operation)).toBe('push')
      expect(String(row.rows[0]!.last_error ?? '')).toContain(REINDEX_FAIL_SQLSTATE)
      expect(String(row.rows[0]!.head_commit_id)).toBe(gitHead(sandboxId))

      const readable = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token })
      expect(readable.status).toBe(200)

      const live = await fetch(`${publicUrl}/reindex-fail-page/`)
      expect(live.status).toBe(200)
      const html = await live.text()
      expect(html).toContain(markerV2)

      await removeReindexFailTrigger(pool)

      const pushRetry = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
      expect(
        pushRetry.status,
        JSON.stringify({ status: pushRetry.status, error: pushRetry.body.error, draft: pushRetry.body.draft }, null, 2),
      ).toBe(200)
    } finally {
      await removeReindexFailTrigger(pool)
    }
  })
})
