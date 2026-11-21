import { expect,it } from 'vitest'
import { validateCollectionFields } from './collection-fields.js'
import type { FieldDefinition } from './content.js'

it('内容类型字段按定义验证类型、选项、必填、所属语言和表格列',()=>{
  const fields:FieldDefinition[]=[{key:'count',label:'数量',type:'number',required:true,translatable:false},{key:'choice',label:'选项',type:'select',required:false,translatable:true,options:[{value:'one',label:'One'}]},{key:'date',label:'日期',type:'date',required:false,translatable:false},{key:'table',label:'参数',type:'table',required:false,translatable:false,columns:[{key:'value',label:'数值',type:'number'}]}]
  expect(validateCollectionFields(fields,{count:2,date:'2026-11-21',table:[{value:2}]},{choice:'one'})).toEqual([])
  for(const [meta,locale]of [[{},{}],[{count:'2'},{}],[{count:2,choice:'one'},{}],[{count:2},{choice:'other'}],[{count:2,date:'2026-02-30'},{}],[{count:2,table:[{value:'2'}]},{}],[{count:2,unknown:1},{}],[{count:2},{count:3}]] as Array<[Record<string,unknown>,Record<string,unknown>]>)expect(validateCollectionFields(fields,meta,locale).length).toBeGreaterThan(0)
})

it('媒体、链接、引用、布尔和TipTap文档拒绝不匹配的结构',()=>{
  const fields:FieldDefinition[]=[{key:'description',label:'介绍',type:'richtext',required:true,translatable:true},{key:'image',label:'图片',type:'media',required:false,translatable:false},{key:'images',label:'图片集',type:'mediaList',required:false,translatable:false},{key:'link',label:'链接',type:'link',required:false,translatable:false},{key:'ref',label:'引用',type:'reference',required:false,translatable:false,referenceCollectionId:'products'},{key:'enabled',label:'启用',type:'boolean',required:false,translatable:false}]
  const meta={image:{mediaId:'image'},images:[{mediaId:'image'}],link:{kind:'internal',target:{ref:'page',id:'home'}},ref:{ref:'item',id:'product'},enabled:true}
  const locale={description:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'说明'}]}]}}
  expect(validateCollectionFields(fields,meta,locale)).toEqual([])
  for(const change of [{image:'image'},{images:['image']},{link:{kind:'external',url:'javascript:alert(1)',newWindow:false}},{ref:{ref:'page',id:'home'}},{enabled:'true'}])expect(validateCollectionFields(fields,{...meta,...change},locale).length).toBeGreaterThan(0)
  expect(validateCollectionFields(fields,meta,{description:'<p>HTML</p>'}).length).toBeGreaterThan(0)
})
