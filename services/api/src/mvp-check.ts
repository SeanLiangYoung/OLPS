import { appConfig } from './config.js'
import { migrate, pool } from './db.js'

const base = `http://127.0.0.1:${appConfig.port}`

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  if (!res.ok) {
    throw new Error(`${method} ${path} => ${res.status} ${text}`)
  }
  return data
}

async function main(): Promise<void> {
  await migrate()

  const health = await fetch(`${base}/api/health`)
  if (!health.ok) {
    throw new Error('API 未启动，请先 npm run dev:api')
  }

  const account = process.env.MVP_CHECK_ACCOUNT?.trim() || `mvp-${Date.now()}`
  const password = process.env.MVP_CHECK_PASSWORD ?? 'mvp-check-pass'

  const register = await api('POST', '/api/auth/register', {
    account,
    password,
    name: 'MVP Check',
  })
  const token = String(register.accessToken ?? '')
  if (!token) {
    throw new Error('注册未返回 accessToken')
  }

  const draftRes = await api('POST', '/api/drafts', { name: 'MVP Draft Site' }, token)
  const draft = draftRes.draft as Record<string, unknown>
  const draftId = String(draft.draftId ?? '')
  if (!draftId) {
    throw new Error('创建草稿未返回 draftId')
  }

  await api(
    'POST',
    `/api/drafts/${draftId}/pages`,
    { kind: 'content', title: 'Home', slug: 'home' },
    token,
  )

  const pushRes = await api('POST', `/api/drafts/${draftId}/push`, undefined, token)
  const site = pushRes.site as Record<string, unknown> | undefined
  const siteId = site ? String(site.siteId ?? '') : ''
  if (!siteId) {
    throw new Error('push 未返回 siteId（请确认 REMOTE_SERVICE_URL/TOKEN 与远端服务可用）')
  }

  const pagesRes = await api('GET', `/api/sites/${siteId}/pages`, undefined, token)
  const pages = pagesRes.pages as Array<Record<string, unknown>> | undefined
  if (!pages?.some((page) => page.slug === 'home')) {
    throw new Error('已发布站点缺少 home 页面')
  }

  console.log('MVP 协作草稿 push 验收通过')
  console.log(
    JSON.stringify(
      {
        account,
        draftId,
        siteId,
        remoteSiteId: site?.remoteSiteId ?? null,
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
