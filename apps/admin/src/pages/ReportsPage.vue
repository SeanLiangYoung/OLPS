<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { ensureSite } from '../site'
import type { PageRecord, ReportRecord } from '../types'

const siteId = ref('')
const pages = ref<PageRecord[]>([])
const reports = ref<ReportRecord[]>([])
const selectedReport = ref<ReportRecord | null>(null)
const pageId = ref('')
const error = ref('')
const message = ref('')
const busy = ref(false)

const pageOptions = computed(() => pages.value)

async function loadReports() {
  const data = await api<{ reports: ReportRecord[] }>('GET', `/api/sites/${siteId.value}/reports`)
  reports.value = data.reports ?? []
}

async function loadPages() {
  const data = await api<{ pages: PageRecord[] }>('GET', `/api/sites/${siteId.value}/pages`)
  pages.value = data.pages ?? []
  if (!pageId.value && pages.value.length) {
    pageId.value = pages.value[0]!.pageId
  }
}

onMounted(async () => {
  try {
    const site = await ensureSite()
    siteId.value = site.siteId
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
    const data = await api<{ report: ReportRecord }>('POST', '/api/reports', {
      siteId: siteId.value,
      pageId: pageId.value,
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
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div class="row" style="align-items: flex-end;">
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

  <section class="panel">
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
            <RouterLink :to="`/pages/${r.pageId}`">编辑页面</RouterLink>
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
      <RouterLink :to="`/pages/${selectedReport.pageId}`">{{ selectedReport.pageId }}</RouterLink>
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
