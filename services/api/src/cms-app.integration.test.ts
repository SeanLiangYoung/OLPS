import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { pool, migrateWithClient, recreatePool } from './db.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { cmsApp } from './cms-app.js'
import { serve } from '@hono/node-server'
import { chromium } from '@playwright/test'

it('新网站从注册、初始化、内容列表到整站预览使用真实 HTTP 接口', async () => {
  const schema = `app_${randomUUID().replaceAll('-', '')}`
  await pool.query(`CREATE SCHEMA ${schema}`)
  await pool.end()
  process.env.PG_TEST_SCHEMA = schema
  recreatePool()
  const client = await pool.connect()
  await client.query(`SET search_path TO ${schema}`)
  try {
    await migrateWithClient(client)
    await migrateCmsRuntime(pool)
    for(const endpoint of ['/api/auth/register','/api/auth/login']){
      const malformed=await cmsApp.request(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{'})
      expect(malformed.status).toBe(400)
    }
    const raceAccount=`race-${randomUUID()}`
    const registrations=await Promise.all([1,2].map(()=>cmsApp.request('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:raceAccount,password:'Registration123!'})})))
    expect(registrations.map(result=>result.status).sort()).toEqual([201,409])
    const register = await cmsApp.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: `cms-${randomUUID()}`, password: 'CmsExample123!', name: '管理用户' }) })
    expect(register.status).toBe(201)
    const { accessToken } = await register.json()
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
    const created = await cmsApp.request('/api/sites', { method: 'POST', headers, body: JSON.stringify({ name: '测试网站' }) })
    expect(created.status, await created.clone().text()).toBe(201)
    const data = await created.json()
    expect(data.site.status).toBe('unpublished')
    for (let count = 0; count < 100; count++) {
      const state = await cmsApp.request(`/api/sites/${data.site.siteId}/initialization`, { headers })
      const body = await state.json()
      if (body.initStatus === 'failed') throw new Error(JSON.stringify(body))
      if (body.initStatus === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const sitesResponse = await cmsApp.request('/api/sites', { headers })
    const sites = await sitesResponse.json()
    expect(sites.sites.find((site: { siteId: string }) => site.siteId === data.site.siteId).status).toBe('unpublished')
    const pages = await cmsApp.request(`/api/drafts/${data.draft.draftId}/pages?locale=en`, { headers })
    expect(pages.status, await pages.clone().text()).toBe(200)
    expect((await pages.json()).pages).toHaveLength(8)
    const draftBase = `/api/drafts/${data.draft.draftId}`
    const settingsResponse = await cmsApp.request(`${draftBase}/settings`, { headers })
    expect(settingsResponse.status).toBe(200)
    const settings = await settingsResponse.json()
    const invalidLocales = await cmsApp.request(`${draftBase}/settings`, { method: 'PUT', headers: { ...headers, 'if-match': `"${settings.revision}"` }, body: JSON.stringify({ settings: { ...settings.settings, locales: [...settings.settings.locales, { code: 'fr', dir: 'ltr' }] } }) })
    expect(invalidLocales.status).toBe(400)
    expect((await invalidLocales.json()).code).toBe('VALIDATION_FAILED')
    expect((await (await cmsApp.request(`${draftBase}/settings`, { headers })).json()).revision).toBe(settings.revision)
    const changedSettings = { ...settings.settings, siteName: '修改后的网站' }
    const savedSettings = await cmsApp.request(`${draftBase}/settings`, { method: 'PUT', headers: { ...headers, 'if-match': `"${settings.revision}"` }, body: JSON.stringify({ settings: changedSettings }) })
    expect(savedSettings.status, await savedSettings.clone().text()).toBe(200)
    expect((await cmsApp.request(`${draftBase}/settings`, { method: 'PUT', headers: { ...headers, 'if-match': `"${settings.revision}"` }, body: JSON.stringify({ settings: settings.settings }) })).status).toBe(409)
    expect((await cmsApp.request(`${draftBase}/source?path=source/site-settings.json`, { headers })).status).toBe(200)
    expect((await cmsApp.request(`${draftBase}/source?path=source/../../.env`, { headers })).status).toBe(400)
    expect((await cmsApp.request(`${draftBase}/source?path=tools/site-build.mjs`, { headers })).status).toBe(400)
    expect((await cmsApp.request(`${draftBase}/source?path=source/missing-optional.json`,{headers})).status).toBe(404)
    const resourceAccess=await(await cmsApp.request(`${draftBase}/resource-access`,{method:'POST',headers})).json()
    const stylesheetUrl=`${resourceAccess.resourceBaseUrl}themes/starter/assets/style.css?token=${resourceAccess.token}`
    const stylesheet=await cmsApp.request(stylesheetUrl)
    expect(stylesheet.status).toBe(200)
    expect(stylesheet.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    const secondAccount = `member-${randomUUID()}`
    const secondRegistration = await cmsApp.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: secondAccount, password: 'MemberExample123!' }) })
    const member = await secondRegistration.json()
    const memberHeaders = { ...headers, authorization: `Bearer ${member.accessToken}` }
    expect((await cmsApp.request(`${draftBase}/pages?locale=en`, { headers: memberHeaders })).status).toBe(403)
    expect((await cmsApp.request(`${draftBase}/resource-access`,{method:'POST',headers:memberHeaders})).status).toBe(403)
    expect((await cmsApp.request('/api/jobs/propose_site_structure', { method: 'POST', headers: { ...memberHeaders, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ draftId: data.draft.draftId, locale: 'en', instruction: 'Describe this website' }) })).status).toBe(403)
    expect((await cmsApp.request('/api/jobs/unknown', { method: 'POST', headers, body: JSON.stringify({ draftId: data.draft.draftId, locale: 'en' }) })).status).toBe(400)
    expect((await cmsApp.request('/api/jobs/revise_node', { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ draftId: data.draft.draftId, locale: 'en' }) })).status).toBe(400)
    expect((await cmsApp.request(`/api/drafts/${data.draft.draftId}`, { headers: memberHeaders })).status).toBe(403)
    expect((await cmsApp.request(`/api/sites/${data.site.siteId}/owners`, { method: 'POST', headers, body: JSON.stringify({ account: secondAccount }) })).status).toBe(200)
    expect((await cmsApp.request(`${draftBase}/owners`, { method: 'POST', headers, body: JSON.stringify({ account: secondAccount }) })).status).toBe(200)
    expect((await cmsApp.request(`${draftBase}/pages?locale=en`, { headers: memberHeaders })).status).toBe(200)
    expect((await cmsApp.request(`${draftBase}/owners/${member.user.userId}`, { method: 'DELETE', headers })).status).toBe(200)
    expect((await cmsApp.request(`${draftBase}/pages?locale=en`, { headers: memberHeaders })).status).toBe(403)
    const owners = await (await cmsApp.request(`${draftBase}/owners`, { headers })).json()
    expect((await cmsApp.request(`${draftBase}/owners/${owners.users[0].userId}`, { method: 'DELETE', headers })).status).toBe(409)
    const anotherDraft = await cmsApp.request('/api/drafts', { method: 'POST', headers, body: JSON.stringify({ siteId: data.site.siteId, name: '另一个编辑版本' }) })
    expect(anotherDraft.status, await anotherDraft.clone().text()).toBe(201)
    const another = (await anotherDraft.json()).draft
    expect(another.siteId).toBe(data.site.siteId)
    expect(another.initStatus).toBe('ready')
    expect((await (await cmsApp.request(`/api/drafts/${another.draftId}/pages?locale=en`, { headers })).json()).pages).toHaveLength(8)
    expect((await cmsApp.request('/api/drafts', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ siteId: randomUUID(), name: '没有权限' }) })).status).toBe(403)
    const logoUpload=new FormData()
    logoUpload.append('file',new File(['<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20"><rect width="28" height="20" fill="blue"/></svg>'],'logo.svg',{type:'image/svg+xml'}))
    const uploadedLogo=await(await cmsApp.request(`${draftBase}/media`,{method:'POST',headers:{authorization:headers.authorization},body:logoUpload})).json()
    const appearance=await(await cmsApp.request(`${draftBase}/appearance`,{headers})).json()
    appearance.appearance.themeSettings={...appearance.appearance.themeSettings,logo:{mediaId:uploadedLogo.media.mediaId},primaryColor:'#123456',fontFamily:'Arial, sans-serif',footerText:{en:'Company custom footer','zh-CN':'公司页脚文字'}}
    expect((await cmsApp.request(`${draftBase}/appearance`,{method:'PUT',headers:{...headers,'If-Match':`"${appearance.revision}"`},body:JSON.stringify(appearance.appearance)})).status).toBe(200)
    const preview = await cmsApp.request(`/api/drafts/${data.draft.draftId}/preview`, { method: 'POST', headers, body: JSON.stringify({ locale: 'en', returnPath: '/pages' }) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const previewData = await preview.json()
    const home = await cmsApp.request(previewData.previewUrl)
    expect(home.status).toBe(200)
    expect(home.headers.get('cache-control')).toBe('no-store')
    expect(await home.text()).toContain('返回后台')
    const server = serve({ fetch: cmsApp.fetch, hostname: '127.0.0.1', port: 0 })
    const browser = await chromium.launch({ headless: true })
    try {
      const port = (server.address() as { port: number }).port
      const page = await browser.newPage()
      const prefix = previewData.previewUrl.slice(0, previewData.previewUrl.lastIndexOf('/en/'))
      await page.goto(`http://127.0.0.1:${port}${prefix}/en/contact/`)
      expect(await page.evaluate(()=>{try{return localStorage.getItem('olps_access_token')}catch(error){return(error as Error).name}})).toBe('SecurityError')
      expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--olps-color-primary').trim())).toBe('#123456')
      expect(await page.locator('.olps-brand-logo').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(28)
      expect(await page.locator('footer').textContent()).toContain('Company custom footer')
      const form = page.locator('form[data-olps-inquiry-form]')
      await form.locator('[name="name"]').fill('预览访客')
      await form.locator('[name="email"]').fill('preview@example.com')
      await form.locator('[name="message"]').fill('检查预览询盘不会发送外部消息')
      await form.locator('[name="privacyConsent"]').check()
      const beforeSubmission=page.url()
      await page.context().setOffline(true)
      await form.locator('button[type="submit"]').click()
      await form.locator('[data-olps-inquiry-error]').waitFor({state:'visible'})
      expect(page.url()).toBe(beforeSubmission)
      expect(await form.locator('[name="message"]').inputValue()).toBe('检查预览询盘不会发送外部消息')
      expect((await pool.query('SELECT count(*) FROM inquiries WHERE site_id=$1',[data.site.siteId])).rows[0].count).toBe('0')
      await page.context().setOffline(false)
      const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/inquiries'))
      await form.locator('button[type="submit"]').click()
      expect((await submitted).status()).toBe(201)
      const inquiries = await pool.query("SELECT source,draft_id FROM inquiries WHERE site_id=$1 AND cms_id IS NOT NULL", [data.site.siteId])
      expect(inquiries.rows).toEqual([{ source: 'preview', draft_id: data.draft.draftId }])
      expect((await pool.query('SELECT * FROM cms_outbound_tasks')).rows).toEqual([])
      await page.waitForURL('**/thank-you/')
      await page.getByRole('link',{name:'返回后台'}).click()
      await page.waitForURL(`http://127.0.0.1:${port}/pages`)
      await page.close()
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    expect((await cmsApp.request('/api/auth/logout',{method:'POST',headers})).status).toBe(200)
    expect((await cmsApp.request(stylesheetUrl)).status).toBe(403)
  } finally {
    client.release()
    await pool.query('SET search_path TO public')
    await pool.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool.end()
  }
}, 120_000)
