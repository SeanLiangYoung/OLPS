/**
 * 自动化跑通 MVP Happy Path。需要真实 SSO 账号（SSO_TEST_ACCOUNT / SSO_TEST_PASSWORD）。
 */
import { appConfig } from './config.js'
import { migrate, pool } from './db.js'

const base = `http://127.0.0.1:${appConfig.port}`
const testAccount = process.env.SSO_TEST_ACCOUNT?.trim() ?? ''
const testPassword = process.env.SSO_TEST_PASSWORD ?? ''

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  tenantId?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token) headers.authorization = `Bearer ${token}`
  if (tenantId) headers['x-tenant-id'] = tenantId
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(`${method} ${path} => ${res.status} ${text}`)
  }
  return data
}

async function main(): Promise<void> {
  if (!testAccount || !testPassword) {
    throw new Error('请设置环境变量 SSO_TEST_ACCOUNT 与 SSO_TEST_PASSWORD 后再跑 mvp:check')
  }
  await migrate()

  const health = await fetch(`${base}/api/health`)
  if (!health.ok) throw new Error('API 未启动，请先 npm run dev:api')

  const login = await api('POST', '/api/auth/password', {
    account: testAccount,
    password: testPassword,
  })
  const token = login.accessToken as string
  if (!token) throw new Error('SSO 登录未返回 accessToken')

  const tenants = await api('GET', '/api/auth/tenants', undefined, token)
  const tenantId = tenants.tenants?.[0] as string
  if (!tenantId) throw new Error('租户列表为空')

  const siteRes = await api('POST', '/api/sites', { name: 'MVP Demo Site' }, token, tenantId)
  const siteId = siteRes.site.siteId as string

  const kb = await api('POST', '/api/knowledge-bases', { name: 'Demo KB' }, token, tenantId)
  await api(
    'POST',
    `/api/knowledge-bases/${kb.knowledgeBase.kbId}/documents`,
    {
      title: 'Company',
      content: 'We build steel structures for export markets. Lead time 30 days.',
    },
    token,
    tenantId,
  )

  const homeJob = await api(
    'POST',
    '/api/jobs/generate_page',
    {
      siteId,
      knowledgeBaseId: kb.knowledgeBase.kbId,
      kind: 'site',
      title: 'Home',
      slug: `home-${Date.now()}`,
      brief: 'Welcome home',
    },
    token,
    tenantId,
  )
  const homeId = homeJob.page.pageId as string

  const contentJob = await api(
    'POST',
    '/api/jobs/generate_page',
    {
      siteId,
      knowledgeBaseId: kb.knowledgeBase.kbId,
      kind: 'content',
      title: 'Product Alpha',
      slug: `product-alpha-${Date.now()}`,
      brief: 'Featured product',
    },
    token,
    tenantId,
  )
  const contentId = contentJob.page.pageId as string

  const adsJob = await api(
    'POST',
    '/api/jobs/generate_page',
    {
      siteId,
      knowledgeBaseId: kb.knowledgeBase.kbId,
      kind: 'ads',
      title: 'Steel Landing',
      slug: `steel-landing-${Date.now()}`,
      brief: 'Steel offers',
      keywords: ['buy steel', 'rent steel'],
    },
    token,
    tenantId,
  )
  const pageId = adsJob.page.pageId as string
  const guide = structuredClone(adsJob.page.body.ads.guide)
  const edge = guide.nodes['entry-0'].options.find((o: any) => o.id === 'e0-proof')
  edge.label = 'See shared proof (edited)'
  await api('PATCH', `/api/pages/${pageId}/guide`, { guide }, token, tenantId)

  const publishedHome = await api('POST', `/api/pages/${homeId}/publish`, undefined, token, tenantId)
  await api('POST', `/api/pages/${contentId}/publish`, undefined, token, tenantId)
  const publishedAds = await api('POST', `/api/pages/${pageId}/publish`, undefined, token, tenantId)

  for (const url of [...publishedHome.urls, ...publishedAds.urls]) {
    const res = await fetch(`${base}${url}`)
    if (!res.ok) throw new Error(`公开页打不开: ${url} => ${res.status}`)
  }

  const sitemap = await fetch(`${base}${publishedAds.sitemapUrl}`)
  if (!sitemap.ok) throw new Error('sitemap 打不开')

  await api(
    'PATCH',
    `/api/pages/${homeId}`,
    {
      title: 'Home Updated',
      seo: { title: 'Home Updated', description: 'Updated description' },
    },
    token,
    tenantId,
  )
  await api('POST', `/api/pages/${homeId}/publish`, undefined, token, tenantId)

  const dash = await api('GET', '/api/dashboard', undefined, token, tenantId)
  if (dash.publishedCount < 3) throw new Error('dashboard 已发布数不足')

  const report = await api('POST', '/api/reports', { siteId, pageId }, token, tenantId)
  if (typeof report.report.score !== 'number') throw new Error('报告分数异常')

  await api(
    'PATCH',
    `/api/sites/${siteId}/integrations`,
    {
      adsAccountId: 'ads-1',
      adsConnected: true,
      gaPropertyId: 'ga-1',
      gaConnected: true,
    },
    token,
    tenantId,
  )

  console.log('MVP Happy Path 验收通过')
  console.log(
    JSON.stringify(
      {
        tenantId,
        siteId,
        publishedUrls: [...publishedHome.urls, ...publishedAds.urls],
        sitemapUrl: publishedAds.sitemapUrl,
        reportId: report.report.reportId,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
