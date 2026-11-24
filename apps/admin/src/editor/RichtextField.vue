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
    <span class="richtext-label">{{ label }}</span>
    <div class="richtext-tools" role="toolbar" aria-label="文字格式">
      <el-button size="small" :type="editor?.isActive('bold')?'primary':'default'" @click="editor?.chain().focus().toggleBold().run()">加粗</el-button>
      <el-button size="small" :type="editor?.isActive('italic')?'primary':'default'" @click="editor?.chain().focus().toggleItalic().run()">斜体</el-button>
      <el-button size="small" @click="editor?.chain().focus().toggleBulletList().run()">项目列表</el-button>
      <el-button size="small" @click="editor?.chain().focus().toggleHeading({level:2}).run()">小标题</el-button>
    </div>
    <EditorContent :editor="editor" />
    <div class="richtext-tools">
      <el-input v-model="address" aria-label="链接地址" type="url" placeholder="https://" style="max-width:280px" />
      <el-button size="small" @click="address ? editor?.chain().focus().setLink({href:address}).run() : editor?.chain().focus().unsetLink().run()">设置链接</el-button>
    </div>
  </div>
</template>

<style scoped>
.richtext-field{display:grid;gap:.5rem;margin:.45rem 0}
.richtext-label{font-size:14px;color:var(--el-text-color-regular)}
.richtext-tools{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.richtext-field :deep(.tiptap){
  min-height:130px;
  border:1px solid var(--el-border-color);
  border-radius:var(--el-border-radius-base);
  padding:.65rem;
  background:var(--el-bg-color);
}
</style>
