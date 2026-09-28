<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  buildCreateReportBody,
  businessViewReady,
  reportsListPath,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
  siteScopeBlockedMessage,
  type BusinessDataScope,
} from '../draftBusinessContext'
import { getSelectedDraftId } from '../api'
import { draftPageDetailRoute } from '../pagePaths'
import { reportCandidatePagesPath } from '../reportsPageLoading'
import { reconcilePageIdForSite } from '../reportsPageSelection'
import type { PageRecord, PublishedSite, ReportRecord } from '../types'

const sites = ref<PublishedSite[]>([])
const draftId = ref('')
const scope = ref<BusinessDataScope>('draft')
const siteId = ref('')
const pages = ref<PageRecord[]>([])
const reports = ref<ReportRecord[]>([])
const selectedReport = ref<ReportRecord | null>(null)
const pageId = ref('')
const error = ref('')
const message = ref('')
const busy = ref(false)

const ready = computed(() => businessViewReady(scope.value, siteId.value))
const pageOptions = computed(() => pages.value)

const linkedSiteName = computed(
  () => sites.value.find((s) => s.siteId === siteId.value)?.name ?? siteId.value,
)

function editPageRoute(pageId: string, reportDraftId?: string): string {
  const id = reportDraftId ?? getSelectedDraftId()
  if (!id) return '/workspace'
  return draftPageDetailRoute(id, pageId)
}

async function loadReports() {
  if (!ready.value || !draftId.value) return
  const data = await api<{ reports: ReportRecord[] }>(
    'GET',
    reportsListPath(scope.value, draftId.value, siteId.value),
  )
  reports.value = data.reports ?? []
}

async function loadPages() {
  if (!ready.value || !draftId.value) return
  const data = await api<{ pages: PageRecord[] }>(
    'GET',
    reportCandidatePagesPath(draftId.value),
  )
  pages.value = data.pages ?? []
  pageId.value = reconcilePageIdForSite(pageId.value, pages.value)
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
    await loadPages()
    await loadReports()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch([siteId, scope], async () => {
  try {
    await loadPages()
    await loadReports()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function runReport() {
  error.value = ''
  message.value = ''
  if (!pageId.value) {
    error.value = '请选择页面'
    return
  }
  busy.value = true
  try {
    const id = requireSelectedDraftId()
    const draft = await fetchDraft(id)
    const data = await api<{ report: ReportRecord }>(
      'POST',
      '/api/reports',
      buildCreateReportBody(id, pageId.value, draft.siteId),
    )
    selectedReport.value = data.report
    message.value = `报告已生成，得分 ${data.report.score}`
    await loadReports()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function openReport(reportId: string) {
  error.value = ''
  try {
    const data = await api<{ report: ReportRecord }>('GET', `/api/reports/${reportId}`)
    selectedReport.value = data.report
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <section class="panel">
    <h1>报告</h1>
    <p v-if="scope === 'draft'" class="muted">
      当前草稿的报告和页面。
    </p>
    <p v-else class="muted">
      当前草稿的报告和页面；历史报告含关联网站「{{ linkedSiteName }}」线上记录。
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div v-if="ready" class="row" style="align-items: flex-end;">
      <label style="flex: 1; min-width: 220px; margin-bottom: 0;">
        页面
        <select v-model="pageId">
          <option v-for="p in pageOptions" :key="p.pageId" :value="p.pageId">
            {{ p.title }} ({{ p.kind }} · {{ p.status }})
          </option>
        </select>
      </label>
      <button type="button" :disabled="busy || !pageId" @click="runReport">运行报告</button>
    </div>
  </section>

  <section v-if="ready" class="panel">
    <h2>历史报告</h2>
    <table class="table">
      <thead>
        <tr>
          <th>时间</th>
          <th>pageId</th>
          <th>得分</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in reports" :key="r.reportId">
          <td>{{ r.createdAt }}</td>
          <td>{{ r.pageId }}</td>
          <td><strong>{{ r.score }}</strong></td>
          <td class="row">
            <button type="button" class="secondary" @click="openReport(r.reportId)">详情</button>
            <RouterLink :to="editPageRoute(r.pageId, r.draftId)">编辑页面</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!reports.length" class="muted">暂无报告。</p>
  </section>

  <section v-if="selectedReport" class="panel">
    <h2>报告详情</h2>
    <p>
      得分 <strong style="font-size: 1.4rem;">{{ selectedReport.score }}</strong>
      · 页面
      <RouterLink :to="editPageRoute(selectedReport.pageId, selectedReport.draftId)">{{
        selectedReport.pageId
      }}</RouterLink>
    </p>
    <table class="table">
      <thead>
        <tr>
          <th>检查项</th>
          <th>结果</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in selectedReport.checklist" :key="item.id">
          <td>{{ item.label }}</td>
          <td>
            <span class="badge" :class="item.passed ? 'published' : 'draft'">
              {{ item.passed ? '通过' : '未通过' }}
            </span>
          </td>
          <td class="muted">{{ item.detail }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
