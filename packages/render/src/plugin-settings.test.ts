import fs from 'node:fs/promises'
import {expect,it} from 'vitest'
import {createMemorySourceReader} from './memory-source-reader.js'
import {loadSiteModel} from './site-model.js'
import {renderTarget} from './render-document.js'
import {PAGE_IDS} from './test-support/fixture-ids.js'
import fullSiteFiles from './test-support/full-site-files.json'

it('启用插件的多语言配置进入区块和全站snippet，三种渲染模式保持一致',async()=>{
  const files:Record<string,string>={...fullSiteFiles}
  for(const id of ['whatsapp','google-maps'])for(const file of ['plugin.json',...(id==='whatsapp'?['snippets/button.liquid','sections/button/section.liquid']:['sections/map/section.liquid'])])files[`plugins/${id}/${file}`]=await fs.readFile(new URL(`../../builtin-plugins/${id}/${file}`,import.meta.url),'utf8')
  const reader=createMemorySourceReader(files),model=await loadSiteModel(reader)
  model.plugins.plugins.whatsapp={...model.plugins.plugins.whatsapp!,enabled:true,settings:{phone:'8613800138000',buttonLabel:{en:'Contact our team','zh-CN':'联系团队'},position:'bottom-left'}}
  model.plugins.plugins['google-maps']={...model.plugins.plugins['google-maps']!,enabled:true,settings:{defaultAddress:{en:'25 Harbour Street','zh-CN':'港口街25号'}}}
  const page=model.pages.find(page=>page.meta.pageId===PAGE_IDS.about)!
  for(const locale of ['en','zh-CN']){
    page.locales[locale]!.blocks=[{id:'phone',type:'plugin/whatsapp/button',props:{},children:[]},{id:'map',type:'plugin/google-maps/map',props:{},children:[]}]
    for(const mode of ['publish','preview','canvas'] as const){
      const html=await renderTarget(model,{kind:'page',pageId:PAGE_IDS.about},locale,{mode,reader})
      expect(html).toContain('https://wa.me/8613800138000')
      expect(html).toContain(locale==='en'?'Contact our team':'联系团队')
      expect(html).toContain(locale==='en'?'25 Harbour Street':'港口街25号')
      expect(html).toContain('data-olps-whatsapp-float')
      expect(html).toContain('data-position="bottom-left"')
      if(mode==='canvas')expect(html).not.toMatch(/<script\b[^>]*src=/)
    }
  }
  page.locales.en!.blocks=[{id:'map',type:'plugin/google-maps/map',props:{address:'Alternate office address'},children:[]}]
  expect(await renderTarget(model,{kind:'page',pageId:PAGE_IDS.about},'en',{mode:'preview',reader})).toContain('Alternate office address')
  page.locales.en!.blocks=[]
  const manifest=JSON.parse(files['plugins/whatsapp/plugin.json']!)
  manifest.snippets=[{file:'snippets/scoped.liquid',position:'head',scope:'pages-with-block'}]
  files['plugins/whatsapp/plugin.json']=JSON.stringify(manifest)
  files['plugins/whatsapp/snippets/scoped.liquid']='<meta name="scoped-plugin" content="{{ plugin.settings.phone }}">'
  const scoped=createMemorySourceReader(files)
  expect(await renderTarget(model,{kind:'page',pageId:PAGE_IDS.about},'en',{mode:'publish',reader:scoped})).not.toContain('name="scoped-plugin"')
  page.locales.en!.blocks=[{id:'phone',type:'plugin/whatsapp/button',props:{phone:'442071234567',label:'Direct contact'},children:[]}]
  const html=await renderTarget(model,{kind:'page',pageId:PAGE_IDS.about},'en',{mode:'publish',reader:scoped})
  expect(html).toContain('<meta name="scoped-plugin" content="8613800138000">')
  expect(html).toContain('https://wa.me/442071234567')
  expect(html).toContain('Direct contact')
  model.plugins.plugins.whatsapp!.settings={}
  const unconfigured=await renderTarget(model,{kind:'page',pageId:PAGE_IDS.about},'en',{mode:'publish',reader})
  expect(unconfigured).not.toContain('data-olps-whatsapp-float')
  expect(unconfigured).toContain('https://wa.me/442071234567')
})
