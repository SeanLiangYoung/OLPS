import { expect,it } from 'vitest'
import { createMemorySourceReader,loadSiteModel,renderTarget,normalizeHtml } from '@olps/render'
import files from '../../../../packages/render/src/test-support/full-site-files.json'
import { createOverlaySourceReader } from './source-reader'

it('编辑器覆盖语言文件后与共享渲染输出一致且不修改原始资料',async()=>{
  const base=createMemorySourceReader(files)
  const original=await loadSiteModel(base)
  const target=original.pages.find(page=>page.meta.role==='about')!
  const localized=structuredClone(target.locales.en)
  localized.title='Editor title'
  const overlay=createOverlaySourceReader(base,new Map([[`${target.directoryPath}/en.json`,JSON.stringify(localized)]]))
  const edited=await loadSiteModel(overlay)
  const html=await renderTarget(edited,{kind:'page',pageId:target.meta.pageId},'en',{reader:overlay,mode:'canvas'})
  const expectedReader=createMemorySourceReader({...files,[`${target.directoryPath}/en.json`]:JSON.stringify(localized)})
  const expectedModel=await loadSiteModel(expectedReader)
  const expected=await renderTarget(expectedModel,{kind:'page',pageId:target.meta.pageId},'en',{reader:expectedReader,mode:'canvas'})
  expect(normalizeHtml(html)).toBe(normalizeHtml(expected))
  expect((await loadSiteModel(base)).pages.find(page=>page.meta.pageId===target.meta.pageId)!.locales.en.title).toBe(target.locales.en.title)
})
