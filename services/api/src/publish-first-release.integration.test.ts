import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

function publishedPageUrl(publicUrl: string, slug: string): string {
  const base = publicUrl.replace(/\/+$/, '')
  return `${base}/${slug.replace(/^\/+/, '')}/`
}

describe('首次发布与双草稿同步（真实远端 HTTP）', () => {
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
      password: 'release-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('注册→新草稿→页面与 SEO 修改→push→publicUrl 上 HTML 与线上一致', async () => {
    const token = await accessToken('release-user-a')
    const seoTitle = 'Release SEO Title 7f3a'
    const bodyMarker = 'release-body-marker-7f3a'

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Release Site A' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Release Page', slug: 'release-page' },
    })
    expect(pageRes.status).toBe(201)
    const pageId = String((pageRes.body.page as Record<string, unknown>).pageId)

    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: {
        seo: { title: seoTitle, description: 'Release SEO description 7f3a' },
        body: { html: `<h1>${bodyMarker}</h1><p>content</p>` },
      },
    })
    expect(patched.status).toBe(200)

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(push.status).toBe(200)
    const site = push.body.site as Record<string, unknown>
    expect(site.publicUrl).toBeTruthy()
    expect(site.remoteSiteId).toBeTruthy()

    const pageUrl = publishedPageUrl(String(site.publicUrl), 'release-page')
    const httpRes = await fetch(pageUrl)
    expect(httpRes.status).toBe(200)
    const html = await httpRes.text()
    expect(html).toContain(seoTitle)
    expect(html).toContain(bodyMarker)
  })

  it(
    '第二用户授权→基于网站草稿→双方编辑→pull/push 后远端 HTML 保留双方正文',
    async () => {
    const tokenA = await accessToken('release-sync-a')
    const tokenB = await accessToken('release-sync-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Shared Release Site' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    const pageA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Shared', slug: 'shared-release' },
    })
    expect(pageA.status).toBe(201)
    const pageIdA = String((pageA.body.page as Record<string, unknown>).pageId)

    const pushA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushA.status).toBe(200)
    const siteId = String((pushA.body.site as Record<string, unknown>).siteId)
    const publicUrl = String((pushA.body.site as Record<string, unknown>).publicUrl)

    const addOwner = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'release-sync-b' },
    })
    expect(addOwner.status).toBe(200)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B fork release', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)

    const pullInit = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
    expect(pullInit.status).toBe(200)

    const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
    const pageIdB = String(
      (pagesB.body.pages as Array<Record<string, unknown>>).find((p) => p.slug === 'shared-release')!
        .pageId,
    )
    expect(pageIdB).toBe(pageIdA)

    const markerA = 'marker-from-a-9c2e'
    const markerB = 'marker-from-b-9c2e'

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
    expect(pullB.status).toBe(409)

    const cont = await requestJson(app, 'POST', `/api/drafts/${draftBId}/continue`, {
      token: tokenB,
      body: { userMessage: '合并双方对正文的修改' },
    })
    expect(cont.status).toBe(200)

    const pushB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, { token: tokenB })
    expect(pushB.status).toBe(200)

    const pageUrl = publishedPageUrl(publicUrl, 'shared-release')
    const httpRes = await fetch(pageUrl)
    expect(httpRes.status).toBe(200)
    const html = await httpRes.text()
    expect(html).toContain(markerA)
    expect(html).toContain(markerB)
    },
    1_200_000,
  )
})
