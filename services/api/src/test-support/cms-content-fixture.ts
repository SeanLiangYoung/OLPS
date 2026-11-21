import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { SyncWorkspace } from '@olps/sync'
import { migrateWithClient } from '../db.js'
import { createCmsSite,initializeCmsSite } from '../cms-sites.js'
import { createContent,type ContentContext } from '../content-sandbox.js'

const execute=promisify(execFile)
export async function withCmsContentSite(action:(context:ContentContext,client:pg.PoolClient)=>Promise<void>):Promise<void>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许测试数据库')
  const schema=`content_guard_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const client=await database.connect();const sandboxRoot=path.resolve('.intermediate/content-guard-tests',schema)
  try{
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site=await createCmsSite('owner','Content guards',database,sandboxRoot)
    const initialized=await initializeCmsSite('owner',site.siteId,database,sandboxRoot)
    if(initialized.initStatus!=='ready')throw new Error(initialized.error)
    const row=(await client.query('SELECT sandbox_id,head_commit_id FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0]
    const workspace=await SyncWorkspace.open({sandboxRoot,draftId:row.sandbox_id,remote:{baseUrl:process.env.REMOTE_SERVICE_URL!,token:process.env.REMOTE_SERVICE_TOKEN!},baseCommitId:row.head_commit_id,headCommitId:row.head_commit_id})
    await action({database,workspace,draftId:site.draftId,userId:'owner'},client)
  }finally{
    client.release();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(sandboxRoot,{recursive:true,force:true})
  }
}

export async function createGuardPage(context:ContentContext,title='Content guard'){
  const now=new Date().toISOString();const pageId=randomUUID()
  return createContent(context,{ref:'page',meta:{schemaVersion:1,pageId,role:null,template:'page',status:'draft',createdAt:now,updatedAt:now},locale:{schemaVersion:1,locale:'en',slug:`content-${pageId}`,title,summary:'',cover:null,seo:{title,description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}})
}

export async function cmsContentSnapshot(context:ContentContext):Promise<unknown>{
  const files:Record<string,string>={}
  for(const name of (await context.workspace.listFiles('source')).sort())files[name]=(await context.workspace.readFile(name)).toString('base64')
  const indexes:Record<string,unknown>={}
  for(const table of ['pages','collection_indexes','collection_groups','collection_items','media'])indexes[table]=(await context.database.query(`SELECT * FROM ${table} WHERE draft_id=$1 ORDER BY ${table==='media'?'media_id':'locale'}`,[context.draftId])).rows
  const state=(await context.database.query('SELECT * FROM site_drafts WHERE draft_id=$1',[context.draftId])).rows
  const head=(await execute('git',['rev-parse','HEAD'],{cwd:context.workspace.getState().workspacePath})).stdout.trim()
  return {files,indexes,state,head}
}
