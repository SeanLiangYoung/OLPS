import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import type net from 'node:net'
import { randomUUID,randomBytes } from 'node:crypto'
import pg from 'pg'
import { expect,it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { migrateWithClient } from './db-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createCmsDraft } from './cms-drafts.js'
import { siteBuildConfig } from './site-build-config.js'
import { createCredentialSchema,encryptCredential,decryptCredential } from './credentials.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { createCmsPublicationSchema,CmsPublicationService } from './cms-publication.js'
import { CmsPreviewService,createCmsPreviewSchema } from './cms-preview.js'

it('两个网站构建和预览仅向服务器hook注入各自密钥，发布后新草稿继承发布密钥',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`plugin_secret_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/plugin-build-secrets',schema)
  const pluginId='private-build-hook',remote=requireRemoteServiceConfig()
  const originalEnvironment=process.env.OLPS_BUILD_PLUGIN_SECRETS
  try{
    const client=await database.connect();await migrateWithClient(client);await createCredentialSchema(client);await createCmsPreviewSchema(client);await createCmsPublicationSchema(client);client.release()
    await database.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const sites=[]
    const privateValues:string[]=[]
    for(const label of ['website-a','website-b']){
      const site=await createCmsSite('owner',label,database,root)
      expect(await initializeCmsSite('owner',site.siteId,database,root)).toEqual({initStatus:'ready'})
      const row=(await database.query('SELECT * FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0]
      const directory=path.join(root,row.sandbox_id)
      await fs.mkdir(path.join(directory,'plugins',pluginId,'server'),{recursive:true})
      await fs.writeFile(path.join(directory,'plugins',pluginId,'plugin.json'),JSON.stringify({schemaVersion:1,id:pluginId,name:'Private build hook',version:'1.0.0',author:'OLPS',description:'Server build authentication',requires:'1',settings:[{key:'label',type:'text',label:'Website',required:true,translatable:false},{key:'apiKey',type:'secret',label:'API key',required:true,translatable:false},{key:'greeting',type:'text',label:'Greeting',required:false,translatable:false,default:'Build default'},{key:'links',type:'list',label:'Links',required:false,translatable:false,default:[{}],itemFields:[{key:'label',type:'text',label:'Label',required:false,translatable:false,default:'Nested default'}]},{key:'unusedSecret',type:'secret',label:'Private',required:false,translatable:false,default:'Manifest private value'}],snippets:[],assets:[],server:{build:'server/build.js'},permissions:{}}))
      await fs.writeFile(path.join(directory,'plugins',pluginId,'server/build.js'),`function authorized(ctx){if(ctx.settings.greeting!=='Build default'||ctx.settings.links[0].label!=='Nested default'||'unusedSecret' in ctx.settings)throw new Error('服务器构建设置默认值无效');if(typeof ctx.settings.apiKey!=='string'||!ctx.settings.apiKey.startsWith(ctx.settings.label+'-')||ctx.settings.apiKey.length<30)throw new Error('服务器构建缺少当前网站密钥');return ctx.settings.label+' authenticated';}exports.onBuild=async function(ctx){ctx.log('info','server authenticated',{privateValue:ctx.settings.apiKey});return [{path:'public/plugins/${pluginId}/result.txt',content:authorized(ctx)}]};exports.transformHtml=async function(html,pageInfo,ctx){return html.replace('</body>','<!-- '+authorized(ctx)+' -->\\n</body>')};`)
      const config=JSON.parse(await fs.readFile(path.join(directory,'source/plugins.json'),'utf8'));config.plugins[pluginId]={enabled:true,settings:{label},permissionsAcceptedAt:new Date().toISOString(),permissionsAcceptedBy:'owner'};await fs.writeFile(path.join(directory,'source/plugins.json'),JSON.stringify(config))
      await fs.writeFile(path.join(directory,'tools/private-environment-check.mjs'),"import {execFileSync} from 'node:child_process';if(process.env.OLPS_BUILD_PLUGIN_SECRETS)throw new Error('校验命令不允许接收插件密钥');execFileSync(process.execPath,['tools/site-verify.mjs'],{stdio:'inherit'});")
      const manifest=JSON.parse(await fs.readFile(path.join(directory,'olps.manifest.json'),'utf8'));manifest.verifyCommand=['node','tools/private-environment-check.mjs'];await fs.writeFile(path.join(directory,'olps.manifest.json'),JSON.stringify(manifest))
      const secret=`${label}-${randomBytes(32).toString('hex')}`
      privateValues.push(secret)
      await database.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,$3,$4)',[site.draftId,site.siteId,pluginId,encryptCredential(JSON.stringify({apiKey:secret}),`${site.siteId}/${pluginId}`)])
      const workspace=await SyncWorkspace.open({sandboxRoot:root,draftId:row.sandbox_id,remote,build:siteBuildConfig({draftId:site.draftId,database})})
      sites.push({...site,label,secret,directory,workspace})
    }
    const results=await Promise.all(sites.map(site=>site.workspace.runValidation()))
    for(let index=0;index<sites.length;index++){
      expect(results[index]!.ok,results[index]!.log).toBe(true)
      expect(results[index]!.log.includes(sites[index]!.secret)).toBe(false)
      expect(await fs.readFile(path.join(sites[index]!.directory,'public/plugins',pluginId,'result.txt'),'utf8')).toBe(`${sites[index]!.label} authenticated`)
    }
    expect(process.env.OLPS_BUILD_PLUGIN_SECRETS).toBe(originalEnvironment)
    const sessionId=randomUUID();await database.query("INSERT INTO sessions VALUES($1,'owner',$2,NOW()+INTERVAL '1 hour',NOW())",[sessionId,randomUUID()])
    const previews=new CmsPreviewService(database,root,path.join(root,'previews'))
    await Promise.all(sites.map(site=>previews.create('owner',sessionId,site.draftId,{locale:'en'})))
    const publication=new CmsPublicationService(database,root,remote)
    const records=await Promise.all(sites.map(site=>publication.publish('owner',site.siteId,site.draftId,randomUUID())))
    expect(records.map(record=>record.status)).toEqual(['completed','completed'])
    const recoverySite=sites[0]!,publishedSecret=`${recoverySite.label}-recovery-${randomBytes(24).toString('hex')}`
    privateValues.push(publishedSecret)
    await database.query('UPDATE plugin_secrets SET ciphertext=$1 WHERE draft_id=$2 AND plugin_id=$3',[encryptCredential(JSON.stringify({apiKey:publishedSecret}),`${recoverySite.siteId}/${pluginId}`),recoverySite.draftId,pluginId])
    let dropped=false,pushes=0
    const proxy=http.createServer((request,response)=>{
      const target=new URL(request.url!,remote.baseUrl)
      const upstream=http.request(target,{method:request.method,headers:{...request.headers,host:target.host}},reply=>{
        if(request.method==='POST'&&target.pathname.endsWith('/push')){pushes++;if(!dropped&&reply.statusCode===200){dropped=true;reply.resume();reply.once('end',()=>response.destroy());return}}
        response.writeHead(reply.statusCode!,reply.headers);reply.pipe(response)
      });upstream.on('error',error=>response.destroy(error));request.pipe(upstream)
    })
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve))
    try{
      const interrupted=new CmsPublicationService(database,root,{...remote,baseUrl:`http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`}),key=randomUUID()
      await expect(interrupted.publish('owner',recoverySite.siteId,recoverySite.draftId,key)).rejects.toThrow()
      const laterSecret=`${recoverySite.label}-later-${randomUUID()}`;privateValues.push(laterSecret)
      await database.query('UPDATE plugin_secrets SET ciphertext=$1 WHERE draft_id=$2 AND plugin_id=$3',[encryptCredential(JSON.stringify({apiKey:laterSecret}),`${recoverySite.siteId}/${pluginId}`),recoverySite.draftId,pluginId])
      expect((await interrupted.publish('owner',recoverySite.siteId,recoverySite.draftId,key)).status).toBe('completed')
      expect(pushes).toBe(1);recoverySite.secret=publishedSecret
    }finally{await new Promise<void>((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()))}
    for(const site of sites){
      const unpublished=`${site.label}-unpublished-${randomUUID()}`;privateValues.push(unpublished)
      await database.query('UPDATE plugin_secrets SET ciphertext=$1 WHERE draft_id=$2 AND plugin_id=$3',[encryptCredential(JSON.stringify({apiKey:unpublished}),`${site.siteId}/${pluginId}`),site.draftId,pluginId])
      const cloned=await createCmsDraft('owner',site.siteId,'Published credentials clone',database,root)
      const credential=(await database.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2',[cloned.draftId,pluginId])).rows[0]
      expect(JSON.parse(decryptCredential(credential.ciphertext,`${site.siteId}/${pluginId}`))).toEqual({apiKey:site.secret})
      const row=(await database.query('SELECT * FROM site_drafts WHERE draft_id=$1',[cloned.draftId])).rows[0]
      const workspace=await SyncWorkspace.open({sandboxRoot:root,draftId:row.sandbox_id,remote,build:siteBuildConfig({draftId:cloned.draftId,database})})
      const validated=await workspace.runValidation();expect(validated.ok,validated.log).toBe(true)
    }
    const inspect=async(directory:string):Promise<void>=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.name==='.git')continue;const target=path.join(directory,entry.name);if(entry.isDirectory())await inspect(target);else if(entry.isFile()){const content=await fs.readFile(target);for(const secret of privateValues)expect(content.includes(Buffer.from(secret)),target).toBe(false)}}}
    await inspect(root)
    expect(process.env.OLPS_BUILD_PLUGIN_SECRETS).toBe(originalEnvironment)
  }finally{await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
},180000)
