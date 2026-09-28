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

describe('push 自动 merge 后发布快照（无 Agent，两草稿）', () => {
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
      password: 'auto-merge-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('B 未 pull 直接 push：公开页与 site_published_pages 须同时包含 A 新页与 B 修改', async () => {
    const tokenA = await accessToken('merge-snap-a')
    const tokenB = await accessToken('merge-snap-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Auto Merge Site' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    const basePage = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Shared Base', slug: 'merge-base' },
    })
    expect(basePage.status).toBe(201)
    const basePageId = String((basePage.body.page as Record<string, unknown>).pageId)

    const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushV1.status, JSON.stringify({ status: pushV1.status, error: pushV1.body.error }, null, 2)).toBe(
      200,
    )
    const siteId = String((pushV1.body.site as Record<string, unknown>).siteId)
    const publicUrl = String((pushV1.body.site as Record<string, unknown>).publicUrl)

    const addOwner = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'merge-snap-b' },
    })
    expect(addOwner.status).toBe(200)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'Merge fork B', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)

    const pagesBInit = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
    expect(pagesBInit.status).toBe(200)
    const baseOnB = (pagesBInit.body.pages as Array<Record<string, unknown>>).find(
      (p) => p.slug === 'merge-base',
    )
    expect(baseOnB).toBeTruthy()
    const basePageIdOnB = String(baseOnB!.pageId)

    const markerA = 'auto-merge-marker-a-7c2f'
    const markerB = 'auto-merge-marker-b-7c2f'

    const pageAOnly = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Page From A', slug: 'merge-a-only' },
    })
    expect(pageAOnly.status).toBe(201)
    const pageAOnlyId = String((pageAOnly.body.page as Record<string, unknown>).pageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageAOnlyId}`, {
      token: tokenA,
      body: { body: { html: `<h1>${markerA}</h1>` } },
    })

    const pushV2 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushV2.status, JSON.stringify({ status: pushV2.status, error: pushV2.body.error }, null, 2)).toBe(
      200,
    )

    await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${basePageIdOnB}`, {
      token: tokenB,
      body: { body: { html: `<h1>${markerB}</h1>` } },
    })

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

    const snapRows = await pool.query(
      `SELECT page_id, slug, body, published_commit_id FROM site_published_pages WHERE site_id=$1 ORDER BY slug`,
      [siteId],
    )
    expect(snapRows.rowCount).toBe(2)

    const snapBySlug = new Map(
      snapRows.rows.map((row) => [String(row.slug), row as Record<string, unknown>]),
    )
    expect(snapBySlug.has('merge-base')).toBe(true)
    expect(snapBySlug.has('merge-a-only')).toBe(true)

    for (const row of snapRows.rows) {
      expect(String(row.published_commit_id)).toBe(publishedCommitId)
    }

    const baseSnapHtml = htmlFromPageBody(snapBySlug.get('merge-base')!.body)
    const aSnapHtml = htmlFromPageBody(snapBySlug.get('merge-a-only')!.body)

    const baseLive = await fetch(publishedPageUrl(publicUrl, 'merge-base'))
    const aLive = await fetch(publishedPageUrl(publicUrl, 'merge-a-only'))
    expect(baseLive.status).toBe(200)
    expect(aLive.status).toBe(200)
    const baseLiveHtml = await baseLive.text()
    const aLiveHtml = await aLive.text()

    const evidence = {
      markerA,
      markerB,
      publishedCommitId,
      baseSnapHtml,
      aSnapHtml,
      baseLiveHtmlSnippet: baseLiveHtml.slice(0, 400),
      aLiveHtmlSnippet: aLiveHtml.slice(0, 400),
      basePageId,
      basePageIdOnB,
      pageAOnlyId,
    }

    expect(baseSnapHtml.includes(markerB), JSON.stringify(evidence, null, 2)).toBe(true)
    expect(aSnapHtml.includes(markerA), JSON.stringify(evidence, null, 2)).toBe(true)
    expect(baseLiveHtml.includes(markerB), JSON.stringify(evidence, null, 2)).toBe(true)
    expect(aLiveHtml.includes(markerA), JSON.stringify(evidence, null, 2)).toBe(true)
  })
})
