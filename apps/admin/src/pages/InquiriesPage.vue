<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  businessViewReady,
  inquiriesListPath,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
  siteScopeBlockedMessage,
  type BusinessDataScope,
} from '../draftBusinessContext'
import type { Inquiry, InquiryStatus, PublishedSite } from '../types'

const sites = ref<PublishedSite[]>([])
const draftId = ref('')
const scope = ref<BusinessDataScope>('draft')
const siteId = ref('')
const inquiries = ref<Inquiry[]>([])
const statusFilter = ref<'' | InquiryStatus>('')
const selectedId = ref<string | number | null>(null)
const error = ref('')
const message = ref('')
const busy = ref(false)

const statusOptions: Array<{ value: '' | InquiryStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'new', label: '新建' },
  { value: 'processing', label: '处理中' },
  { value: 'done', label: '已完成' },
  { value: 'spam', label: '垃圾' },
]

const ready = computed(() => businessViewReady(scope.value, siteId.value))

const selected = computed(
  () => inquiries.value.find((i) => i.inquiryId === selectedId.value) ?? null,
)

const linkedSiteName = computed(
  () => sites.value.find((s) => s.siteId === siteId.value)?.name ?? siteId.value,
)

function statusQuery(): string {
  const q = new URLSearchParams()
  if (statusFilter.value) q.set('status', statusFilter.value)
  return q.toString()
}

async function load() {
  if (!ready.value || !draftId.value) return
  const data = await api<{ inquiries: Inquiry[] }>(
    'GET',
    inquiriesListPath(scope.value, draftId.value, siteId.value, statusQuery()),
  )
  inquiries.value = (data.inquiries ?? []).map((item) => ({
    ...item,
    status: item.status ?? 'new',
  }))
}

onMounted(async () => {
  try {
    draftId.value = requireSelectedDraftId()
    sites.value = await listPublishedSites()
    const draft = await fetchDraft(draftId.value)
    scope.value = resolveBusinessDataScope(draft.siteId)
    siteId.value = resolveLinkedSiteIdForDraft(sites.value, draft.siteId)
    if (!businessViewReady(scope.value, siteId.value)) {
      error.value = siteScopeBlockedMessage()
      return
    }
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch([statusFilter, siteId, scope], async () => {
  error.value = ''
  try {
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function setStatus(status: InquiryStatus) {
  if (!selected.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    await api('PATCH', `/api/inquiries/${selected.value.inquiryId}`, { status })
    message.value = '状态已更新'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function resend() {
  if (!selected.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    await api('POST', `/api/inquiries/${selected.value.inquiryId}/resend`)
    message.value = '已触发重发'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>询盘</h1>
    <p v-if="scope === 'draft'" class="muted" data-testid="inquiries-scope-draft">
      当前草稿的历史询盘（含迁移数据）；未发布草稿不按其他已发布网站展示。
    </p>
    <p v-else class="muted" data-testid="inquiries-scope-site">
      草稿关联网站「{{ linkedSiteName }}」的线上询盘。
    </p>
    <label style="max-width: 220px;">
      状态筛选
      <select v-model="statusFilter">
        <option v-for="opt in statusOptions" :key="String(opt.value)" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <table v-if="ready" class="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>时间</th>
          <th>pageId</th>
          <th>状态</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in inquiries" :key="item.inquiryId">
          <td>{{ item.inquiryId }}</td>
          <td>{{ item.createdAt }}</td>
          <td>{{ item.pageId ?? '—' }}</td>
          <td><span class="badge">{{ item.status }}</span></td>
          <td>
            <button type="button" class="secondary" @click="selectedId = item.inquiryId">查看</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="ready && !inquiries.length" class="muted">暂无询盘。</p>
  </section>

  <section v-if="selected" class="panel">
    <h2>询盘详情 #{{ selected.inquiryId }}</h2>
    <pre style="white-space: pre-wrap; background: #fff; padding: 0.75rem; border-radius: 10px; border: 1px solid var(--line);">{{
      JSON.stringify(selected.payload, null, 2)
    }}</pre>
    <div class="row">
      <button type="button" class="secondary" :disabled="busy" @click="setStatus('new')">标为新建</button>
      <button type="button" class="secondary" :disabled="busy" @click="setStatus('processing')">标为处理中</button>
      <button type="button" :disabled="busy" @click="setStatus('done')">标为已完成</button>
      <button type="button" class="ghost" :disabled="busy" @click="setStatus('spam')">标为垃圾</button>
      <button type="button" :disabled="busy" @click="resend">重发通知</button>
    </div>
  </section>
</template>
