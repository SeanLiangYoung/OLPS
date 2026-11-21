import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect,it } from 'vitest'
import { createContent,saveContent } from './content-sandbox.js'
import { runCmsSiteReport,readCmsReportHistory,readCmsReport } from './cms-reports.js'
import { withCmsContentSite } from './test-support/cms-content-fixture.js'
import { createCmsPublicSchema } from './cms-public.js'

it('全站报告真实检查四类内容和全部语言，持久结果与迁移历史并保护权限',()=>withCmsContentSite(async(context,client)=>{
  await createCmsPublicSchema(client)
  const draft=(await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[context.draftId])).rows[0]
  const settings=JSON.parse((await context.workspace.readFile('source/site-settings.json')).toString())
  const appearance=JSON.parse((await context.workspace.readFile('source/appearance.json')).toString())
  const themeId=appearance.themeId??appearance.theme
  const sandboxRoot=path.dirname(context.workspace.getState().workspacePath)
  settings.siteUrl='https://reports.example.test/site/'
  await context.workspace.writeFile('source/site-settings.json',Buffer.from(JSON.stringify(settings)))
  const baseline=await runCmsSiteReport('owner',draft.site_id,context.database,context.draftId,sandboxRoot)
  expect(baseline.issues.filter(issue=>issue.code==='internal_link')).toEqual([])
  const themeFiles=(await context.workspace.listFiles('themes')).filter(file=>file.endsWith('.liquid'))
  const template=themeFiles.find(file=>file.includes('/layouts/'))??themeFiles[0]
  const source=(await context.workspace.readFile(template)).toString()
  await context.workspace.writeFile(template,Buffer.from(source+'<a href="/missing-report-target/">Missing</a>'))
  const now=new Date().toISOString();const collectionId=randomUUID();const levelId=randomUUID()
  const localized={schemaVersion:1,locale:'en',title:'重复标题',summary:'',cover:null,seo:{title:'重复标题',description:'',ogImage:null},blocks:[{id:randomUUID(),type:'core/heading',props:{text:'跳跃标题',level:4},children:[]}],sourceHash:null,updatedAt:now}
  const entries=[
    {ref:'collection' as const,meta:{schemaVersion:1,collectionId,name:'Report',labels:{en:'Report'},prefix:'report',status:'draft',levels:[{levelId,name:'Series'}],fields:[],structuredData:null,feed:false,createdAt:now,updatedAt:now},locale:localized},
    {ref:'group' as const,collectionId,meta:{schemaVersion:1,groupId:randomUUID(),parentGroupId:null,levelId,order:0,status:'draft',createdAt:now,updatedAt:now},locale:{...localized,slug:'report-group'}},
    {ref:'item' as const,collectionId,meta:{schemaVersion:1,itemId:randomUUID(),primaryGroupId:null,groupIds:[],order:0,publishedAt:null,status:'draft',fields:{},createdAt:now,updatedAt:now},locale:{...localized,slug:'report-item',fields:{}}},
  ]
  for(const entry of entries){const initial=await createContent(context,entry);await saveContent(context,String(entry.meta[`${entry.ref}Id` as keyof typeof entry.meta]),{...entry,locale:{...entry.locale,locale:'zh-CN'}},initial.revision)}
  const historical=randomUUID()
  await client.query("INSERT INTO reports VALUES($1,'owner',$2,$3,'legacy-page',75,'[]',NOW())",[historical,draft.site_id,context.draftId])
  const report=await runCmsSiteReport('owner',draft.site_id,context.database,context.draftId,sandboxRoot)
  expect(new Set(report.content.map(row=>row.target.ref))).toEqual(new Set(['page','collection','group','item']))
  expect(new Set(report.content.map(row=>row.locale))).toEqual(new Set(settings.locales.map((locale:{code:string})=>locale.code)))
  expect(report.issues.some(issue=>issue.code==='internal_link')).toBe(true)
  expect(report.content.filter(row=>row.target.id===collectionId).every(row=>row.issues.some(issue=>issue.message.includes('重复')))).toBe(true)
  expect(report.summary.total).toBe(report.content.length)
  expect((await client.query('SELECT summary,issues FROM reports WHERE report_id=$1',[report.reportId])).rows[0]).toEqual({summary:report.summary,issues:report.issues})
  expect((await readCmsReportHistory('owner',draft.site_id,context.database)).map(row=>row.reportId)).toContain(historical)
  expect((await readCmsReport('owner',draft.site_id,report.reportId,context.database)).summary).toEqual(report.summary)
  const firstPage=(await context.workspace.listFiles('source/pages')).find(file=>file.endsWith('/en.json'))!
  const pageFile=JSON.parse((await context.workspace.readFile(firstPage)).toString())
  pageFile.blocks.push({id:randomUUID(),type:'core/button',props:{label:'Missing target',link:{kind:'internal',target:{ref:'page',id:randomUUID()}}},children:[]})
  await context.workspace.writeFile(firstPage,Buffer.from(JSON.stringify(pageFile)))
  const invalidBuild=await runCmsSiteReport('owner',draft.site_id,context.database,context.draftId,sandboxRoot)
  expect(invalidBuild.issues.some(issue=>issue.code==='build'&&!issue.target)).toBe(true)
  expect(invalidBuild.issues.some(issue=>issue.code==='build'&&issue.target)).toBe(true)
  await expect(runCmsSiteReport('stranger',draft.site_id,context.database,context.draftId,sandboxRoot)).rejects.toThrow('FORBIDDEN')
  expect(themeId).toBeTruthy()
}),120000)
