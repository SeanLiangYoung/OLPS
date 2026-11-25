import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect,it } from 'vitest'
import { pool,recreatePool } from '../db.js'
import { migrateWithClient } from '../db-schema.js'
import { migrateCmsSchema } from '../cms-schema.js'
import { createCmsSite,initializeCmsSite } from '../cms-sites.js'
import { fetchDraftRow,openDraftWorkspaceFromRow } from '../draft-preview-support.js'
import { appConfig } from '../config.js'
import { cmsJobSystemPrompt,submitCmsJob } from './runner.js'

type KnowledgeAssetSnapshot={
  assetId:string
  role:string|null
  sourcePath:string
  mimeType:string
  caption:string|null
  width:number|null
  height:number|null
}

type JobRequestSnapshot={
  knowledge:Array<{documentId:string;title:string;content:string}>
  knowledgeAssets:KnowledgeAssetSnapshot[]
}

it('选中资料时快照注入 knowledgeAssets，未选时不带资产且系统提示含角色约束',async()=>{
  expect(cmsJobSystemPrompt).toContain('媒体字段只能引用清单中的资产')
  expect(cmsJobSystemPrompt).toContain('qr_code')
  expect(cmsJobSystemPrompt).toMatch(/按角色选用|禁止.*角色/)

  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许测试数据库')
  const schema=`jobs_ka_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url})
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const prior=process.env.PG_TEST_SCHEMA
  process.env.PG_TEST_SCHEMA=schema
  recreatePool()
  const client=await pool.connect()
  let sandboxId:string|undefined
  try{
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    const site=await createCmsSite('owner','Knowledge assets job')
    expect(await initializeCmsSite('owner',site.siteId)).toEqual({initStatus:'ready'})
    const row=await fetchDraftRow(site.draftId)
    sandboxId=String(row.sandbox_id)
    const workspace=await openDraftWorkspaceFromRow(row)
    const context={workspace,database:pool,draftId:site.draftId,userId:'owner'}

    const kb=(await client.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1',[site.siteId])).rows[0]
    const productAssetId=randomUUID()
    const qrAssetId=randomUUID()
    const orphanAssetId=randomUUID()
    const docId=randomUUID()
    const assetRefs=[productAssetId,qrAssetId]
    await client.query(
      `INSERT INTO knowledge_assets(
        asset_id,kb_id,import_id,source_path,fingerprint,mime_type,byte_size,
        width,height,role,caption,storage_key,created_at,updated_at
      ) VALUES
        ($1,$2,NULL,'raw/assets/product.png','fp-product','image/png',1200,800,600,'product_photo','产品主图','assets/product.png',NOW(),NOW()),
        ($3,$2,NULL,'raw/assets/qr.png','fp-qr','image/png',400,200,200,'qr_code','收款码','assets/qr.png',NOW(),NOW()),
        ($4,$2,NULL,'raw/assets/orphan.png','fp-orphan','image/png',100,10,10,'misc','无关','assets/orphan.png',NOW(),NOW())`,
      [productAssetId,kb.kb_id,qrAssetId,orphanAssetId],
    )
    await client.query(
      `INSERT INTO knowledge_documents(doc_id,kb_id,title,content,kind,asset_refs,created_at,updated_at)
       VALUES($1,$2,'产品说明','正文含素材','wiki_page',$3::jsonb,NOW(),NOW())`,
      [docId,kb.kb_id,JSON.stringify(assetRefs)],
    )

    const baseRequest={draftId:site.draftId,locale:'en',instruction:'Propose one short About Us page.'}

    const withoutKnowledge=await submitCmsJob(context,'propose_site_structure',baseRequest,'without-knowledge')
    const emptySnapshot=(await client.query('SELECT request FROM jobs WHERE job_id=$1',[withoutKnowledge.jobId])).rows[0].request as JobRequestSnapshot
    expect(emptySnapshot.knowledge).toEqual([])
    expect(emptySnapshot.knowledgeAssets).toEqual([])

    const withEmptyIds=await submitCmsJob(context,'propose_site_structure',{...baseRequest,knowledgeDocumentIds:[]},'empty-ids')
    const emptyIdsSnapshot=(await client.query('SELECT request FROM jobs WHERE job_id=$1',[withEmptyIds.jobId])).rows[0].request as JobRequestSnapshot
    expect(emptyIdsSnapshot.knowledge).toEqual([])
    expect(emptyIdsSnapshot.knowledgeAssets).toEqual([])

    const withKnowledge=await submitCmsJob(
      context,
      'propose_site_structure',
      {...baseRequest,knowledgeDocumentIds:[docId]},
      'with-knowledge-assets',
    )
    const snapshot=(await client.query('SELECT request FROM jobs WHERE job_id=$1',[withKnowledge.jobId])).rows[0].request as JobRequestSnapshot
    expect(snapshot.knowledge).toEqual([{documentId:docId,title:'产品说明',content:'正文含素材'}])
    expect(snapshot.knowledgeAssets).toHaveLength(assetRefs.length)
    expect(snapshot.knowledgeAssets.map(asset=>asset.assetId).sort()).toEqual([...assetRefs].sort())
    expect(snapshot.knowledgeAssets).toEqual(expect.arrayContaining([
      {
        assetId:productAssetId,
        role:'product_photo',
        sourcePath:'raw/assets/product.png',
        mimeType:'image/png',
        caption:'产品主图',
        width:800,
        height:600,
      },
      {
        assetId:qrAssetId,
        role:'qr_code',
        sourcePath:'raw/assets/qr.png',
        mimeType:'image/png',
        caption:'收款码',
        width:200,
        height:200,
      },
    ]))
    expect(snapshot.knowledgeAssets.some(asset=>asset.assetId===orphanAssetId)).toBe(false)
  }finally{
    client.release()
    await pool.end()
    if(prior===undefined)delete process.env.PG_TEST_SCHEMA
    else process.env.PG_TEST_SCHEMA=prior
    recreatePool()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    if(sandboxId)await fs.rm(path.join(appConfig.sandboxRoot,sandboxId),{recursive:true,force:true})
  }
},180000)
