import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { getDraftPageForUser, saveGeneratedDraftPageUnlocked } from './drafts-service.js'
import { withDraftLock } from './draft-lock.js'

describe('页面语言与 SEO 配置保存', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())
  it('语言关联及 SEO 在读取和列表中保留', async () => {
    const user = await registerUser(app, { account: 'metadata-owner', password: 'metadata-password', name: 'Owner' })
    const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
    const draft = await call('POST', '/api/drafts', { name: 'Metadata' })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const result = await call('POST', `/api/drafts/${draftId}/pages`, { kind: 'site', title: 'Home', slug: 'home', locale: 'en', translationGroupId: 'home-group' })
    const page = result.body.page as Record<string, unknown>
    expect(page.translationGroupId).toBe('home-group')
    const patched = await call('PATCH', `/api/drafts/${draftId}/pages/${page.pageId}`, { locale: 'zh-CN', translationGroupId: 'home-group', seo: { title: '首页', description: '产品介绍', image: '/assets/product.png', robots: 'index,follow' } })
    expect(patched.status).toBe(200)
    const listed = await call('GET', `/api/drafts/${draftId}/pages`)
    const saved = (listed.body.pages as Array<Record<string, unknown>>)[0]
    expect(saved.locale).toBe('zh-CN')
    expect(saved.translationGroupId).toBe('home-group')
    expect((saved.seo as Record<string, unknown>).robots).toBe('index,follow')
  })
  it('草稿状态写入失败时改写保留原页面', async () => {
    const user = await registerUser(app, { account: 'atomic-owner', password: 'metadata-password', name: 'Owner' })
    const draft = await requestJson(app, 'POST', '/api/drafts', { token: user.accessToken, body: { name: 'Atomic' } })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const created = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token: user.accessToken, body: { kind: 'content', title: 'Original', slug: 'original' } })
    const pageId = String((created.body.page as Record<string, unknown>).pageId)
    const userId = String(user.user.userId)
    const before = (await getDraftPageForUser(userId, draftId, pageId))!
    await pool.query(`CREATE FUNCTION reject_draft_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'state write unavailable'; END $$`)
    await pool.query(`CREATE TRIGGER reject_draft_state BEFORE UPDATE ON site_drafts FOR EACH ROW EXECUTE FUNCTION reject_draft_state()`)
    await expect(withDraftLock(draftId, () => saveGeneratedDraftPageUnlocked(userId,draftId,{
      kind: 'content', operation: 'rewrite', sourcePageId: pageId, expectedUpdatedAt: before.updatedAt,
      generated: { title: 'Updated', slug: 'original', locale: 'en', seo: { title: 'Updated', description: 'Updated' }, body: { html: '<main><h1>Updated</h1><p>Updated content.</p></main>' } }, generation: {},
    }))).rejects.toThrow('state write unavailable')
    expect(await getDraftPageForUser(userId,draftId,pageId)).toEqual(before)
  })
  it('改写保留页面身份、语言关联和 SEO 收录设置', async () => {
    const user = await registerUser(app, { account: 'rewrite-metadata', password: 'metadata-password', name: 'Owner' })
    const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
    const draft = await call('POST', '/api/drafts', { name: 'Rewrite metadata' })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const created = await call('POST', `/api/drafts/${draftId}/pages`, { kind: 'content', title: 'Original', slug: 'original', translationGroupId: 'original-group' })
    const pageId = String((created.body.page as Record<string, unknown>).pageId)
    await call('PATCH', `/api/drafts/${draftId}/pages/${pageId}`, { seo: { title: 'Original', description: 'Original', robots: 'noindex,nofollow', canonical: 'https://example.org/article' } })
    const before = (await getDraftPageForUser(String(user.user.userId), draftId, pageId))!
    const updated = await withDraftLock(draftId, () => saveGeneratedDraftPageUnlocked(String(user.user.userId), draftId, {
      kind: 'content', operation: 'rewrite', sourcePageId: pageId, expectedUpdatedAt: before.updatedAt,
      generated: { title: 'Updated', slug: 'original', locale: 'en', seo: { title: 'Updated', description: 'Updated description' }, body: { html: '<main><h1>Updated</h1><p>Updated content.</p></main>' } }, generation: { jobId: 'rewrite-metadata-job' },
    }))
    expect(updated.pageId).toBe(pageId)
    expect(updated.locale).toBe(before.locale)
    expect(updated.translationGroupId).toBe('original-group')
    expect(updated.seo).toMatchObject({ title: 'Updated', description: 'Updated description', robots: 'noindex,nofollow', canonical: 'https://example.org/article' })
    expect(await getDraftPageForUser(String(user.user.userId), draftId, pageId)).toMatchObject({ seo: updated.seo, metadata: { generation: { jobId: 'rewrite-metadata-job' } } })
  })
  it('翻译保存目标页面与源页面关联，并拒绝过期源版本', async () => {
    const user = await registerUser(app, { account: 'translation-save', password: 'metadata-password', name: 'Owner' })
    const userId = String(user.user.userId)
    const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
    const draft = await call('POST', '/api/drafts', { name: 'Translation save' })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const created = await call('POST', `/api/drafts/${draftId}/pages`, { kind: 'content', title: 'Source', slug: 'source', locale: 'en' })
    const pageId = String((created.body.page as Record<string, unknown>).pageId)
    const before = (await getDraftPageForUser(userId, draftId, pageId))!
    const input = {
      kind: 'content' as const, operation: 'translate' as const, sourcePageId: pageId, expectedUpdatedAt: before.updatedAt,
      generated: { title: 'Traduction', slug: 'traduction', locale: 'fr', seo: { title: 'Traduction', description: 'Description française' }, body: { html: '<main><h1>Traduction</h1><p>Présentation du produit.</p></main>' } }, generation: { jobId: 'translation-job' },
    }
    const translated = await withDraftLock(draftId, () => saveGeneratedDraftPageUnlocked(userId, draftId, input))
    expect(translated.pageId).not.toBe(pageId)
    expect(translated).toMatchObject({ locale: 'fr', translationGroupId: pageId, metadata: { generation: { jobId: 'translation-job' } } })
    const source = (await getDraftPageForUser(userId, draftId, pageId))!
    expect(source.translationGroupId).toBe(pageId)
    expect(source.body).toEqual(before.body)
    expect(source.updatedAt).not.toBe(before.updatedAt)
    await expect(withDraftLock(draftId, () => saveGeneratedDraftPageUnlocked(userId, draftId, input))).rejects.toThrow('PAGE_VERSION_CONFLICT')
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM pages WHERE draft_id=$1', [draftId])
    expect(count.rows[0].count).toBe(2)
  })
})
