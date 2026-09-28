<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  pickPublishedSiteId,
  publishedSiteRequiredMessage,
} from '../publishedSiteContext'
import { getSelectedDraftId } from '../api'
import { draftPageDetailRoute } from '../pagePaths'
import { reconcilePageIdForSite } from '../reportsPageSelection'
import type { PageRecord, PublishedSite, ReportRecord } from '../types'

const sites = ref<PublishedSite[]>([])
const siteId = ref('')
const pages = ref<PageRecord[]>([])
const reports = ref<ReportRecord[]>([])
const selectedReport = ref<ReportRecord | null>(null)
const pageId = ref('')
const error = ref('')
const message = ref('')
const busy = ref(false)

const pageOptions = computed(() => pages.value)

function editPageRoute(pageId: string, reportDraftId?: string): string {
  const draftId = reportDraftId ?? getSelectedDraftId()
  if (!draftId) return '/workspace'
  return draftPageDetailRoute(draftId, pageId)
}

async function loadReports() {
  if (!siteId.value) return
  const data = await api<{ reports: ReportRecord[] }>(
    'GET',
    `/api/sites/${siteId.value}/reports`,
  )
  reports.value = data.reports ?? []
}

async function loadPages() {
  if (!siteId.value) return
  const data = await api<{ pages: PageRecord[] }>(
    'GET',
    `/api/sites/${siteId.value}/pages`,
  )
  pages.value = data.pages ?? []
  pageId.value = reconcilePageIdForSite(pageId.value, pages.value)
}

onMounted(async () => {
  try {
    requireSelectedDraftId()
    sites.value = await listPublishedSites()
    const draft = await fetchDraft(requireSelectedDraftId())
    siteId.value = pickPublishedSiteId(sites.value, draft.siteId)
    if (!siteId.value) {
      error.value = publishedSiteRequiredMessage()
      return
    }
    await loadPages()
    await loadReports()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch(siteId, async () => {
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
    const draftId = requireSelectedDraftId()
    const data = await api<{ report: ReportRecord }>('POST', '/api/reports', {
      siteId: siteId.value,
      pageId: pageId.value,
      draftId,
    })
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
    <p class="muted">对指定页面运行诊断，查看得分与问题项，并可跳转编辑。</p>
    <label v-if="sites.length > 1" style="max-width: 320px;">
      已发布网站
      <select v-model="siteId">
        <option v-for="s in sites" :key="s.siteId" :value="s.siteId">{{ s.name }}</option>
      </select>
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div v-if="siteId" class="row" style="align-items: flex-end;">
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

  <section v-if="siteId" class="panel">
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
