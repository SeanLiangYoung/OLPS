import { expect,it } from 'vitest'
import { validateBlockProps } from './props-schema.js'

it('相同区块type在两个主题中使用不同字段定义时分别验证',()=>{
  const type='theme/shared-card'
  const text=[{key:'value',type:'text' as const,label:'文字',required:true}]
  const number=[{key:'value',type:'number' as const,label:'数值',required:true}]
  expect(validateBlockProps(type,text,{value:'文字'})).toEqual([])
  expect(validateBlockProps(type,number,{value:2})).toEqual([])
  expect(validateBlockProps(type,number,{value:'文字'}).length).toBeGreaterThan(0)
  expect(validateBlockProps(type,text,{value:2}).length).toBeGreaterThan(0)
  expect(validateBlockProps(type,text,{value:'文字'})).toEqual([])
})

it('同名区块的嵌套列表定义与选项更新后使用对应Schema',()=>{
  const type='theme/shared-list'
  const first=[{key:'rows',type:'list' as const,label:'列表',required:true,itemFields:[{key:'value',type:'select' as const,label:'选项',required:true,options:[{value:'one',label:'One'}]}]}]
  const second=[{...first[0],itemFields:[{...first[0].itemFields[0],options:[{value:'two',label:'Two'}]}]}]
  expect(validateBlockProps(type,first,{rows:[{value:'one'}]})).toEqual([])
  expect(validateBlockProps(type,second,{rows:[{value:'two'}]})).toEqual([])
  expect(validateBlockProps(type,second,{rows:[{value:'one'}]}).length).toBeGreaterThan(0)
  expect(validateBlockProps(type,first,{rows:[{value:'two'}]}).length).toBeGreaterThan(0)
})
