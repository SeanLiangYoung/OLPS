<script setup lang="ts">
import { computed,ref } from 'vue'
import type { MediaMeta } from '@olps/domain'
import { signedResourceUrl,type ResourceAccess } from './canvas'

const props=defineProps<{modelValue:unknown;media:MediaMeta[];locale:string;access:ResourceAccess;multiple?:boolean;label:string}>()
const emit=defineEmits<{(event:'update:modelValue',value:unknown):void;(event:'upload',file:File):void;(event:'resource-error',token:string):void}>()
const open=ref(false)
const query=ref('')
const selected=computed(()=>props.multiple?(Array.isArray(props.modelValue)?props.modelValue as Array<{mediaId:string}>:[]):props.modelValue?[props.modelValue as {mediaId:string}]:[])
const filtered=computed(()=>props.media.filter(media=>String(media.title[props.locale]??'').toLowerCase().includes(query.value.toLowerCase())))
function choose(mediaId:string):void{
  if(props.multiple){
    const next=selected.value.some(item=>item.mediaId===mediaId)?selected.value.filter(item=>item.mediaId!==mediaId):[...selected.value,{mediaId}]
    emit('update:modelValue',next)
  }else{emit('update:modelValue',{mediaId});open.value=false}
}
function upload(event:Event):void{const file=(event.target as HTMLInputElement).files?.[0];if(file)emit('upload',file)}
function resourceFailed(event:Event):void{const source=(event.target as HTMLImageElement).currentSrc||(event.target as HTMLImageElement).src;if(!source)return;const token=new URL(source,location.href).searchParams.get('token');if(token)emit('resource-error',token)}
</script>

<template>
  <div class="media-picker">
    <span>{{ label }}</span>
    <div class="selected-media"><img v-for="item in selected" :key="item.mediaId" :src="media.find(media=>media.mediaId===item.mediaId) ? signedResourceUrl(media.find(media=>media.mediaId===item.mediaId)!.path,access) : undefined" alt="已选图片" @error="resourceFailed" /></div>
    <button type="button" @click="open=true">{{ multiple?'选择多张图片':'选择图片' }}</button>
    <button v-if="selected.length" type="button" @click="emit('update:modelValue',multiple?[]:undefined)">取消选择</button>
    <div v-if="open" class="media-dialog" role="dialog" aria-modal="true" :aria-label="label">
      <div class="media-panel">
        <h3>{{ label }}</h3>
        <input v-model="query" aria-label="查找图片" placeholder="输入图片名称" />
        <label>上传图片<input type="file" accept="image/*" @change="upload" /></label>
        <div class="media-grid"><button v-for="item in filtered" :key="item.mediaId" type="button" :aria-pressed="selected.some(selected=>selected.mediaId===item.mediaId)" @click="choose(item.mediaId)"><img v-if="item.mimeType.startsWith('image/')" :src="signedResourceUrl(item.path,access)" :alt="item.alt[locale]??''" @error="resourceFailed" /><span>{{ item.title[locale]||'未命名图片' }}</span></button></div>
        <p v-if="!filtered.length">还没有符合条件的图片，可以上传图片。</p>
        <button type="button" @click="open=false">完成选择</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-picker{display:grid;gap:.5rem}.selected-media{display:flex;gap:.5rem}.selected-media img{width:68px;height:52px;object-fit:cover;border-radius:4px}.media-dialog{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center;padding:1rem}.media-panel{background:white;color:#24323b;border-radius:10px;padding:1.25rem;width:min(720px,100%);max-height:85vh;overflow:auto}.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.6rem;margin:1rem 0}.media-grid button{display:grid;gap:.4rem;background:#f1f5f9;color:#24323b;border:2px solid transparent}.media-grid button[aria-pressed=true]{border-color:#1464a5}.media-grid img{width:100%;height:90px;object-fit:contain}
</style>
