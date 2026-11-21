import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { FtpSrv } from 'ftp-srv'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { expect,it } from 'vitest'
import { migrateWithClient,pool,recreatePool } from './db.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createSession } from './sessions.js'
import { CmsPublicationService } from './cms-publication.js'
import { createCmsPublicationRoutes } from './cms-publication-routes.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

it('真实发布HTTP使用camelCase、分页和标准错误，拒绝未发布Pull与客户端远端标识',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`publication_http_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const previousSchema=process.env.PG_TEST_SCHEMA;await pool.end();process.env.PG_TEST_SCHEMA=schema;recreatePool()
  const root=path.resolve('../../.intermediate/publication-http',schema)
  let server:ReturnType<typeof serve>|undefined,ftp:FtpSrv|undefined
  try{
    const client=await database.connect();await migrateWithClient(client);client.release();await migrateCmsRuntime(database,{sandboxRoot:root})
    await database.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site=await createCmsSite('owner','Publication HTTP',database,root);expect(await initializeCmsSite('owner',site.siteId,database,root)).toEqual({initStatus:'ready'})
    const token=randomUUID();await createSession('owner',token)
    const service=new CmsPublicationService(database,root,requireRemoteServiceConfig()),app=new Hono();app.route('/api',createCmsPublicationRoutes(service))
    const base=await new Promise<string>(resolve=>{server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'},info=>resolve(`http://127.0.0.1:${info.port}`))})
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'},sitePath=`${base}/api/sites/${site.siteId}`
    const unpublished=await fetch(`${sitePath}/drafts/${site.draftId}/pull`,{method:'POST',headers})
    expect(unpublished.status).toBe(409);expect(await unpublished.json()).toMatchObject({code:'DRAFT_BUSY'})
    const unexpected=await fetch(`${sitePath}/publish`,{method:'POST',headers,body:JSON.stringify({draftId:site.draftId,requestKey:randomUUID(),remoteSiteId:randomUUID()})})
    expect(unexpected.status).toBe(400);expect(await unexpected.json()).toMatchObject({code:'VALIDATION_FAILED',details:{issues:expect.any(Array)}})
    const socket=net.createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
    const ftpRoot=path.join(root,'ftp');await fs.mkdir(ftpRoot)
    ftp=new FtpSrv({url:`ftp://127.0.0.1:${port}`,pasv_url:'127.0.0.1',pasv_min:22400,pasv_max:22499});ftp.on('login',({username,password},resolve,reject)=>username==='publisher'&&password==='acceptance-password'?resolve({root:ftpRoot}):reject(new Error('Invalid credentials')));await ftp.listen()
    const targetResponse=await fetch(`${sitePath}/deploy-targets`,{method:'POST',headers,body:JSON.stringify({name:'Real FTP',type:'ftp',enabled:true,config:{host:'127.0.0.1',port,username:'publisher',password:'acceptance-password',root:'/'}})})
    expect(targetResponse.status).toBe(201);const target=await targetResponse.json() as {targetId:string}
    const recordIds=[]
    for(let index=0;index<2;index++){
      const published=await fetch(`${sitePath}/publish`,{method:'POST',headers,body:JSON.stringify({draftId:site.draftId,requestKey:randomUUID()})})
      expect(published.status,await published.clone().text()).toBe(200)
      const {record}=await published.json() as {record:{recordId:string;siteId:string;publicUrl:string;createdAt:string;record_id?:string;targets:Array<{targetId:string;status:string}>}}
      expect(record.siteId).toBe(site.siteId);expect(record.publicUrl).toMatch(/^http/);expect(record.createdAt).toMatch(/Z$/);expect(record.record_id).toBeUndefined();recordIds.push(record.recordId)
      expect(record.targets).toHaveLength(1);expect(record.targets[0]).toMatchObject({targetId:target.targetId,status:'completed'})
    }
    type History={records:Array<{recordId:string;targets:Array<{targetId:string;target_id?:string;status:string}>;notifications:Array<{recordId:string;record_id?:string}>}>;pageInfo:{nextCursor:string|null;hasNextPage:boolean}}
    const first=await(await fetch(`${sitePath}/publish-records?limit=1`,{headers})).json() as History
    expect(first.records).toHaveLength(1);expect(first.pageInfo.hasNextPage).toBe(true)
    expect(first.records[0]!.targets).toHaveLength(1);expect(first.records[0]!.targets[0]).toMatchObject({targetId:target.targetId,status:'completed'});expect(first.records[0]!.targets[0]!.target_id).toBeUndefined()
    for(const notification of first.records[0]!.notifications){expect(notification.recordId).toBe(first.records[0]!.recordId);expect(notification.record_id).toBeUndefined()}
    const second=await(await fetch(`${sitePath}/publish-records?limit=1&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`,{headers})).json() as History
    expect(second.records).toHaveLength(1);expect(second.pageInfo.hasNextPage).toBe(false);expect(new Set([...first.records,...second.records].map(value=>value.recordId))).toEqual(new Set(recordIds))
    const invalid=await fetch(`${sitePath}/publish-records?limit=101`,{headers});expect(invalid.status).toBe(400);expect(await invalid.json()).toMatchObject({code:'VALIDATION_FAILED',details:{issues:expect.any(Array)}})
    const files=await fetch(`${sitePath}/site-files`,{headers});expect(files.status).toBe(200);expect((await files.json() as {files:unknown[]}).files.length).toBeGreaterThan(0)
    const missing=await fetch(`${sitePath}/publish-records/${randomUUID()}/download.zip`,{headers});expect(missing.status).toBe(404);expect(await missing.json()).toMatchObject({code:'NOT_FOUND'})
    expect(await fs.readFile(path.join(ftpRoot,'en/index.html'),'utf8')).toContain('Publication HTTP')
    const draft=(await database.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0]
    const home=path.join(root,draft.sandbox_id,'source/pages/11111111-1111-4111-8111-111111111101/en.json'),content=JSON.parse(await fs.readFile(home,'utf8'))
    content.blocks.push({id:randomUUID(),type:'core/missing',props:{},children:[]});await fs.writeFile(home,JSON.stringify(content))
    const rejectedBuild=await fetch(`${sitePath}/publish`,{method:'POST',headers,body:JSON.stringify({draftId:site.draftId,requestKey:randomUUID()})})
    expect(rejectedBuild.status).toBe(400);expect(await rejectedBuild.json()).toMatchObject({code:'BUILD_FAILED',details:{validationLog:expect.any(String)}})
  }finally{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));if(ftp)await ftp.close()
    await pool.end();if(previousSchema===undefined)delete process.env.PG_TEST_SCHEMA;else process.env.PG_TEST_SCHEMA=previousSchema;recreatePool()
    await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
  }
},120000)
