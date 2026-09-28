import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { appConfig } from './config.js'
import { app } from './app.js'
import {
  createTestPool,
  resetTestDatabase,
  syncSearchPath,
} from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

const BLOCK_ERROR = 'OLPS_PUBLISH_RECOVERY_TEST_BLOCK'

const pool = createTestPool()

beforeEach(async () => {
  requireRemoteServiceConfig()
  await resetTestDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function accessToken(account: string): Promise<string> {
  const reg = await registerUser(app, {
    account,
    password: 'publish-recovery-pass',
    name: account,
  })
  expect(reg.status).toBe(201)
  return reg.accessToken
}

function gitHeadInSandbox(sandboxId: string): string {
  const dir = path.join(appConfig.sandboxRoot, sandboxId)
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rev-parse HEAD 失败')
  }
  return result.stdout.trim()
}

async function installPublishBlockForDraft(draftId: string): Promise<void> {
  await syncSearchPath(pool)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS olps_publish_recovery_block (
      draft_id TEXT PRIMARY KEY
    )
  `)
  await pool.query(`
    CREATE OR REPLACE FUNCTION olps_publish_recovery_block_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM olps_publish_recovery_block b
        INNER JOIN pages p ON p.draft_id = b.draft_id
        WHERE p.page_id = NEW.page_id
      ) THEN
        RAISE EXCEPTION '${BLOCK_ERROR}';
      END IF;
      RETURN NEW;
    END;
    $$
  `)
  await pool.query(`
    DROP TRIGGER IF EXISTS olps_publish_recovery_block_trg ON site_published_pages
  `)
  await pool.query(`
    CREATE TRIGGER olps_publish_recovery_block_trg
      BEFORE INSERT ON site_published_pages
      FOR EACH ROW EXECUTE PROCEDURE olps_publish_recovery_block_insert()
  `)
  await pool.query(`INSERT INTO olps_publish_recovery_block(draft_id) VALUES ($1)`, [draftId])
}

async function removePublishBlockForDraft(draftId: string): Promise<void> {
  await syncSearchPath(pool)
  await pool.query(`DELETE FROM olps_publish_recovery_block WHERE draft_id=$1`, [draftId])
  await pool.query(`DROP TRIGGER IF EXISTS olps_publish_recovery_block_trg ON site_published_pages`)
  await pool.query(`DROP FUNCTION IF EXISTS olps_publish_recovery_block_insert()`)
  await pool.query(`DROP TABLE IF EXISTS olps_publish_recovery_block`)
}

async function restartApiDatabasePool(): Promise<void> {
  const db = await import('./db.js')
  await db.pool.end()
  db.recreatePool()
}

async function distinctRemoteSiteCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT remote_site_id)::int AS n FROM sites WHERE remote_site_id IS NOT NULL`,
  )
  return Number(result.rows[0]!.n)
}

describe('发布恢复与并发首次 push（RED）', () => {
  it('同一草稿并发首次 push 仅产生一个本地站点与一个远端站点且重复 push 幂等', async () => {
    const token = await accessToken('concurrent-first-push-user')
    const marker = 'concurrent-first-push-marker-4e91'

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Concurrent First Push' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Home', slug: 'home' },
    })
    expect(pageRes.status).toBe(201)
    const pageId = String((pageRes.body.page as Record<string, unknown>).pageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: {
        seo: { title: 'Concurrent SEO', description: 'desc' },
        body: { html: `<h1>${marker}</h1>` },
      },
    })

    const [pushA, pushB] = await Promise.all([
      requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token }),
      requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token }),
    ])

    for (const res of [pushA, pushB]) {
      expect([200, 409]).toContain(res.status)
    }
    const success = [pushA, pushB].filter((res) => res.status === 200)
    expect(success.length).toBeGreaterThan(0)

    const siteIds = [pushA, pushB]
      .filter((res) => res.status === 200 && res.body.site)
      .map((res) => String((res.body.site as Record<string, unknown>).siteId))
    expect(new Set(siteIds).size).toBeLessThanOrEqual(1)

    const siteCount = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
    expect(Number(siteCount.rows[0]!.n)).toBe(1)
    expect(await distinctRemoteSiteCount()).toBe(1)

    const pushAgain = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(pushAgain.status).toBe(200)
    const siteIdAgain = String((pushAgain.body.site as Record<string, unknown>).siteId)
    if (siteIds.length > 0) {
      expect(siteIdAgain).toBe(siteIds[0])
    }

    const siteCountAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
    expect(Number(siteCountAfter.rows[0]!.n)).toBe(1)
    expect(await distinctRemoteSiteCount()).toBe(1)

    const publicUrl = String((pushAgain.body.site as Record<string, unknown>).publicUrl).replace(
      /\/+$/,
      '',
    )
    const httpRes = await fetch(`${publicUrl}/home/`)
    expect(httpRes.status).toBe(200)
    const html = await httpRes.text()
    expect(html).toContain(marker)
  })

  it('远端已成功但本地发布事务失败后可恢复且重试不创建第二个远端站点', async () => {
    const token = await accessToken('local-tx-failure-recovery')
    const marker = 'recovery-retry-marker-8b02'

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Recovery Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Recovery Page', slug: 'recovery-page' },
    })
    expect(pageRes.status).toBe(201)
    const pageId = String((pageRes.body.page as Record<string, unknown>).pageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: {
        seo: { title: 'Recovery SEO', description: 'recovery desc' },
        body: { html: `<h1>${marker}</h1>` },
      },
    })

    const report = await requestJson(app, 'POST', '/api/reports', {
      token,
      body: { draftId, pageId },
    })
    expect(report.status).toBe(201)
    const reportId = String((report.body.report as Record<string, unknown>).reportId)

    await installPublishBlockForDraft(draftId)

    const failedPush = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(failedPush.status).toBe(500)
    expect(String(failedPush.body.error ?? '')).toContain(BLOCK_ERROR)

    const draftRow = (
      await pool.query(
        `SELECT sandbox_id, head_commit_id, remote_site_id, pending_operation, last_error, site_id
         FROM site_drafts WHERE draft_id=$1`,
        [draftId],
      )
    ).rows[0]!
    expect(String(draftRow.pending_operation)).toBe('push')
    expect(draftRow.remote_site_id).toBeTruthy()
    expect(String(draftRow.last_error ?? '')).toContain(BLOCK_ERROR)
    expect(draftRow.site_id).toBeNull()

    const gitHead = gitHeadInSandbox(String(draftRow.sandbox_id))
    expect(String(draftRow.head_commit_id)).toBe(gitHead)

    const sitesAfterFail = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
    expect(Number(sitesAfterFail.rows[0]!.n)).toBe(0)

    const readDraft = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token })
    expect(readDraft.status).toBe(200)

    const remoteSiteIdAfterFail = String(draftRow.remote_site_id)

    await restartApiDatabasePool()

    const readAfterRestart = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token })
    expect(readAfterRestart.status).toBe(200)
    const draftAfterRestart = readAfterRestart.body.draft as Record<string, unknown>
    expect(String(draftAfterRestart.pendingOperation)).toBe('push')
    expect(String(draftAfterRestart.headCommitId)).toBe(gitHead)

    const rowAfterRestart = (
      await pool.query(
        `SELECT remote_site_id, pending_operation, head_commit_id FROM site_drafts WHERE draft_id=$1`,
        [draftId],
      )
    ).rows[0]!
    expect(String(rowAfterRestart.remote_site_id)).toBe(remoteSiteIdAfterFail)
    expect(String(rowAfterRestart.pending_operation)).toBe('push')
    expect(String(rowAfterRestart.head_commit_id)).toBe(gitHead)

    await removePublishBlockForDraft(draftId)

    const retryPush = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(retryPush.status).toBe(200)
    const siteId = String((retryPush.body.site as Record<string, unknown>).siteId)
    expect(String((retryPush.body.site as Record<string, unknown>).remoteSiteId)).toBe(
      remoteSiteIdAfterFail,
    )

    expect(await distinctRemoteSiteCount()).toBe(1)
    const siteCount = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
    expect(Number(siteCount.rows[0]!.n)).toBe(1)

    const snap = await pool.query(
      `SELECT COUNT(*)::int AS n FROM site_published_pages WHERE site_id=$1`,
      [siteId],
    )
    expect(Number(snap.rows[0]!.n)).toBeGreaterThan(0)

    const reportRow = (
      await pool.query(`SELECT site_id FROM reports WHERE report_id=$1`, [reportId])
    ).rows[0]!
    expect(String(reportRow.site_id)).toBe(siteId)

    const draftClean = (
      await pool.query(`SELECT pending_operation FROM site_drafts WHERE draft_id=$1`, [draftId])
    ).rows[0]!
    expect(draftClean.pending_operation).toBeNull()

    const publicUrl = String((retryPush.body.site as Record<string, unknown>).publicUrl).replace(
      /\/+$/,
      '',
    )
    const httpRes = await fetch(`${publicUrl}/recovery-page/`)
    expect(httpRes.status).toBe(200)
    expect(await httpRes.text()).toContain(marker)
  })

  it('pending push 恢复态 GET 草稿 HTTP 响应含 draftRemoteSiteId（RED）', async () => {
    const token = await accessToken('recovery-api-field-red')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Recovery API Field' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Page', slug: 'page' },
    })
    expect(pageRes.status).toBe(201)

    await installPublishBlockForDraft(draftId)
    const failedPush = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(failedPush.status).toBe(500)

    const row = (
      await pool.query(`SELECT remote_site_id FROM site_drafts WHERE draft_id=$1`, [draftId])
    ).rows[0]!
    expect(row.remote_site_id).toBeTruthy()
    const remoteSiteId = String(row.remote_site_id)

    const read = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token })
    expect(read.status).toBe(200)
    const draft = read.body.draft as Record<string, unknown>
    expect(String(draft.pendingOperation)).toBe('push')
    expect(String(draft.draftRemoteSiteId ?? '')).toBe(remoteSiteId)

    await removePublishBlockForDraft(draftId)
  })
})
