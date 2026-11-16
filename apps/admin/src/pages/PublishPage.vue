<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId, pullDraft, continueDraftSync } from '../draft'
import ConflictDecision from '../components/ConflictDecision.vue'
import PublicationPanel from '../components/PublicationPanel.vue'
import { conflictDecisionSummary, showConflictDecision, syncActionDisabledReason } from '../draftDisplay'
import { pageChangeLabel, publicationOperationLabel, type PublicationOverview } from '../siteManagement'
import type { SiteDraft } from '../types'

const draft = ref<SiteDraft | null>(null)
const overview = ref<PublicationOverview | null>(null)
const selected = ref<string[]>([])
const includeSettings = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
type PublicationTask = { taskId: string; status: string; createdAt: string; error: string | null; pages: Array<{ pageId: string; title: string }> }
const tasks = ref<PublicationTask[]>([])
const taskLabels: Record<string, string> = { preview: '等待确认', publishing: '正在发布', reconciling: '等待核对', completed: '发布成功', failed: '发布失败' }
const changes = computed(() => overview.value?.pages.filter(page => page.changed) || [])
async function reload() {
  try {
    const id = requireSelectedDraftId()
    const [loaded, state, history] = await Promise.all([fetchDraft(id), api<PublicationOverview>('GET', `/api/drafts/${id}/publication`), api<{ tasks: PublicationTask[] }>('GET', `/api/drafts/${id}/publication/tasks`)])
    draft.value = loaded
    overview.value = state
    tasks.value = history.tasks
    selected.value = selected.value.filter(id => state.pages.some(page => page.pageId === id && page.changed))
    includeSettings.value = !state.site?.publishedCommitId && state.settingsChanged
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
onMounted(reload)
async function recoverTask(taskId: string) {
  if (!draft.value) return
  busy.value = true; error.value = ''
  try {
    const result = await api<{ task: { status: string; error?: string } }>('GET', `/api/drafts/${draft.value.draftId}/publication/tasks/${taskId}`)
    message.value = result.task.status === 'completed' ? '已经核对发布结果，线上内容已更新。' : (result.task.error || '任务状态已更新。')
    await reload()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function pull() {
  if (!draft.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    draft.value = await pullDraft(draft.value.draftId)
    message.value = showConflictDecision(draft.value) ? '需要处理内容冲突，请查看下方差异。' : '已获取线上更新，保留当前未发布的编辑内容。'
    await reload()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function decide(payload: { userMessage: string }) {
  if (!draft.value) return
  busy.value = true; error.value = ''
  try { draft.value = await continueDraftSync(draft.value.draftId, payload.userMessage); await reload() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-heading"><div><h1>发布更改</h1><p class="muted">选择本次需要更新的页面，确认后公开展示。</p></div><button type="button" class="ghost" @click="reload">刷新状态</button></div>
  <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="ok" role="status">{{ message }}</p>
  <section v-if="draft && overview" class="panel">
    <h2>待发布更改 <span class="badge">{{ changes.length }}</span></h2>
    <p class="muted">未选择的页面继续使用线上版本。保存后的新修改需要另外发布。</p>
    <label v-if="changes.length" class="check-label"><input type="checkbox" :checked="selected.length === changes.length" @change="selected = selected.length === changes.length ? [] : changes.map(page => page.pageId)" />选择全部待发布页面</label>
    <div class="table-wrap"><table v-if="changes.length" class="table"><thead><tr><th>选择</th><th>页面</th><th>语言</th><th>编辑状态</th><th>本次操作</th></tr></thead><tbody><tr v-for="page in changes" :key="page.pageId"><td><input v-model="selected" type="checkbox" :value="page.pageId" :aria-label="`选择 ${page.title}`" /></td><td>{{ page.title }}<div class="muted">/{{ page.slug }}/</div></td><td>{{ page.locale }}</td><td>{{ pageChangeLabel(page) }}</td><td>{{ publicationOperationLabel(page.operation) }}</td></tr></tbody></table></div>
    <p v-if="!changes.length" class="empty-state">所有页面都已更新，可以继续编辑内容。</p>
    <label v-if="overview.settingsChanged" class="check-label settings-choice"><input v-model="includeSettings" type="checkbox" />发布网站共用设置</label>
    <p v-if="includeSettings" class="muted">语言、地图、WhatsApp 等共用设置将影响整个网站。</p>
    <PublicationPanel :draft-id="draft.draftId" :page-ids="selected" :include-settings="includeSettings" @published="reload" />
  </section>
  <section v-if="overview?.site?.publicUrl" class="panel"><h2>线上网站</h2><p>{{ overview.site.name }}</p><a :href="overview.site.publicUrl" target="_blank" rel="noopener">{{ overview.site.publicUrl }}</a></section>
  <section class="panel"><h2>发布记录</h2><div class="table-wrap"><table v-if="tasks.length" class="table"><thead><tr><th>时间</th><th>涉及页面</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.taskId"><td>{{ new Date(task.createdAt).toLocaleString('zh-CN') }}</td><td>{{ task.pages.map(page => page.title).join('、') || '网站设置' }}</td><td>{{ taskLabels[task.status] || task.status }}<p v-if="task.error" class="error">{{ task.error }}</p></td><td><button v-if="task.status === 'reconciling' || task.status === 'publishing'" type="button" class="ghost" :disabled="busy" @click="recoverTask(task.taskId)">核对并继续发布</button></td></tr></tbody></table><p v-else class="muted">还没有发布记录。</p></div></section>
  <section v-if="draft" class="panel"><details><summary>协作与版本</summary><p class="muted">获取其他成员已经发布的修改，并保留当前编辑内容。</p><button type="button" class="secondary" :disabled="busy || Boolean(syncActionDisabledReason(draft, 'pull'))" @click="pull">获取线上更新</button><p v-if="draft.lastError" class="error">{{ draft.lastError }}</p><ConflictDecision v-if="showConflictDecision(draft)" :summary="conflictDecisionSummary(draft)" :disabled="busy" @submit="decide" /><details class="version-details"><summary>版本信息</summary><p>编辑版本：{{ draft.name }}</p><p class="muted">{{ draft.headCommitId }}<br />{{ draft.baseCommitId }}</p><pre v-if="draft.validationLog">{{ draft.validationLog }}</pre></details></details></section>
</template>

<style scoped>
.table input { width: auto; }
.settings-choice { padding: 1rem 0; }
summary { cursor: pointer; font-weight: 600; }
.version-details { margin-top: 1rem; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; }
</style>
