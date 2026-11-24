<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { UploadFile } from 'element-plus'
import type { MediaMeta } from '@olps/domain'
import { api, getSelectedDraftId } from '../api'
import { contentLocale as cmsLocale } from '../cms-state'
import { selectedDraftIdState } from '../workspaceSession'

type Entry = { media: MediaMeta; revision: string }
type MediaContext = { version: number; draftId: string; locale: string }
const entries = ref<Entry[]>([])
const selected = ref<Entry | null>(null)
const title = ref('')
const alt = ref('')
const caption = ref('')
const search = ref('')
const error = ref('')
const message = ref('')
const busy = ref(false)
const fileUrl = ref('')
const usages = ref<Array<{ title: string; href?: string }>>([])
const deleting = ref(false)
let generation = 0
const base = (draftId: string) => `/api/drafts/${draftId}/media`
function context(): MediaContext { return { version: generation, draftId: getSelectedDraftId(), locale: cmsLocale.value } }
function isCurrent(value: MediaContext): boolean { return value.version === generation && value.draftId === getSelectedDraftId() && value.locale === cmsLocale.value }
const filtered = computed(() => entries.value.filter(entry => `${entry.media.title[cmsLocale.value] ?? ''} ${entry.media.mimeType}`.toLowerCase().includes(search.value.toLowerCase())))
function release(): void { fileUrl.value = '' }
async function load(value=context()): Promise<void> { if(!value.draftId){if(isCurrent(value))entries.value=[];return}const result=await api<{media:Entry[]}>('GET',base(value.draftId));if(isCurrent(value))entries.value=result.media }
async function choose(entry: Entry): Promise<MediaContext | null> {
  generation++
  const value = context()
  selected.value = entry; title.value = entry.media.title[value.locale] ?? ''; alt.value = entry.media.alt[value.locale] ?? ''; caption.value = entry.media.caption[value.locale] ?? ''; usages.value = []; error.value = ''; message.value = ''; deleting.value = false; release()
  try {
    const capability = await api<{ token: string; resourceBaseUrl: string }>('POST', `/api/drafts/${value.draftId}/resource-access`)
    if (!isCurrent(value)) return null
    fileUrl.value = `${capability.resourceBaseUrl}${entry.media.path}?token=${encodeURIComponent(capability.token)}`
    const references = (await api<{ usages: Array<{path:string;field:string}> }>('GET', `${base(value.draftId)}/${entry.media.mediaId}/usages`)).usages
    if (!isCurrent(value)) return null
    const display = await Promise.all(references.map(async reference => {
      if (!isCurrent(value)) return null
      const page = /^source\/pages\/([^/]+)\/([^/]+)\.json$/.exec(reference.path)
      const content = /^source\/collections\/([^/]+)\/(groups|items)\/([^/]+)\/([^/]+)\.json$/.exec(reference.path)
      const ref = page ? 'page' : content?.[2] === 'groups' ? 'group' : 'item'
      const id = page?.[1] ?? content?.[3]
      const locale = page?.[2] ?? content?.[4]
      if (id && locale && !['page','group','item'].includes(locale)) {
        const result = await api<{content:{locale:{title:string}}}>('GET', `/api/drafts/${value.draftId}/content/${ref}/${id}?locale=${encodeURIComponent(locale)}`)
        if (!isCurrent(value)) return null
        return {title:result.content.locale.title,href:`/content/${ref}/${id}?locale=${encodeURIComponent(locale)}`}
      }
      return {title:reference.path.includes('appearance') ? '外观定制或导航菜单' : reference.path.includes('site-settings') ? '网站常规设置' : '网站内容设置'}
    }))
    if (!isCurrent(value)) return null
    usages.value = display.filter(item => item !== null)
    return value
  } catch (reason) { if (isCurrent(value)) error.value = (reason as Error).message; return null }
}
async function uploadFile(file: File, replace = false): Promise<void> {
  if (!file || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  const value=context()
  try {
    const body = new FormData(); body.append('file', file)
    const current = selected.value
    const entry = await api<Entry>('POST', replace && current ? `${base(value.draftId)}/${current.media.mediaId}/replace` : base(value.draftId), body, replace && current ? { headers: { 'If-Match': `"${current.revision}"` } } : undefined)
    if(!isCurrent(value))return
    await load(value)
    if(!isCurrent(value))return
    const chosen=await choose(entry)
    if(chosen&&isCurrent(chosen))message.value = replace ? '媒体文件已替换' : '媒体文件已上传'
  } catch (reason) { if(isCurrent(value))error.value = (reason as Error).message } finally { busy.value = false }
}
function onUploadChange(file: UploadFile): void {
  if (file.raw) void uploadFile(file.raw, false)
}
function onReplaceChange(file: UploadFile): void {
  if (file.raw) void uploadFile(file.raw, true)
}
async function save(): Promise<void> {
  if (!selected.value || busy.value) return
  busy.value = true; error.value = ''
  const value=context()
  try {
    const current = selected.value
    const entry = await api<Entry>('PUT', `${base(value.draftId)}/${current.media.mediaId}`, { title: { ...current.media.title, [value.locale]: title.value }, alt: { ...current.media.alt, [value.locale]: alt.value }, caption: { ...current.media.caption, [value.locale]: caption.value } }, { headers: { 'If-Match': `"${current.revision}"` } })
    if(!isCurrent(value))return
    await load(value)
    if(!isCurrent(value))return
    const chosen=await choose(entry)
    if(chosen&&isCurrent(chosen))message.value = '媒体资料已保存'
  } catch (reason) { if(isCurrent(value))error.value = (reason as Error).message } finally { busy.value = false }
}
async function remove(): Promise<void> {
  if (!selected.value || busy.value) return
  busy.value = true; error.value = ''
  const value=context()
  try { await api('DELETE', `${base(value.draftId)}/${selected.value.media.mediaId}`, undefined, { headers: { 'If-Match': `"${selected.value.revision}"` } }); if(!isCurrent(value))return;selected.value = null; release(); deleting.value = false; await load(value); if(isCurrent(value))message.value = '媒体文件已删除' } catch (reason) { if(isCurrent(value))error.value = (reason as Error).message } finally { busy.value = false }
}
onMounted(async () => { const value=context();try { await load(value) } catch (reason) { if(isCurrent(value))error.value = (reason as Error).message } })
watch(cmsLocale, () => { if (selected.value) { void choose(selected.value); return } generation++; error.value=''; message.value=''; const value=context();void load(value).catch(reason=>{if(isCurrent(value))error.value=(reason as Error).message}) })
watch(selectedDraftIdState,()=>{generation++;selected.value=null;entries.value=[];usages.value=[];error.value='';message.value='';deleting.value=false;release();const value=context();void load(value).catch(reason=>{if(isCurrent(value))error.value=(reason as Error).message})})
onUnmounted(() => { generation++; release() })
</script>
<template>
  <section>
    <h1>媒体资料</h1>
    <p>上传图片、视频和 PDF，并编辑当前语言的标题与替代文本。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <div class="row toolbar">
      <el-input v-model="search" clearable placeholder="搜索媒体" style="max-width: 280px" />
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,.pdf"
        :disabled="busy"
        :on-change="onUploadChange"
      >
        <el-button type="primary" :loading="busy">上传文件</el-button>
      </el-upload>
    </div>
    <div class="media-layout">
      <el-card shadow="never">
        <template #header><span>已有媒体</span></template>
        <el-button
          v-for="entry in filtered"
          :key="entry.media.mediaId"
          class="media-entry"
          @click="choose(entry)"
        >{{ entry.media.title[cmsLocale] || '未填写标题' }} · {{ entry.media.mimeType }} · {{ Math.ceil(entry.media.size / 1024) }} KB</el-button>
        <el-empty v-if="!filtered.length" description="没有符合条件的媒体文件。" :image-size="72" />
      </el-card>
      <el-card v-if="selected" shadow="never">
        <template #header><span>媒体详情</span></template>
        <img v-if="fileUrl && selected.media.mimeType.startsWith('image/')" :src="fileUrl" :alt="alt" class="media-preview">
        <video v-else-if="fileUrl && selected.media.mimeType.startsWith('video/')" :src="fileUrl" controls class="media-preview"></video>
        <el-link v-else-if="fileUrl" :href="fileUrl" target="_blank" rel="noopener" type="primary">打开文件</el-link>
        <el-form label-position="top" @submit.prevent="save">
          <el-form-item label="标题"><el-input v-model="title" /></el-form-item>
          <el-form-item label="替代文本"><el-input v-model="alt" /></el-form-item>
          <el-form-item label="说明"><el-input v-model="caption" type="textarea" :rows="3" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="busy" native-type="submit">保存资料</el-button>
          </el-form-item>
        </el-form>
        <el-form-item label="替换文件">
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,.pdf"
            :disabled="busy"
            :on-change="onReplaceChange"
          >
            <el-button :disabled="busy">选择替换文件</el-button>
          </el-upload>
        </el-form-item>
        <h3>使用位置</h3>
        <ul v-if="usages.length">
          <li v-for="(usage,index) in usages" :key="index">
            <RouterLink v-if="usage.href" :to="usage.href">{{ usage.title }}</RouterLink>
            <span v-else>{{ usage.title }}</span>
          </li>
        </ul>
        <p v-else>当前没有内容引用这个文件。</p>
        <el-button type="danger" plain :disabled="busy || usages.length > 0" @click="deleting = true">删除媒体</el-button>
      </el-card>
    </div>
    <el-dialog v-model="deleting" title="删除媒体确认" width="420px">
      <p>确认删除这个媒体文件？</p>
      <template #footer>
        <el-button type="danger" :loading="busy" @click="remove">确认删除</el-button>
        <el-button :disabled="busy" @click="deleting = false">取消</el-button>
      </template>
    </el-dialog>
  </section>
</template>
<style scoped>
.page-alert { margin-bottom: 12px; }
.toolbar { margin-bottom: 16px; }
.media-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.media-entry { display: block; width: 100%; margin-bottom: 10px; height: auto; white-space: normal; text-align: left; padding: 10px 14px; }
.media-preview { max-width: 100%; max-height: 300px; display: block; margin-bottom: 20px; }
@media (max-width: 800px) { .media-layout { grid-template-columns: 1fr; } }
</style>
