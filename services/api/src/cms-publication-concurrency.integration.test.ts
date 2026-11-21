import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { FtpSrv } from 'ftp-srv'
import { expect,it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createCmsPublicationSchema,CmsPublicationService } from './cms-publication.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { withDraftLock } from './draft-lock.js'

async function fixture(action:(input:{database:pg.Pool;admin:pg.Client;root:string;schema:string;service:CmsPublicationService;site:{siteId:string;draftId:string}})=>Promise<void>){
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`publication_race_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,application_name:schema,max:2,connectionTimeoutMillis:5000})
  const root=path.resolve('../../.intermediate/publication-concurrency',schema)
  try{
    const client=await database.connect();await migrateWithClient(client);client.release()
    await database.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site=await createCmsSite('owner','Concurrent publication',database,root)
    expect(await initializeCmsSite('owner',site.siteId,database,root)).toEqual({initStatus:'ready'})
    const schemaClient=await database.connect();await createCmsPublicationSchema(schemaClient);schemaClient.release()
    const service=new CmsPublicationService(database,root,requireRemoteServiceConfig())
    await action({database,admin,root,schema,service,site})
  }finally{await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
}

it('取得草稿锁后重新检查网站成员，等待期间撤权不执行Pull',async()=>{
  await fixture(async({database,admin,schema,service,site})=>{
    let release!:()=>void,entered!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve})
    const blocking=withDraftLock(site.draftId,async()=>{entered();await gate})
    await started
    const pending=service.pull('owner',site.siteId,site.draftId)
    try{
      await expect.poll(async()=>Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND state='idle' AND query='SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2'",[schema])).rows[0].count)).toBeGreaterThan(0)
      await admin.query('DELETE FROM site_owners WHERE site_id=$1',[site.siteId])
    }finally{release();await blocking}
    await expect(pending).rejects.toThrow('FORBIDDEN')
    expect((await database.query('SELECT status,pending_operation FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows).toEqual([{status:'active',pending_operation:null}])
  })
},60000)

it('连接池max2时两个网站同时真实发布并保存各自快照',async()=>{
  await fixture(async({database,root,service,site})=>{
    const other=await createCmsSite('owner','Second concurrent website',database,root)
    expect(await initializeCmsSite('owner',other.siteId,database,root)).toEqual({initStatus:'ready'})
    const records=await Promise.all([service.publish('owner',site.siteId,site.draftId,randomUUID()),service.publish('owner',other.siteId,other.draftId,randomUUID())])
    expect(records.map(record=>record.status)).toEqual(['completed','completed'])
    expect((await database.query("SELECT s.site_id FROM sites s JOIN cms_public_snapshots p ON p.site_id=s.site_id AND p.commit_id=s.published_commit_id WHERE s.status='published'")).rowCount).toBe(2)
    expect(database.totalCount).toBeLessThanOrEqual(2)
  })
},120000)

it('目标锁等待期间修改地址、禁用或撤权，使用最新配置并保护摘要清单',async()=>{
  await fixture(async({database,admin,root,schema,service,site})=>{
    const socket=net.createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
    const ftpRoot=path.join(root,'ftp');await fs.mkdir(ftpRoot)
    const ftp=new FtpSrv({url:`ftp://127.0.0.1:${port}`,pasv_url:'127.0.0.1',pasv_min:22300,pasv_max:22399})
    ftp.on('login',({username,password},resolve,reject)=>username==='publisher'&&password==='acceptance-password'?resolve({root:ftpRoot}):reject(new Error('Invalid credentials')))
    await ftp.listen()
    try{
      const record=await service.publish('owner',site.siteId,site.draftId,randomUUID())
      const config={host:'127.0.0.1',port,username:'publisher',password:'acceptance-password',root:'/first'}
      const targetId=await service.saveTarget('owner',site.siteId,{name:'FTP acceptance',type:'ftp',enabled:true,config})
      expect((await service.retryTarget('owner',site.siteId,record.record_id,targetId)).status).toBe('completed')
      const waiters=async(minimum:number)=>expect.poll(async()=>Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",[schema])).rows[0].count)).toBeGreaterThanOrEqual(minimum)
      await admin.query('SELECT pg_advisory_lock(hashtext($1))',[`deploy:${targetId}`])
      const saving=service.saveTarget('owner',site.siteId,{targetId,name:'Moved FTP',type:'ftp',enabled:true,config:{...config,root:'/second'}})
      await waiters(1)
      const retrying=service.retryTarget('owner',site.siteId,record.record_id,targetId)
      try{await waiters(2)}finally{await admin.query('SELECT pg_advisory_unlock(hashtext($1))',[`deploy:${targetId}`])}
      await saving;expect((await retrying).status).toBe('completed')
      expect(await fs.readFile(path.join(ftpRoot,'second/en/index.html'),'utf8')).toContain('Concurrent publication')
      const before=(await database.query('SELECT * FROM deploy_target_files WHERE target_id=$1 ORDER BY path',[targetId])).rows
      await admin.query('SELECT pg_advisory_lock(hashtext($1))',[`deploy:${targetId}`])
      const disabling=service.saveTarget('owner',site.siteId,{targetId,name:'Disabled FTP',type:'ftp',enabled:false,config:{}})
      await waiters(1)
      const disabledRetry=service.retryTarget('owner',site.siteId,record.record_id,targetId)
      try{await waiters(2)}finally{await admin.query('SELECT pg_advisory_unlock(hashtext($1))',[`deploy:${targetId}`])}
      await disabling;await expect(disabledRetry).rejects.toThrow('NOT_FOUND')
      expect((await database.query('SELECT * FROM deploy_target_files WHERE target_id=$1 ORDER BY path',[targetId])).rows).toEqual(before)
      await service.saveTarget('owner',site.siteId,{targetId,name:'Enabled FTP',type:'ftp',enabled:true,config:{}})
      await admin.query('SELECT pg_advisory_lock(hashtext($1))',[`deploy:${targetId}`])
      const revokedRetry=service.retryTarget('owner',site.siteId,record.record_id,targetId)
      try{await waiters(1);await admin.query('DELETE FROM site_owners WHERE site_id=$1',[site.siteId])}finally{await admin.query('SELECT pg_advisory_unlock(hashtext($1))',[`deploy:${targetId}`])}
      await expect(revokedRetry).rejects.toThrow('FORBIDDEN')
      expect((await database.query('SELECT * FROM deploy_target_files WHERE target_id=$1 ORDER BY path',[targetId])).rows).toEqual(before)
    }finally{await ftp.close()}
  })
},120000)
