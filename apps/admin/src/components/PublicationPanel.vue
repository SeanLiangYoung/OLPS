<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import { publicationOperationLabel, type PublicationOverview, type PublicationPreview } from '../siteManagement'

const props = withDefaults(defineProps<{ draftId: string; pageIds: string[]; includeSettings?: boolean; label?: string; disabled?: boolean }>(), { includeSettings: false, label: '发布所选页面', disabled: false })
const emit = defineEmits<{ published: [] }>()
const preview = ref<PublicationPreview | null>(null)
const busy = ref(false)
const error = ref('')
const message = ref('')
const publicUrl = ref('')
const settingsAvailable = ref(false)
const settings = ref(props.includeSettings)
const hasIssues = computed(() => Boolean(preview.value?.issues.length))

watch([() => props.draftId, () => [...props.pageIds].sort().join(','), () => props.includeSettings], () => {
  preview.value = null
  settings.value = props.includeSettings
  message.value = ''
  error.value = ''
})

async function inspect() {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const state = await api<PublicationOverview>('GET', `/api/drafts/${props.draftId}/publication`)
    settingsAvailable.value = state.settingsChanged
    if (!state.site?.publishedCommitId && state.settingsChanged) settings.value = true
    preview.value = await api<PublicationPreview>('POST', `/api/drafts/${props.draftId}/publication/preview`, { pageIds: props.pageIds, includeSettings: settings.value })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    preview.value = null
  } finally { busy.value = false }
}

async function confirm() {
  if (!preview.value?.token || hasIssues.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await api<{ task: { status: string; error?: string }; publicUrl?: string; site?: { publicUrl?: string } }>('POST', `/api/drafts/${props.draftId}/publication/confirm`, { token: preview.value.token })
    if (result.task.status !== 'completed' && result.task.status !== 'published' && result.task.status !== 'succeeded') {
      throw new Error(result.task.error || '发布尚未完成，请在发布记录中查看状态')
    }
    publicUrl.value = result.publicUrl || result.site?.publicUrl || ''
    message.value = '发布成功，所选内容已经更新。'
    preview.value = null
    emit('published')
    window.dispatchEvent(new Event('olps:published'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { busy.value = false }
}
</script>

<template>
  <div class="publication-control">
    <button type="button" :disabled="busy || disabled || (!pageIds.length && !includeSettings)" @click="inspect">{{ busy ? '处理中…' : label }}</button>
    <p v-if="error && !preview" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="ok" role="status">{{ message }} <a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener">查看网站</a></p>
    <div v-if="preview" class="publication-backdrop" @click.self="!busy && (preview = null)">
      <section class="publication-dialog" role="dialog" aria-modal="true" aria-labelledby="publication-title">
        <h2 id="publication-title">确认发布范围</h2>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p>本次更新以下内容，其他页面保留线上版本。</p>
        <ul class="publication-list">
          <li v-for="page in preview.pages" :key="page.pageId"><strong>{{ page.title }}</strong><span>{{ page.locale }} · /{{ page.slug }}/ · {{ publicationOperationLabel(page.operation) }}</span></li>
        </ul>
        <p v-if="!preview.pages.length">本次仅更新网站设置。</p>
        <label v-if="settingsAvailable" class="check-label"><input v-model="settings" type="checkbox" :disabled="busy" @change="inspect" />同时发布网站共用设置</label>
        <p v-if="settings" class="muted">网站共用设置会影响全部公开页面。</p>
        <p class="muted">导航、语言链接和 sitemap 将根据本次发布结果更新。</p>
        <ul v-if="preview.issues.length" class="publication-issues"><li v-for="(issue, index) in preview.issues" :key="index">{{ issue.message }} <RouterLink v-if="issue.pageId" :to="`/drafts/${draftId}/pages/${issue.pageId}`" @click="preview = null">处理相关页面</RouterLink></li></ul>
        <p class="muted">确认有效期至 {{ new Date(preview.expiresAt).toLocaleTimeString('zh-CN') }}。</p>
        <div class="row"><button type="button" :disabled="busy || hasIssues || !preview.token" @click="confirm">{{ busy ? '正在发布…' : '确认发布' }}</button><button type="button" class="ghost" :disabled="busy" @click="preview = null">返回编辑</button></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.publication-control { display: inline-block; }
.publication-backdrop { position: fixed; inset: 0; z-index: 1000; background: #142a3c66; display: grid; place-items: center; padding: 1rem; }
.publication-dialog { width: min(700px, 100%); max-height: 88vh; overflow: auto; border-radius: 16px; padding: 1.5rem; background: white; box-shadow: 0 20px 80px #142a3c33; }
.publication-dialog h2 { margin-top: 0; }
.publication-list { list-style: none; padding: 0; }
.publication-list li { padding: .8rem 0; border-bottom: 1px solid var(--line); display: grid; gap: .3rem; }
.publication-list span { color: var(--muted, #596a7a); font-size: .9rem; }
.publication-issues { color: #9b1c1c; padding-left: 1.2rem; }
.check-label { display: flex; gap: .5rem; align-items: center; }
.check-label input { width: auto; }
</style>
