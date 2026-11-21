import { expect,it } from 'vitest'
import { sourceHashFor } from './source-hash.js'

it('翻译摘要排除语言地址时间并使用规范化JSON',()=>{
  const first={locale:'en',slug:'first',sourceHash:null,updatedAt:'2026-11-20',title:'Heading',summary:'Text',blocks:[]}
  const reordered={blocks:[],summary:'Text',title:'Heading',locale:'zh-CN',slug:'second',sourceHash:'existing',updatedAt:'2026-11-21'}
  expect(sourceHashFor(first)).toBe(sourceHashFor(reordered))
  expect(sourceHashFor({...first,title:'Updated'})).not.toBe(sourceHashFor(first))
})
