import path from 'node:path'
import fs from 'node:fs/promises'
import { test,expect,type Page,type APIRequestContext } from '@playwright/test'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
async function createWebsite(page:Page,request:APIRequestContext){
  const suffix=crypto.randomUUID()
  const registration=await request.post(`${apiBase}/api/auth/register`,{data:{account:`business-${suffix}`,password:'BusinessPass123!',name:'网站运营'}})
  expect(registration.ok(),await registration.text()).toBe(true)
  const {accessToken}=await registration.json() as {accessToken:string}
  const headers={Authorization:`Bearer ${accessToken}`}
  const response=await request.post(`${apiBase}/api/sites`,{headers,data:{name:'业务检查网站',draftName:'网站编辑'}})
  expect(response.ok(),await response.text()).toBe(true)
  const created=await response.json() as {site:{siteId:string};draft:{draftId:string}}
  await expect.poll(async()=>{const state=await(await request.get(`${apiBase}/api/sites/${created.site.siteId}/initialization`,{headers})).json() as {initStatus:string;error:string|null};if(state.initStatus==='failed')throw new Error(state.error??'初始化未完成');return state.initStatus},{timeout:120000}).toBe('ready')
  await page.addInitScript(({token,siteId,draftId})=>{localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:accessToken,siteId:created.site.siteId,draftId:created.draft.draftId})
  return {...created,accessToken,headers}
}
test('十种AI处理可以真实提交并显示服务端终态',async({page,request})=>{
  await createWebsite(page,request)
  await page.goto('/generate')
  await expect(page.getByRole('combobox',{name:'处理内容',exact:true})).toBeVisible()
  await expect(page.getByRole('combobox',{name:'处理内容',exact:true}).locator('option')).toHaveCount(11)
  await page.getByRole('combobox',{name:'处理内容',exact:true}).selectOption('propose_site_structure')
  await page.getByRole('button',{name:'添加内容',exact:true}).click()
  const operations=['propose_site_structure','generate_nodes','generate_node','revise_node','rewrite_block','generate_legal_pages','translate_node','translate_site','translate_strings','generate_seo']
  for(const operation of operations){
    await page.getByRole('combobox',{name:'处理内容',exact:true}).selectOption(operation)
    if(operation==='generate_node')await page.getByLabel('新内容名称',{exact:true}).fill('产品说明')
    if(operation!=='propose_site_structure')await page.getByLabel('你的要求',{exact:true}).fill('根据网站现有内容提供清楚、准确的说明。')
    const submitted=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname===`/api/jobs/${operation}`)
    await page.getByRole('button',{name:'开始处理',exact:true}).click()
    const response=await submitted
    expect(response.status(),await response.text()).toBe(202)
    await expect(page.getByRole('status').filter({hasText:/处理完成|处理没有完成/})).toBeVisible({timeout:120000})
    const body=await response.json() as {job:{jobId:string}}
    const token=await page.evaluate(()=>localStorage.getItem('olps_access_token'))
    const job=await(await request.get(`${apiBase}/api/jobs/${body.job.jobId}`,{headers:{Authorization:`Bearer ${token}`}})).json() as {job:{status:string;error:unknown}}
    expect(['completed','failed']).toContain(job.job.status)
    if(job.job.status==='failed')await expect(page.getByRole('alert')).not.toBeEmpty()
  }
})

async function sendInquiry(page:Page,name:string){
  const form=page.locator('form[data-olps-inquiry-form]')
  await expect(form).toBeVisible()
  await form.locator('[name="name"]').fill(name)
  await form.locator('[name="email"]').fill('visitor@example.com')
  await form.locator('[name="message"]').fill('Please provide product information.')
  await form.locator('[name="privacyConsent"]').check()
  const submitted=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname.endsWith('/inquiries'))
  await form.locator('button[type="submit"]').click()
  const response=await submitted
  expect(response.status()).toBe(201)
  await expect(page).toHaveURL(/\/thank-you\/(?:[?#].*)?$/)
}
test('真实预览与公开询盘、发布记录、报告及网站文件下载',async({page,request})=>{
  const site=await createWebsite(page,request)
  const contact='11111111-1111-4111-8111-111111111103'
  const preview=await request.post(`${apiBase}/api/drafts/${site.draft.draftId}/preview`,{headers:site.headers,data:{locale:'en',target:{ref:'page',id:contact},returnPath:'/inquiries'}})
  expect(preview.ok(),await preview.text()).toBe(true)
  const {previewUrl}=await preview.json() as {previewUrl:string}
  await page.goto(previewUrl)
  await sendInquiry(page,'Preview visitor')
  await page.goto('/inquiries')
  await page.getByRole('combobox',{name:'询盘来源',exact:true}).selectOption('preview')
  await expect(page.getByRole('heading',{name:'Preview visitor',exact:true})).toBeVisible()
  await page.goto('/publish')
  const publication=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname===`/api/sites/${site.site.siteId}/publish`)
  await page.getByRole('button',{name:'发布网站',exact:true}).click()
  const published=await publication
  expect(published.ok(),await published.text()).toBe(true)
  const record=(await published.json() as {record:{publicUrl:string}}).record
  await expect(page.getByRole('link',{name:'查看网站',exact:true}).first()).toBeVisible()
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载此次网站文件',exact:true}).first().click()
  const download=await downloaded
  const directory=path.resolve('../../.intermediate/cms-business-e2e');await fs.mkdir(directory,{recursive:true})
  const destination=path.join(directory,`${crypto.randomUUID()}.zip`);await download.saveAs(destination)
  expect((await fs.stat(destination)).size).toBeGreaterThan(100)
  const visitor=await page.context().newPage()
  await visitor.goto(`${record.publicUrl.replace(/\/$/,'')}/en/contact/`)
  await sendInquiry(visitor,'Public visitor')
  await visitor.close()
  await page.goto('/inquiries')
  await expect(page.getByRole('heading',{name:'Public visitor',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Preview visitor',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'标记为有效询盘',exact:true}).click()
  await expect(page.getByRole('button',{name:'标记为已处理',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'标记为已处理',exact:true}).click()
  await expect(page.locator('article.inquiry').filter({has:page.getByRole('heading',{name:'Public visitor',exact:true})}).getByText(/^已处理 ·/)).toBeVisible()
  await page.goto('/reports')
  await expect(page.getByRole('heading',{name:'统计与报告',exact:true})).toBeVisible()
  await expect(page.locator('.content-report').filter({has:page.getByRole('heading',{name:'Contact',exact:true})})).toContainText('公开询盘：1')
})
