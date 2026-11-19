<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftStatusLabel, formatCommitRef } from '../draftDisplay'
import type { DashboardData, JobRecord, SiteDraft } from '../types'

const data = ref<DashboardData | null>(null)
const draft = ref<SiteDraft | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const draftId = requireSelectedDraftId()
    draft.value = await fetchDraft(draftId)
    data.value = await api<DashboardData>('GET', `/api/drafts/${draftId}/dashboard`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

function jobLabel(job: JobRecord): string {
  return `${job.type ?? 'job'} · ${job.status}`
}
</script>

<template>
  <section class="panel">
    <h1>总览</h1>
    <p v-if="draft" class="muted">
      草稿 {{ draft.name }} · {{ draftStatusLabel(draft.status) }} · head
      {{ formatCommitRef(draft.headCommitId) }} · base
      {{ formatCommitRef(draft.baseCommitId) }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="data" class="stat-grid" style="margin-top: 1rem;">
      <div class="stat">
        <div class="muted">通用站页</div>
        <div class="num">{{ data.pagesByKind?.site ?? 0 }}</div>
      </div>
      <div class="stat">
        <div class="muted">内容页</div>
        <div class="num">{{ data.pagesByKind?.content ?? 0 }}</div>
      </div>
      <div class="stat">
        <div class="muted">sandbox 已发布标记</div>
        <div class="num">{{ data.publishedCount ?? 0 }}</div>
      </div>
      <div class="stat">
        <div class="muted">询盘（含草稿历史）</div>
        <div class="num">{{ data.inquiryCount ?? 0 }}</div>
      </div>
    </div>
  </section>

  <section v-if="data" class="panel">
    <h2>最近任务</h2>
    <table v-if="data.recentJobs?.length" class="table">
      <thead>
        <tr>
          <th>任务</th>
          <th>状态</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="job in data.recentJobs" :key="job.jobId">
          <td>{{ jobLabel(job) }}</td>
          <td><span class="badge">{{ job.status }}</span></td>
          <td class="muted">{{ job.updatedAt || job.createdAt || '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">暂无最近任务。</p>
  </section>

  <section v-if="data" class="panel">
    <h2>Sitemap</h2>
    <p v-if="data.sitemapUrl">
      <a :href="data.sitemapUrl" target="_blank" rel="noopener">{{ data.sitemapUrl }}</a>
    </p>
    <p v-else class="muted">尚未生成 sitemap。</p>
    <div class="row" style="margin-top: 0.75rem;">
      <RouterLink class="btn" to="/pages">管理页面</RouterLink>
      <RouterLink class="btn secondary" to="/generate">生成页面</RouterLink>
      <RouterLink class="btn secondary" to="/publish">发布与同步</RouterLink>
    </div>
  </section>
</template>
