import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requestHtml } from './test-support/request-html.js'

// 这些用例真实调用 AI_BASE_URL 指向的模型接口，需要根目录 .env 中的 AI_API_KEY
const AI_TEST_TIMEOUT_MS = 900_000

type PageJson = {
  pageId: string
  kind: string
  slug: string
  seo: { title: string; description: string }
  body: { html: string }
}

describe('AI 生成与修改页面（真实模型接口）', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function setupDraft(account: string): Promise<{ token: string; draftId: string }> {
    const reg = await registerUser(app, { account, password: 'ai-pass', name: account })
    expect(reg.status).toBe(201)
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: reg.accessToken,
      body: { name: 'AI Draft' },
    })
    expect(draft.status).toBe(201)
    return { token: reg.accessToken, draftId: String((draft.body.draft as Record<string, unknown>).draftId) }
  }

  async function generate(
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; job: Record<string, unknown>; page: PageJson }> {
    const res = await requestJson(app, 'POST', '/api/jobs/generate_page', { token, body })
    return {
      status: res.status,
      job: res.body.job as Record<string, unknown>,
      page: res.body.page as PageJson,
    }
  }

  it(
    '生成联系页与内容页、按指令修改，结果写入草稿并可预览',
    async () => {
      const { token, draftId } = await setupDraft('ai-generate')

      const contact = await generate(token, {
        draftId,
        kind: 'site',
        title: 'Contact Us',
        slug: 'contact',
        brief: 'Contact page for a stainless steel pipe supplier. Include an inquiry form so visitors can send us a message.',
      })
      expect(contact.status).toBe(201)
      expect(contact.job.status).toBe('completed')
      expect(contact.job.type).toBe('generate_page')
      expect(contact.page.kind).toBe('site')
      expect(contact.page.slug).toBe('contact')
      expect(contact.page.seo.title.trim()).not.toBe('')
      expect(contact.page.seo.description.trim()).not.toBe('')
      const contactHtml = contact.page.body.html
      expect(contactHtml).toMatch(/<html[\s>]/i)
      expect(contactHtml).toMatch(/name="viewport"/i)
      expect(contactHtml.match(/<h1[\s>]/gi)?.length).toBe(1)
      expect(contactHtml).toContain('data-olps-inquiry')
      expect(contactHtml).toContain('data-olps-inquiry-status')
      expect(contactHtml).not.toMatch(/<script[\s>]/i)

      const product = await generate(token, {
        draftId,
        kind: 'content',
        title: '304 Stainless Steel Pipes',
        slug: 'stainless-304',
        brief: 'Product detail page for 304 stainless steel pipes: sizes, applications and advantages. End the page with a link to the Contact Us page.',
      })
      expect(product.status).toBe(201)
      expect(product.page.kind).toBe('content')
      expect(product.page.body.html).toContain('../contact/')

      const pages = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages`, { token })
      expect((pages.body.pages as PageJson[]).map((p) => p.slug).sort()).toEqual(['contact', 'stainless-304'])

      const revisedHeading = 'Premium 304 Stainless Steel Pipes'
      const revised = await requestJson(app, 'POST', '/api/jobs/revise_page', {
        token,
        body: {
          draftId,
          pageId: product.page.pageId,
          instruction: `Change the text of the h1 heading to exactly "${revisedHeading}". Keep everything else unchanged.`,
        },
      })
      expect(revised.status).toBe(201)
      const revisedJob = revised.body.job as Record<string, unknown>
      expect(revisedJob.type).toBe('revise_page')
      expect(revisedJob.status).toBe('completed')
      const revisedPage = revised.body.page as PageJson
      expect(revisedPage.pageId).toBe(product.page.pageId)
      expect(revisedPage.body.html).toContain(revisedHeading)

      const stored = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages/${product.page.pageId}`, { token })
      expect(stored.status).toBe(200)
      expect((stored.body.page as PageJson).body.html).toContain(revisedHeading)

      const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages/${contact.page.pageId}/preview`, {
        token,
      })
      expect(preview.status).toBe(200)
      const previewRes = await requestHtml(app, 'GET', String(preview.body.previewUrl))
      expect(previewRes.status).toBe(200)
      expect(previewRes.text).toContain('data-olps-inquiry')
      expect(previewRes.text).toMatch(/<script[\s>]/i)
    },
    AI_TEST_TIMEOUT_MS,
  )

  it('revise_page 指向不存在的页面返回 404 并记录 failed Job', async () => {
    const { token, draftId } = await setupDraft('ai-revise-missing')
    const res = await requestJson(app, 'POST', '/api/jobs/revise_page', {
      token,
      body: { draftId, pageId: 'missing-page', instruction: 'Make it shorter.' },
    })
    expect(res.status).toBe(404)
    const jobs = await pool.query(`SELECT type, status FROM jobs WHERE draft_id=$1`, [draftId])
    expect(jobs.rows).toEqual([{ type: 'revise_page', status: 'failed' }])
  })

  it('generate_page 缺少 brief 或 kind 无效时返回 400 且不创建 Job', async () => {
    const { token, draftId } = await setupDraft('ai-generate-invalid')
    const noBrief = await generate(token, { draftId, kind: 'content', title: 'T', slug: 't' })
    expect(noBrief.status).toBe(400)
    const badKind = await generate(token, { draftId, kind: 'landing', title: 'T', slug: 't', brief: 'b' })
    expect(badKind.status).toBe(400)
    const jobs = await pool.query(`SELECT COUNT(*)::int AS c FROM jobs WHERE draft_id=$1`, [draftId])
    expect(Number(jobs.rows[0]!.c)).toBe(0)
  })
})
