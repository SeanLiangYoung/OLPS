import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect,it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { loadWorkspace } from '@olps/site-builder'
import { migrateWithClient } from './db.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createCmsDraft } from './cms-drafts.js'
import { CmsPublicationService,createCmsPublicationSchema } from './cms-publication.js'
import { readPublishedContentSnapshot } from './cms-public.js'
import { readContent,saveContent } from './content-sandbox.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'

type Block={id:string;type:string;props:Record<string,unknown>;children:unknown[]}
it('两个账号使用真实Agent处理同页不同区块和互斥内容，继续发布与拉取保留权限和双方修改',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`agent_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const sandboxRoot=path.resolve('../../.intermediate/cms-agent-collaboration',schema)
  const client=await database.connect()
  const remote=requireRemoteServiceConfig()
  try{
    await migrateWithClient(client)
    for(const userId of ['author-a','author-b'])await client.query("INSERT INTO users VALUES($1,$1,'password',$1,NOW(),NOW())",[userId])
    const site=await createCmsSite('author-a','Agent collaboration',database,sandboxRoot)
    expect(await initializeCmsSite('author-a',site.siteId,database,sandboxRoot)).toEqual({initStatus:'ready'})
    await client.query('INSERT INTO site_owners VALUES($1,$2,NOW())',[site.siteId,'author-b'])
    await createCmsPublicationSchema(client)
    const publication=new CmsPublicationService(database,sandboxRoot,remote)
    const context=async(draftId:string,userId:string)=>{
      const row=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[draftId])).rows[0]
      const workspace=await SyncWorkspace.open({sandboxRoot,draftId:row.sandbox_id,remote,remoteSiteId:row.remote_site_id,baseCommitId:row.base_commit_id,headCommitId:row.head_commit_id,build:siteBuildConfig()})
      return{workspace,database,draftId,userId}
    }
    const initialContext=await context(site.draftId,'author-a')
    const model=(await loadWorkspace(initialContext.workspace.getState().workspacePath)).model
    const homeId=model.pages.find(page=>page.meta.role==='home')!.meta.pageId
    const initial=await readContent(initialContext,'page',homeId,'en')
    const primaryId=randomUUID(),secondaryId=randomUUID()
    initial.content.locale.blocks=[...(initial.content.locale.blocks as Block[]),{id:primaryId,type:'core/heading',props:{text:'Original primary heading',level:2},children:[]},{id:secondaryId,type:'core/heading',props:{text:'Original secondary heading',level:2},children:[]}]
    await saveContent(initialContext,homeId,initial.content,initial.revision)
    await publication.publish('author-a',site.siteId,site.draftId,randomUUID())
    async function edit(draftId:string,userId:string,blockId:string,text:string){
      const current=await context(draftId,userId)
      const page=await readContent(current,'page',homeId,'en')
      const block=(page.content.locale.blocks as Block[]).find(block=>block.id===blockId)!
      block.props.text=text
      await saveContent(current,homeId,page.content,page.revision)
    }
    const differentA=await createCmsDraft('author-a',site.siteId,'Different A',database,sandboxRoot)
    const differentB=await createCmsDraft('author-b',site.siteId,'Different B',database,sandboxRoot)
    await edit(differentA.draftId,'author-a',primaryId,'Contribution from author A')
    await edit(differentB.draftId,'author-b',secondaryId,'Contribution from author B')
    await publication.publish('author-a',site.siteId,differentA.draftId,randomUUID())
    expect((await publication.publish('author-b',site.siteId,differentB.draftId,randomUUID())).status).toBe('completed')
    const merged=(await readPublishedContentSnapshot(site.siteId,database)).pages.find(page=>page.meta.pageId===homeId)!.locales.en!.blocks
    expect(merged.find(block=>block.id===primaryId)!.props.text).toBe('Contribution from author A')
    expect(merged.find(block=>block.id===secondaryId)!.props.text).toBe('Contribution from author B')
    const pushA=await createCmsDraft('author-a',site.siteId,'Primary choice A',database,sandboxRoot)
    const pushB=await createCmsDraft('author-b',site.siteId,'Primary choice B',database,sandboxRoot)
    await edit(pushA.draftId,'author-a',primaryId,'Selected red primary heading')
    await edit(pushB.draftId,'author-b',primaryId,'Alternative green primary heading')
    await edit(pushB.draftId,'author-b',secondaryId,'Preserved author B independent heading')
    await publication.publish('author-a',site.siteId,pushA.draftId,randomUUID())
    await expect(publication.publish('author-b',site.siteId,pushB.draftId,randomUUID())).rejects.toThrow()
    const pending=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[pushB.draftId])).rows[0]
    expect(pending.sync_status).toBe('awaiting_user');expect(pending.pending_operation).toBe('push')
    const continued=await publication.continue('author-b',site.siteId,pushB.draftId,'主标题明确选择 Selected red primary heading。保留 Preserved author B independent heading 和全部其他内容。请完成合并并继续原来的发布。')
    expect(continued.syncStatus).toBe('clean')
    const published=await readPublishedContentSnapshot(site.siteId,database)
    const blocks=published.pages.find(page=>page.meta.pageId===homeId)!.locales.en!.blocks
    expect(blocks.find(block=>block.id===primaryId)!.props.text).toBe('Selected red primary heading')
    expect(blocks.find(block=>block.id===secondaryId)!.props.text).toBe('Preserved author B independent heading')
    const pullA=await createCmsDraft('author-a',site.siteId,'Pull choice A',database,sandboxRoot)
    const pullB=await createCmsDraft('author-b',site.siteId,'Pull choice B',database,sandboxRoot)
    await edit(pullA.draftId,'author-a',primaryId,'Remote violet primary heading')
    await edit(pullB.draftId,'author-b',primaryId,'Local yellow primary heading')
    const remoteVersion=await publication.publish('author-a',site.siteId,pullA.draftId,randomUUID())
    expect((await publication.pull('author-b',site.siteId,pullB.draftId)).syncStatus).toBe('awaiting_user')
    const before=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[pullB.draftId])).rows[0]
    await client.query('DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2',[site.siteId,'author-b'])
    await expect(publication.continue('author-b',site.siteId,pullB.draftId,'选择远程标题')).rejects.toThrow('FORBIDDEN')
    expect((await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[pullB.draftId])).rows[0]).toEqual(before)
    await client.query('INSERT INTO site_owners VALUES($1,$2,NOW())',[site.siteId,'author-b'])
    const pulled=await publication.continue('author-b',site.siteId,pullB.draftId,'主标题明确选择 Remote violet primary heading，保留全部其他内容。请完成本次拉取。')
    expect(['clean','dirty']).toContain(pulled.syncStatus)
    expect((await client.query('SELECT published_commit_id FROM sites WHERE site_id=$1',[site.siteId])).rows[0].published_commit_id).toBe(remoteVersion.commit_id)
    const finalContext=await context(pullB.draftId,'author-b')
    const final=(await loadWorkspace(finalContext.workspace.getState().workspacePath)).model
    expect(final.pages.find(page=>page.meta.pageId===homeId)!.locales.en!.blocks.find(block=>block.id===primaryId)!.props.text).toBe('Remote violet primary heading')
    expect((await client.query('SELECT body FROM pages WHERE draft_id=$1 AND page_id=$2 AND locale=$3',[pullB.draftId,homeId,'en'])).rows[0].body.blocks.find((block:Block)=>block.id===primaryId).props.text).toBe('Remote violet primary heading')
  }finally{client.release();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(sandboxRoot,{recursive:true,force:true})}
},1200000)
