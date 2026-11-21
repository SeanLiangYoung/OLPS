import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {Hono} from 'hono'
import {serve} from '@hono/node-server'
import {expect,it} from 'vitest'
import {migrateWithClient} from './db.js'
import {migrateCmsRuntime} from './cms-runtime-schema.js'
import {createCmsSite,initializeCmsSite} from './cms-sites.js'
import {createCmsDraft} from './cms-drafts.js'
import {CmsPublicationService} from './cms-publication.js'
import {CmsPreviewService} from './cms-preview.js'
import {encryptCredential} from './credentials.js'
import {requireRemoteServiceConfig} from './remote-service-config.js'
import {createCmsPluginApiRoutes,createCmsPluginApiSchema} from './cms-plugin-api.js'
type ManifestField={key:string;type:string;label:string;required:boolean;translatable:boolean;default?:unknown;itemFields?:ManifestField[]}
import {createCmsPublicRoutes} from './cms-public-routes.js'

it('自定义插件API使用发布版本和密钥，真实isolate与PG隔离预览、网站和询盘来源',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`plugin_api_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:url})
  await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`}),root=path.resolve('../../.intermediate/plugin-api',schema)
  let server:ReturnType<typeof serve>|undefined
  try{
    const client=await database.connect();await migrateWithClient(client);client.release();await migrateCmsRuntime(database,{sandboxRoot:root});await createCmsPluginApiSchema(database)
    await database.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const session=randomUUID();await database.query("INSERT INTO sessions VALUES($1,'owner',$2,NOW()+INTERVAL '1 hour',NOW())",[session,randomUUID()])
    const previews=new CmsPreviewService(database,root,path.join(root,'previews')),publisher=new CmsPublicationService(database,root,requireRemoteServiceConfig())
    const sites=[]
    const script=(label:string)=>`exports.handle=async function(request,ctx){ctx.log('info','key '+ctx.settings.apiKey,{secret:ctx.settings.apiKey});if(!ctx.settings.apiKey.startsWith(ctx.settings.label+'-'+ctx.settings.secretVersion+'-'))throw new Error('key mismatch');if(request.path==='/unsafe')return {status:302,headers:{'set-cookie':'admin=true','location':'https://example.com'},body:''};if(request.path==='/cookie')return {status:200,headers:{'set-cookie':'admin=true'},body:{}};if(request.path==='/html')return {status:200,headers:{'content-type':'text/html'},body:'<script>alert(1)</script>'};if(request.path==='/status')return {status:700,body:{}};if(request.path==='/large')return {status:200,body:'x'.repeat(1100000)};if(request.path==='/forbidden-fetch'){await ctx.fetch('https://example.com/');}if(request.path==='/fetch')return {status:200,body:await ctx.fetch(request.query.url)};if(request.path==='/inquiry')return {status:201,body:await ctx.inquiries.create(request.body)};if(request.path==='/state'){const key=request.query.key||'value';if(request.method==='POST')await ctx.store.set(key,request.body.value);if(request.method==='DELETE')await ctx.store.delete(key);return {status:200,body:{value:await ctx.store.get(key)}};}return {status:200,headers:{'content-type':'application/json'},body:{code:'${label}',authorized:true,headers:request.headers,label:ctx.settings.label}};}`
    const guardedScript=(label:string)=>script(label)+`;const originalHandle=exports.handle;exports.handle=async function(request,ctx){if(ctx.settings.defaultGreeting!=='Hello from manifest'||ctx.settings.explicitChoice!==''||ctx.settings.featureEnabled!==false||ctx.settings.links[0].label!=='Nested label'||ctx.settings.caption.en!=='English caption'||'unusedSecret' in ctx.settings)throw new Error('插件设置默认值无效');const result=await originalHandle(request,ctx);if(request.path==='/inspect')result.body.defaultGreeting=ctx.settings.defaultGreeting;return result;};`
    for(const label of ['first','second']){
      const site=await createCmsSite('owner',label,database,root);expect(await initializeCmsSite('owner',site.siteId,database,root)).toEqual({initStatus:'ready'})
      const draft=(await database.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0],directory=path.join(root,draft.sandbox_id)
      await fs.mkdir(path.join(directory,'plugins','custom-api','server'),{recursive:true})
      const manifest={schemaVersion:1,id:'custom-api',name:'Custom API',version:'1',author:'OLPS',description:'API acceptance',requires:'1',settings:[{key:'label',type:'text',label:'Website',required:true,translatable:false},{key:'secretVersion',type:'text',label:'Version',required:true,translatable:false},{key:'apiKey',type:'secret',label:'Key',required:true,translatable:false}] as ManifestField[],snippets:[],assets:[],server:{api:'server/api.js'},permissions:{store:true,inquiries:true,fetch:['127.0.0.1']}}
      manifest.settings.push({key:'defaultGreeting',type:'text',label:'Greeting',required:false,translatable:false,default:'Hello from manifest'} as typeof manifest.settings[number])
      manifest.settings.push(...[{key:'explicitChoice',type:'text',label:'Choice',required:false,translatable:false,default:'Default choice'},{key:'featureEnabled',type:'boolean',label:'Feature',required:false,translatable:false,default:true},{key:'links',type:'list',label:'Links',required:false,translatable:false,default:[{}],itemFields:[{key:'label',type:'text',label:'Label',required:false,translatable:false,default:'Nested label'}]},{key:'caption',type:'text',label:'Caption',required:false,translatable:true,default:{en:'English caption','zh-CN':'中文文字'}},{key:'unusedSecret',type:'secret',label:'Private',required:false,translatable:false,default:'Manifest private value'}] as typeof manifest.settings)
      await fs.writeFile(path.join(directory,'plugins/custom-api/plugin.json'),JSON.stringify(manifest));await fs.writeFile(path.join(directory,'plugins/custom-api/server/api.js'),guardedScript('published'))
      const config=JSON.parse(await fs.readFile(path.join(directory,'source/plugins.json'),'utf8'));config.plugins['custom-api']={enabled:true,permissionsAcceptedAt:new Date().toISOString(),permissionsAcceptedBy:'owner',settings:{label,secretVersion:'published',explicitChoice:'',featureEnabled:false,unusedSecret:'Source private value'}};await fs.writeFile(path.join(directory,'source/plugins.json'),JSON.stringify(config))
      const secret=`${label}-published-${randomUUID()}`;await database.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,$3,$4)',[site.draftId,site.siteId,'custom-api',encryptCredential(JSON.stringify({apiKey:secret}),`${site.siteId}/custom-api`)])
      expect((await publisher.publish('owner',site.siteId,site.draftId,randomUUID())).status).toBe('completed')
      sites.push({...site,directory,secret,config})
    }
    const app=new Hono();let upstreamRequests=0;app.get('/upstream',c=>{upstreamRequests++;return c.text('real upstream')});app.get('/redirect',c=>c.redirect('https://example.com/'));app.route('/api',createCmsPublicRoutes(previews));app.route('/api',createCmsPluginApiRoutes(previews,database,root))
    const base=await new Promise<string>(resolve=>{server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0},info=>resolve(`http://127.0.0.1:${info.port}`))})
    const a=sites[0]!,b=sites[1]!,publicPath=(siteId:string)=>`${base}/api/public/${siteId}/plugins/custom-api`
    const preflight=await fetch(`${publicPath(a.siteId)}/inspect`,{method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}})
    expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    const call=async(url:string,value?:unknown)=>fetch(url,{method:value===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer visitor-private',Cookie:'session=visitor-private','X-Private':'visitor-private'},...(value===undefined?{}:{body:JSON.stringify(value)})})
    const published=await call(`${publicPath(a.siteId)}/inspect`);expect(published.status,await published.clone().text()).toBe(200);const inspection=await published.json();expect(inspection).toMatchObject({code:'published',authorized:true,label:'first',defaultGreeting:'Hello from manifest'});expect(JSON.stringify(inspection)).not.toContain('visitor-private')
    await fs.writeFile(path.join(a.directory,'plugins/custom-api/server/api.js'),guardedScript('draft'))
    const nextSecret=`first-draft-${randomUUID()}`;await database.query('UPDATE plugin_secrets SET ciphertext=$1 WHERE draft_id=$2 AND plugin_id=$3',[encryptCredential(JSON.stringify({apiKey:nextSecret}),`${a.siteId}/custom-api`),a.draftId,'custom-api']);a.config.plugins['custom-api'].settings.secretVersion='draft';await fs.writeFile(path.join(a.directory,'source/plugins.json'),JSON.stringify(a.config))
    expect(await(await call(`${publicPath(a.siteId)}/inspect`)).json()).toMatchObject({code:'published',authorized:true})
    const capability=await previews.create('owner',session,a.draftId,{locale:'en'}),token=capability.previewUrl.split('/')[2]!,previewPath=`${base}/api/preview-access/${token}/plugins/custom-api`
    expect(await(await call(`${previewPath}/inspect`)).json()).toMatchObject({code:'draft',authorized:true})
    expect(await(await call(`${publicPath(a.siteId)}/state`,{value:'public-first'})).json()).toEqual({value:'public-first'})
    expect(await(await call(`${previewPath}/state`)).json()).toEqual({value:null})
    expect(await(await call(`${previewPath}/state`,{value:'preview-first'})).json()).toEqual({value:'preview-first'})
    const cloned=await createCmsDraft('owner',a.siteId,'Separate preview storage',database,root),otherCapability=await previews.create('owner',session,cloned.draftId,{locale:'en'}),otherToken=otherCapability.previewUrl.split('/')[2]!
    expect(await(await call(`${base}/api/preview-access/${otherToken}/plugins/custom-api/state`)).json()).toEqual({value:null})
    expect(await(await call(`${publicPath(b.siteId)}/state`)).json()).toEqual({value:null})
    await database.query("INSERT INTO plugin_store(site_id,plugin_id,source,draft_scope,key,value) SELECT $1,'custom-api','public','','quota-'||n,to_jsonb(repeat('x',1000)) FROM generate_series(1,1000) n",[b.siteId])
    const replaced=await call(`${publicPath(b.siteId)}/state?key=quota-1`,{value:'y'.repeat(47000)});expect(replaced.status,await replaced.clone().text()).toBe(200)
    expect((await call(`${publicPath(b.siteId)}/state?key=quota-new`,{value:'new'})).status).toBe(502)
    expect((await database.query("SELECT count(*) AS count,sum(octet_length(value::text)) AS bytes FROM plugin_store WHERE site_id=$1 AND source='public'",[b.siteId])).rows[0]).toMatchObject({count:'1000',bytes:'1048000'})
    const removed=await fetch(`${publicPath(b.siteId)}/state?key=quota-1`,{method:'DELETE'});expect(await removed.json()).toEqual({value:null})
    expect(await(await call(`${publicPath(a.siteId)}/state`)).json()).toEqual({value:'public-first'})
    const unsafe=await call(`${publicPath(a.siteId)}/unsafe`);expect(unsafe.status).toBe(502);expect(unsafe.headers.get('set-cookie')).toBeNull();expect(unsafe.headers.get('location')).toBeNull()
    for(const endpoint of ['cookie','html','status','large'])expect((await call(`${publicPath(a.siteId)}/${endpoint}`)).status,endpoint).toBe(502)
    expect(published.headers.get('x-content-type-options')).toBe('nosniff');expect(published.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect((await call(`${publicPath(a.siteId)}/state`,{value:'x'.repeat(65000)})).status).toBe(400)
    expect(await(await call(`${publicPath(a.siteId)}/fetch?url=${encodeURIComponent(`${base}/upstream`)}`)).json()).toMatchObject({status:200,body:'real upstream'});expect(upstreamRequests).toBe(1)
    expect((await call(`${publicPath(a.siteId)}/fetch?url=${encodeURIComponent(`${base}/redirect`)}`)).status).toBe(502)
    expect((await call(`${publicPath(a.siteId)}/forbidden-fetch`)).status).toBe(502)
    expect((await call(`${base}/api/public/${a.siteId}/plugins/unknown/inspect`)).status).toBe(404)
    await database.query("UPDATE sites SET status='unpublished' WHERE site_id=$1",[b.siteId]);expect((await call(`${publicPath(b.siteId)}/inspect`)).status).toBe(404);await database.query("UPDATE sites SET status='published' WHERE site_id=$1",[b.siteId])
    a.config.plugins['custom-api'].enabled=false;await fs.writeFile(path.join(a.directory,'source/plugins.json'),JSON.stringify(a.config));expect((await call(`${previewPath}/inspect`)).status).toBe(404)
    a.config.plugins['custom-api'].enabled=true;a.config.plugins['custom-api'].permissionsAcceptedAt=null;a.config.plugins['custom-api'].permissionsAcceptedBy=null;await fs.writeFile(path.join(a.directory,'source/plugins.json'),JSON.stringify(a.config));expect((await call(`${previewPath}/inspect`)).status).toBe(404)
    a.config.plugins['custom-api'].permissionsAcceptedAt=new Date().toISOString();a.config.plugins['custom-api'].permissionsAcceptedBy='owner';await fs.writeFile(path.join(a.directory,'source/plugins.json'),JSON.stringify(a.config))
    const contact=JSON.parse(await fs.readFile(path.join(a.directory,'source/pages/11111111-1111-4111-8111-111111111103/en.json'),'utf8'))
    const form=contact.blocks.find((block:{type:string})=>block.type==='plugin/inquiry-form/form')
    const inquiry={target:{ref:'page',id:'11111111-1111-4111-8111-111111111103'},locale:'en',formId:form.id,fields:{name:'Plugin inquiry',email:'plugin@example.com',message:'Preview request'},privacyConsent:true,eventId:randomUUID()}
    const created=await call(`${previewPath}/inquiry`,inquiry);expect(created.status,await created.clone().text()).toBe(201)
    const row=(await database.query('SELECT * FROM inquiries WHERE cms_id=$1',[(await created.json() as {inquiryId:string}).inquiryId])).rows[0];expect(row.source).toBe('preview');expect(row.draft_id).toBe(a.draftId);expect((await database.query('SELECT * FROM cms_outbound_tasks WHERE inquiry_id=$1',[row.inquiry_id])).rowCount).toBe(0)
    const publicInquiry=await call(`${publicPath(a.siteId)}/inquiry`,{...inquiry,eventId:randomUUID()});expect(publicInquiry.status,await publicInquiry.clone().text()).toBe(201);const publicRow=(await database.query('SELECT * FROM inquiries WHERE cms_id=$1',[(await publicInquiry.json() as {inquiryId:string}).inquiryId])).rows[0];expect(publicRow.source).toBe('public');expect(publicRow.draft_id).toBeNull();expect((await database.query('SELECT * FROM cms_outbound_tasks WHERE inquiry_id=$1',[publicRow.inquiry_id])).rowCount).toBeGreaterThan(0)
    const logs=await database.query('SELECT * FROM plugin_logs');expect(logs.rowCount).toBeGreaterThan(0);for(const secret of [...sites.map(site=>site.secret),nextSecret])expect(JSON.stringify(logs.rows)).not.toContain(secret)
    const manifestPath=path.join(a.directory,'plugins/custom-api/plugin.json'),originalManifest=JSON.parse(await fs.readFile(manifestPath,'utf8'))
    await database.query("INSERT INTO plugin_store(site_id,plugin_id,source,draft_scope,key,value) VALUES($1,'custom-api','preview',$2,'protected','123')",[a.siteId,a.draftId])
    const inquiryCount=Number((await database.query('SELECT count(*) FROM inquiries')).rows[0].count)
    const attacks=[
      "return globalThis.__olps_store_get.applySyncPromise(undefined,['protected'])",
      "return globalThis.__olps_store_set.applySyncPromise(undefined,['protected','456'])",
      "return globalThis.__olps_store_delete.applySyncPromise(undefined,['protected'])",
      `return globalThis.__olps_inquiries_create.applySyncPromise(undefined,[JSON.stringify(${JSON.stringify({...inquiry,eventId:randomUUID()})})])`,
      `return globalThis.__olps_fetch.applySyncPromise(undefined,[${JSON.stringify(`${base}/upstream`)},null])`,
    ]
    await fs.writeFile(manifestPath,JSON.stringify({...originalManifest,permissions:{}}))
    for(const attack of attacks){
      await fs.writeFile(path.join(a.directory,'plugins/custom-api/server/api.js'),`exports.handle=function(){${attack}}`)
      const denied=await call(`${previewPath}/bridge`)
      expect(denied.status,attack+await denied.clone().text()).toBe(502)
      expect(await denied.text()).toContain('permission')
    }
    expect((await database.query("SELECT value FROM plugin_store WHERE site_id=$1 AND source='preview' AND draft_scope=$2 AND key='protected'",[a.siteId,a.draftId])).rows).toEqual([{value:123}])
    expect(Number((await database.query('SELECT count(*) FROM inquiries')).rows[0].count)).toBe(inquiryCount)
    expect(upstreamRequests).toBe(1)
    await fs.writeFile(manifestPath,JSON.stringify(originalManifest))
    await fs.writeFile(path.join(a.directory,'plugins/custom-api/server/api.js'),"exports.handle=function(){return globalThis.__olps_fetch.applySyncPromise(undefined,['https://example.com/',null])}")
    const forbiddenBridgeFetch=await call(`${previewPath}/bridge`)
    expect(forbiddenBridgeFetch.status).toBe(502)
    expect(await forbiddenBridgeFetch.text()).toContain('fetch host not allowed')
    await fs.writeFile(path.join(a.directory,'plugins/custom-api/server/api.js'),guardedScript('draft'))
    b.config.plugins['custom-api'].enabled=false;await fs.writeFile(path.join(b.directory,'source/plugins.json'),JSON.stringify(b.config));expect((await publisher.publish('owner',b.siteId,b.draftId,randomUUID())).status).toBe('completed');expect((await call(`${publicPath(b.siteId)}/inspect`)).status).toBe(404)
    b.config.plugins['custom-api'].enabled=true;b.config.plugins['custom-api'].permissionsAcceptedAt=null;b.config.plugins['custom-api'].permissionsAcceptedBy=null;await fs.writeFile(path.join(b.directory,'source/plugins.json'),JSON.stringify(b.config));expect((await publisher.publish('owner',b.siteId,b.draftId,randomUUID())).status).toBe('completed');expect((await call(`${publicPath(b.siteId)}/inspect`)).status).toBe(404)
    await database.query("UPDATE cms_preview_capabilities SET expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1",[a.draftId]);expect((await call(`${previewPath}/inspect`)).status).toBe(403)
    await database.query('DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2',[a.siteId,'owner']);expect((await call(`${base}/api/preview-access/${otherToken}/plugins/custom-api/state`)).status).toBe(403);expect((await call(`${publicPath(a.siteId)}/inspect`)).status).toBe(200)
    await database.query('DELETE FROM sessions WHERE session_id=$1',[session])
  }finally{if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
},180000)
