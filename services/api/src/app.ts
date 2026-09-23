import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { validateGuideGraph, type AdsPayload, type PageKind, type PageStatus } from '@olps/domain'
import { requireAuth, resolveAccountFromToken } from './auth.js'
import { appConfig } from './config.js'
import { generatePageContent } from './generate.js'
import { getIntegrations, upsertIntegrations } from './integrations.js'
import { createJob, getJob, listRecentJobs, setJobStatus } from './jobs.js'
import {
  addDocument,
  createKnowledgeBase,
  getKnowledgeBase,
  listDocuments,
  listKnowledgeBases,
  retrieveKnowledge,
} from './knowledge.js'
import { publishPage, writePreview, writeSitemap } from './publish.js'
import { getReport, listReports, runPageReport } from './reports.js'
import {
  loginByMiniCode,
  loginByPassword,
  sendLoginCode,
  SsoLoginError,
} from './sso/siluzan-login.js'
import {
  assertTokenCanAccessTenant,
  listAiSiteTenantsForToken,
} from './tenants.js'
import {
  countInquiries,
  createSite,
  getInquiry,
  getPage,
  getSite,
  insertAnalyticsEvent,
  insertInquiry,
  insertPage,
  listInquiries,
  listPages,
  listSites,
  resendInquiryEmail,
  updateInquiryStatus,
  updatePage,
  updateSiteSettings,
} from './store.js'

export const app = new Hono()

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'X-Tenant-Id'],
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.post('/api/auth/password', async (c) => {
  const body = await c.req.json<{ account?: string; password?: string }>()
  if (!body.account?.trim() || !body.password) {
    return c.json({ error: '账号与密码必填' }, 400)
  }
  try {
    const { accessToken } = await loginByPassword({
      authority: appConfig.ssoAuthority,
      account: body.account,
      password: body.password,
      clientId: appConfig.ssoPasswordClientId,
      clientSecret: appConfig.ssoPasswordClientSecret || undefined,
      scope: appConfig.ssoPasswordScope,
    })
    return c.json({ accessToken })
  } catch (error) {
    if (error instanceof SsoLoginError) {
      return c.json({ error: error.message }, error.statusCode === 401 ? 401 : 502)
    }
    throw error
  }
})

app.post('/api/auth/phone/send', async (c) => {
  const body = await c.req.json<{ phone?: string }>()
  if (!body.phone?.trim()) return c.json({ error: '手机号必填' }, 400)
  try {
    await sendLoginCode({
      authority: appConfig.ssoAuthority,
      phone: body.phone,
    })
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof SsoLoginError) {
      return c.json({ error: error.message }, error.statusCode && error.statusCode < 500 ? error.statusCode : 502)
    }
    throw error
  }
})

app.post('/api/auth/phone/verify', async (c) => {
  const body = await c.req.json<{ phone?: string; code?: string }>()
  if (!body.phone?.trim() || !body.code?.trim()) {
    return c.json({ error: '手机号与验证码必填' }, 400)
  }
  try {
    const { accessToken } = await loginByMiniCode({
      authority: appConfig.ssoAuthority,
      phone: body.phone,
      code: body.code,
    })
    return c.json({ accessToken })
  } catch (error) {
    if (error instanceof SsoLoginError) {
      return c.json({ error: error.message }, error.statusCode === 401 ? 401 : 502)
    }
    throw error
  }
})

app.get('/api/auth/tenants', async (c) => {
  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return c.json({ error: 'Unauthorized' }, 401)
  const token = match[1]!.trim()
  try {
    const account = await resolveAccountFromToken(token)
    const tenants = await listAiSiteTenantsForToken(token)
    return c.json({
      accountId: account.accountId,
      tenants: tenants.map((t) => t.tenantId),
      tenantDetails: tenants,
    })
  } catch (error) {
    if (error instanceof SsoLoginError) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.json(
      { error: error instanceof Error ? error.message : '租户列表失败' },
      502,
    )
  }
})

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  if (c.req.path.startsWith('/api/auth/')) return next()
  if (c.req.path.startsWith('/api/public/')) return next()
  return requireAuth(c, next)
})

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  if (c.req.path.startsWith('/api/auth/')) return next()
  if (c.req.path.startsWith('/api/public/')) return next()
  const auth = c.get('auth')
  try {
    await assertTokenCanAccessTenant(auth.token, auth.tenantId)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : '租户无权访问' },
      403,
    )
  }
  await next()
})

app.get('/api/dashboard', async (c) => {
  const auth = c.get('auth')
  const sites = await listSites(auth.tenantId)
  const site = sites[0]
  if (!site) {
    return c.json({
      pagesByKind: { site: 0, content: 0, ads: 0 },
      publishedCount: 0,
      inquiryCount: 0,
      sitemapUrl: '',
      recentJobs: [],
    })
  }
  const pages = await listPages(auth.tenantId, site.siteId, {})
  const pagesByKind = { site: 0, content: 0, ads: 0 }
  let publishedCount = 0
  for (const page of pages) {
    pagesByKind[page.kind] += 1
    if (page.status === 'published') publishedCount += 1
  }
  const inquiryCount = await countInquiries(auth.tenantId, site.siteId)
  const recentJobs = await listRecentJobs(auth.tenantId, site.siteId, 10)
  const sitemapUrl = `/p/${site.tenantId}/${site.siteId}/sitemap.xml`
  return c.json({
    siteId: site.siteId,
    pagesByKind,
    publishedCount,
    inquiryCount,
    sitemapUrl,
    recentJobs,
  })
})

app.get('/api/sites', async (c) => {
  const auth = c.get('auth')
  return c.json({ sites: await listSites(auth.tenantId) })
})

app.post('/api/sites', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) throw new Error('name 必填')
  const site = await createSite(auth.tenantId, body.name.trim())
  return c.json({ site }, 201)
})

app.get('/api/sites/:siteId', async (c) => {
  const auth = c.get('auth')
  const site = await getSite(auth.tenantId, c.req.param('siteId'))
  if (!site) return c.json({ error: 'Not Found' }, 404)
  return c.json({ site })
})

app.patch('/api/sites/:siteId/settings', async (c) => {
  const auth = c.get('auth')
  const patch = await c.req.json()
  const site = await updateSiteSettings(auth.tenantId, c.req.param('siteId'), patch)
  return c.json({ site })
})

app.get('/api/sites/:siteId/pages', async (c) => {
  const auth = c.get('auth')
  const kind = c.req.query('kind') as PageKind | undefined
  const status = c.req.query('status') as PageStatus | undefined
  const pages = await listPages(auth.tenantId, c.req.param('siteId'), { kind, status })
  return c.json({ pages })
})

app.post('/api/sites/:siteId/pages', async (c) => {
  const auth = c.get('auth')
  const site = await getSite(auth.tenantId, c.req.param('siteId'))
  if (!site) return c.json({ error: '站点不存在' }, 404)
  const body = await c.req.json<{
    kind: PageKind
    title: string
    slug: string
    locale?: string
  }>()
  if (!body.kind || !body.title?.trim() || !body.slug?.trim()) {
    throw new Error('kind / title / slug 必填')
  }
  const title = body.title.trim()
  const page = await insertPage({
    tenantId: auth.tenantId,
    siteId: site.siteId,
    kind: body.kind,
    slug: body.slug.trim(),
    title,
    locale: body.locale ?? site.settings.defaultLocale,
    seo: { title, description: title },
    body: {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head><body><main><h1>${title}</h1><p>Blank page</p></main></body></html>`,
    },
  })
  return c.json({ page }, 201)
})

app.get('/api/pages/:pageId', async (c) => {
  const auth = c.get('auth')
  const page = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!page) return c.json({ error: 'Not Found' }, 404)
  return c.json({ page })
})

app.patch('/api/pages/:pageId', async (c) => {
  const auth = c.get('auth')
  const patch = await c.req.json()
  const existing = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!existing) return c.json({ error: 'Not Found' }, 404)
  if (patch.body?.ads) {
    const site = await getSite(auth.tenantId, existing.siteId)
    const validation = validateGuideGraph(patch.body.ads as AdsPayload, {
      screenCap: site!.settings.screenCap,
    })
    if (!validation.ok) return c.json({ error: 'Guide 校验失败', issues: validation.issues }, 400)
  }
  const page = await updatePage(auth.tenantId, existing.pageId, patch)
  return c.json({ page })
})

app.patch('/api/pages/:pageId/guide', async (c) => {
  const auth = c.get('auth')
  const existing = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!existing || !existing.body.ads) return c.json({ error: 'Not Found' }, 404)
  const body = await c.req.json<{ guide: AdsPayload['guide'] }>()
  const ads: AdsPayload = { ...existing.body.ads, guide: body.guide }
  const site = await getSite(auth.tenantId, existing.siteId)
  const validation = validateGuideGraph(ads, { screenCap: site!.settings.screenCap })
  if (!validation.ok) return c.json({ error: 'Guide 校验失败', issues: validation.issues }, 400)
  const page = await updatePage(auth.tenantId, existing.pageId, {
    body: { ...existing.body, ads },
  })
  return c.json({ page, validation })
})

app.post('/api/pages/:pageId/guide/validate', async (c) => {
  const auth = c.get('auth')
  const existing = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!existing || !existing.body.ads) return c.json({ error: 'Not Found' }, 404)
  const site = await getSite(auth.tenantId, existing.siteId)
  const ads = (await c.req.json<{ ads?: AdsPayload }>()).ads ?? existing.body.ads
  const validation = validateGuideGraph(ads, { screenCap: site!.settings.screenCap })
  return c.json({ validation })
})

app.post('/api/jobs/generate_page', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{
    siteId: string
    knowledgeBaseId: string
    kind: PageKind
    title: string
    slug: string
    brief?: string
    locale?: string
    keywords?: string[]
  }>()
  if (!body.knowledgeBaseId) return c.json({ error: '必须选择知识库' }, 400)
  const site = await getSite(auth.tenantId, body.siteId)
  if (!site) return c.json({ error: '站点不存在' }, 404)
  const kb = await getKnowledgeBase(auth.tenantId, body.knowledgeBaseId)
  if (!kb) return c.json({ error: '知识库不存在' }, 404)

  let job = await createJob({
    tenantId: auth.tenantId,
    siteId: site.siteId,
    type: 'generate_page',
    request: body as unknown as Record<string, unknown>,
  })
  job = await setJobStatus(auth.tenantId, job.jobId, 'running', {})

  try {
    const snippets = await retrieveKnowledge(
      auth.tenantId,
      body.knowledgeBaseId,
      `${body.title}\n${body.brief ?? ''}`,
    )
    const briefWithKb = `${body.brief ?? ''}\n\nKnowledge:\n${snippets.join('\n\n')}`
    const generated = generatePageContent({
      kind: body.kind,
      title: body.title,
      slug: body.slug,
      brief: briefWithKb,
      locale: body.locale ?? site.settings.defaultLocale,
      keywords: body.keywords,
    })
    if (generated.body.ads) {
      const validation = validateGuideGraph(generated.body.ads, {
        screenCap: site.settings.screenCap,
      })
      if (!validation.ok) {
        throw new Error(`生成结果未通过 Guide 校验: ${validation.issues.map((i) => i.message).join('; ')}`)
      }
    }
    const page = await insertPage({
      tenantId: auth.tenantId,
      siteId: site.siteId,
      kind: body.kind,
      slug: generated.slug,
      title: generated.title,
      locale: generated.locale,
      seo: generated.seo,
      body: generated.body,
    })
    const previewUrl = await writePreview(site, page)
    job = await setJobStatus(auth.tenantId, job.jobId, 'completed', {
      result: { pageId: page.pageId, previewUrl, page },
    })
    return c.json({ job, page, previewUrl }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    job = await setJobStatus(auth.tenantId, job.jobId, 'failed', { error: message })
    return c.json({ job, error: message }, 500)
  }
})

app.get('/api/jobs/:jobId', async (c) => {
  const auth = c.get('auth')
  const job = await getJob(auth.tenantId, c.req.param('jobId'))
  if (!job) return c.json({ error: 'Not Found' }, 404)
  return c.json({ job })
})

app.post('/api/pages/:pageId/publish', async (c) => {
  const auth = c.get('auth')
  const existing = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!existing) return c.json({ error: 'Not Found' }, 404)
  if (!existing.seo.title?.trim()) {
    return c.json({ error: 'SEO title 为空，拒绝发布' }, 400)
  }
  const site = await getSite(auth.tenantId, existing.siteId)
  if (!site) return c.json({ error: '站点不存在' }, 404)
  if (existing.body.ads) {
    const validation = validateGuideGraph(existing.body.ads, {
      screenCap: site.settings.screenCap,
    })
    if (!validation.ok) return c.json({ error: 'Guide 校验失败', issues: validation.issues }, 400)
  }
  const page = await updatePage(auth.tenantId, existing.pageId, {
    status: 'published',
    publishedAt: new Date().toISOString(),
  })
  const urls = await publishPage(site, page)
  const sitemapUrl = await writeSitemap(site)
  return c.json({ page, urls, sitemapUrl })
})

app.post('/api/pages/:pageId/preview', async (c) => {
  const auth = c.get('auth')
  const page = await getPage(auth.tenantId, c.req.param('pageId'))
  if (!page) return c.json({ error: 'Not Found' }, 404)
  const site = await getSite(auth.tenantId, page.siteId)
  const previewUrl = await writePreview(site!, page)
  return c.json({ previewUrl })
})

app.get('/api/knowledge-bases', async (c) => {
  const auth = c.get('auth')
  return c.json({ knowledgeBases: await listKnowledgeBases(auth.tenantId) })
})

app.post('/api/knowledge-bases', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) throw new Error('name 必填')
  const knowledgeBase = await createKnowledgeBase(auth.tenantId, body.name.trim())
  return c.json({ knowledgeBase }, 201)
})

app.get('/api/knowledge-bases/:kbId/documents', async (c) => {
  const auth = c.get('auth')
  const documents = await listDocuments(auth.tenantId, c.req.param('kbId'))
  return c.json({ documents })
})

app.post('/api/knowledge-bases/:kbId/documents', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ title?: string; content?: string }>()
  if (!body.title?.trim() || !body.content?.trim()) throw new Error('title / content 必填')
  const document = await addDocument({
    tenantId: auth.tenantId,
    kbId: c.req.param('kbId'),
    title: body.title.trim(),
    content: body.content.trim(),
  })
  return c.json({ document }, 201)
})

app.get('/api/sites/:siteId/inquiries', async (c) => {
  const auth = c.get('auth')
  const status = c.req.query('status') || undefined
  const inquiries = await listInquiries(auth.tenantId, c.req.param('siteId'), { status })
  return c.json({ inquiries })
})

app.patch('/api/inquiries/:inquiryId', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ status: string }>()
  const inquiry = await updateInquiryStatus(
    auth.tenantId,
    Number(c.req.param('inquiryId')),
    body.status,
  )
  return c.json({ inquiry })
})

app.post('/api/inquiries/:inquiryId/resend', async (c) => {
  const auth = c.get('auth')
  const result = await resendInquiryEmail(auth.tenantId, Number(c.req.param('inquiryId')))
  return c.json(result)
})

app.get('/api/sites/:siteId/integrations', async (c) => {
  const auth = c.get('auth')
  const integrations = await getIntegrations(auth.tenantId, c.req.param('siteId'))
  return c.json({ integrations })
})

app.patch('/api/sites/:siteId/integrations', async (c) => {
  const auth = c.get('auth')
  const patch = await c.req.json()
  const integrations = await upsertIntegrations(auth.tenantId, c.req.param('siteId'), patch)
  return c.json({ integrations })
})

app.post('/api/reports', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ siteId: string; pageId: string }>()
  const report = await runPageReport(auth.tenantId, body.pageId)
  return c.json({ report }, 201)
})

app.get('/api/sites/:siteId/reports', async (c) => {
  const auth = c.get('auth')
  const reports = await listReports(auth.tenantId, c.req.param('siteId'))
  return c.json({ reports })
})

app.get('/api/reports/:reportId', async (c) => {
  const auth = c.get('auth')
  const report = await getReport(auth.tenantId, c.req.param('reportId'))
  if (!report) return c.json({ error: 'Not Found' }, 404)
  return c.json({ report })
})

app.post('/api/public/:tenantId/:siteId/inquiries', async (c) => {
  const tenantId = c.req.param('tenantId')
  const siteId = c.req.param('siteId')
  const pageId = c.req.query('pageId')
  const payload = await c.req.json<Record<string, unknown>>()
  const result = await insertInquiry({ tenantId, siteId, pageId, payload })
  return c.json(result, 201)
})

app.post('/api/public/:tenantId/:siteId/events', async (c) => {
  const tenantId = c.req.param('tenantId')
  const siteId = c.req.param('siteId')
  const body = await c.req.json<{ name?: string; pageId?: string; payload?: Record<string, unknown> }>()
  if (!body.name?.trim()) throw new Error('name 必填')
  await insertAnalyticsEvent({
    tenantId,
    siteId,
    pageId: body.pageId,
    name: body.name.trim(),
    payload: body.payload ?? {},
  })
  return c.json({ ok: true }, 201)
})

app.use(
  '/p/*',
  serveStatic({
    root: appConfig.publishRoot,
    rewriteRequestPath: (p) => p.replace(/^\/p/, ''),
  }),
)

app.use(
  '/preview/*',
  serveStatic({
    root: appConfig.previewRoot,
    rewriteRequestPath: (p) => p.replace(/^\/preview/, ''),
  }),
)
