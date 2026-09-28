import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { appConfig } from './config.js'
import { app } from './app.js'
import { startApiHttpServerFromWorktree } from './test-support/api-server-process.js'
import {
  createTestPool,
  resetTestDatabase,
  syncSearchPath,
} from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import {
  assertRemoteSiteExistsViaHttp,
  listRemoteSiteIdsFromDataRoot,
  newRemoteSiteIdsSince,
} from './test-support/remote-site-catalog.js'

const BLOCK_ERROR = 'OLPS_PUBLISH_RECOVERY_TEST_BLOCK'

const pool = createTestPool()

beforeEach(async () => {
  requireRemoteServiceConfig()
  await resetTestDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function requestJsonUrl(
  baseUrl: string,
  method: string,
  apiPath: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${apiPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text.trim()) {
    body = JSON.parse(text) as Record<string, unknown>
  }
  return { status: response.status, body }
}

async function accessTokenInProcess(account: string): Promise<string> {
  const reg = await registerUser(app, {
    account,
    password: 'publish-recovery-pass',
    name: account,
  })
  expect(reg.status).toBe(201)
  return reg.accessToken
}

async function accessTokenViaServer(baseUrl: string, account: string): Promise<string> {
  const reg = await requestJsonUrl(baseUrl, 'POST', '/api/auth/register', {
    body: { account, password: 'publish-recovery-pass', name: account },
  })
  expect(reg.status).toBe(201)
  expect(reg.body.accessToken).toBeTruthy()
  return String(reg.body.accessToken)
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

async function distinctRemoteSiteCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT remote_site_id)::int AS n FROM sites WHERE remote_site_id IS NOT NULL`,
  )
  return Number(result.rows[0]!.n)
}

function requireRemoteDataRoot(): string {
  const root = process.env.REMOTE_DATA_ROOT?.trim()
  if (!root) {
    throw new Error('测试缺少 REMOTE_DATA_ROOT')
  }
  return root
}

async function expectExactlyOneNewRemoteSite(input: {
  beforeRemoteIds: Set<string>
  afterRemoteIds: Set<string>
  expectedRemoteSiteId: string
}): Promise<void> {
  const added = newRemoteSiteIdsSince(input.beforeRemoteIds, input.afterRemoteIds)
  expect(added.size).toBe(1)
  expect(added.has(input.expectedRemoteSiteId)).toBe(true)
  await assertRemoteSiteExistsViaHttp(
    input.expectedRemoteSiteId,
    process.env.REMOTE_SERVICE_URL ?? '',
    process.env.REMOTE_SERVICE_TOKEN ?? '',
  )
}

describe('发布恢复与并发首次 push', () => {
  it('同一草稿并发首次 push 仅产生一个本地站点与一个远端站点且重复 push 幂等', async () => {
    const token = await accessTokenInProcess('concurrent-first-push-user')
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

    const remoteDataRoot = requireRemoteDataRoot()
    const remoteIdsBeforePush = await listRemoteSiteIdsFromDataRoot(remoteDataRoot)

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
    const remoteSiteIdAgain = String(
      (pushAgain.body.site as Record<string, unknown>).remoteSiteId,
    )
    if (siteIds.length > 0) {
      expect(siteIdAgain).toBe(siteIds[0])
    }

    const siteCountAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
    expect(Number(siteCountAfter.rows[0]!.n)).toBe(1)
    expect(await distinctRemoteSiteCount()).toBe(1)

    const remoteIdsAfterPush = await listRemoteSiteIdsFromDataRoot(remoteDataRoot)
    await expectExactlyOneNewRemoteSite({
      beforeRemoteIds: remoteIdsBeforePush,
      afterRemoteIds: remoteIdsAfterPush,
      expectedRemoteSiteId: remoteSiteIdAgain,
    })

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
    const marker = 'recovery-retry-marker-8b02'
    let stopServer: (() => Promise<void>) | null = null

    try {
      const remoteDataRoot = requireRemoteDataRoot()
      const remoteIdsAtStart = await listRemoteSiteIdsFromDataRoot(remoteDataRoot)

      const firstServer = await startApiHttpServerFromWorktree()
      stopServer = firstServer.stop
      const baseUrl = firstServer.baseUrl
      const token = await accessTokenViaServer(baseUrl, 'local-tx-failure-recovery')

      const created = await requestJsonUrl(baseUrl, 'POST', '/api/drafts', {
        token,
        body: { name: 'Recovery Draft' },
      })
      expect(created.status).toBe(201)
      const draftId = String((created.body.draft as Record<string, unknown>).draftId)

      const pageRes = await requestJsonUrl(baseUrl, 'POST', `/api/drafts/${draftId}/pages`, {
        token,
        body: { kind: 'content', title: 'Recovery Page', slug: 'recovery-page' },
      })
      expect(pageRes.status).toBe(201)
      const pageId = String((pageRes.body.page as Record<string, unknown>).pageId)

      await requestJsonUrl(baseUrl, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
        token,
        body: {
          seo: { title: 'Recovery SEO', description: 'recovery desc' },
          body: { html: `<h1>${marker}</h1>` },
        },
      })

      const report = await requestJsonUrl(baseUrl, 'POST', '/api/reports', {
        token,
        body: { draftId, pageId },
      })
      expect(report.status).toBe(201)
      const reportId = String((report.body.report as Record<string, unknown>).reportId)

      await installPublishBlockForDraft(draftId)

      const failedPush = await requestJsonUrl(baseUrl, 'POST', `/api/drafts/${draftId}/push`, {
        token,
      })
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

      const remoteSiteIdAfterFail = String(draftRow.remote_site_id)

      const remoteIdsAfterFail = await listRemoteSiteIdsFromDataRoot(remoteDataRoot)
      await expectExactlyOneNewRemoteSite({
        beforeRemoteIds: remoteIdsAtStart,
        afterRemoteIds: remoteIdsAfterFail,
        expectedRemoteSiteId: remoteSiteIdAfterFail,
      })

      await firstServer.stop()
      stopServer = null

      const secondServer = await startApiHttpServerFromWorktree()
      stopServer = secondServer.stop

      const readAfterRestart = await requestJsonUrl(
        secondServer.baseUrl,
        'GET',
        `/api/drafts/${draftId}`,
        { token },
      )
      expect(readAfterRestart.status).toBe(200)
      const draftAfterRestart = readAfterRestart.body.draft as Record<string, unknown>
      expect(String(draftAfterRestart.pendingOperation)).toBe('push')
      expect(String(draftAfterRestart.headCommitId)).toBe(gitHead)
      expect(String(draftAfterRestart.lastError ?? '')).toContain(BLOCK_ERROR)

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

      const retryPush = await requestJsonUrl(
        secondServer.baseUrl,
        'POST',
        `/api/drafts/${draftId}/push`,
        { token },
      )
      expect(retryPush.status).toBe(200)
      const siteId = String((retryPush.body.site as Record<string, unknown>).siteId)
      expect(String((retryPush.body.site as Record<string, unknown>).remoteSiteId)).toBe(
        remoteSiteIdAfterFail,
      )

      expect(await distinctRemoteSiteCount()).toBe(1)
      const siteCount = await pool.query(`SELECT COUNT(*)::int AS n FROM sites`)
      expect(Number(siteCount.rows[0]!.n)).toBe(1)

      const remoteIdsAfterRetry = await listRemoteSiteIdsFromDataRoot(remoteDataRoot)
      await expectExactlyOneNewRemoteSite({
        beforeRemoteIds: remoteIdsAtStart,
        afterRemoteIds: remoteIdsAfterRetry,
        expectedRemoteSiteId: remoteSiteIdAfterFail,
      })

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

      await secondServer.stop()
      stopServer = null
    } finally {
      if (stopServer) {
        await stopServer()
      }
    }
  })
})
