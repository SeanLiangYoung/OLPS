import { test,expect } from '@playwright/test'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
test.use({actionTimeout:15000})

test('全站检查显示修改建议、切换语言、重新检查和读取历史报告',async({page,request})=>{
  const account=`report-${crypto.randomUUID()}`
  const registration=await request.post(`${apiBase}/api/auth/register`,{data:{account,password:'ReportPass123!',name:'网站检查'}})
  expect(registration.ok(),await registration.text()).toBe(true)
  const {accessToken}=await registration.json()
  const headers={Authorization:`Bearer ${accessToken}`}
  const creation=await request.post(`${apiBase}/api/sites`,{headers,data:{name:'报告检查网站'}})
  expect(creation.status(),await creation.text()).toBe(201)
  const created=await creation.json()
  await expect.poll(async()=>{
    const state=await(await request.get(`${apiBase}/api/sites/${created.site.siteId}/initialization`,{headers})).json()
    if(state.initStatus==='failed')throw new Error(state.error)
    return state.initStatus
  },{timeout:90000}).toBe('ready')
  await page.addInitScript(({token,siteId,draftId})=>{if(window!==window.top)return;localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:accessToken,siteId:created.site.siteId,draftId:created.draft.draftId})
  const checked=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname===`/api/sites/${created.site.siteId}/reports`)
  await page.goto('/reports')
  const response=await checked
  expect(response.status(),await response.text()).toBe(200)
  const first=await response.json()
  expect(first.summary).toBeDefined()
  await expect(page.getByRole('heading',{name:'统计与报告',exact:true})).toBeVisible()
  await expect(page.getByRole('status').filter({hasText:'已检查'})).toContainText(`${first.summary.total} 份内容`)
  await expect(page.locator('.content-report')).toHaveCount(first.content.filter((item:{locale:string})=>item.locale==='en').length)
  await expect(page.locator('.content-report').first().getByRole('link',{name:'编辑内容',exact:true})).toHaveAttribute('href',/\/content\//)
  await expect(page.locator('.content-report').first()).toContainText('公开询盘：0')
  await page.getByRole('combobox',{name:'内容语言',exact:true}).selectOption('zh-CN')
  await expect(page.locator('.content-report')).toHaveCount(first.content.filter((item:{locale:string})=>item.locale==='zh-CN').length)
  await expect(page.locator('.content-report').first().getByRole('link',{name:'编辑内容',exact:true})).toHaveAttribute('href',/locale=zh-CN/)
  await page.getByRole('button',{name:'重新检查',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'检查记录',exact:true}).locator('option')).toHaveCount(2)
  await page.getByRole('combobox',{name:'检查记录',exact:true}).selectOption(first.reportId)
  await expect(page.getByRole('status').filter({hasText:'已检查'})).toContainText(`${first.summary.total} 份内容`)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
