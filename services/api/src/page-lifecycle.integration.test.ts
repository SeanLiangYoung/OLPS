import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('页面删除与发布范围', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())

  it('下线、重新发布、删除后公开 HTML、sitemap 和协作草稿一致', async () => {
    const owner = await registerUser(app, { account: 'lifecycle-owner', password: 'lifecycle-password', name: 'Owner' })
    const token = owner.accessToken
    const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token, body })
    const created = await call('POST', '/api/drafts', { name: 'Lifecycle' })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const root = `/api/drafts/${draftId}`
    const page = await call('POST', `${root}/pages`, { kind: 'content', title: 'Article', slug: 'article' })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    expect((await call('POST', `${root}/pages`, { kind: 'site', title: 'Home', slug: 'home' })).status).toBe(201)
    const first = await call('POST', `${root}/push`)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const site = first.body.site as Record<string, unknown>
    const publicUrl = String(site.publicUrl).replace(/\/$/, '')
    expect((await fetch(`${publicUrl}/article/`)).status).toBe(200)
    const publishedPage = await call('GET', `${root}/pages/${pageId}`)
    expect((publishedPage.body.page as Record<string, unknown>).status).toBe('published')
    const clone = await call('POST', '/api/drafts', { name: 'Collaborator', siteId: site.siteId })
    const cloneId = String((clone.body.draft as Record<string, unknown>).draftId)
    const clonedPublishedPage = await call('GET', `/api/drafts/${cloneId}/pages/${pageId}`)
    expect((clonedPublishedPage.body.page as Record<string, unknown>).status).toBe('published')
    const edited = await call('PATCH', `${root}/pages/${pageId}`, { title: 'Updated article' })
    expect((edited.body.page as Record<string, unknown>).status).toBe('draft')

    const excluded = await call('PATCH', `${root}/pages/${pageId}`, { status: 'unpublished' })
    expect(excluded.status).toBe(200)
    expect((excluded.body.page as Record<string, unknown>).status).toBe('unpublished')
    const preview = await call('POST', `${root}/pages/${pageId}/preview`)
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect((await call('POST', `${root}/push`)).status).toBe(200)
    expect((await fetch(`${publicUrl}/article/`)).status).toBe(404)
    expect((await fetch(`${publicUrl}/home/`)).status).toBe(200)
    expect(await (await fetch(`${publicUrl}/sitemap.xml`)).text()).not.toContain('/article/')
    expect((await pool.query('SELECT * FROM site_published_pages WHERE site_id=$1 AND page_id=$2', [site.siteId, pageId])).rowCount).toBe(0)
    expect((await call('POST', `/api/drafts/${cloneId}/pull`)).status).toBe(200)
    const clonedPage = await call('GET', `/api/drafts/${cloneId}/pages/${pageId}`)
    expect((clonedPage.body.page as Record<string, unknown>).status).toBe('unpublished')

    expect((await call('PATCH', `${root}/pages/${pageId}`, { status: 'draft' })).status).toBe(200)
    expect((await call('POST', `${root}/push`)).status).toBe(200)
    expect((await fetch(`${publicUrl}/article/`)).status).toBe(200)
    expect((await call('POST', `/api/drafts/${cloneId}/pull`)).status).toBe(200)
    expect((await call('DELETE', `${root}/pages/${pageId}`)).status).toBe(200)
    expect((await call('POST', `${root}/push`)).status).toBe(200)
    expect((await fetch(`${publicUrl}/article/`)).status).toBe(404)
    expect((await call('POST', `/api/drafts/${cloneId}/pull`)).status).toBe(200)
    const list = await call('GET', `/api/drafts/${cloneId}/pages`)
    expect((list.body.pages as Array<Record<string, unknown>>).some(p => p.pageId === pageId)).toBe(false)
    expect((await call('DELETE', `${root}/pages/${pageId}`)).status).toBe(404)
  }, 120_000)

  it('其他用户无法删除页面或改变发布范围，非法状态返回 400', async () => {
    const owner = await registerUser(app, { account: 'lifecycle-a', password: 'lifecycle-password', name: 'A' })
    const other = await registerUser(app, { account: 'lifecycle-b', password: 'lifecycle-password', name: 'B' })
    const created = await requestJson(app, 'POST', '/api/drafts', { token: owner.accessToken, body: { name: 'Private' } })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token: owner.accessToken, body: { kind: 'site', title: 'Private', slug: 'private' } })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const url = `/api/drafts/${draftId}/pages/${pageId}`
    expect((await requestJson(app, 'DELETE', url, { token: other.accessToken })).status).toBe(403)
    expect((await requestJson(app, 'PATCH', url, { token: other.accessToken, body: { status: 'unpublished' } })).status).toBe(403)
    expect((await requestJson(app, 'PATCH', url, { token: owner.accessToken, body: { status: 'invalid' } })).status).toBe(400)
  })
})
