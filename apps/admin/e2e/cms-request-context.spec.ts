import {expect,test} from '@playwright/test'
import {startDedicatedE2eStack} from './dedicated-e2e-stack'
import {cmsWebsite,selectCmsWebsite} from './cms-fixtures'

test('网站选择只接受最后一次进入操作的真实响应',async({page,request})=>{
  test.setTimeout(180000)
  const stack=await startDedicatedE2eStack('cms-site-request-context')
  let release=()=>{}
  try{
    const a=await cmsWebsite(request,stack.apiBaseUrl),b=await cmsWebsite(request,stack.apiBaseUrl,a.identity)
    await selectCmsWebsite(page,a);await page.goto(`${stack.adminBaseUrl}/sites`)
    const delayed=new Promise<void>(resolve=>{release=resolve})
    let started=()=>{};const pending=new Promise<void>(resolve=>{started=resolve})
    await page.route(`**/api/sites/${a.siteId}/drafts`,async route=>{started();await delayed;await route.continue()})
    const articles=page.getByRole('region',{name:'网站列表'}).locator('article')
    const sites=await(await request.get(`${stack.apiBaseUrl}/api/sites`,{headers:a.identity.headers})).json() as {sites:Array<{siteId:string}>}
    await articles.nth(sites.sites.findIndex(site=>site.siteId===a.siteId)).getByRole('button',{name:'进入网站'}).click();await pending
    await articles.nth(sites.sites.findIndex(site=>site.siteId===b.siteId)).getByRole('button',{name:'进入网站'}).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    const returned=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/sites/${a.siteId}/drafts`)
    release();expect((await returned).ok()).toBe(true)
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('olps_site_id'))).toBe(b.siteId)
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('olps_draft_id'))).toBe(b.draftId)
  }finally{release();await stack.stop()}
})

for(const change of ['locale','route'] as const)test(`创建内容期间切换${change==='locale'?'语言':'页面'}后保留当前选择`,async({page,request})=>{
  test.setTimeout(180000)
  const stack=await startDedicatedE2eStack(`cms-content-request-${change}`)
  let release=()=>{}
  try{
    const website=await cmsWebsite(request,stack.apiBaseUrl)
    await selectCmsWebsite(page,website);await page.goto(`${stack.adminBaseUrl}/pages`)
    const delayed=new Promise<void>(resolve=>{release=resolve})
    let started=()=>{};const pending=new Promise<void>(resolve=>{started=resolve})
    await page.route(`**/api/drafts/${website.draftId}/pages`,async route=>{if(route.request().method()==='POST'){started();await delayed}await route.continue()})
    await page.getByRole('button',{name:'新建页面',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'新建页面'})
    await dialog.getByLabel('标题',{exact:true}).fill('Delayed English page')
    await dialog.getByLabel('网址名称',{exact:true}).fill('delayed-english-page')
    await dialog.getByRole('button',{name:'创建并编辑'}).click();await pending
    if(change==='locale')await page.getByLabel('内容语言').selectOption('zh-CN')
    else await page.getByRole('link',{name:'全部内容类型',exact:true}).click()
    const returned=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/drafts/${website.draftId}/pages`)
    release();const response=await returned;expect(response.status(),await response.text()).toBe(201)
    const saved=await response.json() as {page:{meta:{pageId:string}}}
    const actual=await request.get(`${stack.apiBaseUrl}/api/drafts/${website.draftId}/content/page/${saved.page.meta.pageId}?locale=en`,{headers:website.identity.headers})
    expect(actual.ok(),await actual.text()).toBe(true)
    await expect(page).toHaveURL(new RegExp(change==='locale'?'/pages$':'/collections$'))
    if(change==='locale')await expect(page.getByLabel('内容语言')).toHaveValue('zh-CN')
    await expect(page.getByRole('alert')).toHaveCount(0)
  }finally{release();await stack.stop()}
})
