import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import {
  applyRemoteEnv,
  restartDedicatedRemote,
  snapshotRemoteEnv,
  startDedicatedRemote,
} from './test-support/dedicated-remote-harness.js'
import { appConfig } from './config.js'
import path from 'node:path'

function gitHeadForSandbox(sandboxId: string): string {
  const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git rev-parse 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

describe('远端进程终止后 pull/push 持久化错误并可重试', () => {
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

  it('push 远端不可达时记录 error 与 pending，重启同一 dataRoot 后重试成功', async () => {
    let session = await startDedicatedRemote('remote-retry-test')
    applyRemoteEnv(session.baseUrl, session.token)
    try {

    const reg = await registerUser(app, {
      account: 'remote-retry-user',
      password: 'remote-retry-pass',
      name: 'remote-retry-user',
    })
    expect(reg.status).toBe(201)
    const token = reg.accessToken

    const marker = 'remote-retry-marker-9f2a'

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Remote Retry Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const sandboxId = String((created.body.draft as Record<string, unknown>).sandboxId)

    await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'P', slug: 'remote-retry-p' },
    })

    const pages = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages`, { token })
    const pageId = String((pages.body.pages as Array<Record<string, unknown>>)[0]!.pageId)
    const pushInitial = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(
      pushInitial.status,
      JSON.stringify({ status: pushInitial.status, error: pushInitial.body.error }, null, 2),
    ).toBe(200)

    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: { body: { html: `<h1>${marker}</h1>` } },
    })

    session.close()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500)
    })

    const pushFail = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(pushFail.status).not.toBe(200)

    const row = await pool.query(
      `SELECT head_commit_id, pending_operation, last_error, sync_status FROM site_drafts WHERE draft_id=$1`,
      [draftId],
    )
    expect(row.rowCount).toBe(1)
    expect(String(row.rows[0]!.pending_operation)).toBe('push')
    expect(String(row.rows[0]!.last_error ?? '')).not.toBe('')
    const dbHead = String(row.rows[0]!.head_commit_id)
    expect(dbHead).toBe(gitHeadForSandbox(sandboxId))

    const draftReadable = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token })
    expect(draftReadable.status).toBe(200)

    session = await restartDedicatedRemote(session.dataRoot, 'remote-retry-test')
    applyRemoteEnv(session.baseUrl, session.token)

    const pushRetry = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(
      pushRetry.status,
      JSON.stringify({ status: pushRetry.status, error: pushRetry.body.error, draft: pushRetry.body.draft }, null, 2),
    ).toBe(200)

    const site = pushRetry.body.site as Record<string, unknown>
    const publicUrl = String(site.publicUrl).replace(/\/+$/, '')
    const live = await fetch(`${publicUrl}/remote-retry-p/`)
    expect(live.status).toBe(200)
    const html = await live.text()
    expect(html).toContain(marker)
    } finally {
      session.close()
      applyRemoteEnv(restoredEnv.baseUrl, restoredEnv.token)
    }
  })
})
