import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { appConfig } from './config.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requestHtml } from './test-support/request-html.js'
import { PREVIEW_PUBLISH_SITE_SEGMENT } from './preview-build.js'

describe('草稿预览凭据（审查 16、22）', () => {
  const testPool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await testPool.end()
  })

  async function token(account: string): Promise<string> {
    const reg = await registerUser(app, { account, password: 'preview-pass', name: account })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  function capabilityTokenFromPreviewUrl(previewUrl: string): string {
    const match = previewUrl.match(/^\/preview-access\/([^/]+)\//)
    if (!match?.[1]) {
      throw new Error(`无法解析 previewUrl: ${previewUrl}`)
    }
    return match[1]
  }

  async function writeSandboxAsset(sandboxId: string, relativePath: string, content: string): Promise<void> {
    const abs = path.join(appConfig.sandboxRoot, sandboxId, relativePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  async function createDraftWithContentPage(
    ownerToken: string,
    html: string,
    seo?: { title: string; description: string },
    slug = 'prev',
  ) {
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Preview Draft' },
    })
    expect(draft.status).toBe(201)
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'content', title: 'Prev', slug },
    })
    expect(page.status).toBe(201)
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const patch = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: {
        seo: seo ?? { title: 'Prev', description: 'Prev' },
        body: { html },
      },
    })
    expect(patch.status).toBe(200)
    return { draftId, pageId, slug }
  }

  async function issuePreviewUrl(ownerToken: string, draftId: string, pageId: string): Promise<string> {
    const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages/${pageId}/preview`, {
      token: ownerToken,
    })
    expect(preview.status).toBe(200)
    const previewUrl = String((preview.body as Record<string, unknown>).previewUrl)
    expect(previewUrl.length).toBeGreaterThan(0)
    expect(previewUrl.startsWith('/preview-access/')).toBe(true)
    return previewUrl
  }

  it('22 未携带有效凭据时不可读取已生成的永久式 /preview/draftId/pageId 路径', async () => {
    const ownerToken = await token('preview-anon-owner')
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<h1>Secret</h1>')
    await issuePreviewUrl(ownerToken, draftId, pageId)

    const guessed = `/preview/${draftId}/${pageId}/`
    const res = await requestHtml(app, 'GET', guessed)
    expect([401, 403]).toContain(res.status)
  })

  it('22 另一用户无法为他人草稿创建预览', async () => {
    const ownerToken = await token('preview-owner-only')
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<p>x</p>')

    const strangerToken = await token('preview-stranger')
    const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages/${pageId}/preview`, {
      token: strangerToken,
    })
    expect(preview.status).toBe(403)
  })

  it('16 有效 previewUrl 无 Bearer 可 HTTP 读取完整 HTML 与 SEO', async () => {
    const ownerToken = await token('preview-owner-read')
    const { draftId, pageId } = await createDraftWithContentPage(
      ownerToken,
      '<h1>Readable</h1><p>paragraph</p>',
      { title: 'SEO Readable', description: 'desc' },
    )
    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)

    const res = await requestHtml(app, 'GET', previewUrl)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Readable')
    expect(res.text).toContain('paragraph')
    expect(res.text).toMatch(/<title>\s*SEO Readable\s*<\/title>/i)
  })

  it('16 预览 HTML 内 builder assets 路径无 Bearer 可读 CSS', async () => {
    const ownerToken = await token('preview-relative-asset')
    const html =
      '<h1>Asset page</h1><link rel="stylesheet" href="/assets/css/preview-extra.css"/>'
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, html, undefined, 'assetpage')
    await writeSandboxAsset(
      draftId,
      'assets/css/preview-extra.css',
      '.olps-preview-extra-marker { color: red; }',
    )
    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)
    const capToken = capabilityTokenFromPreviewUrl(previewUrl)
    const cssPath = `/preview-access/${capToken}/s/${PREVIEW_PUBLISH_SITE_SEGMENT}/assets/css/preview-extra.css`

    const pageRes = await requestHtml(app, 'GET', previewUrl)
    expect(pageRes.status).toBe(200)
    expect(pageRes.text).toContain(cssPath)

    const cssRes = await requestHtml(app, 'GET', cssPath)
    expect(cssRes.status).toBe(200)
    expect(cssRes.contentType ?? '').toMatch(/text\/css/i)
    expect(cssRes.text).toContain('olps-preview-extra-marker')

    const anonymousCss = await requestHtml(app, 'GET', cssPath.replace(capToken, `${capToken}x`))
    expect([401, 403]).toContain(anonymousCss.status)
  })

  it('16 广告页预览 HTML 须包含 adsRuntime 运行时脚本', async () => {
    const ownerToken = await token('preview-ads-runtime')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Ads Preview' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'ads', title: 'Ads', slug: 'ads' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const { generatePageContent } = await import('./generate.js')
    const generated = generatePageContent({
      kind: 'ads',
      title: 'Ads',
      slug: 'ads',
      brief: 'brief',
      locale: 'en',
      keywords: ['kw-a', 'kw-b'],
    })
    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: { body: generated.body },
    })
    expect(patched.status).toBe(200)

    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)
    const res = await requestHtml(app, 'GET', previewUrl)
    expect(res.status).toBe(200)
    expect(res.text).toContain('id="olps-ads-data"')
    expect(res.text).toContain('data-olps-guide-float')
  })

  it('22 撤销草稿所有权后旧 previewUrl 不可访问', async () => {
    const ownerToken = await token('preview-revoke-owner')
    const collabReg = await registerUser(app, {
      account: 'preview-revoke-collab',
      password: 'preview-pass',
      name: 'collab',
    })
    expect(collabReg.status).toBe(201)
    const collabToken = collabReg.accessToken

    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<h1>Revoke</h1>')
    const add = await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: ownerToken,
      body: { account: 'preview-revoke-collab' },
    })
    expect(add.status).toBe(200)

    const previewUrl = await issuePreviewUrl(collabToken, draftId, pageId)

    const me = await requestJson(app, 'GET', '/api/auth/me', { token: collabToken })
    const collabUserId = String((me.body.user as Record<string, unknown>).userId)
    const removed = await requestJson(
      app,
      'DELETE',
      `/api/drafts/${draftId}/owners/${collabUserId}`,
      { token: ownerToken },
    )
    expect(removed.status).toBe(200)

    const afterRevoke = await requestHtml(app, 'GET', previewUrl)
    expect([401, 403]).toContain(afterRevoke.status)
  })

  it('22 注销 session 后旧 previewUrl 不可访问', async () => {
    const ownerToken = await token('preview-logout-owner')
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<h1>Logout</h1>')
    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)

    const logout = await requestJson(app, 'POST', '/api/auth/logout', { token: ownerToken })
    expect(logout.status).toBe(200)

    const afterLogout = await requestHtml(app, 'GET', previewUrl)
    expect([401, 403]).toContain(afterLogout.status)
  })

  it('22 路径参数编码越界不可读取 preview 目录外或 source/.git', async () => {
    const ownerToken = await token('preview-traversal')
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<h1>Safe</h1>')
    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)
    const capToken = capabilityTokenFromPreviewUrl(previewUrl)

    const sandboxMarker = path.join(appConfig.sandboxRoot, draftId, 'source', 'olps-traversal-marker.txt')
    await fs.mkdir(path.dirname(sandboxMarker), { recursive: true })
    await fs.writeFile(sandboxMarker, 'sandbox-secret', 'utf8')

    const attempts = [
      `/preview/${draftId}/${pageId}/`,
      `/preview-access/${capToken}/%2e%2e%2f%2e%2e%2fsource%2folps-traversal-marker.txt`,
      `/preview-access/${capToken}/s/${PREVIEW_PUBLISH_SITE_SEGMENT}/%2e%2e%2fsource%2folps-traversal-marker.txt`,
    ]
    for (const attempt of attempts) {
      const res = await requestHtml(app, 'GET', attempt)
      expect([401, 403, 404]).toContain(res.status)
      expect(res.text).not.toContain('sandbox-secret')
    }
  })

  it('22 凭据过期后 previewUrl 不可访问', async () => {
    process.env.PREVIEW_CREDENTIAL_TTL_SECONDS = '1'
    const ownerToken = await token('preview-expiry')
    const { draftId, pageId } = await createDraftWithContentPage(ownerToken, '<h1>Expire</h1>')
    const previewUrl = await issuePreviewUrl(ownerToken, draftId, pageId)

    await new Promise((resolve) => setTimeout(resolve, 1500))

    const expired = await requestHtml(app, 'GET', previewUrl)
    expect([401, 403]).toContain(expired.status)
  })
})
