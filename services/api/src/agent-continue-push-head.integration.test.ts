import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SITE_PATHS } from '@olps/sync'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'
import path from 'node:path'

const BRAND_RED = 'red'
const BRAND_GREEN = 'green'
const B_ONLY_MARKER = 'agent-brand-b-only-7c2f'

describe('Agent continue 后 push 须保留用户选择与独有修改', () => {
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
      password: 'agent-head-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it(
    'brandColor 冲突：continue 选择 red 后 push 成功，公开页含选择与 B 独有 marker，HEAD 一致',
    async () => {
      const tokenA = await accessToken('agent-brand-a')
      const tokenB = await accessToken('agent-brand-b')

      const draftA = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenA,
        body: { name: 'Agent Brand Site' },
      })
      expect(draftA.status).toBe(201)
      const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

      const page = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
        token: tokenA,
        body: { kind: 'content', title: 'Shared', slug: 'agent-brand-shared' },
      })
      expect(page.status).toBe(201)
      const pageIdA = String((page.body.page as Record<string, unknown>).pageId)

      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/settings`, {
        token: tokenA,
        body: { brandColor: BRAND_RED },
      })

      const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(pushV1.status).toBe(200)
      const siteId = String((pushV1.body.site as Record<string, unknown>).siteId)
      const publicUrl = String((pushV1.body.site as Record<string, unknown>).publicUrl)

      await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
        token: tokenA,
        body: { account: 'agent-brand-b' },
      })

      const draftB = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenB,
        body: { name: 'Agent Brand B', siteId },
      })
      expect(draftB.status).toBe(201)
      const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
      const sandboxId = String((draftB.body.draft as Record<string, unknown>).sandboxId)

      const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
      const pageOnB = (pagesB.body.pages as Array<Record<string, unknown>>).find(
        (p) => p.slug === 'agent-brand-shared',
      )!
      const pageIdB = String(pageOnB.pageId)

      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/settings`, {
        token: tokenA,
        body: { brandColor: BRAND_RED },
      })
      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageIdA}`, {
        token: tokenA,
        body: { body: { html: '<h1>agent-brand-a-base</h1>' } },
      })
      const pushV2 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(pushV2.status).toBe(200)

      await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/settings`, {
        token: tokenB,
        body: { brandColor: BRAND_GREEN },
      })
      await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${pageIdB}`, {
        token: tokenB,
        body: { body: { html: `<h1>${B_ONLY_MARKER}</h1>` } },
      })

      const pullB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      expect(pullB.status).toBe(409)
      expect(String((pullB.body.draft as Record<string, unknown>).syncStatus)).toBe('awaiting_user')

      const cont = await requestJson(app, 'POST', `/api/drafts/${draftBId}/continue`, {
        token: tokenB,
        body: {
          userMessage: `保留远端已发布的 brandColor 为 ${BRAND_RED}，放弃本地 ${BRAND_GREEN}。`,
        },
      })
      expect(
        cont.status,
        JSON.stringify({ status: cont.status, error: cont.body.error, draft: cont.body.draft }, null, 2),
      ).toBe(200)

      const pushB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, { token: tokenB })
      expect(
        pushB.status,
        JSON.stringify({ status: pushB.status, error: pushB.body.error, draft: pushB.body.draft }, null, 2),
      ).toBe(200)

      const siteRow = await pool.query(
        `SELECT published_commit_id FROM sites WHERE site_id=$1`,
        [siteId],
      )
      const publishedCommitId = String(siteRow.rows[0]!.published_commit_id)

      const draftRow = await pool.query(
        `SELECT head_commit_id FROM site_drafts WHERE draft_id=$1`,
        [draftBId],
      )
      const dbHead = String(draftRow.rows[0]!.head_commit_id)
      const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)
      const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf8' })
      expect(gitHead.status).toBe(0)
      expect(dbHead).toBe(gitHead.stdout.trim())
      expect(publishedCommitId).toBe(dbHead)

      const settingsPath = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.siteSettings)
      const mergedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
      expect(String(mergedSettings.brandColor)).toBe(BRAND_RED)

      const siteSettingsRow = await pool.query(`SELECT settings FROM sites WHERE site_id=$1`, [siteId])
      const publishedSettings = siteSettingsRow.rows[0]!.settings as Record<string, unknown>
      expect(String(publishedSettings.brandColor)).toBe(BRAND_RED)

      const base = publicUrl.replace(/\/+$/, '')
      const pageRes = await fetch(`${base}/agent-brand-shared/`)
      expect(pageRes.status).toBe(200)
      const pageHtml = await pageRes.text()
      expect(pageHtml).toContain(B_ONLY_MARKER)
    },
    1_200_000,
  )
})
