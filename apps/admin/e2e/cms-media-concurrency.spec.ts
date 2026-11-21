import { test,expect,type Page,type APIRequestContext } from '@playwright/test'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
test.use({actionTimeout:15000})
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}
async function setup(page:Page,request:APIRequestContext,beforeNavigation?:(base:string)=>Promise<void>){
  const registration=await request.post(`${apiBase}/api/auth/register`,{data:{account:`media-race-${crypto.randomUUID()}`,password:'MediaRace123!',name:'媒体检查'}})
  expect(registration.status(),await registration.text()).toBe(201)
  const {accessToken}=await registration.json();const headers={Authorization:`Bearer ${accessToken}`}
  const created=await request.post(`${apiBase}/api/sites`,{headers,data:{name:'媒体并发检查'}})
  expect(created.status(),await created.text()).toBe(201)
  const site=await created.json()
  await expect.poll(async()=>{const state=await(await request.get(`${apiBase}/api/sites/${site.site.siteId}/initialization`,{headers})).json();if(state.initStatus==='failed')throw new Error(state.error);return state.initStatus},{timeout:90000}).toBe('ready')
  const base=`/api/drafts/${site.draft.draftId}/media`
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>')
  const media=[]
  for(const title of ['媒体甲','媒体乙']){
    const upload=await request.post(apiBase+base,{headers,multipart:{file:{name:'image.svg',mimeType:'image/svg+xml',buffer:svg}}})
    expect(upload.status(),await upload.text()).toBe(201)
    const entry=await upload.json()
    const updated=await request.put(`${apiBase}${base}/${entry.media.mediaId}`,{headers:{...headers,'If-Match':`"${entry.revision}"`},data:{title:{en:title},alt:{en:title}}})
    expect(updated.status(),await updated.text()).toBe(200)
    media.push(await updated.json())
  }
  await page.addInitScript(({token,siteId,draftId})=>{if(window!==window.top)return;localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:accessToken,siteId:site.site.siteId,draftId:site.draft.draftId})
  if(beforeNavigation)await beforeNavigation(base)
  await page.goto('/media')
  if(!beforeNavigation)await expect(page.getByRole('button',{name:/媒体甲 ·/})).toBeVisible()
  return {site,headers,base,media,svg}
}
async function delayList(page:Page,base:string){
  const entered=gate(),released=gate();let delayed=false
  await page.route(url=>url.pathname===base,async route=>{if(!delayed&&route.request().method()==='GET'){delayed=true;entered.release();await released.promise}await route.continue()})
  return {entered,released}
}
test('保存甲后重新加载期间选择乙，保留乙的资料与当前消息',async({page,request})=>{
  const context=await setup(page,request)
  await page.getByRole('button',{name:/媒体甲 ·/}).click()
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体甲')
  await page.getByLabel('标题',{exact:true}).fill('媒体甲已保存')
  const delayed=await delayList(page,context.base)
  await page.getByRole('button',{name:'保存资料',exact:true}).click()
  await delayed.entered.promise
  try{await page.getByRole('button',{name:/媒体乙 ·/}).click();await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')}finally{delayed.released.release()}
  await expect(page.getByRole('button',{name:'保存资料',exact:true})).toBeEnabled()
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')
  await expect(page.getByRole('status')).toHaveCount(0)
  const stored=await request.get(`${apiBase}${context.base}/${context.media[0].media.mediaId}`,{headers:context.headers})
  expect((await stored.json()).media.title.en).toBe('媒体甲已保存')
})
test('上传完成后的列表请求期间切换媒体，保留新的选择',async({page,request})=>{
  const context=await setup(page,request)
  await page.getByRole('button',{name:/媒体甲 ·/}).click()
  const delayed=await delayList(page,context.base)
  await page.getByLabel('上传文件',{exact:true}).setInputFiles({name:'third.svg',mimeType:'image/svg+xml',buffer:context.svg})
  await delayed.entered.promise
  try{await page.getByRole('button',{name:/媒体乙 ·/}).click();await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')}finally{delayed.released.release()}
  await expect(page.getByRole('button',{name:'保存资料',exact:true})).toBeEnabled()
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')
  await expect(page.getByRole('status')).toHaveCount(0)
  expect((await(await request.get(apiBase+context.base,{headers:context.headers})).json()).media).toHaveLength(3)
})
test('甲的引用内容请求失效时，错误信息不会覆盖乙的选择',async({page,request})=>{
  const context=await setup(page,request),pageId=crypto.randomUUID(),now=new Date().toISOString()
  const created=await request.post(`${apiBase}/api/drafts/${context.site.draft.draftId}/pages`,{headers:context.headers,data:{ref:'page',meta:{schemaVersion:1,pageId,role:null,template:'page',status:'draft',createdAt:now,updatedAt:now},locale:{schemaVersion:1,locale:'en',slug:`media-${pageId}`,title:'媒体使用页面',summary:'',cover:{mediaId:context.media[0].media.mediaId},seo:{title:'媒体使用页面',description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}}})
  expect(created.status(),await created.text()).toBe(201)
  const saved=await created.json(),entered=gate(),released=gate()
  const contentPath=`/api/drafts/${context.site.draft.draftId}/content/page/${pageId}`
  await page.route(url=>url.pathname===contentPath,async route=>{entered.release();await released.promise;await route.continue()})
  await page.getByRole('button',{name:/媒体甲 ·/}).click()
  await entered.promise
  await page.getByRole('button',{name:/媒体乙 ·/}).click()
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')
  expect((await request.delete(`${apiBase}/api/drafts/${context.site.draft.draftId}/pages/${pageId}`,{headers:{...context.headers,'If-Match':`"${saved.revision}"`}})).status()).toBe(204)
  const failed=page.waitForResponse(response=>new URL(response.url()).pathname===contentPath)
  released.release()
  const response=await failed;expect(response.status()).toBe(404);await response.finished()
  await page.evaluate(()=>fetch('/api/health').then(response=>response.json()))
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('媒体乙')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
test('首次读取列表期间切换语言，当前语言仍能显示已有媒体',async({page,request})=>{
  let delayed:Awaited<ReturnType<typeof delayList>>|undefined
  await setup(page,request,async base=>{delayed=await delayList(page,base)})
  await delayed!.entered.promise
  try{await page.getByRole('combobox',{name:'内容语言',exact:true}).selectOption('zh-CN')}finally{delayed!.released.release()}
  await expect(page.locator('.media-entry')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
