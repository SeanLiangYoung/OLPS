import { expect,it } from 'vitest'
import { createContent,saveContent,deleteContent } from './content-sandbox.js'
import { withCmsContentSite,createGuardPage,cmsContentSnapshot } from './test-support/cms-content-fixture.js'

it('需要成员处理冲突、正在同步和初始化期间拒绝内容修改，Git、文件和索引保持不变',()=>withCmsContentSite(async(context,client)=>{
  const initial=await createGuardPage(context)
  const id=String(initial.content.meta.pageId)
  for(const state of [{status:'conflict',sync_status:'awaiting_user',init_status:'ready'},{status:'conflict',sync_status:'merge_conflict',init_status:'ready'},{status:'syncing',sync_status:'clean',init_status:'ready'},{status:'active',sync_status:'clean',init_status:'initializing'}]){
    await client.query('UPDATE site_drafts SET status=$1,sync_status=$2,init_status=$3 WHERE draft_id=$4',[state.status,state.sync_status,state.init_status,context.draftId])
    const before=await cmsContentSnapshot(context)
    await expect(createContent(context,{...initial.content,meta:{...initial.content.meta,pageId:crypto.randomUUID()}})).rejects.toThrow('DRAFT_ORDINARY_EDIT_BLOCKED')
    await expect(saveContent(context,id,{...initial.content,locale:{...initial.content.locale,title:'Conflict write'}},initial.revision)).rejects.toThrow('DRAFT_ORDINARY_EDIT_BLOCKED')
    await expect(deleteContent(context,'page',id,initial.revision)).rejects.toThrow('DRAFT_ORDINARY_EDIT_BLOCKED')
    expect(await cmsContentSnapshot(context)).toEqual(before)
  }
}),120000)
