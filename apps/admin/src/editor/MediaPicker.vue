<script setup lang="ts">
import { computed,ref } from 'vue'
import type { UploadFile } from 'element-plus'
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
function uploadFile(file:UploadFile):void{if(file.raw)emit('upload',file.raw)}
function resourceFailed(event:Event):void{const source=(event.target as HTMLImageElement).currentSrc||(event.target as HTMLImageElement).src;if(!source)return;const token=new URL(source,location.href).searchParams.get('token');if(token)emit('resource-error',token)}
</script>

<template>
  <div class="media-picker">
    <span class="media-label">{{ label }}</span>
    <div class="selected-media">
      <img
        v-for="item in selected"
        :key="item.mediaId"
        :src="media.find(media=>media.mediaId===item.mediaId) ? signedResourceUrl(media.find(media=>media.mediaId===item.mediaId)!.path,access) : undefined"
        alt="已选图片"
        @error="resourceFailed"
      />
    </div>
    <div class="row">
      <el-button @click="open=true">{{ multiple?'选择多张图片':'选择图片' }}</el-button>
      <el-button v-if="selected.length" @click="emit('update:modelValue',multiple?[]:undefined)">取消选择</el-button>
    </div>
    <el-dialog v-model="open" :title="label" width="720px" append-to-body>
      <el-input v-model="query" aria-label="查找图片" placeholder="输入图片名称" class="search" />
      <el-upload :auto-upload="false" :show-file-list="false" accept="image/*" :on-change="uploadFile">
        <el-button>上传图片</el-button>
      </el-upload>
      <div class="media-grid">
        <el-button
          v-for="item in filtered"
          :key="item.mediaId"
          class="media-tile"
          :type="selected.some(selected=>selected.mediaId===item.mediaId)?'primary':'default'"
          @click="choose(item.mediaId)"
        >
          <img v-if="item.mimeType.startsWith('image/')" :src="signedResourceUrl(item.path,access)" :alt="item.alt[locale]??''" @error="resourceFailed" />
          <span>{{ item.title[locale]||'未命名图片' }}</span>
        </el-button>
      </div>
      <p v-if="!filtered.length">还没有符合条件的图片，可以上传图片。</p>
      <template #footer>
        <el-button type="primary" @click="open=false">完成选择</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.media-picker{display:grid;gap:.5rem;margin:.45rem 0}
.media-label{font-size:14px;color:var(--el-text-color-regular)}
.selected-media{display:flex;gap:.5rem;flex-wrap:wrap}
.selected-media img{width:68px;height:52px;object-fit:cover;border-radius:4px}
.row{display:flex;flex-wrap:wrap;gap:8px}
.search{margin-bottom:12px}
.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.6rem;margin:1rem 0}
.media-tile{display:grid!important;gap:.4rem;height:auto;padding:8px;white-space:normal}
.media-tile img{width:100%;height:90px;object-fit:contain}
</style>
