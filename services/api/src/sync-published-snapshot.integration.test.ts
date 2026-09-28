import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

function publishedPageUrl(publicUrl: string, slug: string): string {
  const base = publicUrl.replace(/\/+$/, '')
  return `${base}/${slug.replace(/^\/+/, '')}/`
}

function htmlFromPageBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const html = (body as Record<string, unknown>).html
  return typeof html === 'string' ? html : ''
}

describe('push 后 site_published_pages 与远端 HTML 一致（真实 Agent）', () => {
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
      password: 'snapshot-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it(
    '冲突合并后 push：site_published_pages 正文须与 publicUrl HTML 同样包含双方 marker',
    async () => {
      const tokenA = await accessToken('snap-a')
      const tokenB = await accessToken('snap-b')

      const draftA = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenA,
        body: { name: 'Snapshot Site' },
      })
      expect(draftA.status).toBe(201)
      const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

      const pageA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
        token: tokenA,
        body: { kind: 'content', title: 'Shared', slug: 'snapshot-shared' },
      })
      expect(pageA.status).toBe(201)
      const pageIdA = String((pageA.body.page as Record<string, unknown>).pageId)

      const pushA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      if (pushA.status !== 200) {
        const draft = pushA.body.draft as Record<string, unknown> | undefined
        expect(
          JSON.stringify({
            status: pushA.status,
            error: pushA.body.error,
            lastError: draft?.lastError,
            validationLog: draft?.validationLog,
          }),
          '首次 push',
        ).toBe('200')
      }
      expect(pushA.status).toBe(200)
      const siteId = String((pushA.body.site as Record<string, unknown>).siteId)
      const publicUrl = String((pushA.body.site as Record<string, unknown>).publicUrl)

      const addOwner = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
        token: tokenA,
        body: { account: 'snap-b' },
      })
      expect(addOwner.status).toBe(200)

      const draftB = await requestJson(app, 'POST', '/api/drafts', {
        token: tokenB,
        body: { name: 'Snap fork B', siteId },
      })
      expect(draftB.status).toBe(201)
      const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)

      const pullInit = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      expect(pullInit.status).toBe(200)

      const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
      const pageIdB = String(
        (pagesB.body.pages as Array<Record<string, unknown>>).find((p) => p.slug === 'snapshot-shared')!
          .pageId,
      )
      expect(pageIdB).toBe(pageIdA)

      const markerA = 'snapshot-marker-a-4e91'
      const markerB = 'snapshot-marker-b-4e91'

      await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageIdA}`, {
        token: tokenA,
        body: { body: { html: `<h1>${markerA}</h1>` } },
      })
      const pushA2 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
      expect(pushA2.status).toBe(200)

      await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${pageIdB}`, {
        token: tokenB,
        body: { body: { html: `<h1>${markerB}</h1>` } },
      })

      const pullB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
      if (pullB.status !== 409) {
        expect(JSON.stringify({ status: pullB.status, error: pullB.body.error, draft: pullB.body.draft }), 'pull 冲突').toBe('409')
      }
      expect(pullB.status).toBe(409)

      const cont = await requestJson(app, 'POST', `/api/drafts/${draftBId}/continue`, {
        token: tokenB,
        body: { userMessage: '合并双方 snapshot marker 到同一页面正文' },
      })
      if (cont.status !== 200) {
        expect(JSON.stringify({ status: cont.status, error: cont.body.error, draft: cont.body.draft }), 'continue').toBe('200')
      }
      expect(cont.status).toBe(200)

      const pushB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, { token: tokenB })
      if (pushB.status !== 200) {
        expect(JSON.stringify({ status: pushB.status, error: pushB.body.error, draft: pushB.body.draft }), 'push B').toBe('200')
      }
      expect(pushB.status).toBe(200)

      const siteRow = await pool.query(
        `SELECT published_commit_id FROM sites WHERE site_id=$1`,
        [siteId],
      )
      const publishedCommitId = String(siteRow.rows[0]!.published_commit_id)

      const snapRows = await pool.query(
        `SELECT page_id, body, published_commit_id FROM site_published_pages
         WHERE site_id=$1 AND page_id=$2`,
        [siteId, pageIdA],
      )
      expect(snapRows.rowCount).toBe(1)
      const snapBody = snapRows.rows[0]!.body as Record<string, unknown>
      const snapHtml = htmlFromPageBody(snapBody)
      expect(String(snapRows.rows[0]!.published_commit_id)).toBe(publishedCommitId)

      const pageUrl = publishedPageUrl(publicUrl, 'snapshot-shared')
      const httpRes = await fetch(pageUrl)
      expect(httpRes.status).toBe(200)
      const liveHtml = await httpRes.text()

      expect(liveHtml).toContain(markerA)
      expect(liveHtml).toContain(markerB)

      const evidence = {
        markerA,
        markerB,
        snapHtml,
        liveHtmlHasA: liveHtml.includes(markerA),
        liveHtmlHasB: liveHtml.includes(markerB),
        snapHasA: snapHtml.includes(markerA),
        snapHasB: snapHtml.includes(markerB),
        publishedCommitId,
      }

      expect(snapHtml.includes(markerA), JSON.stringify(evidence, null, 2)).toBe(true)
      expect(snapHtml.includes(markerB), JSON.stringify(evidence, null, 2)).toBe(true)
    },
    1_200_000,
  )
})
