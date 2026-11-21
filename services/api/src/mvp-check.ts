import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { z } from 'zod'
import type { BlockNode,ManagedSiteSettings,AppearanceConfig,MediaMeta } from '@olps/domain'
import type { ManagedContent } from './content-sandbox.js'
import { nodeRequestSchema,type GenerationNodeRequest } from './jobs/schema.js'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { decryptCredential } from './credentials.js'
import { readGa4RealtimeLeadCount,type OAuthTokens } from '@olps/connectors'

const prerequisites=['AI_API_KEY','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','META_APP_ID','META_APP_SECRET','CREDENTIALS_ENCRYPTION_KEY','MVP_CHECK_ACCOUNT','MVP_CHECK_PASSWORD','MVP_CHECK_SITE_ID','MVP_CHECK_DRAFT_ID','MVP_SFTP_CONFIG','MVP_S3_CONFIG','MVP_NGINX_BASE_URL','MVP_IIS_BASE_URL','MVP_SERVE_BASE_URL','MVP_STATIC_DEPLOY_COMMAND_JSON','MVP_GCLID']
const base=(process.env.OLPS_API_URL??`http://127.0.0.1:${appConfig.port}`).replace(/\/$/,'')
const outputRoot=path.join(appConfig.root,'.intermediate/mvp-check',new Date().toISOString().replaceAll(':','-'))
const steps:Array<{step:number;name:string;status:string;error?:string}>=[]
let token=''
async function api<T>(method:string,url:string,body?:unknown,revision?:string):Promise<T>{
  const headers:Record<string,string>={}
  if(token)headers.Authorization=`Bearer ${token}`
  if(method==='POST'&&url.startsWith('/jobs/'))headers['Idempotency-Key']=randomUUID()
  if(revision)headers['If-Match']=`"${revision}"`
  if(body!==undefined && !(body instanceof FormData))headers['Content-Type']='application/json'
  const response=await fetch(`${base}/api${url}`,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)})
  const text=await response.text()
  if(!response.ok)throw new Error(`${method} ${url}：${response.status} ${text}`)
  return(text?JSON.parse(text):undefined) as T
}
async function step<T>(number:number,name:string,run:()=>Promise<T>):Promise<T>{
  try{const result=await run();steps.push({step:number,name,status:'completed'});console.log(`第${number}步通过：${name}`);return result}
  catch(error){steps.push({step:number,name,status:'failed',error:error instanceof Error?error.message:String(error)});throw error}
}
async function poll<T>(read:()=>Promise<T>,done:(value:T)=>boolean,label:string,timeout=600000):Promise<T>{
  const deadline=Date.now()+timeout
  while(Date.now()<deadline){const value=await read();if(done(value))return value;await new Promise(resolve=>setTimeout(resolve,500))}
  throw new Error(`${label}超过等待时间`)
}
type ContentResult={content:ManagedContent;revision:string}
type Publication={recordId:string;status:string;kind:string;publicUrl:string;targets?:Array<{status:string;uploaded:number}>}
async function main(){
  const missing=prerequisites.filter(key=>!process.env[key]?.trim())
  if(missing.length)throw new Error(`主流程验收缺少配置：${missing.join(', ')}。需要真实模型、已授权验收网站、SFTP/S3测试目标、有效广告点击和三种静态服务器。`)
  const siteId=z.string().uuid().parse(process.env.MVP_CHECK_SITE_ID),draftId=z.string().uuid().parse(process.env.MVP_CHECK_DRAFT_ID)
  const deployCommand=z.array(z.string()).min(1).parse(JSON.parse(process.env.MVP_STATIC_DEPLOY_COMMAND_JSON!))
  const siteScope=`/sites/${siteId}`,scope=`/drafts/${draftId}`
  const login=await api<{accessToken:string}>('POST','/auth/login',{account:process.env.MVP_CHECK_ACCOUNT,password:process.env.MVP_CHECK_PASSWORD})
  token=login.accessToken;assert.ok(token)
  const integrations=await api<{integrations:Array<{connector:string;status:string;missingEnvironment:string[]}>}>('GET',`${scope}/integrations`)
  for(const connector of ['googleAds','ga4','meta']){const row=integrations.integrations.find(value=>value.connector===connector);assert.equal(row?.status,'connected',`${connector}需要完成真实OAuth授权`);assert.deepEqual(row.missingEnvironment,[])}
  await fs.mkdir(outputRoot,{recursive:true})
  const read=(ref:string,id:string,locale='en')=>api<ContentResult>('GET',`${scope}/content/${ref}/${id}?locale=${locale}`)
  const save=(id:string,result:ContentResult)=>api<ContentResult>('PUT',`${scope}/content/${result.content.ref}/${id}`,result.content,result.revision)
  const list=async(plural:string,collectionId?:string)=>{const route=collectionId?`${scope}/collections/${collectionId}/${plural}`:`${scope}/${plural}`;return(await api<Record<string,ManagedContent[]>>('GET',`${route}?locale=en&limit=200`))[plural]!}
  const runJob=async(type:string,request:Record<string,unknown>)=>{
    type Job={jobId:string;status:string;result:unknown;error:unknown}
    const created=await api<{job:Job}>('POST',`/jobs/${type}`,{draftId,locale:'en',...request})
    const result=await poll(()=>api<{job:Job}>('GET',`/jobs/${created.job.jobId}`),value=>{if(value.job.status==='failed')throw new Error(`AI ${type}失败：${JSON.stringify(value.job.error)}`);return value.job.status==='completed'},`AI ${type}`)
    assert.equal(result.job.status,'completed');return result.job.result
  }
  await step(1,'注册、登录与异步创建八职责默认网站',async()=>{
    const suffix=randomUUID(),previous=token
    const createdUser=await api<{accessToken:string}>('POST','/auth/register',{account:`mvp-${suffix}`,password:`Mvp-${suffix}`,name:'验收运营'})
    token=createdUser.accessToken
    try{
      const created=await api<{site:{siteId:string};draft:{draftId:string}}>('POST','/sites',{name:'主流程初始化验收'})
      await poll(()=>api<{initStatus:string;error:string}>('GET',`/sites/${created.site.siteId}/initialization`),value=>{if(value.initStatus==='failed')throw new Error(value.error);return value.initStatus==='ready'},'初始化',120000)
      const pages=await api<{pages:ManagedContent[]}>('GET',`/drafts/${created.draft.draftId}/pages?locale=en`)
      assert.equal(pages.pages.filter(value=>value.meta.role).length,8)
    }finally{token=previous}
    assert.equal((await api<{draft:{siteId:string}}>('GET',scope)).draft.siteId,siteId)
  })
  await step(2,'保存公司信息和英文、简体中文',async()=>{
    const current=await api<{settings:ManagedSiteSettings;revision:string}>('GET',`${scope}/settings`)
    current.settings.company={name:'MVP Manufacturing',address:'100 Test Road',phone:'+1-202-555-0100',email:'sales@example.com'}
    assert.ok(['en','zh-CN'].every(code=>current.settings.locales.some(locale=>locale.code===code)))
    current.settings.defaultLocale='en';await api('PUT',`${scope}/settings`,{settings:current.settings},current.revision)
  })
  const collections=await list('collections'),products=collections.find(value=>value.meta.prefix==='products')!
  assert.ok(products,'产品内容类型不存在');const collectionId=String(products.meta.collectionId)
  const knowledge=await api<{document:{documentId:string}}>('POST',`${siteScope}/knowledge-base/documents`,{title:'主流程验收资料',content:'MVP Manufacturing生产工业泵，规格包含材质、功率与流量。公司地址100 Test Road，销售邮箱sales@example.com。'})
  const common={knowledgeDocumentIds:[knowledge.document.documentId]}
  let nodes:GenerationNodeRequest[]=[]
  const flatten=(values:GenerationNodeRequest[]):GenerationNodeRequest[]=>values.flatMap(value=>[value,...flatten(value.children??[])])
  await step(3,'真实模型生成完整网站结构',async()=>{
    const result=await runJob('propose_site_structure',{...common,instruction:`保留八个必备页面。生成两个产品系列，每个系列两个分类，每个分类三个产品，三条新闻、两个解决方案。产品使用collectionId=${collectionId}，已有内容类型=${JSON.stringify(collections.map(value=>value.meta))}，全部节点使用独立UUID。`})
    nodes=z.object({nodes:z.array(nodeRequestSchema)}).parse(result).nodes
    assert.ok(flatten(nodes).filter(value=>value.ref==='item'&&value.collectionId===collectionId).length>=12,'结构缺少12个产品')
    assert.ok(flatten(nodes).filter(value=>value.ref==='group'&&value.collectionId===collectionId).length>=6,'结构缺少产品系列和分类')
    for(const [prefix,minimum] of [['news',3],['solutions',2]] as const){const collection=collections.find(value=>value.meta.prefix===prefix);assert.ok(collection,`缺少${prefix}内容类型`);assert.ok(flatten(nodes).filter(value=>value.ref==='item'&&value.collectionId===collection.meta.collectionId).length>=minimum,`结构缺少${prefix}内容`)}
  })
  await step(4,'编辑结构树并完成全部内容生成',async()=>{
    let removed=false
    const remove=(values:GenerationNodeRequest[]):GenerationNodeRequest[]=>values.filter(value=>{if(!removed&&value.ref==='item'&&value.collectionId===collectionId){removed=true;return false}return true}).map(value=>({...value,children:remove(value.children??[])}))
    nodes=remove(nodes);assert.ok(removed)
    nodes.push({nodeId:randomUUID(),ref:'group',collectionId,title:'Additional category',requirements:'增加一个有效产品分类，使用产品内容类型的分组层级定义。'})
    await runJob('generate_nodes',{...common,nodes,instruction:'生成全部内容，产品使用published状态，保留现有必备页面。'})
  })
  let productId=''
  await step(5,'编辑产品标题、区块顺序和规格表',async()=>{
    const items=await list('items',collectionId);assert.ok(items.length>=11);productId=String(items[0]!.meta.itemId)
    const current=await read('item',productId);current.content.locale.title='MVP verified industrial pump'
    current.content.locale.blocks=(current.content.locale.blocks as BlockNode[]).reverse()
    current.content.locale.fields={...(current.content.locale.fields as Record<string,unknown>),specifications:[{name:'Material',value:'Stainless steel'},{name:'Power',value:'1500 W'}]}
    current.content.meta.status='published';await save(productId,current)
  })
  await step(6,'真实模型仅重写选中区块',async()=>{
    const before=await read('item',productId),selected=(before.content.locale.blocks as BlockNode[])[0]!;assert.ok(selected)
    const other=(before.content.locale.blocks as BlockNode[]).filter(value=>value.id!==selected.id)
    await runJob('rewrite_block',{...common,target:{ref:'item',id:productId},blockId:selected.id,instruction:'使用准确清楚的英文改写当前区块，保留其他全部内容。'})
    const after=(await read('item',productId)).content.locale.blocks as BlockNode[]
    assert.notDeepEqual(after.find(value=>value.id===selected.id),selected);assert.deepEqual(after.filter(value=>value.id!==selected.id),other)
  })
  await step(7,'产品关联两个分类并保留主要分类',async()=>{
    const groups=await list('groups',collectionId);assert.ok(groups.length>=2)
    const current=await read('item',productId),ids=groups.slice(0,2).map(value=>String(value.meta.groupId))
    current.content.meta.groupIds=ids;current.content.meta.primaryGroupId=ids[0];await save(productId,current)
    assert.deepEqual((await read('item',productId)).content.meta.groupIds,ids)
  })
  let media:MediaMeta
  const image=async(color:string)=>{const bytes=await sharp({create:{width:640,height:480,channels:3,background:color}}).png().toBuffer();const form=new FormData();form.set('file',new File([new Uint8Array(bytes)],'product.png',{type:'image/png'}));return form}
  await step(8,'真实图片上传、替代文字和引用位置',async()=>{
    const result=await api<{media:MediaMeta;revision:string}>('POST',`${scope}/media`,await image('#235a8c'));media=result.media
    media.alt={en:'Industrial pump','zh-CN':'工业泵'};await api('PUT',`${scope}/media/${media.mediaId}`,{alt:media.alt},result.revision)
    const product=await read('item',productId);product.content.locale.cover={mediaId:media.mediaId}
    product.content.locale.blocks=[...(product.content.locale.blocks as BlockNode[]),{id:randomUUID(),type:'core/image',props:{image:{mediaId:media.mediaId},alt:'Industrial pump'},children:[]}];await save(productId,product)
    assert.ok((await api<{usages:unknown[]}>('GET',`${scope}/media/${media.mediaId}/usages`)).usages.length)
  })
  await step(9,'保存主色、Logo和分组菜单',async()=>{
    const current=await api<{appearance:AppearanceConfig;revision:string}>('GET',`${scope}/appearance`),group=(await list('groups',collectionId))[0]!
    current.appearance.themeSettings.primaryColor='#146b53';current.appearance.themeSettings.logo={mediaId:media!.mediaId}
    current.appearance.menus.primary!.push({menuItemId:randomUUID(),label:{en:'Featured category','zh-CN':'精选分类'},link:{kind:'internal',target:{ref:'group',id:String(group.meta.groupId)}},children:[]})
    await api('PUT',`${scope}/appearance`,current.appearance,current.revision)
  })
  await step(10,'启用WhatsApp并保存号码',async()=>{
    const current=await api<{revision:string}>('GET',`${scope}/plugins`);await api('PUT',`${scope}/plugins/whatsapp`,{enabled:true,confirmPermissions:true},current.revision)
    const settings=await api<{settings:Record<string,unknown>;revision:string}>('GET',`${scope}/plugins/whatsapp/settings`);await api('PUT',`${scope}/plugins/whatsapp/settings`,{settings:{...settings.settings,phone:'12025550100'}},settings.revision)
  })
  await step(11,'Google Ads、GA4、Meta真实授权账户查询',async()=>{for(const connector of ['googleAds','ga4','meta'])assert.ok((await api<{accounts:unknown[]}>('GET',`${scope}/integrations/${connector}/accounts`)).accounts.length)})
  await step(12,'真实模型完成中文翻译',async()=>{await runJob('translate_node',{...common,target:{ref:'item',id:productId},targetLocale:'zh-CN',instruction:'准确翻译产品和规格，保留英文原文。'});assert.ok((await read('item',productId,'zh-CN')).content.locale.sourceHash)})
  const publish=async()=>{const response=await api<{record:Publication}>('POST',`${siteScope}/publish`,{draftId,requestKey:randomUUID()});assert.equal(response.record.status,'completed');response.record.publicUrl=response.record.publicUrl.replace(/\/$/,'');return response.record}
  let record=await step(13,'托管网站发布与公开访问',async()=>{const value=await publish();assert.equal((await fetch(`${value.publicUrl}/en/`)).status,200);return value})
  let legacyProductSlug=''
  await step(14,'真实SFTP和S3增量发布',async()=>{
    for(const type of ['sftp','s3'])await api('POST',`${siteScope}/deploy-targets`,{name:`MVP ${type}`,type,enabled:true,config:JSON.parse(process.env[`MVP_${type.toUpperCase()}_CONFIG`]!)})
    const current=await read('item',productId);legacyProductSlug=String(current.content.locale.slug);current.content.locale.slug=`${legacyProductSlug}-verified`;await save(productId,current)
    for(let iteration=0;iteration<2;iteration++){
      record=await publish();const history=await api<{records:Publication[]}>('GET',`${siteScope}/publish-records`),targets=history.records.find(value=>value.recordId===record.recordId)!.targets!
      assert.ok(targets.length>=2);assert.ok(targets.every(value=>value.status==='completed'));if(iteration===1)assert.ok(targets.every(value=>value.uploaded===0))
    }
  })
  await step(15,'替换图片并执行资源专用发布',async()=>{const current=await api<{revision:string}>('GET',`${scope}/media/${media!.mediaId}`);await api('POST',`${scope}/media/${media!.mediaId}/replace`,await image('#8c4523'),current.revision);record=await publish();assert.equal(record.kind,'assets_only')})
  const browser=await chromium.launch()
  let inquiryId=''
  const ga4=async()=>{
    const result=await pool.query("SELECT c.account_id,t.ciphertext FROM integration_connections c JOIN integration_credentials t USING(scope_key) WHERE c.site_id=$1 AND c.scope_key=$2 AND c.connector='ga4' AND c.status='connected' AND t.provider='google'",[siteId,`site:${siteId}`])
    assert.equal(result.rowCount,1,'验收网站缺少可验证的Google OAuth凭据')
    const row=result.rows[0],tokens=JSON.parse(decryptCredential(row.ciphertext,`site:${siteId}/google`)) as OAuthTokens
    return readGa4RealtimeLeadCount(tokens,row.account_id)
  }
  let ga4Before=0
  try{
    const page=await browser.newPage()
    await step(16,'真实浏览器同意Cookie并提交带广告来源的询盘',async()=>{
      ga4Before=(await ga4()).count
      await page.goto(`${record.publicUrl}/en/contact/?gclid=${encodeURIComponent(process.env.MVP_GCLID!)}&utm_source=google&utm_medium=cpc&utm_campaign=mvp&utm_term=industrial-pump`)
      await page.getByRole('button',{name:/接受全部|Accept all/i}).click()
      const form=page.locator('form[data-olps-inquiry-form]');await form.locator('[name="name"]').fill('MVP visitor');await form.locator('[name="email"]').fill('mvp-visitor@example.com');await form.locator('[name="message"]').fill('Please provide industrial pump information.');await form.locator('[name="privacyConsent"]').check()
      const submitted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/inquiries'))
      const ga4Received=page.waitForResponse(response=>{const url=new URL(response.url()),query=url.searchParams,body=new URLSearchParams(response.request().postData()??'');return /(^|\.)google-analytics\.com$/.test(url.hostname)&&(query.get('en')??body.get('en'))==='generate_lead'},{timeout:120000})
      await form.locator('button[type="submit"]').click();const response=await submitted;assert.equal(response.status(),201);inquiryId=(await response.json() as {inquiryId:string}).inquiryId
      await page.waitForURL(/\/thank-you\//)
      assert.ok((await ga4Received).ok(),'GA4未接收浏览器generate_lead事件')
    })
    type Inquiry={inquiryId:string;locale:string;payload:{contentTitle:string;attribution:Record<string,string>};deliveries:Array<{kind:string;status:string;error:string|null}>}
    const inquiry=async()=>{const result=await api<{inquiries:Inquiry[]}>('GET',`${siteScope}/inquiries`);const value=result.inquiries.find(value=>value.inquiryId===inquiryId);assert.ok(value);return value}
    await step(17,'询盘显示页面、语言、广告系列和关键词',async()=>{const value=await inquiry();assert.equal(value.locale,'en');assert.ok(value.payload.contentTitle);assert.equal(value.payload.attribution.utm_campaign,'mvp');assert.equal(value.payload.attribution.utm_term,'industrial-pump')})
    await step(18,'有效询盘Google Ads离线转化、提交转化与GA4平台观测',async()=>{
      await api('PATCH',`${siteScope}/inquiries/${inquiryId}`,{status:'qualified'})
      await poll(inquiry,value=>{const conversions=value.deliveries.filter(delivery=>delivery.kind.includes('conversion'));assert.ok(conversions.length);for(const delivery of conversions)if(['failed','blocked'].includes(delivery.status))throw new Error(`转化发送失败：${delivery.error}`);return conversions.every(delivery=>delivery.status==='completed')},'转化发送')
      const observation=await poll(ga4,value=>value.count>ga4Before,'GA4实时generate_lead观测')
      await fs.writeFile(path.join(outputRoot,'ga4-observation.json'),JSON.stringify({before:ga4Before,...observation},null,2))
    })
    await step(19,'全站报告覆盖四类内容和两种语言',async()=>{const report=await api<{content:Array<{target:{ref:string};locale:string}>}>('GET',`${siteScope}/reports?draftId=${draftId}`);for(const locale of ['en','zh-CN'])assert.ok(report.content.some(value=>value.locale===locale));for(const ref of ['page','collection','group','item'])assert.ok(report.content.some(value=>value.target.ref===ref))})
    await step(20,'历史ZIP和nginx、IIS、serve多语言静态网站',async()=>{
      const response=await fetch(`${base}/api${siteScope}/publish-records/${record.recordId}/download.zip`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200)
      const zip=path.join(outputRoot,'website.zip'),directory=path.join(outputRoot,'website');await fs.writeFile(zip,Buffer.from(await response.arrayBuffer()));await fs.mkdir(directory);execFileSync('unzip',['-q',zip,'-d',directory]);execFileSync(deployCommand[0]!,[...deployCommand.slice(1),zip,directory],{stdio:'inherit'})
      const product=(await read('item',productId)).content,slug=String(product.locale.slug)
      const publicRoot=path.join(directory,'public'),artifacts:Array<{file:string;sha256:string}>=[]
      const collect=async(relative:string):Promise<void>=>{for(const entry of await fs.readdir(path.join(publicRoot,relative),{withFileTypes:true})){const file=path.posix.join(relative,entry.name);if(entry.isSymbolicLink())throw new Error('网站产物包含符号链接');if(entry.isDirectory())await collect(file);else{assert.ok(entry.isFile());artifacts.push({file,sha256:createHash('sha256').update(await fs.readFile(path.join(publicRoot,file))).digest('hex')})}}}
      await collect('');assert.ok(artifacts.length)
      for(const variable of ['MVP_NGINX_BASE_URL','MVP_IIS_BASE_URL','MVP_SERVE_BASE_URL']){
        const host=process.env[variable]!.replace(/\/$/,'');await page.goto(`${host}/`);await page.waitForURL(/\/en\/$/)
        for(const artifact of artifacts){const file=await fetch(`${host}/${artifact.file.split('/').map(encodeURIComponent).join('/')}`);assert.equal(file.status,200,`${variable}/${artifact.file}`);assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),artifact.sha256,`${variable}/${artifact.file}与下载产物不一致`)}
        for(const file of ['en/','zh-CN/','en/products/',`en/products/${slug}/`,'sitemap.xml','robots.txt','llms.txt','feed.xml'])assert.equal((await fetch(`${host}/${file}`)).status,200,`${variable}/${file}`)
        assert.equal((await fetch(`${host}/missing-${randomUUID()}/`)).status,404)
        await page.goto(`${host}/en/products/${legacyProductSlug}/`);await page.waitForURL(url=>url.pathname.endsWith(`/${slug}/`))
        for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});await page.goto(`${host}/en/products/${slug}/`);assert.equal(await page.locator('h1').count(),1);assert.ok(await page.locator('img').count());assert.ok(await page.locator('link[rel="canonical"]').count());assert.ok(await page.locator('link[hreflang="zh-CN"]').count())}
        const results=await page.evaluate(async(moduleUrl)=>{const pagefind=await import(moduleUrl) as {search(query:string):Promise<{results:unknown[]}>};return(await pagefind.search('industrial')).results.length},`${host}/pagefind/pagefind.js`);assert.ok(results,'静态站内搜索没有返回产品')
        const translated=page.locator('a[hreflang="zh-CN"]').first();await translated.click();assert.ok(new URL(page.url()).pathname.includes('/zh-CN/'))
        const rejected=await browser.newContext()
        try{const visitor=await rejected.newPage(),tracking:string[]=[];visitor.on('request',request=>{if(/googletagmanager\.com\/gtag|connect\.facebook\.net/.test(request.url()))tracking.push(request.url())});await visitor.goto(`${host}/en/`);await visitor.getByRole('button',{name:/拒绝|Reject/i}).click();await visitor.waitForLoadState('networkidle');assert.deepEqual(tracking,[],'拒绝Cookie后仍然加载广告或分析脚本')}finally{await rejected.close()}
      }
    })
  }finally{await browser.close()}
  assert.equal(steps.length,20);assert.ok(steps.every(value=>value.status==='completed'));console.log('CMS 主流程20步验收通过')
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1}).finally(async()=>{if(steps.length){await fs.mkdir(outputRoot,{recursive:true});await fs.writeFile(path.join(outputRoot,'results.json'),JSON.stringify({status:steps.length===20&&steps.every(value=>value.status==='completed')?'completed':'failed',steps},null,2))}await pool.end()})
