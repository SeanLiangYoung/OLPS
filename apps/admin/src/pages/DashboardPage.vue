<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { ensureSite } from '../site'
import type { DashboardData, JobRecord } from '../types'

const data = ref<DashboardData | null>(null)
const error = ref('')
const siteId = ref('')

onMounted(async () => {
  try {
    const site = await ensureSite()
    siteId.value = site.siteId
    data.value = await api<DashboardData>('GET', '/api/dashboard')
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
    <p class="muted">当前站点：{{ siteId || data?.siteId || '—' }}</p>
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
        <div class="muted">广告承接页</div>
        <div class="num">{{ data.pagesByKind?.ads ?? 0 }}</div>
      </div>
      <div class="stat">
        <div class="muted">已发布</div>
        <div class="num">{{ data.publishedCount ?? 0 }}</div>
      </div>
      <div class="stat">
        <div class="muted">询盘</div>
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
      <RouterLink class="btn secondary" to="/publish">发布中心</RouterLink>
    </div>
  </section>
</template>
