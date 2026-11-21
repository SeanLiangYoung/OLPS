import { expect,it } from 'vitest'
import { withDraftLock } from './draft-lock.js'
import { saveContent,deleteContent,withContentTransaction } from './content-sandbox.js'
import { withCmsContentSite,createGuardPage,cmsContentSnapshot } from './test-support/cms-content-fixture.js'

function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

it('创建、保存、删除和受管文件写入等待草稿锁，期间文件、Git和索引不变',()=>withCmsContentSite(async context=>{
  const initial=await createGuardPage(context)
  for(const operation of [()=>createGuardPage(context,'Created while locked'),()=>saveContent(context,String(initial.content.meta.pageId),{...initial.content,locale:{...initial.content.locale,title:'Saved while locked'}},initial.revision),()=>withContentTransaction(context,true,async()=>{await context.workspace.writeFile('source/lock-check.json',Buffer.from('{}'))})]){
    const held=gate();const release=gate();const lock=withDraftLock(context.draftId,async()=>{held.release();await release.promise})
    await held.promise;const before=await cmsContentSnapshot(context)
    let completed=false
    const pending=operation().finally(()=>{completed=true})
    try{await new Promise(resolve=>setTimeout(resolve,80));expect(completed).toBe(false);expect(await cmsContentSnapshot(context)).toEqual(before)}finally{release.release();await lock}
    await pending;expect(completed).toBe(true)
  }
  const removable=await createGuardPage(context,'Delete while locked')
  const held=gate();const release=gate();const lock=withDraftLock(context.draftId,async()=>{held.release();await release.promise})
  await held.promise;const before=await cmsContentSnapshot(context);const pending=deleteContent(context,'page',String(removable.content.meta.pageId),removable.revision)
  try{await new Promise(resolve=>setTimeout(resolve,80));expect(await cmsContentSnapshot(context)).toEqual(before)}finally{release.release();await lock}
  await pending
}),120000)

it('等待草稿锁期间权限被撤销后保存拒绝，文件与索引保持不变',()=>withCmsContentSite(async(context,client)=>{
  const initial=await createGuardPage(context);const held=gate();const release=gate()
  const lock=withDraftLock(context.draftId,async()=>{held.release();await release.promise});await held.promise
  const pending=saveContent(context,String(initial.content.meta.pageId),{...initial.content,locale:{...initial.content.locale,title:'Revoked write'}},initial.revision)
  const rejected=expect(pending).rejects.toThrow('FORBIDDEN')
  await client.query('DELETE FROM draft_owners WHERE draft_id=$1 AND user_id=$2',[context.draftId,context.userId])
  const before=await cmsContentSnapshot(context);release.release();await lock;await rejected
  expect(await cmsContentSnapshot(context)).toEqual(before)
}),120000)

it('不同草稿可以同时取得编辑锁',async()=>{
  const heldA=gate();const heldB=gate();const release=gate()
  const first=withDraftLock('independent-a',async()=>{heldA.release();await release.promise})
  const second=withDraftLock('independent-b',async()=>{heldB.release();await release.promise})
  try{await Promise.all([heldA.promise,heldB.promise])}finally{release.release();await Promise.all([first,second])}
})
