import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { randomUUID,randomBytes } from 'node:crypto'
import pg from 'pg'
import { FtpSrv } from 'ftp-srv'
import { unzipSync } from 'fflate'
import { expect,it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { CmsPublicationService,createCmsPublicationSchema } from './cms-publication.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

async function freePort():Promise<number>{const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port}
it('真实托管发布、FTP增量、独立失败重试与历史ZIP',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema=`publish_${randomUUID().replaceAll('-','')}`
  const root=path.resolve('../../.intermediate/cms-publication-tests',schema)
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const client=await database.connect()
  const previousKey=process.env.CREDENTIALS_ENCRYPTION_KEY
  process.env.CREDENTIALS_ENCRYPTION_KEY=randomBytes(32).toString('base64')
  const ftpRoot=path.join(root,'ftp');await fs.mkdir(ftpRoot,{recursive:true})
  const port=await freePort()
  const ftp=new FtpSrv({url:`ftp://127.0.0.1:${port}`,pasv_url:'127.0.0.1',pasv_min:22000,pasv_max:22099,anonymous:false})
  ftp.on('login',({username,password},resolve,reject)=>username==='publisher' && password==='test-password'?resolve({root:ftpRoot}):reject(new Error('Invalid credentials')))
  await ftp.listen()
  try{
    await migrateWithClient(client);await migrateCmsSchema(client);await createCmsPublicationSchema(client)
    const userId=randomUUID();await client.query("INSERT INTO users VALUES($1,$1,'password','Publisher',NOW(),NOW())",[userId])
    const site=await createCmsSite(userId,'Published test',database,path.join(root,'sandboxes'))
    expect(await initializeCmsSite(userId,site.siteId,database,path.join(root,'sandboxes'),'https://olps.example')).toEqual({initStatus:'ready'})
    const sandboxId=(await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0].sandbox_id
    const workspace=path.join(root,'sandboxes',sandboxId)
    const mediaId=randomUUID()
    const mediaPath='assets/uploads/test.svg'
    await fs.writeFile(path.join(workspace,mediaPath),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>')
    await fs.writeFile(path.join(workspace,'source/media',`${mediaId}.json`),JSON.stringify({schemaVersion:1,mediaId,path:mediaPath,mimeType:'image/svg+xml',size:(await fs.stat(path.join(workspace,mediaPath))).size,width:10,height:10,title:{en:'Image','zh-CN':'图片'},alt:{en:'Image','zh-CN':'图片'},caption:{en:'','zh-CN':''},uploadedBy:userId,uploadedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}))
    const service=new CmsPublicationService(database,path.join(root,'sandboxes'),requireRemoteServiceConfig())
    const config={host:'127.0.0.1',port,username:'publisher',password:'test-password',root:'/'}
    const good=await service.saveTarget(userId,site.siteId,{name:'FTP',type:'ftp',enabled:true,config})
    const bad=await service.saveTarget(userId,site.siteId,{name:'Wrong credentials',type:'ftp',enabled:true,config:{...config,password:'wrong'}})
    expect(await service.testTarget(userId,site.siteId,good)).toEqual({connected:true})
    expect((await service.testTarget(userId,site.siteId,bad)).connected).toBe(false)
    const first=await service.publish(userId,site.siteId,site.draftId,randomUUID())
    expect(first.status).toBe('completed')
    expect(first.kind).toBe('full')
    expect((await client.query('SELECT status FROM sites WHERE site_id=$1',[site.siteId])).rows[0].status).toBe('published')
    const publishedFiles=await(await service.siteFiles(userId,site.siteId)).json()
    expect(publishedFiles.files.some((file:{path:string})=>file.path==='robots.txt')).toBe(true)
    expect(await(await service.siteFiles(userId,site.siteId,'robots.txt')).text()).toContain('Sitemap:')
    await expect(service.siteFiles(userId,site.siteId,'../source/site-settings.json')).rejects.toThrow('发布路径无效')
    const results=await client.query('SELECT target_id,status,uploaded FROM publish_target_results WHERE record_id=$1',[first.record_id])
    expect(results.rows.find(row=>row.target_id===good).status).toBe('completed')
    expect(results.rows.find(row=>row.target_id===bad).status).toBe('failed')
    await fs.writeFile(path.join(ftpRoot,'unrelated.txt'),'User file')
    await service.saveTarget(userId,site.siteId,{targetId:bad,name:'Repaired credentials',type:'ftp',enabled:true,config:{...config,root:'/second'}})
    expect((await service.retryTarget(userId,site.siteId,first.record_id,bad)).status).toBe('completed')
    expect((await client.query('SELECT attempts FROM publish_target_results WHERE record_id=$1 AND target_id=$2',[first.record_id,good])).rows[0].attempts).toBe(1)
    const oldZip=Buffer.from(await(await service.downloadZip(userId,site.siteId,first.record_id)).arrayBuffer())
    expect(unzipSync(oldZip)['public/en/index.html']).toBeTruthy()
    await fs.writeFile(path.join(workspace,mediaPath),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="cyan"/></svg>')
    const second=await service.publish(userId,site.siteId,site.draftId,randomUUID())
    expect(second.kind).toBe('assets_only')
    expect((await fs.readFile(path.join(ftpRoot,mediaPath),'utf8'))).toContain('cyan')
    expect(Buffer.from(await(await service.downloadZip(userId,site.siteId,first.record_id)).arrayBuffer())).toEqual(oldZip)
    const third=await service.publish(userId,site.siteId,site.draftId,randomUUID())
    expect((await client.query('SELECT uploaded FROM publish_target_results WHERE record_id=$1',[third.record_id])).rows.every(row=>row.uploaded===0)).toBe(true)
    await fs.rm(path.join(workspace,mediaPath));await fs.rm(path.join(workspace,'source/media',`${mediaId}.json`))
    const fourth=await service.publish(userId,site.siteId,site.draftId,randomUUID())
    expect(fourth.kind).toBe('full')
    expect(await fs.stat(path.join(ftpRoot,mediaPath)).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
    expect(await fs.readFile(path.join(ftpRoot,'unrelated.txt'),'utf8')).toBe('User file')
    const remote=requireRemoteServiceConfig()
    let dropped=false,pushes=0
    const proxy=http.createServer((request,response)=>{
      const target=new URL(request.url!,remote.baseUrl)
      const upstream=http.request(target,{method:request.method,headers:{...request.headers,host:target.host}},reply=>{
        if(request.method==='POST' && target.pathname.endsWith('/push')){
          pushes++
          if(!dropped && reply.statusCode===200){dropped=true;reply.resume();reply.once('end',()=>response.destroy());return}
        }
        response.writeHead(reply.statusCode!,reply.headers);reply.pipe(response)
      })
      upstream.on('error',error=>response.destroy(error));request.pipe(upstream)
    })
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve))
    try{
      const page=modelPagePath(workspace)
      const source=JSON.parse(await fs.readFile(page,'utf8'));source.title='After response loss';await fs.writeFile(page,JSON.stringify(source))
      const interrupted=new CmsPublicationService(database,path.join(root,'sandboxes'),{...remote,baseUrl:`http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`})
      const requestKey=randomUUID()
      await expect(interrupted.publish(userId,site.siteId,site.draftId,requestKey)).rejects.toThrow()
      const recovered=await interrupted.publish(userId,site.siteId,site.draftId,requestKey)
      expect(recovered.status).toBe('completed');expect(recovered.remote_site_id).toBe(first.remote_site_id)
      expect(pushes).toBe(1)
      expect((await client.query('SELECT count(*) FROM publish_records WHERE site_id=$1 AND request_key=$2',[site.siteId,requestKey])).rows[0].count).toBe('1')
    }finally{await new Promise<void>(resolve=>proxy.close(()=>resolve()))}
    await expect(service.downloadZip(randomUUID(),site.siteId,first.record_id)).rejects.toThrow('FORBIDDEN')
    await service.deleteTarget(userId,site.siteId,bad)
    expect((await service.listTargets(userId,site.siteId)).map(target=>target.targetId)).toEqual([good])
    expect(await fs.readFile(path.join(ftpRoot,'unrelated.txt'),'utf8')).toBe('User file')
  }finally{
    await ftp.close();client.release();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
    if(previousKey===undefined)delete process.env.CREDENTIALS_ENCRYPTION_KEY;else process.env.CREDENTIALS_ENCRYPTION_KEY=previousKey
  }
},300000)

function modelPagePath(workspace:string):string{return path.join(workspace,'source/pages/11111111-1111-4111-8111-111111111101/en.json')}
