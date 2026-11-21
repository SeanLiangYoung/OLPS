import { describe,expect,it } from 'vitest'
import { applySavedPageMetadata,pageEditSnapshot,protectPageUnload,PageEditSession } from './pageEditSession'
import type { EditorContent } from './editor/document'

function content():EditorContent{return {ref:'page',meta:{pageId:'page-a',updatedAt:'before'},locale:{locale:'en',title:'当前标题',summary:'',seo:{title:'当前 SEO',description:'当前描述',ogImage:null},blocks:[],updatedAt:'before'}}}

describe('内容编辑会话',()=>{
  it('保存内容与原始内容相同时允许离开，编辑和保存期间提示',()=>{
    const current=content();const session=new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    const saved=new Event('beforeunload',{cancelable:true}) as BeforeUnloadEvent
    protectPageUnload(saved,session.needsLeaveWarning(current));expect(saved.defaultPrevented).toBe(false)
    current.locale.title='未保存标题'
    const dirty=new Event('beforeunload',{cancelable:true}) as BeforeUnloadEvent
    protectPageUnload(dirty,session.needsLeaveWarning(current));expect(dirty.defaultPrevented).toBe(true)
    current.locale.title='当前标题';const operation=session.begin()!
    expect(session.needsLeaveWarning(current)).toBe(true);session.finish(operation)
    expect(session.needsLeaveWarning(current)).toBe(false)
  })
  it('保存期间的新输入保持未保存状态，保存响应只更新服务器时间',()=>{
    const current=content();const session=new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current));current.locale.title='提交标题'
    const sent=structuredClone(current);const operation=session.begin()!
    expect(session.saveStatus(current)).toBe('正在保存…')
    current.locale.title='请求期间输入';sent.meta.updatedAt='after';sent.locale.updatedAt='after'
    applySavedPageMetadata(current,sent);session.acceptSaved(pageEditSnapshot(sent));session.finish(operation)
    expect(current.locale.title).toBe('请求期间输入');expect(current.meta.updatedAt).toBe('after')
    expect(session.saveStatus(current)).toBe('有未保存修改')
  })
  it('保存失败保留输入，重试成功显示已保存',()=>{
    const current=content();const session=new PageEditSession();session.acceptSaved(pageEditSnapshot(current))
    current.locale.blocks=[{id:'heading',type:'core/heading',props:{text:'需要重试的输入',level:2},children:[]}]
    const operation=session.begin()!;session.saveFailed=true;session.finish(operation)
    expect(session.saveStatus(current)).toBe('保存失败，输入已保留，请重试')
    expect(current.locale.blocks[0].props.text).toBe('需要重试的输入')
    const retry=session.begin()!;session.acceptSaved(pageEditSnapshot(current));session.finish(retry)
    expect(session.saveStatus(current)).toBe('已保存')
  })
  it('页面切换使旧响应失效，旧操作不能释放新操作',()=>{
    const session=new PageEditSession();const old=session.begin()!;expect(session.begin()).toBeNull()
    session.saveFailed=true;session.reset();expect(session.saveFailed).toBe(false)
    const current=session.begin()!;session.finish(old)
    expect(session.isCurrent(old)).toBe(false);expect(session.pending).toBe(true)
    session.finish(current);expect(session.pending).toBe(false)
    const first=session.reset();expect(session.isCurrent(first)).toBe(true)
    session.reset();expect(session.isCurrent(first)).toBe(false)
  })
  it('内容标识与语言必须匹配，服务器时间变化不产生未保存状态',()=>{
    const current=content();const saved=structuredClone(current);saved.meta.updatedAt='after';saved.locale.updatedAt='after'
    expect(pageEditSnapshot(current)).toBe(pageEditSnapshot(saved))
    expect(()=>applySavedPageMetadata(current,{...saved,meta:{pageId:'page-b'}})).toThrow('内容标识')
    expect(()=>applySavedPageMetadata(current,{...saved,locale:{...saved.locale,locale:'zh-CN'}})).toThrow('内容标识')
  })
})
