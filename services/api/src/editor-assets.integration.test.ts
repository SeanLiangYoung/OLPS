import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('图片资源与编辑保存真实接口', () => {
  const pool = createTestPool()
  let token: string
  let draftId: string
  beforeEach(async () => {
    await resetTestDatabase()
    const user = await registerUser(app, { account: 'editor-owner', password: 'editor-password', name: '编辑用户' })
    token = user.accessToken
    const draft = await requestJson(app, 'POST', '/api/drafts', { token, body: { name: '图片网站' } })
    expect(draft.status).toBe(201)
    draftId = String((draft.body.draft as Record<string, unknown>).draftId)
  })
  afterAll(async () => { await pool.end() })

  async function upload(bytes: Uint8Array, name = 'photo.png', accessToken = token) {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    return app.request(`/api/drafts/${draftId}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form })
  }

  it('上传、重新读取与无Bearer预览使用真实图片，替换保持原文件可访问', async () => {
    const bytes = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#2196f3' } }).png().toBuffer()
    const response = await upload(bytes)
    expect(response.status).toBe(201)
    const { asset } = await response.json()
    expect(asset).toMatchObject({ name: 'photo.png', width: 12, height: 9, mimeType: 'image/webp' })
    expect(asset.url).toMatch(/^\/assets\/[a-f0-9]{64}\.webp$/)
    const preview = await app.request(asset.previewUrl)
    expect(preview.status).toBe(200)
    expect((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width).toBe(12)
    const replacement = await upload(await sharp({ create: { width: 7, height: 5, channels: 3, background: '#ff0000' } }).png().toBuffer())
    expect(replacement.status).toBe(201)
    expect((await replacement.json()).asset.url).not.toBe(asset.url)
    expect((await app.request(asset.previewUrl)).status).toBe(200)
    const listed = await requestJson(app, 'GET', `/api/drafts/${draftId}/assets`, { token })
    expect(listed.status).toBe(200)
    expect(listed.body.assets).toHaveLength(2)
    await pool.query('DELETE FROM sessions')
    expect((await app.request(asset.previewUrl)).status).toBe(403)
  })

  it('拒绝损坏图片、超出大小限制与无权限用户', async () => {
    expect((await upload(Buffer.from('invalid image'))).status).toBe(400)
    expect((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413)
    const other = await registerUser(app, { account: 'editor-other', password: 'editor-password', name: '其他用户' })
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
    expect((await upload(bytes, 'photo.png', other.accessToken)).status).toBe(403)
    expect((await requestJson(app, 'GET', `/api/drafts/${draftId}/assets`, { token: other.accessToken })).status).toBe(403)
  })

  it('页面地址冲突不会改变文件或数据库中保存的内容', async () => {
    const pages = []
    for (const slug of ['original-a', 'original-b']) {
      const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token, body: { kind: 'site', title: slug, slug } })
      pages.push(created.body.page as Record<string, unknown>)
    }
    const response = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}/editor`, { token, body: { body: { html: '<h1>不能覆盖的正文</h1>' }, slug: 'original-b', expectedUpdatedAt: pages[0]!.updatedAt } })
    expect(response.status).toBe(409)
    const reread = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token })
    expect(reread.body.page).toMatchObject({ slug: 'original-a', body: { html: '<h1>original-a</h1>' } })
    const stored = await pool.query('SELECT slug,body FROM pages WHERE draft_id=$1 AND page_id=$2', [draftId, pages[0]!.pageId])
    expect(stored.rows[0]).toMatchObject({ slug: 'original-a', body: { html: '<h1>original-a</h1>' } })
  })

  it('保存未完成Guide并返回问题，版本冲突与结构错误无法覆盖内容', async () => {
    const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token, body: { kind: 'ads', title: '广告页面', slug: 'editor-ad' } })
    const page = created.body.page as Record<string, unknown>
    const endpoint = `/api/drafts/${draftId}/pages/${page.pageId}/editor`
    const body = { html: '<h1>广告内容</h1>', ads: { keywordCluster: ['产品'], screens: [{ screenId: 'entry', role: 'entry', title: '入口', html: '<h2>入口</h2>' }], guide: { entryByKeyword: { 产品: 'entry' }, nodes: { entry: { options: [{ id: 'page-link', label: '目标页面', action: 'link_page' }] } } } } }
    const saved = await requestJson(app, 'PATCH', endpoint, { token, body: { body, expectedUpdatedAt: page.updatedAt, metadata: { editor: { version: 1 } } } })
    expect(saved.status).toBe(200)
    expect(saved.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'cta_count' })]))
    expect(saved.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'guide_page_missing', screenId: 'entry', optionId: 'page-link' })]))
    expect((saved.body.page as Record<string, unknown>).body).toEqual(body)
    expect((await requestJson(app, 'PATCH', endpoint, { token, body: { body: { html: '覆盖内容' }, expectedUpdatedAt: page.updatedAt } })).status).toBe(409)
    expect((await requestJson(app, 'PATCH', endpoint, { token, body: { body: { html: 123 }, expectedUpdatedAt: (saved.body.page as Record<string, unknown>).updatedAt } })).status).toBe(400)
    const ordinary = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${page.pageId}`, { token, body: { body } })
    expect(ordinary.status).toBe(400)
    const reread = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages/${page.pageId}`, { token })
    expect((reread.body.page as Record<string, unknown>).body).toEqual(body)
  })

  it('页面属性与正文在同一次版本检查中保存', async () => {
    const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token, body: { kind: 'content', title: '原始标题', slug: 'original' } })
    const page = created.body.page as Record<string, unknown>
    const saved = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${page.pageId}/editor`, { token, body: { body: { html: '<h1>更新内容</h1>' }, expectedUpdatedAt: page.updatedAt, title: '新的标题', slug: 'updated', locale: 'en', seo: { title: 'SEO标题', description: 'SEO说明' }, translationGroupId: 'group-1' } })
    expect(saved.status).toBe(200)
    expect(saved.body.page).toMatchObject({ title: '新的标题', slug: 'updated', locale: 'en', seo: { title: 'SEO标题', description: 'SEO说明' }, translationGroupId: 'group-1', body: { html: '<h1>更新内容</h1>' } })
  })

  it('拒绝超出像素限制的真实PNG以及截断PNG', async () => {
    const large = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer()
    expect((await upload(large)).status).toBe(400)
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#abcdef' } }).png().toBuffer()
    expect((await upload(png.subarray(0, png.length - 30))).status).toBe(400)
  })

  it('保存验证资源路径与资源存在，并保持现有元数据', async () => {
    const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token, body: { kind: 'content', title: '资源页面', slug: 'resources' } })
    const page = created.body.page as Record<string, unknown>
    const endpoint = `/api/drafts/${draftId}/pages/${page.pageId}/editor`
    for (const html of ['<img src="/assets/missing.webp">', '<div style="background:url(/assets/missing.webp)"></div>', '<img src="/assets/%2e%2e/source/site-settings.json">']) {
      const response = await requestJson(app, 'PATCH', endpoint, { token, body: { body: { html }, expectedUpdatedAt: page.updatedAt } })
      expect(response.status).toBe(400)
    }
    const bytes = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#123456' } }).png().toBuffer()
    const { asset } = await (await upload(bytes)).json()
    const html = `<picture><source srcset="${asset.url} 1x"><img src="${asset.url}" alt="产品"></picture>`
    const response = await requestJson(app, 'PATCH', endpoint, { token, body: { body: { html }, expectedUpdatedAt: page.updatedAt, metadata: { editor: { version: 1 } } } })
    expect(response.status).toBe(200)
    expect((response.body.page as Record<string, unknown>).body).toEqual({ html })
  })

  it('权限撤销使图片预览失效，并拒绝其他用户保存与并发旧版本保存', async () => {
    const other = await registerUser(app, { account: 'editor-member', password: 'editor-password', name: '其他用户' })
    const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token, body: { kind: 'content', title: '并发页面', slug: 'concurrent' } })
    const page = created.body.page as Record<string, unknown>
    const endpoint = `/api/drafts/${draftId}/pages/${page.pageId}/editor`
    expect((await requestJson(app, 'PATCH', endpoint, { token: other.accessToken, body: { body: { html: '<h1>没有权限</h1>' }, expectedUpdatedAt: page.updatedAt } })).status).toBe(403)
    const responses = await Promise.all(['内容A', '内容B'].map(html => requestJson(app, 'PATCH', endpoint, { token, body: { body: { html }, expectedUpdatedAt: page.updatedAt } })))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#123456' } }).png().toBuffer()
    const { asset } = await (await upload(bytes)).json()
    await pool.query('DELETE FROM draft_owners WHERE draft_id=$1', [draftId])
    expect((await app.request(asset.previewUrl)).status).toBe(403)
  })

  it('支持真实JPEG、GIF和WebP，资源capability限定具体图片', async () => {
    const images: Buffer[] = []
    for (const format of ['jpeg', 'gif', 'webp'] as const) images.push(await sharp({ create: { width: 6, height: 4, channels: 3, background: '#49aabb' } }).toFormat(format).toBuffer())
    const assets = []
    for (const image of images) {
      const response = await upload(image)
      expect(response.status).toBe(201)
      assets.push((await response.json()).asset)
    }
    const first = new URL(assets[0].previewUrl, 'http://localhost')
    const second = new URL(assets[1].previewUrl, 'http://localhost')
    first.searchParams.set('token', second.searchParams.get('token')!)
    expect((await app.request(first.pathname + first.search)).status).toBe(403)
    expect((await requestJson(app, 'GET', `/api/drafts/${draftId}/assets`, { token })).body.assets).toHaveLength(3)
  })
})
