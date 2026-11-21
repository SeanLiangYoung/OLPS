import { mount,flushPromises } from '@vue/test-utils'
import { expect,it } from 'vitest'
import type { BlockFieldDefinition } from '@olps/domain'
import type { Editor } from '@tiptap/core'
import FieldControl from './FieldControl.vue'
import RichtextField from './RichtextField.vue'

const resources={media:[],locale:'en',access:{token:crypto.randomUUID(),resourceBaseUrl:'/resources/',expiresAt:new Date(Date.now()+900000).toISOString()},links:[{title:'About',target:{ref:'page' as const,id:'about'}}]}
function field(type:BlockFieldDefinition['type']):BlockFieldDefinition{return {key:'value',type,label:'Value',required:true,translatable:true}}

it.each([
  ['text','Old','Updated','input'],
  ['number',1,42,'input'],
  ['color','#000000','#123456','input'],
] as const)('%s 字段保存实际输入值',async(type,initial,value,selector)=>{
  const wrapper=mount(FieldControl,{props:{...resources,field:field(type),modelValue:initial}})
  await wrapper.get(selector).setValue(value)
  expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toBe(value)
  wrapper.unmount()
})

it('布尔、选择、链接与列表字段保持结构',async()=>{
  const boolean=mount(FieldControl,{props:{...resources,field:field('boolean'),modelValue:false}})
  await boolean.get('input').setValue(true)
  expect(boolean.emitted('update:modelValue')!.at(-1)![0]).toBe(true)
  boolean.unmount()
  const select=mount(FieldControl,{props:{...resources,field:{...field('select'),options:[{value:'one',label:'One'},{value:'two',label:'Two'}]},modelValue:'one'}})
  await select.get('select').setValue('two')
  expect(select.emitted('update:modelValue')!.at(-1)![0]).toBe('two')
  select.unmount()
  const link=mount(FieldControl,{props:{...resources,field:field('link'),modelValue:{kind:'external',url:'https://example.com',newWindow:false}}})
  await link.get('input[type=url]').setValue('https://example.org')
  expect(link.emitted('update:modelValue')!.at(-1)![0]).toEqual({kind:'external',url:'https://example.org',newWindow:false})
  link.unmount()
  const list=mount(FieldControl,{props:{...resources,field:{...field('list'),itemFields:[{...field('text'),key:'title'}]},modelValue:[{title:'Old'}]}})
  await list.get('input').setValue('Updated')
  expect(list.emitted('update:modelValue')!.at(-1)![0]).toEqual([{title:'Updated'}])
  list.unmount()
})

it('媒体与多图字段可以打开实际选择对话框',async()=>{
  for(const type of ['media','mediaList'] as const){
    const wrapper=mount(FieldControl,{props:{...resources,field:field(type),modelValue:type==='media'?null:[]}})
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role=dialog]').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没有符合条件的图片')
    wrapper.unmount()
  }
})

it('富文本字段使用真实TipTap编辑器并输出文档树',async()=>{
  const wrapper=mount(FieldControl,{props:{...resources,field:field('richtext'),modelValue:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original'}]}]}}})
  await flushPromises()
  const richtext=wrapper.getComponent(RichtextField)
  const editor=(richtext.vm as unknown as {editor:Editor}).editor
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Updated'}]}]})
  expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toMatchObject({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Updated'}]}]})
  wrapper.unmount()
})

it('清空可选数值和选择字段时移除字段值，媒体可以取消选择',async()=>{
  const number=mount(FieldControl,{props:{...resources,field:{...field('number'),required:false},modelValue:2}})
  await number.get('input').setValue('')
  expect(number.emitted('update:modelValue')!.at(-1)![0]).toBeUndefined()
  number.unmount()
  const select=mount(FieldControl,{props:{...resources,field:{...field('select'),required:false,options:[{value:'one',label:'One'}]},modelValue:'one'}})
  await select.get('select').setValue('')
  expect(select.emitted('update:modelValue')!.at(-1)![0]).toBeUndefined()
  select.unmount()
  const media=mount(FieldControl,{props:{...resources,field:{...field('media'),required:false},modelValue:{mediaId:'selected-image'}}})
  await media.findAll('button').find(button=>button.text()==='取消选择')!.trigger('click')
  expect(media.emitted('update:modelValue')!.at(-1)![0]).toBeUndefined()
  media.unmount()
})
