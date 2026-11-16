<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { pageChangeLabel, type PublicationOverview } from '../siteManagement'
import type { DashboardData, Inquiry, SiteDraft } from '../types'

const data = ref<DashboardData | null>(null)
const overview = ref<PublicationOverview | null>(null)
const draft = ref<SiteDraft | null>(null)
const inquiries = ref<Inquiry[]>([])
const error = ref('')
const changes = computed(() => overview.value?.pages.filter(page => page.changed) || [])
const recent = computed(() => [...(overview.value?.pages || [])].filter(page => page.operation !== 'delete').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6))
const issues = computed(() => overview.value?.issues || [])
const jobStatus: Record<string, string> = { pending: '等待执行', running: '正在处理', completed: '已经完成', failed: '处理失败' }
const jobNames: Record<string, string> = { generate_page: '生成页面', rewrite_page: '改写页面', translate_page: '翻译页面' }

onMounted(async () => {
  try {
    const id = requireSelectedDraftId()
    const [loaded, stats, state] = await Promise.all([fetchDraft(id), api<DashboardData>('GET', `/api/drafts/${id}/dashboard`), api<PublicationOverview>('GET', `/api/drafts/${id}/publication`)])
    draft.value = loaded; data.value = stats; overview.value = state
    const result = await api<{ inquiries: Inquiry[] }>('GET', `/api/drafts/${id}/inquiries`)
    inquiries.value = result.inquiries.slice(0, 5)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
})
</script>

<template>
  <div class="page-heading"><div><h1>网站概况</h1><p class="muted">{{ overview?.site?.name || draft?.name || '正在读取网站' }}</p></div><div class="row"><RouterLink class="btn" to="/pages">管理页面</RouterLink><RouterLink class="btn secondary" to="/generate">AI 生成页面</RouterLink></div></div>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <section v-if="overview" class="overview-banner"><div><h2>{{ overview.site?.publishedCommitId ? '网站正在公开展示' : '网站内容准备中' }}</h2><p>{{ changes.length ? `有 ${changes.length} 个页面等待发布。` : '页面内容已经保存，可以继续编辑。' }}{{ overview.settingsChanged ? '网站设置有未发布更改。' : '' }}</p></div><RouterLink class="btn" to="/publish">查看发布范围</RouterLink></section>
  <div v-if="data && overview" class="stat-grid overview-stats"><RouterLink class="stat" to="/pages"><div class="muted">全部页面</div><div class="num">{{ overview.pages.filter(page => page.operation !== 'delete').length }}</div></RouterLink><RouterLink class="stat" to="/publish"><div class="muted">待发布页面</div><div class="num">{{ changes.length }}</div></RouterLink><RouterLink class="stat" to="/pages"><div class="muted">线上可访问</div><div class="num">{{ overview.pages.filter(page => page.onlineStatus === 'published').length }}</div></RouterLink><RouterLink class="stat" to="/inquiries"><div class="muted">客户询盘</div><div class="num">{{ data.inquiryCount }}</div></RouterLink></div>
  <div class="dashboard-columns">
    <section class="panel"><div class="section-heading"><h2>最近编辑</h2><RouterLink to="/pages">全部页面</RouterLink></div><ul v-if="recent.length" class="dashboard-list"><li v-for="page in recent" :key="page.pageId"><RouterLink :to="`/drafts/${draft?.draftId}/pages/${page.pageId}`"><strong>{{ page.title }}</strong><small>{{ page.locale }} · {{ pageChangeLabel(page) }}</small></RouterLink><span class="muted">{{ new Date(page.updatedAt).toLocaleDateString('zh-CN') }}</span></li></ul><p v-else class="empty-state">添加页面，开始建立网站内容。</p></section>
    <section class="panel"><div class="section-heading"><h2>需要处理</h2><RouterLink to="/reports">检查页面</RouterLink></div><ul v-if="issues.length" class="issue-list"><li v-for="(issue, index) in issues.slice(0, 6)" :key="index">{{ issue.message }} <RouterLink v-if="issue.pageId" :to="`/drafts/${draft?.draftId}/pages/${issue.pageId}`">查看页面</RouterLink></li></ul><p v-else class="muted">当前没有发布检查问题。选择发布时还会检查具体内容和引用。</p><p><RouterLink to="/integrations">管理广告与分析连接</RouterLink></p><p><RouterLink to="/settings">管理网站语言与联系入口</RouterLink></p></section>
    <section class="panel"><div class="section-heading"><h2>最新询盘</h2><RouterLink to="/inquiries">查看询盘</RouterLink></div><ul v-if="inquiries.length" class="dashboard-list"><li v-for="inquiry in inquiries" :key="inquiry.inquiryId"><RouterLink to="/inquiries"><strong>{{ inquiry.payload.name || inquiry.payload.email || '网站访客' }}</strong><small>{{ String(inquiry.payload.message || '').slice(0, 90) }}</small></RouterLink></li></ul><p v-else class="empty-state">还没有可显示的询盘。</p></section>
    <section class="panel"><div class="section-heading"><h2>访问与任务</h2><RouterLink to="/reports">数据与报告</RouterLink></div><p v-if="data?.siteStatsAvailable">最近28天采集了 <strong>{{ data.eventCount }}</strong> 条访客行为记录。</p><p v-else class="muted">尚无可读取的线上行为统计。</p><p class="muted">行为记录包含浏览和点击，数量按事件计算。</p><ul v-if="data?.recentJobs.length" class="dashboard-list"><li v-for="job in data.recentJobs" :key="job.jobId"><span>{{ jobNames[job.type || ''] || '页面任务' }}</span><span class="badge">{{ jobStatus[job.status] }}</span></li></ul><p v-else class="muted">还没有生成或改写任务。</p><details v-if="data?.sitemapUrl"><summary>搜索引擎收录</summary><a :href="data.sitemapUrl" target="_blank" rel="noopener">查看 sitemap</a></details></section>
  </div>
</template>

<style scoped>
.overview-banner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.2rem 1.5rem; background: #eaf3ff; border: 1px solid #c7dffa; border-radius: 12px; margin-bottom: 1rem; }
.overview-banner h2 { margin: 0; font-size: 1.15rem; }.overview-banner p { margin-bottom: 0; color: #45658a; }
.overview-stats { margin-bottom: 1.5rem; }.stat { background: white; color: var(--ink); }
.dashboard-columns { display: grid; grid-template-columns: 1.3fr 1fr; gap: 1.2rem; }.dashboard-columns .panel { margin: 0; }
.section-heading { display: flex; align-items: center; justify-content: space-between; }.section-heading h2 { font-size: 1.1rem; margin: 0 0 1rem; }
.dashboard-list { list-style: none; padding: 0; margin: 0; }.dashboard-list li { display: flex; justify-content: space-between; gap: 1rem; padding: .85rem 0; border-bottom: 1px solid var(--line); }.dashboard-list li:last-child { border-bottom: 0; }.dashboard-list a { display: grid; gap: .4rem; }.dashboard-list small { color: var(--muted); }
.issue-list { padding-left: 1.2rem; line-height: 1.8; }
@media (max-width: 900px) { .dashboard-columns { grid-template-columns: 1fr; } .overview-banner { flex-wrap: wrap; } }
</style>
