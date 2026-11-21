import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { expect,it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { loadWorkspace } from '@olps/site-builder'
import { migrateWithClient } from './db-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createCmsDraft } from './cms-drafts.js'
import { CmsPublicationService,createCmsPublicationSchema } from './cms-publication.js'
import { readContent,saveContent } from './content-sandbox.js'
import { siteBuildConfig } from './site-build-config.js'
import { startDedicatedRemote,restartDedicatedRemote,applyRemoteEnv,snapshotRemoteEnv } from './test-support/dedicated-remote-harness.js'

it('真实远端停止后发布与拉取可以重试，并从深层linked worktree创建有效Git bundle',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`retry_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const client=await database.connect()
  const root=path.resolve('../../.intermediate/cms-remote-retry',schema)
  const sandboxRoot=path.join(root,'deep-path'.repeat(8),'sandboxes')
  const prior=snapshotRemoteEnv()
  let session=await startDedicatedRemote(schema)
  applyRemoteEnv(session.baseUrl,session.token)
  const remote={baseUrl:session.baseUrl,token:session.token}
  try{
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site=await createCmsSite('owner','Retry website',database,sandboxRoot)
    expect(await initializeCmsSite('owner',site.siteId,database,sandboxRoot)).toEqual({initStatus:'ready'})
    await createCmsPublicationSchema(client)
    const publication=new CmsPublicationService(database,sandboxRoot,remote)
    await publication.publish('owner',site.siteId,site.draftId,randomUUID())
    const clone=await createCmsDraft('owner',site.siteId,'Clone',database,sandboxRoot)
    const context=async(draftId:string)=>{
      const row=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[draftId])).rows[0]
      const workspace=await SyncWorkspace.open({sandboxRoot,draftId:row.sandbox_id,remote,remoteSiteId:row.remote_site_id,baseCommitId:row.base_commit_id,headCommitId:row.head_commit_id,build:siteBuildConfig()})
      return{workspace,database,draftId,userId:'owner'}
    }
    const source=await context(site.draftId)
    const homeId=(await loadWorkspace(source.workspace.getState().workspacePath)).model.pages.find(page=>page.meta.role==='home')!.meta.pageId
    const page=await readContent(source,'page',homeId,'en')
    page.content.locale.title='Retry retained remote title'
    await saveContent(source,homeId,page.content,page.revision)
    session.close()
    const requestKey=randomUUID()
    await expect(publication.publish('owner',site.siteId,site.draftId,requestKey)).rejects.toThrow()
    expect((await client.query('SELECT status FROM publish_records WHERE request_key=$1',[requestKey])).rows[0].status).toBe('failed')
    session=await restartDedicatedRemote(session.dataRoot,schema,Number(new URL(remote.baseUrl).port))
    const published=await publication.publish('owner',site.siteId,site.draftId,requestKey)
    expect(published.status).toBe('completed')
    expect((await client.query('SELECT count(*) FROM publish_records WHERE request_key=$1',[requestKey])).rows[0].count).toBe('1')
    const cloneContext=await context(clone.draftId)
    const cloneRoot=cloneContext.workspace.getState().workspacePath
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:cloneRoot,encoding:'utf8'}).trim()
    session.close()
    await expect(publication.pull('owner',site.siteId,clone.draftId)).rejects.toThrow()
    const failed=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[clone.draftId])).rows[0]
    expect(failed.status).toBe('error');expect(failed.pending_operation).toBe('pull');expect(failed.last_error).toBeTruthy()
    expect(execFileSync('git',['rev-parse','HEAD'],{cwd:cloneRoot,encoding:'utf8'}).trim()).toBe(head)
    session=await restartDedicatedRemote(session.dataRoot,schema,Number(new URL(remote.baseUrl).port))
    expect((await publication.pull('owner',site.siteId,clone.draftId)).syncStatus).toBe('clean')
    expect((await loadWorkspace(cloneRoot)).model.pages.find(page=>page.meta.pageId===homeId)!.locales.en!.title).toBe('Retry retained remote title')
    const linked=path.join(root,'nested'.repeat(12),'linked-worktree')
    await fs.mkdir(path.dirname(linked),{recursive:true})
    execFileSync('git',['worktree','add','--detach',linked,'HEAD'],{cwd:cloneRoot})
    expect((await fs.stat(path.join(linked,'.git'))).isFile()).toBe(true)
    const bundle=path.join(root,'linked.bundle')
    execFileSync('git',['bundle','create',bundle,'--all'],{cwd:linked})
    expect(execFileSync('git',['bundle','verify',bundle],{cwd:linked,encoding:'utf8'})).toContain('HEAD')
    const destination=path.join(root,'bundle-clone')
    execFileSync('git',['clone',bundle,destination])
    expect((await loadWorkspace(destination)).model.pages.find(page=>page.meta.pageId===homeId)!.locales.en!.title).toBe('Retry retained remote title')
  }finally{session.close();applyRemoteEnv(prior.baseUrl,prior.token);client.release();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true});await fs.rm(session.dataRoot,{recursive:true,force:true})}
},300000)
