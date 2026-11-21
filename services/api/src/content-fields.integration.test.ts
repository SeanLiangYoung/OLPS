import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import type { FieldDefinition } from '@olps/domain'
import { createContent,saveContent,readContent,saveContentBatch,refreshContentIndexes,type ManagedContent } from './content-sandbox.js'
import { uploadMedia } from './media-routes.js'
import { withCmsContentSite,cmsContentSnapshot } from './test-support/cms-content-fixture.js'

it('条目自定义字段按定义验证，失败时文件、全部索引和revision保持不变',()=>withCmsContentSite(async context=>{
  const now=new Date().toISOString()
  const locale={schemaVersion:1,locale:'en',title:'Fields',summary:'',cover:null,seo:{title:'Fields',description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}
  const collection=(collectionId:string,fields:FieldDefinition[])=>({ref:'collection' as const,meta:{schemaVersion:1,collectionId,name:'Fields',labels:{en:'Fields'},prefix:`fields-${collectionId}`,status:'draft',levels:[],fields,structuredData:null,feed:false,createdAt:now,updatedAt:now},locale})
  const item=(collectionId:string,itemId:string,shared:Record<string,unknown>,localized:Record<string,unknown>)=>({ref:'item' as const,collectionId,meta:{schemaVersion:1,itemId,primaryGroupId:null,groupIds:[],order:0,publishedAt:null,status:'draft',fields:shared,createdAt:now,updatedAt:now},locale:{...locale,slug:`item-${itemId}`,fields:localized}})
  const targetCollection=randomUUID(),otherCollection=randomUUID()
  await createContent(context,collection(targetCollection,[]));await createContent(context,collection(otherCollection,[]))
  const targetItem=randomUUID(),otherItem=randomUUID()
  await createContent(context,item(targetCollection,targetItem,{},{}));await createContent(context,item(otherCollection,otherItem,{},{}))
  const media=await uploadMedia(context,{fileName:'field.svg',content:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>')})
  const definition:FieldDefinition[]=[
    {key:'name',label:'名称',type:'text',required:true,translatable:true},
    {key:'description',label:'介绍',type:'richtext',required:true,translatable:true},
    {key:'count',label:'数量',type:'number',required:true,translatable:false},
    {key:'enabled',label:'启用',type:'boolean',required:true,translatable:false},
    {key:'choice',label:'选项',type:'select',required:false,translatable:true,options:[{value:'one',label:'One'}]},
    {key:'date',label:'日期',type:'date',required:false,translatable:false},
    {key:'image',label:'图片',type:'media',required:false,translatable:false},
    {key:'images',label:'图片集',type:'mediaList',required:false,translatable:false},
    {key:'link',label:'链接',type:'link',required:false,translatable:false},
    {key:'table',label:'参数',type:'table',required:false,translatable:false,columns:[{key:'value',label:'数值',type:'number'}]},
    {key:'ref',label:'引用',type:'reference',required:false,translatable:false,referenceCollectionId:targetCollection},
  ]
  const collectionId=randomUUID();const definitionSaved=await createContent(context,collection(collectionId,definition))
  const shared={count:0,enabled:false,date:'2026-11-21',image:{mediaId:media.media.mediaId},images:[{mediaId:media.media.mediaId}],link:{kind:'internal',target:{ref:'item',id:targetItem}},table:[{value:4}],ref:{ref:'item',id:targetItem}}
  const localized={name:'名称',description:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'介绍'}]}]},choice:'one'}
  const itemId=randomUUID();const saved=await createContent(context,item(collectionId,itemId,shared,localized))
  const mutations:Array<(value:ManagedContent)=>void>=[
    value=>{value.meta.fields={...shared,count:'2'}},value=>{value.meta.fields={...shared,count:undefined}},
    value=>{value.meta.fields={...shared,unknown:'value'}},value=>{value.meta.fields={...shared,name:'错误位置'}},
    value=>{value.locale.fields={...localized,count:3}},value=>{value.locale.fields={...localized,choice:'other'}},
    value=>{value.meta.fields={...shared,date:'2026-02-30'}},value=>{value.meta.fields={...shared,table:[{value:'4'}]}},
    value=>{value.meta.fields={...shared,ref:{ref:'page',id:targetItem}}},value=>{value.meta.fields={...shared,ref:{ref:'item',id:otherItem}}},
    value=>{value.meta.fields={...shared,ref:{ref:'item',id:randomUUID()}}},value=>{value.locale.fields={...localized,description:'<p>HTML</p>'}},
    value=>{value.meta.fields={...shared,enabled:'false'}},value=>{value.meta.fields={...shared,link:{kind:'external',url:'javascript:alert(1)',newWindow:false}}},
    value=>{value.meta.fields={...shared,image:'image'}},value=>{value.meta.fields={...shared,images:['image']}},
  ]
  for(const mutation of mutations){
    const changed=structuredClone(saved.content);mutation(changed);const before=await cmsContentSnapshot(context)
    await expect(saveContent(context,itemId,changed,saved.revision)).rejects.toThrow('VALIDATION_FAILED')
    expect(await cmsContentSnapshot(context)).toEqual(before)
    expect((await readContent(context,'item',itemId,'en')).revision).toBe(saved.revision)
  }
  const before=await cmsContentSnapshot(context)
  await expect(saveContent(context,collectionId,{...definitionSaved.content,meta:{...definitionSaved.content.meta,fields:[...definition,{key:'requiredExtra',label:'新增必填',type:'text',required:true,translatable:false}]}},definitionSaved.revision)).rejects.toThrow('RESOURCE_IN_USE')
  expect(await cmsContentSnapshot(context)).toEqual(before)
  const beforeDuplicate=await cmsContentSnapshot(context)
  await expect(createContent(context,item(otherCollection,itemId,{},{}))).rejects.toThrow('REVISION_CONFLICT')
  expect(await cmsContentSnapshot(context)).toEqual(beforeDuplicate)
  const groupId=randomUUID(),levelId=randomUUID(),groupCollections=[randomUUID(),randomUUID()]
  for(const target of groupCollections){const value=collection(target,[]);await createContent(context,{...value,meta:{...value.meta,levels:[{levelId,name:'分组'}]}})}
  const group={ref:'group' as const,collectionId:groupCollections[0],meta:{schemaVersion:1,groupId,parentGroupId:null,levelId,order:0,status:'draft',createdAt:now,updatedAt:now},locale:{...locale,slug:'duplicate-group'}}
  await createContent(context,group)
  const beforeGroupDuplicate=await cmsContentSnapshot(context)
  await expect(createContent(context,{...group,collectionId:groupCollections[1]})).rejects.toThrow('REVISION_CONFLICT')
  expect(await cmsContentSnapshot(context)).toEqual(beforeGroupDuplicate)
  const pendingId=randomUUID()
  await saveContentBatch(context,[{content:{...saved.content,meta:{...saved.content.meta,fields:{...shared,ref:{ref:'item',id:pendingId}}}},revision:saved.revision},{content:item(targetCollection,pendingId,{},{}),revision:null}])
  const current=await readContent(context,'item',itemId,'en')
  const wrongId=randomUUID();const beforeBatch=await cmsContentSnapshot(context)
  await expect(saveContentBatch(context,[{content:item(otherCollection,wrongId,{},{}),revision:null},{content:{...current.content,meta:{...current.content.meta,fields:{...shared,ref:{ref:'item',id:wrongId}}}},revision:current.revision}])).rejects.toThrow('VALIDATION_FAILED')
  expect(await cmsContentSnapshot(context)).toEqual(beforeBatch)
  await context.workspace.writeFile(`source/collections/${collectionId}/items/${itemId}/en.json`,Buffer.from(JSON.stringify({...current.content.locale,fields:{...localized,choice:'unknown'}})))
  const beforeReindex=await cmsContentSnapshot(context)
  await expect(refreshContentIndexes(context)).rejects.toThrow('VALIDATION_FAILED')
  expect(await cmsContentSnapshot(context)).toEqual(beforeReindex)
}),120000)
