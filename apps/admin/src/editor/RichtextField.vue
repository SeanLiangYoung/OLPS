<script setup lang="ts">
import { ref,watch } from 'vue'
import { EditorContent,useEditor } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

const props=defineProps<{modelValue:unknown;label:string}>()
const emit=defineEmits<{(event:'update:modelValue',value:unknown):void}>()
const address=ref('')
const editor=useEditor({
  extensions:[StarterKit.configure({link:false}),Link.configure({openOnClick:false})],
  content:props.modelValue as JSONContent,
  editorProps:{attributes:{role:'textbox','aria-label':props.label,'aria-multiline':'true'}},
  onUpdate:({editor})=>emit('update:modelValue',editor.getJSON()),
})
watch(()=>props.modelValue,value=>{
  if(editor.value&&JSON.stringify(editor.value.getJSON())!==JSON.stringify(value))editor.value.commands.setContent(value as JSONContent,{emitUpdate:false})
},{deep:true})
defineExpose({editor})
</script>

<template>
  <div class="richtext-field">
    <span>{{ label }}</span>
    <div class="richtext-tools" role="toolbar" aria-label="文字格式">
      <button type="button" :aria-pressed="editor?.isActive('bold')" @click="editor?.chain().focus().toggleBold().run()">加粗</button>
      <button type="button" :aria-pressed="editor?.isActive('italic')" @click="editor?.chain().focus().toggleItalic().run()">斜体</button>
      <button type="button" @click="editor?.chain().focus().toggleBulletList().run()">项目列表</button>
      <button type="button" @click="editor?.chain().focus().toggleHeading({level:2}).run()">小标题</button>
    </div>
    <EditorContent :editor="editor" />
    <div class="richtext-tools"><input v-model="address" aria-label="链接地址" type="url" placeholder="https://" /><button type="button" @click="address ? editor?.chain().focus().setLink({href:address}).run() : editor?.chain().focus().unsetLink().run()">设置链接</button></div>
  </div>
</template>

<style scoped>
.richtext-field{display:grid;gap:.5rem}.richtext-tools{display:flex;flex-wrap:wrap;gap:.35rem}.richtext-tools button{padding:.35rem .55rem}.richtext-field :deep(.tiptap){min-height:130px;border:1px solid var(--line,#ccd4db);border-radius:6px;padding:.65rem;background:white}
</style>
