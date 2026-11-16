<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  buildCreateReportBody,
  businessViewReady,
  draftPagesListPath,
  reportsListPath,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
  siteScopeBlockedMessage,
  type BusinessDataScope,
} from '../draftBusinessContext'
import { getSelectedDraftId } from '../api'
import { draftPageDetailRoute } from '../pagePaths'
import { selectedDraftIdState } from '../workspaceSession'
import { reconcilePageIdForSite } from '../reportsPageSelection'
import type { PageRecord, PublishedSite, ReportSiteData, ReportRecord as BaseReportRecord } from '../types'
import ReportSiteDataPanel from '../components/ReportSiteDataPanel.vue'
import { buildReportRewriteRoute } from '../reportRewrite'

type ReportRecord = BaseReportRecord & { details?: {
  summary: string
  findings: Array<{ category: string; severity: string; title: string; evidence: string; recommendation: string }>
  rewriteBrief: string
  source: { type: string; url: string | null; sha256: string; capturedAt: string }
  model: { provider: string; model: string; responseId: string; completedAt: string }
} | null }

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
const publicUrl = ref('')
const siteData = ref<ReportSiteData | null>(null)
const siteDataLoading = ref(false)
let siteDataRequest = 0

async function loadSiteData() {
  const request = ++siteDataRequest
  siteData.value = null
  if (!draftId.value || !pageId.value || !ready.value) { siteDataLoading.value = false; return }
  siteDataLoading.value = true
  try {
    const result = await api<{ data: ReportSiteData }>('GET', `/api/drafts/${draftId.value}/pages/${pageId.value}/report-data`)
    if (request === siteDataRequest) siteData.value = result.data
  } catch (e) {
    if (request === siteDataRequest) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (request === siteDataRequest) siteDataLoading.value = false
  }
}

function rewriteRoute(report: ReportRecord) {
  return buildReportRewriteRoute(report)
}

async function diagnosePage() {
  error.value = ''
  message.value = ''
  if (!pageId.value) { error.value = '请选择页面'; return }
  busy.value = true
  try {
    const data = await api<{ report: ReportRecord }>('POST', '/api/reports/diagnose', {
      draftId: requireSelectedDraftId(), pageId: pageId.value,
      ...(publicUrl.value.trim() ? { publicUrl: publicUrl.value.trim() } : {}),
    })
    selectedReport.value = data.report
    message.value = '模型诊断已经完成'
    await loadReports()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally { busy.value = false }
}

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
    reportsListPath('draft', draftId.value, ''),
  )
  reports.value = data.reports ?? []
}

async function loadPages() {
  if (!ready.value || !draftId.value) return
  const requestedDraftId = draftId.value
  const data = await api<{ pages: PageRecord[] }>('GET', draftPagesListPath(requestedDraftId))
  if (requestedDraftId !== draftId.value) return
  pages.value = data.pages ?? []
  pageId.value = reconcilePageIdForSite(pageId.value, pages.value)
  await loadSiteData()
}

async function syncFromSelectedDraft() {
  siteDataRequest++
  siteData.value = null
  siteDataLoading.value = false
  draftId.value = requireSelectedDraftId()
  const draft = await fetchDraft(draftId.value)
  scope.value = resolveBusinessDataScope(draft.siteId)
  siteId.value = resolveLinkedSiteIdForDraft(sites.value, draft.siteId)
  if (!businessViewReady(scope.value, siteId.value)) {
    error.value = siteScopeBlockedMessage()
    pages.value = []
    reports.value = []
    pageId.value = ''
    selectedReport.value = null
    return
  }
  error.value = ''
  await loadPages()
  await loadReports()
}

onMounted(async () => {
  try {
    sites.value = await listPublishedSites()
    await syncFromSelectedDraft()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch(selectedDraftIdState, async () => {
  try {
    await syncFromSelectedDraft()
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
        <select v-model="pageId" @change="loadSiteData">
          <option v-for="p in pageOptions" :key="p.pageId" :value="p.pageId">
            {{ p.title }} ({{ p.kind }} · {{ p.status }})
          </option>
        </select>
      </label>
      <button type="button" :disabled="busy || !pageId" @click="runReport">运行本地检查</button>
    </div>
    <label v-if="ready">公开页面地址（选填）
      <input v-model="publicUrl" type="url" placeholder="https://example.com/page.html" :disabled="busy">
    </label>
    <p v-if="ready" class="muted">未填写地址时诊断所选草稿页面；填写地址时诊断该公开页面，并将优化建议关联至所选页面。诊断使用所选本站页面最近 28 天的事件与询盘统计，报告保存当时的数据。</p>
    <button v-if="ready" type="button" :disabled="busy || !pageId" @click="diagnosePage">{{ busy ? '正在处理' : '运行模型诊断' }}</button>
  </section>

  <section v-if="ready" class="panel" aria-label="所选页面的网站数据">
    <h2>所选页面的网站数据</h2>
    <p v-if="siteDataLoading" class="muted">正在读取网站数据</p>
    <ReportSiteDataPanel v-else-if="siteData" :data="siteData" />
  </section>

  <section v-if="ready" class="panel">
    <h2>历史报告</h2>
    <table class="table">
      <thead>
        <tr>
          <th>时间</th>
          <th>pageId</th>
          <th>得分</th>
          <th>类型</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in reports" :key="r.reportId">
          <td>{{ r.createdAt }}</td>
          <td>{{ r.pageId }}</td>
          <td><strong>{{ r.score }}</strong></td>
          <td>{{ r.details ? '模型诊断' : '本地检查' }}</td>
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
    <section v-if="selectedReport.siteData" aria-label="报告保存的网站数据">
      <h3>报告保存的网站数据</h3>
      <ReportSiteDataPanel :data="selectedReport.siteData" />
    </section>
    <div v-if="selectedReport.details">
      <p>{{ selectedReport.details.summary }}</p>
      <p class="muted">模型：{{ selectedReport.details.model.provider }} / {{ selectedReport.details.model.model }}；调用编号：{{ selectedReport.details.model.responseId }}</p>
      <p class="muted">来源：{{ selectedReport.details.source.url ?? '当前草稿页面' }}；获取时间：{{ selectedReport.details.source.capturedAt }}</p>
      <p class="muted" style="overflow-wrap: anywhere;">内容 SHA-256：{{ selectedReport.details.source.sha256 }}</p>
      <article v-for="(finding, index) in selectedReport.details.findings" :key="index">
        <h3>{{ finding.title }}（{{ { high: '重要', medium: '一般', low: '建议' }[finding.severity] ?? finding.severity }}）</h3>
        <p>页面证据：{{ finding.evidence }}</p>
        <p>修改建议：{{ finding.recommendation }}</p>
      </article>
      <h3>改写要求</h3>
      <p style="white-space: pre-wrap;">{{ selectedReport.details.rewriteBrief }}</p>
      <p class="muted">进入生成页面后检查改写要求、选择知识库并确认提交。</p>
      <RouterLink v-if="selectedReport.draftId === draftId && pages.some(page => page.pageId === selectedReport?.pageId)" :to="rewriteRoute(selectedReport)">根据建议改写页面</RouterLink>
    </div>
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
