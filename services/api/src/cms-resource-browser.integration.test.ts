import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium,type Browser } from '@playwright/test'
import { createServer,type ViteDevServer } from 'vite'
import { expect,it } from 'vitest'
import { startApiHttpServerFromWorktree } from './test-support/api-server-process.js'

it('真实短期资源授权自动续签和失效恢复，链式CSS导入能够读取图片',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许测试数据库')
  const schema=`resource_browser_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/resource-browser-tests',schema)
  const environment=['DATABASE_URL','PG_TEST_SCHEMA','SANDBOX_ROOT','PREVIEW_ROOT','PUBLISH_ROOT','EDITOR_RESOURCE_TTL_SECONDS','API_TEST_LISTEN_PORT','OLPS_API_PROXY_URL']
  const previous=Object.fromEntries(environment.map(key=>[key,process.env[key]]))
  let api:Awaited<ReturnType<typeof startApiHttpServerFromWorktree>>|undefined
  let vite:ViteDevServer|undefined,browser:Browser|undefined
  try{
    Object.assign(process.env,{DATABASE_URL:url,PG_TEST_SCHEMA:schema,SANDBOX_ROOT:path.join(root,'sandboxes'),PREVIEW_ROOT:path.join(root,'previews'),PUBLISH_ROOT:path.join(root,'publish'),EDITOR_RESOURCE_TTL_SECONDS:'3',API_TEST_LISTEN_PORT:'0'})
    api=await startApiHttpServerFromWorktree()
    process.env.OLPS_API_PROXY_URL=api.baseUrl
    const adminRoot=path.resolve('../../apps/admin')
    vite=await createServer({root:adminRoot,configFile:path.join(adminRoot,'vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false}})
    await vite.listen()
    const port=(vite.httpServer!.address() as {port:number}).port
    const adminUrl=`http://127.0.0.1:${port}`
    for(const key of environment){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
    const registration=await fetch(`${api.baseUrl}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:`resource-${randomUUID()}`,password:'ResourcePass123!',name:'资源检查'})})
    expect(registration.status).toBe(201)
    const {accessToken}=await registration.json() as {accessToken:string}
    const headers={Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}
    const siteResponse=await fetch(`${api.baseUrl}/api/sites`,{method:'POST',headers,body:JSON.stringify({name:'资源检查网站'})})
    expect(siteResponse.status).toBe(201)
    const site=await siteResponse.json() as {site:{siteId:string};draft:{draftId:string}}
    await expect.poll(async()=>{
      const state=await(await fetch(`${api!.baseUrl}/api/sites/${site.site.siteId}/initialization`,{headers})).json() as {initStatus:string;error?:string}
      if(state.initStatus==='failed')throw new Error(state.error)
      return state.initStatus
    },{timeout:90000}).toBe('ready')
    const sandboxId=(await database.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[site.draft.draftId])).rows[0].sandbox_id
    const workspace=path.join(root,'sandboxes',sandboxId)
    const cssRoot=path.join(workspace,'themes/starter/assets')
    await fs.mkdir(path.join(cssRoot,'chain/nested'),{recursive:true})
    await fs.writeFile(path.join(cssRoot,'style.css'),'@import "chain/first.css";\n'+await fs.readFile(path.join(cssRoot,'style.css'),'utf8'))
    await fs.writeFile(path.join(cssRoot,'chain/first.css'),'@import "nested/second.css";')
    await fs.writeFile(path.join(cssRoot,'chain/nested/second.css'),'.chain-probe{width:24px;height:24px;background-image:url("../image.svg")}')
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2468ab"/></svg>'
    await fs.writeFile(path.join(cssRoot,'chain/image.svg'),svg)
    const upload=new FormData();upload.set('file',new Blob([svg],{type:'image/svg+xml'}),'resource.svg')
    const uploadResponse=await fetch(`${api.baseUrl}/api/drafts/${site.draft.draftId}/media`,{method:'POST',headers:{Authorization:headers.Authorization},body:upload})
    expect(uploadResponse.status).toBe(201)
    const media=(await uploadResponse.json() as {media:{mediaId:string}}).media
    const now=new Date().toISOString(),collectionId=randomUUID(),itemId=randomUUID()
    const localized={schemaVersion:1,locale:'en',title:'Resource item',summary:'',cover:null,seo:{title:'Resource item',description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}
    const collection={ref:'collection',meta:{schemaVersion:1,collectionId,name:'Resources',labels:{en:'Resources'},prefix:'resources',status:'draft',levels:[],fields:[{key:'photo',label:'资料图片',type:'media',required:false,translatable:false}],structuredData:null,feed:false,createdAt:now,updatedAt:now},locale:localized}
    const item={ref:'item',collectionId,meta:{schemaVersion:1,itemId,primaryGroupId:null,groupIds:[],order:0,publishedAt:null,status:'draft',fields:{photo:{mediaId:media.mediaId}},createdAt:now,updatedAt:now},locale:{...localized,slug:'resource-item',fields:{},blocks:[{id:randomUUID(),type:'core/html',props:{html:'<div class="chain-probe">图片背景</div>'},children:[]}]}}
    for(const value of [collection,item]){const response=await fetch(`${api.baseUrl}/api/drafts/${site.draft.draftId}/content/${value.ref}`,{method:'POST',headers,body:JSON.stringify(value)});expect(response.status,await response.text()).toBe(201)}
    browser=await chromium.launch({headless:true})
    const page=await browser.newPage()
    await page.addInitScript(({token,siteId,draftId})=>{if(window!==window.top)return;localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId)},{token:accessToken,siteId:site.site.siteId,draftId:site.draft.draftId})
    const imageResponses:Array<{status:number;signed:boolean}>=[]
    page.on('response',response=>{const target=new URL(response.url());if(target.pathname.endsWith('/chain/image.svg'))imageResponses.push({status:response.status(),signed:target.searchParams.has('token')})})
    await page.goto(`${adminUrl}/content/item/${itemId}?locale=en`)
    const image=page.locator('.selected-media img').last()
    await image.waitFor({state:'visible',timeout:30000})
    await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).naturalWidth),{timeout:30000}).toBeGreaterThan(0)
    await expect.poll(()=>imageResponses.some(response=>response.status===200&&response.signed),{timeout:30000}).toBe(true)
    const first=await image.getAttribute('src')
    await expect.poll(()=>image.getAttribute('src'),{timeout:15000}).not.toBe(first)
    await expect.poll(async()=> (await fetch(first!)).status,{timeout:10000}).toBe(403)
    const current=await image.getAttribute('src')
    const token=new URL(current!).searchParams.get('token')!
    await database.query("UPDATE cms_resource_capabilities SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",[createHash('sha256').update(token).digest('hex')])
    expect((await fetch(current!)).status).toBe(403)
    await image.evaluate(element=>{const image=element as HTMLImageElement;const url=new URL(image.src);url.searchParams.set('reload',crypto.randomUUID());image.src=url.href})
    await expect.poll(async()=>new URL((await image.getAttribute('src'))!).searchParams.get('token'),{timeout:15000}).not.toBe(token)
    await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).naturalWidth),{timeout:15000}).toBeGreaterThan(0)
    expect((await database.query('SELECT count(*)::int AS total FROM cms_resource_capabilities')).rows[0].total).toBeGreaterThan(2)
  }finally{
    await browser?.close();await vite?.close();await api?.stop();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
    for(const key of environment){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
  }
},180000)
