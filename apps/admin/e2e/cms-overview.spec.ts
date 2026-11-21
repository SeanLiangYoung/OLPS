import { test,expect } from '@playwright/test'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
test.use({actionTimeout:15000})

test('网站概况显示未同步平台状态，并读取访客同意后的真实原生统计',async({page,request})=>{
  const registration=await request.post(`${apiBase}/api/auth/register`,{data:{account:`overview-${crypto.randomUUID()}`,password:'OverviewPass123!',name:'概况检查'}})
  expect(registration.status(),await registration.text()).toBe(201)
  const {accessToken}=await registration.json()
  const headers={Authorization:`Bearer ${accessToken}`}
  const response=await request.post(`${apiBase}/api/sites`,{headers,data:{name:'指标检查网站'}})
  expect(response.status(),await response.text()).toBe(201)
  const site=await response.json()
  await expect.poll(async()=>{
    const state=await(await request.get(`${apiBase}/api/sites/${site.site.siteId}/initialization`,{headers})).json()
    if(state.initStatus==='failed')throw new Error(state.error)
    return state.initStatus
  },{timeout:90000}).toBe('ready')
  await page.addInitScript(({token,siteId,draftId})=>{if(window!==window.top)return;localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:accessToken,siteId:site.site.siteId,draftId:site.draft.draftId})
  await page.goto('/dashboard')
  await expect(page.getByRole('heading',{name:'最近30天的平台指标',exact:true})).toBeVisible()
  await expect(page.locator('.platform-card')).toHaveCount(4)
  await expect(page.locator('.platform-card .sync-status')).toHaveText(['尚未同步','尚未同步','尚未同步','尚未同步'])
  await expect(page.locator('[data-platform="ga4"] dd').first()).toHaveText('尚未同步')
  await expect(page.getByRole('link').filter({hasText:'当前语言的页面'}).locator('strong')).toHaveText('8')
  await expect(page.getByRole('link').filter({hasText:'内容类型'}).filter({has:page.locator('strong')}).locator('strong')).toHaveText('3')
  await expect(page.getByRole('link').filter({hasText:'已同意统计的页面浏览'}).locator('strong')).toHaveText('0')
  const publication=await request.post(`${apiBase}/api/sites/${site.site.siteId}/publish`,{headers,data:{draftId:site.draft.draftId,requestKey:crypto.randomUUID()}})
  expect(publication.status(),await publication.text()).toBe(200)
  const {record}=await publication.json()
  const visitor=await page.context().newPage()
  await visitor.goto(`${record.publicUrl.replace(/\/$/,'')}/en/`)
  const collected=visitor.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/public/${site.site.siteId}/events`&&response.request().postDataJSON().name==='page_view')
  await visitor.locator('[data-olps-consent-accept-all]').click()
  expect((await collected).status()).toBe(202)
  await visitor.close()
  await page.reload()
  await expect(page.getByRole('link').filter({hasText:'已同意统计的页面浏览'}).locator('strong')).toHaveText('1')
  await expect(page.locator('.platform-card .sync-status')).toHaveText(['尚未同步','尚未同步','尚未同步','尚未同步'])
  await expect(page.getByRole('alert')).toHaveCount(0)
})
