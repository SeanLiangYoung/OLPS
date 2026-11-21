import { expect,it } from 'vitest'
import { refreshContentIndexes,refreshContentIndexesUnlocked } from './content-sandbox.js'
import { withDraftLock } from './draft-lock.js'
import { withCmsContentSite,createGuardPage,cmsContentSnapshot } from './test-support/cms-content-fixture.js'

it('重建内容索引遇真实唯一约束失败，全部索引和文件保持原有内容',()=>withCmsContentSite(async context=>{
  const first=await createGuardPage(context,'First page')
  const second=await createGuardPage(context,'Second page')
  await withDraftLock(context.draftId,()=>refreshContentIndexesUnlocked(context))
  const id=String(second.content.meta.pageId)
  await context.workspace.writeFile(`source/pages/${id}/en.json`,Buffer.from(JSON.stringify({...second.content.locale,slug:first.content.locale.slug,title:'Duplicate slug'})))
  const before=await cmsContentSnapshot(context)
  await expect(refreshContentIndexes(context)).rejects.toMatchObject({code:'23505'})
  expect(await cmsContentSnapshot(context)).toEqual(before)
}),120000)
