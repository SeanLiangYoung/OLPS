import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { verifyPassword } from './password.js'
import { createUser, findUserByAccount } from './users.js'
import { createAccessToken, createSession, deleteSessionByToken } from './sessions.js'
import {
  continueDraft,
  createDraft,
  createDraftPage,
  getDraftForUser,
  getDraftPageForUser,
  listDraftPages,
  listDraftsForUser,
  patchDraftPageForUser,
  patchDraftSettings,
  pullDraft,
  pushDraft,
} from './drafts-service.js'
import { DRAFT_ORDINARY_EDIT_BLOCKED } from './draft-ordinary-edit-guard.js'
import {
  addDraftOwner,
  addSiteOwner,
  listDraftOwners,
  listSiteOwners,
  removeDraftOwner,
  removeSiteOwner,
} from './collaboration-owners.js'
import {
  listSitesForUser,
  getSiteForUser,
  listPublishedSitePages,
  getSiteIntegrations,
  patchSiteIntegrations,
  getDraftIntegrations,
  patchDraftIntegrations,
  listSiteInquiries,
  updateInquiryStatus,
  resendInquiryEmail,
} from './collaboration-sites.js'
import {
  createKnowledgeBase,
  listKnowledgeBases,
  addDocument,
  listDocuments,
  grantKbAccess,
} from './collaboration-knowledge.js'
import { runGeneratePageJob, runRevisePageJob, getJob } from './collaboration-jobs.js'
import {
  createReport,
  listDraftReports,
  listSiteReports,
  getReport,
  getDraftReport,
} from './collaboration-reports.js'
import { insertPublicInquiry, insertAnalyticsEvent } from './collaboration-public.js'
import { buildDraftDashboard, buildUserDashboard } from './collaboration-dashboard.js'
import { listDraftInquiries } from './collaboration-draft-history.js'
import { previewDraftPage } from './page-routes.js'
import { resolvePreviewCapability } from './preview-capability-store.js'
import { readPreviewCapabilityFile } from './preview-serve.js'
import { resolveSessionFromToken } from './sessions.js'
import type { PageKind, SiteSettings } from '@olps/domain'

type AppEnv = { Variables: AuthVariables }

function isPageKind(value: string): value is PageKind {
  return value === 'site' || value === 'content'
}

export const app = new Hono<AppEnv>()

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type'],
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{ account?: string; password?: string; name?: string }>()
  const account = body.account?.trim()
  const password = body.password ?? ''
  const name = body.name?.trim() || account
  if (!account || !password) {
    return c.json({ error: 'account 与 password 必填' }, 400)
  }
  const existing = await findUserByAccount(account)
  if (existing) {
    return c.json({ error: '账号已存在' }, 409)
  }
  const user = await createUser({ account, password, name })
  const accessToken = createAccessToken()
  await createSession(user.userId, accessToken)
  return c.json({ accessToken, user }, 201)
})

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ account?: string; password?: string }>()
  const account = body.account?.trim()
  const password = body.password ?? ''
  if (!account || !password) {
    return c.json({ error: 'account 与 password 必填' }, 400)
  }
  const record = await findUserByAccount(account)
  if (!record || !verifyPassword(password, record.passwordHash)) {
    return c.json({ error: '账号或密码错误' }, 401)
  }
  const accessToken = createAccessToken()
  await createSession(record.userId, accessToken)
  const { passwordHash: _ph, ...user } = record
  return c.json({ accessToken, user })
})

app.get('/api/auth/me', requireAuth, (c) => {
  return c.json({ user: getAuthUser(c) })
})

app.post('/api/auth/logout', requireAuth, async (c) => {
  const token = c.get('accessToken')
  await deleteSessionByToken(token)
  return c.json({ ok: true })
})

app.post('/api/public/:siteId/inquiries', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>()
  const pageId = c.req.query('pageId')?.trim() || undefined
  try {
    const out = await insertPublicInquiry(c.req.param('siteId'), payload, pageId)
    return c.json({ inquiryId: out.inquiryId }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_PAGE_ID') {
      return c.json({ error: 'pageId 不属于已发布网站' }, 400)
    }
    throw err
  }
})

app.post('/api/public/:siteId/events', async (c) => {
  const body = await c.req.json<{ name?: string; pageId?: string; payload?: Record<string, unknown> }>()
  if (!body.name) return c.json({ error: 'name 必填' }, 400)
  try {
    await insertAnalyticsEvent(
      c.req.param('siteId'),
      body.name,
      body.payload ?? {},
      body.pageId?.trim() || undefined,
    )
    return c.json({ ok: true }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_PAGE_ID') {
      return c.json({ error: 'pageId 不属于已发布网站' }, 400)
    }
    throw err
  }
})

app.get('/preview/:draftId/:pageId/*', (c) => {
  return c.json({ error: '预览路径已关闭，请通过 API 获取 previewUrl' }, 403)
})

app.get('/preview-access/:token/*', async (c) => {
  const rawToken = c.req.param('token')
  const capability = await resolvePreviewCapability(rawToken)
  if (!capability) {
    return c.json({ error: '预览凭据无效或已过期' }, 403)
  }
  const prefix = `/preview-access/${rawToken}/`
  const subPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : (c.req.param('*') ?? '')
  try {
    const file = await readPreviewCapabilityFile(
      capability.capabilityId,
      subPath || `${capability.entryRoute || capability.pageSlug}/`,
    )
    const body = new Uint8Array(file.content)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'PREVIEW_FORBIDDEN') {
      return c.json({ error: '无权访问该预览资源' }, 403)
    }
    if (err instanceof Error && err.message === 'PREVIEW_NOT_FOUND') {
      return c.json({ error: '预览资源不存在' }, 404)
    }
    throw err
  }
})

const authed = new Hono<AppEnv>()
authed.use('*', requireAuth)

authed.get('/api/sites', async (c) => {
  const sites = await listSitesForUser(getAuthUser(c).userId)
  return c.json({ sites })
})

authed.get('/api/sites/:siteId', async (c) => {
  const site = await getSiteForUser(getAuthUser(c).userId, c.req.param('siteId'))
  if (!site) return c.json({ error: '无权访问或站点不存在' }, 403)
  return c.json({ site })
})

authed.get('/api/sites/:siteId/pages', async (c) => {
  const status = c.req.query('status') as import('@olps/domain').PageStatus | undefined
  try {
    const pages = await listPublishedSitePages(getAuthUser(c).userId, c.req.param('siteId'), {
      status,
    })
    return c.json({ pages })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/sites/:siteId/owners', async (c) => {
  try {
    const users = await listSiteOwners(getAuthUser(c).userId, c.req.param('siteId'))
    return c.json({ users })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/sites/:siteId/owners', async (c) => {
  const body = await c.req.json<{ account?: string }>()
  if (!body.account?.trim()) return c.json({ error: 'account 必填' }, 400)
  try {
    await addSiteOwner(getAuthUser(c).userId, c.req.param('siteId'), body.account.trim())
    const users = await listSiteOwners(getAuthUser(c).userId, c.req.param('siteId'))
    return c.json({ users })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.delete('/api/sites/:siteId/owners/:userId', async (c) => {
  try {
    await removeSiteOwner(getAuthUser(c).userId, c.req.param('siteId'), c.req.param('userId'))
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'LAST_SITE_OWNER') {
      return c.json({ error: '不能移除最后一名网站所有者' }, 409)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts', async (c) => {
  const drafts = await listDraftsForUser(getAuthUser(c).userId)
  return c.json({ drafts })
})

authed.post('/api/drafts', async (c) => {
  const body = await c.req.json<{ name?: string; siteId?: string | null }>()
  if (!body.name?.trim()) return c.json({ error: 'name 必填' }, 400)
  try {
    const draft = await createDraft({
      userId: getAuthUser(c).userId,
      name: body.name.trim(),
      siteId: body.siteId ?? null,
    })
    return c.json({ draft }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN_SITE') {
      return c.json({ error: '无权基于该站点创建草稿' }, 403)
    }
    throw err
  }
})

authed.get('/api/drafts/:draftId', async (c) => {
  const draft = await getDraftForUser(getAuthUser(c).userId, c.req.param('draftId'))
  if (!draft) return c.json({ error: '无权访问' }, 403)
  return c.json({ draft })
})

authed.patch('/api/drafts/:draftId/settings', async (c) => {
  const patch = await c.req.json<Partial<SiteSettings>>()
  try {
    const draft = await patchDraftSettings(getAuthUser(c).userId, c.req.param('draftId'), patch)
    return c.json({ draft })
  } catch (err) {
    if (err instanceof Error && err.message === DRAFT_ORDINARY_EDIT_BLOCKED) {
      return c.json({ error: '草稿处于冲突或同步处理中，无法编辑' }, 409)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/inquiries', async (c) => {
  try {
    const inquiries = await listDraftInquiries(getAuthUser(c).userId, c.req.param('draftId'), {
      status: c.req.query('status') ?? undefined,
    })
    return c.json({ inquiries })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/reports', async (c) => {
  try {
    const reports = await listDraftReports(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json({ reports })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/reports/:reportId', async (c) => {
  try {
    const report = await getDraftReport(
      getAuthUser(c).userId,
      c.req.param('draftId'),
      c.req.param('reportId'),
    )
    if (!report) return c.json({ error: '不存在' }, 404)
    return c.json({ report })
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    throw err
  }
})

authed.get('/api/drafts/:draftId/integrations', async (c) => {
  try {
    const integrations = await getDraftIntegrations(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json({ integrations })
  } catch (err) {
    if (err instanceof Error && err.message === 'INTEGRATION_ADS_ACCOUNT_REQUIRED') {
      return c.json({ error: '启用 Google Ads 时必须填写 adsAccountId' }, 400)
    }
    if (err instanceof Error && err.message === 'INTEGRATION_GA_PROPERTY_REQUIRED') {
      return c.json({ error: '启用 GA 时必须填写 gaPropertyId' }, 400)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.patch('/api/drafts/:draftId/integrations', async (c) => {
  const patch = await c.req.json<{
    adsAccountId?: string
    adsConnected?: boolean
    gaPropertyId?: string
    gaConnected?: boolean
  }>()
  try {
    const integrations = await patchDraftIntegrations(
      getAuthUser(c).userId,
      c.req.param('draftId'),
      patch,
    )
    return c.json({ integrations })
  } catch (err) {
    if (err instanceof Error && err.message === 'INTEGRATION_ADS_ACCOUNT_REQUIRED') {
      return c.json({ error: '启用 Google Ads 时必须填写 adsAccountId' }, 400)
    }
    if (err instanceof Error && err.message === 'INTEGRATION_GA_PROPERTY_REQUIRED') {
      return c.json({ error: '启用 GA 时必须填写 gaPropertyId' }, 400)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/dashboard', async (c) => {
  try {
    const data = await buildDraftDashboard(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json(data)
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/owners', async (c) => {
  try {
    const users = await listDraftOwners(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json({ users })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/drafts/:draftId/owners', async (c) => {
  const body = await c.req.json<{ account?: string }>()
  if (!body.account?.trim()) return c.json({ error: 'account 必填' }, 400)
  try {
    await addDraftOwner(getAuthUser(c).userId, c.req.param('draftId'), body.account.trim())
    const users = await listDraftOwners(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json({ users })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.delete('/api/drafts/:draftId/owners/:userId', async (c) => {
  try {
    await removeDraftOwner(
      getAuthUser(c).userId,
      c.req.param('draftId'),
      c.req.param('userId'),
    )
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'LAST_DRAFT_OWNER') {
      return c.json({ error: '不能移除最后一名草稿所有者' }, 409)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/drafts/:draftId/pull', async (c) => {
  const draftId = c.req.param('draftId')
  const userId = getAuthUser(c).userId
  try {
    const result = await pullDraft(userId, draftId)
    if (result.httpStatus === 409) {
      return c.json({ draft: result.draft, error: '同步冲突或来源不可用' }, 409)
    }
    if (result.httpStatus !== 200) {
      return c.json(
        { draft: result.draft, error: result.error ?? '同步失败' },
        result.httpStatus as ContentfulStatusCode,
      )
    }
    return c.json({ draft: result.draft }, result.httpStatus as ContentfulStatusCode)
  } catch (err) {
    if (err instanceof Error && err.message === 'PULL_NO_REMOTE_SOURCE') {
      return c.json({ error: '草稿尚未关联已发布站点或远端来源' }, 409)
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    throw err
  }
})

authed.post('/api/drafts/:draftId/push', async (c) => {
  const draftId = c.req.param('draftId')
  const userId = getAuthUser(c).userId
  const body: { remoteSiteId?: string } = await c.req
    .json<{ remoteSiteId?: string }>()
    .catch(() => ({}))
  if (body.remoteSiteId !== undefined) {
    return c.json({ error: '不允许客户端指定 remoteSiteId' }, 400)
  }
  try {
    const result = await pushDraft(userId, draftId)
    if (result.httpStatus === 403) {
      return c.json({ error: '无权向远端发布' }, 403)
    }
    if (result.httpStatus !== 200) {
      return c.json(
        { draft: result.draft, error: result.error ?? '同步失败' },
        result.httpStatus as ContentfulStatusCode,
      )
    }
    return c.json({ draft: result.draft, site: result.site })
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN_PUBLISH') {
      return c.json({ error: '无权向远端发布' }, 403)
    }
    if (err instanceof Error && err.message.includes('远端 push 失败')) {
      return c.json({ error: err.message }, 500)
    }
    throw err
  }
})

authed.post('/api/drafts/:draftId/continue', async (c) => {
  const draftId = c.req.param('draftId')
  const body = await c.req.json<{ userMessage?: string }>()
  if (!body.userMessage?.trim()) {
    return c.json({ error: 'userMessage 必填' }, 400)
  }
  try {
    const result = await continueDraft(getAuthUser(c).userId, draftId, body.userMessage!.trim())
    return c.json({ draft: result.draft }, result.httpStatus as ContentfulStatusCode)
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    throw err
  }
})

authed.get('/api/drafts/:draftId/pages', async (c) => {
  try {
    const pages = await listDraftPages(getAuthUser(c).userId, c.req.param('draftId'))
    return c.json({ pages })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/drafts/:draftId/pages', async (c) => {
  const body = await c.req.json<{ kind?: string; title?: string; slug?: string; locale?: string }>()
  if (!body.kind || !body.title?.trim() || !body.slug?.trim()) {
    return c.json({ error: 'kind、title、slug 必填' }, 400)
  }
  if (!isPageKind(body.kind)) {
    return c.json({ error: `kind 无效: ${body.kind}` }, 400)
  }
  try {
    const page = await createDraftPage(getAuthUser(c).userId, c.req.param('draftId'), {
      kind: body.kind,
      title: body.title.trim(),
      slug: body.slug.trim(),
      locale: body.locale,
    })
    return c.json({ page }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === DRAFT_ORDINARY_EDIT_BLOCKED) {
      return c.json({ error: '草稿处于冲突或同步处理中，无法编辑' }, 409)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/drafts/:draftId/pages/:pageId', async (c) => {
  const page = await getDraftPageForUser(
    getAuthUser(c).userId,
    c.req.param('draftId'),
    c.req.param('pageId'),
  )
  if (!page) return c.json({ error: '无权访问或页面不存在' }, 403)
  return c.json({ page })
})

authed.patch('/api/drafts/:draftId/pages/:pageId', async (c) => {
  const patch = await c.req.json<{
    title?: string
    slug?: string
    seo?: import('@olps/domain').SeoFields
    body?: import('@olps/domain').PageBody
  }>()
  try {
    const page = await patchDraftPageForUser(
      getAuthUser(c).userId,
      c.req.param('draftId'),
      c.req.param('pageId'),
      patch,
    )
    return c.json({ page })
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return c.json({ error: '页面不存在' }, 404)
    }
    if (err instanceof Error && err.message === 'SANDBOX_PAGE_MISSING') {
      return c.json({ error: 'sandbox 缺少页面文件' }, 404)
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    if (err instanceof Error && err.message === DRAFT_ORDINARY_EDIT_BLOCKED) {
      return c.json({ error: '草稿处于冲突或同步处理中，无法编辑' }, 409)
    }
    throw err
  }
})

authed.post('/api/drafts/:draftId/pages/:pageId/preview', async (c) => {
  const accessToken = c.get('accessToken')
  const session = await resolveSessionFromToken(accessToken)
  if (!session) {
    return c.json({ error: '会话无效或已过期' }, 401)
  }
  try {
    const previewUrl = await previewDraftPage(
      getAuthUser(c).userId,
      session.sessionId,
      c.req.param('draftId'),
      c.req.param('pageId'),
    )
    return c.json({ previewUrl })
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return c.json({ error: '页面不存在' }, 404)
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    if (
      err instanceof Error &&
      (err.message === 'PREVIEW_PUBLISH_CONFIG_MISSING' ||
        err.message === 'PREVIEW_PUBLISH_CONFIG_INVALID')
    ) {
      return c.json({ error: 'publish-config 缺失或无效' }, 400)
    }
    if (err instanceof Error && err.message === 'PREVIEW_BUILD_FAILED') {
      return c.json({ error: '预览构建失败' }, 400)
    }
    return c.json({ error: '预览生成失败' }, 500)
  }
})

authed.get('/api/knowledge-bases', async (c) => {
  const knowledgeBases = await listKnowledgeBases(getAuthUser(c).userId)
  return c.json({ knowledgeBases })
})

authed.post('/api/knowledge-bases', async (c) => {
  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name 必填' }, 400)
  const knowledgeBase = await createKnowledgeBase(getAuthUser(c).userId, body.name.trim())
  return c.json({ knowledgeBase }, 201)
})

authed.get('/api/knowledge-bases/:kbId/documents', async (c) => {
  try {
    const documents = await listDocuments(getAuthUser(c).userId, c.req.param('kbId'))
    return c.json({ documents })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/knowledge-bases/:kbId/documents', async (c) => {
  const body = await c.req.json<{ title?: string; content?: string }>()
  try {
    const doc = await addDocument(getAuthUser(c).userId, c.req.param('kbId'), {
      title: body.title?.trim() ?? '',
      content: body.content ?? '',
    })
    return c.json({ document: doc }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    return c.json({ error: String(err) }, 400)
  }
})

authed.post('/api/knowledge-bases/:kbId/grants', async (c) => {
  const body = await c.req.json<{ account?: string }>()
  if (!body.account?.trim()) return c.json({ error: 'account 必填' }, 400)
  try {
    await grantKbAccess(getAuthUser(c).userId, c.req.param('kbId'), body.account.trim())
    return c.json({ ok: true })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/jobs/generate_page', async (c) => {
  const body = await c.req.json<{
    draftId?: string
    knowledgeBaseId?: string
    kind?: string
    title?: string
    slug?: string
    brief?: string
  }>()
  if (!body.draftId || !body.kind || !body.title?.trim() || !body.slug?.trim() || !body.brief?.trim()) {
    return c.json({ error: 'draftId、kind、title、slug、brief 必填' }, 400)
  }
  if (!isPageKind(body.kind)) {
    return c.json({ error: `kind 无效: ${body.kind}` }, 400)
  }
  try {
    const out = await runGeneratePageJob({
      userId: getAuthUser(c).userId,
      draftId: body.draftId,
      knowledgeBaseId: body.knowledgeBaseId?.trim() || undefined,
      kind: body.kind,
      title: body.title.trim(),
      slug: body.slug.trim(),
      brief: body.brief.trim(),
    })
    return c.json(out, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    if (err instanceof Error && err.message === DRAFT_ORDINARY_EDIT_BLOCKED) {
      return c.json({ error: '草稿处于冲突或同步处理中，无法编辑' }, 409)
    }
    throw err
  }
})

authed.post('/api/jobs/revise_page', async (c) => {
  const body = await c.req.json<{ draftId?: string; pageId?: string; instruction?: string }>()
  if (!body.draftId || !body.pageId || !body.instruction?.trim()) {
    return c.json({ error: 'draftId、pageId、instruction 必填' }, 400)
  }
  try {
    const out = await runRevisePageJob({
      userId: getAuthUser(c).userId,
      draftId: body.draftId,
      pageId: body.pageId,
      instruction: body.instruction.trim(),
    })
    return c.json(out, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return c.json({ error: '页面不存在' }, 404)
    }
    if (err instanceof Error && err.message === DRAFT_ORDINARY_EDIT_BLOCKED) {
      return c.json({ error: '草稿处于冲突或同步处理中，无法编辑' }, 409)
    }
    throw err
  }
})

authed.get('/api/jobs/:jobId', async (c) => {
  const job = await getJob(getAuthUser(c).userId, c.req.param('jobId'))
  if (!job) return c.json({ error: '不存在' }, 404)
  return c.json({ job })
})

authed.get('/api/sites/:siteId/inquiries', async (c) => {
  try {
    const inquiries = await listSiteInquiries(getAuthUser(c).userId, c.req.param('siteId'), {
      status: c.req.query('status') ?? undefined,
    })
    return c.json({ inquiries })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.patch('/api/inquiries/:inquiryId', async (c) => {
  const body = await c.req.json<{ status?: string }>()
  if (!body.status) return c.json({ error: 'status 必填' }, 400)
  try {
    await updateInquiryStatus(getAuthUser(c).userId, Number(c.req.param('inquiryId')), body.status)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

authed.post('/api/inquiries/:inquiryId/resend', async (c) => {
  try {
    const out = await resendInquiryEmail(getAuthUser(c).userId, Number(c.req.param('inquiryId')))
    return c.json(out)
  } catch (err) {
    return c.json({ error: String(err) }, 400)
  }
})

authed.get('/api/sites/:siteId/integrations', async (c) => {
  try {
    const integrations = await getSiteIntegrations(getAuthUser(c).userId, c.req.param('siteId'))
    return c.json({ integrations })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.patch('/api/sites/:siteId/integrations', async (c) => {
  const patch = await c.req.json<{
    adsAccountId?: string
    adsConnected?: boolean
    gaPropertyId?: string
    gaConnected?: boolean
  }>()
  try {
    const integrations = await patchSiteIntegrations(
      getAuthUser(c).userId,
      c.req.param('siteId'),
      patch,
    )
    return c.json({ integrations })
  } catch (err) {
    if (err instanceof Error && err.message === 'INTEGRATION_ADS_ACCOUNT_REQUIRED') {
      return c.json({ error: '启用 Google Ads 时必须填写 adsAccountId' }, 400)
    }
    if (err instanceof Error && err.message === 'INTEGRATION_GA_PROPERTY_REQUIRED') {
      return c.json({ error: '启用 GA 时必须填写 gaPropertyId' }, 400)
    }
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.post('/api/reports', async (c) => {
  const body = await c.req.json<{ siteId?: string; draftId?: string; pageId?: string }>()
  if (!body.draftId?.trim() || !body.pageId?.trim()) {
    return c.json({ error: 'draftId、pageId 必填' }, 400)
  }
  try {
    const report = await createReport({
      userId: getAuthUser(c).userId,
      draftId: body.draftId.trim(),
      pageId: body.pageId.trim(),
      siteId: body.siteId,
    })
    return c.json({ report }, 201)
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/sites/:siteId/reports', async (c) => {
  try {
    const reports = await listSiteReports(getAuthUser(c).userId, c.req.param('siteId'))
    return c.json({ reports })
  } catch {
    return c.json({ error: '无权访问' }, 403)
  }
})

authed.get('/api/reports/:reportId', async (c) => {
  try {
    const report = await getReport(getAuthUser(c).userId, c.req.param('reportId'))
    if (!report) return c.json({ error: '不存在' }, 404)
    return c.json({ report })
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return c.json({ error: '无权访问' }, 403)
    }
    throw err
  }
})

authed.get('/api/dashboard', async (c) => {
  const data = await buildUserDashboard(getAuthUser(c).userId)
  return c.json(data)
})

app.route('/', authed)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
})
