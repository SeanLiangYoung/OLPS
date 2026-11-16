<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftPageDetailRoute } from '../pagePaths'
import { buildPageJobRequest } from '../pageJobRequest'
import { readReportRewriteBrief, type ReportRewriteSource } from '../reportRewrite'
import RewriteProposalReview from '../components/RewriteProposalReview.vue'
import type { JobRecord, KnowledgeBase, KnowledgeDocument, PageKind, PageRecord, SiteDraft } from '../types'

const router = useRouter()
const route = useRoute()
const sourcePage = ref<PageRecord | null>(null)
const relatedPages = ref<PageRecord[]>([])
const operation = ref<'generate' | 'rewrite' | 'translate'>(route.query.operation === 'translate' ? 'translate' : route.query.operation === 'rewrite' ? 'rewrite' : 'generate')
const targetPageId = ref('')
const draft = ref<SiteDraft | null>(null)
const draftId = ref('')
const knowledgeBases = ref<KnowledgeBase[]>([])
const knowledgeBaseId = ref('')
const documents = ref<KnowledgeDocument[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)
const job = ref<JobRecord | null>(null)
const resultPageId = ref('')
const rewriteProposal = ref<PageRecord | null>(null)
const proposalVersion = ref('')
const wikiStatus = ref<{ configured: boolean; allowed: boolean } | null>(null)
const wikiBusy = ref(false)

const form = ref({
  kind: 'site' as PageKind,
  title: '',
  slug: '',
  brief: '',
  keywords: 'buy steel, rent steel',
  locale: 'en',
})

const newKbName = ref('')
const newDoc = ref({ title: '', content: '' })

async function loadKnowledgeBases() {
  const data = await api<{ knowledgeBases: KnowledgeBase[] }>('GET', '/api/knowledge-bases')
  knowledgeBases.value = data.knowledgeBases ?? []
  if (!knowledgeBaseId.value && knowledgeBases.value.length) {
    knowledgeBaseId.value = knowledgeBases.value[0]!.kbId
  }
}

async function loadDocuments() {
  if (!knowledgeBaseId.value) {
    documents.value = []
    wikiStatus.value = null
    return
  }
  const data = await api<{ documents: KnowledgeDocument[] }>(
    'GET',
    `/api/knowledge-bases/${knowledgeBaseId.value}/documents`,
  )
  documents.value = data.documents ?? []
  wikiStatus.value = await api<{ configured: boolean; allowed: boolean }>('GET', `/api/knowledge-bases/${knowledgeBaseId.value}/wiki`)
}

async function importWiki() {
  if (!wikiStatus.value?.configured || !wikiStatus.value.allowed || wikiBusy.value) return
  error.value = ''
  wikiBusy.value = true
  try {
    const result = await api<{ imported: number }>('POST', `/api/knowledge-bases/${knowledgeBaseId.value}/wiki/import`)
    await loadDocuments()
    message.value = `已同步 ${result.imported} 份本地知识文档`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    wikiBusy.value = false
  }
}

onMounted(async () => {
  try {
    const id = requireSelectedDraftId()
    draftId.value = id
    draft.value = await fetchDraft(id)
    form.value.locale = draft.value.settings.defaultLocale
    if (typeof route.query.pageId === 'string') {
      const data = await api<{ page: PageRecord }>('GET', `/api/drafts/${id}/pages/${route.query.pageId}`)
      sourcePage.value = data.page
      form.value.kind = data.page.kind
      form.value.title = data.page.title
      form.value.slug = data.page.slug
      form.value.locale = operation.value === 'translate' ? draft.value.settings.locales.find(locale => locale !== data.page.locale) || '' : data.page.locale || draft.value.settings.defaultLocale
      form.value.keywords = data.page.body.ads?.keywordCluster.join(', ') || ''
      if (operation.value === 'translate') form.value.slug = `${data.page.slug}-${form.value.locale}`
      const list = await api<{ pages: PageRecord[] }>('GET', `/api/drafts/${id}/pages`)
      relatedPages.value = list.pages
    }
    if (typeof route.query.reportId === 'string') {
      if (operation.value !== 'rewrite' || !sourcePage.value) throw new Error('报告改写需要选择源页面')
      const data = await api<{ report: ReportRewriteSource }>('GET', `/api/reports/${encodeURIComponent(route.query.reportId)}`)
      form.value.brief = readReportRewriteBrief(data.report, id, sourcePage.value.pageId)
    } else if (typeof route.query.brief === 'string') form.value.brief = route.query.brief
    await loadKnowledgeBases()
    await loadDocuments()
    if (typeof route.query.jobId === 'string') {
      busy.value = true
      try { await waitForJob(route.query.jobId) } finally { busy.value = false }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function onKbChange() {
  error.value = ''
  try {
    await loadDocuments()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function createKb() {
  error.value = ''
  if (!newKbName.value.trim()) {
    error.value = '请填写知识库名称'
    return
  }
  try {
    const data = await api<{ knowledgeBase: KnowledgeBase }>('POST', '/api/knowledge-bases', {
      name: newKbName.value.trim(),
    })
    newKbName.value = ''
    await loadKnowledgeBases()
    knowledgeBaseId.value = data.knowledgeBase.kbId
    await loadDocuments()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function addDocument() {
  error.value = ''
  if (!knowledgeBaseId.value) {
    error.value = '请先选择知识库'
    return
  }
  if (!newDoc.value.title.trim() || !newDoc.value.content.trim()) {
    error.value = '文档标题与内容均必填'
    return
  }
  try {
    await api('POST', `/api/knowledge-bases/${knowledgeBaseId.value}/documents`, {
      title: newDoc.value.title.trim(),
      content: newDoc.value.content.trim(),
    })
    newDoc.value = { title: '', content: '' }
    await loadDocuments()
    message.value = '文档已添加'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const canSubmit = computed(
  () =>
    Boolean(
      draftId.value &&
        knowledgeBaseId.value &&
        form.value.title.trim() &&
        form.value.slug.trim() && form.value.locale,
    ),
)

const translationTargets = computed(() => relatedPages.value.filter(page => page.pageId !== sourcePage.value?.pageId && page.locale === form.value.locale && Boolean(sourcePage.value?.translationGroupId) && page.translationGroupId === sourcePage.value?.translationGroupId))

watch(targetPageId, value => {
  const target = translationTargets.value.find(page => page.pageId === value)
  if (target) form.value.slug = target.slug
})
watch(() => form.value.locale, locale => {
  targetPageId.value = ''
  if (operation.value === 'translate' && sourcePage.value) form.value.slug = `${sourcePage.value.slug}-${locale}`
})

let cancelled = false
onUnmounted(() => {
  cancelled = true
})

async function waitForJob(jobId: string) {
  while (!cancelled) {
    const data = await api<{ job: JobRecord }>('GET', `/api/jobs/${jobId}`)
    if (cancelled) return
    job.value = data.job
    if (data.job.status === 'failed') {
      error.value = data.job.error || '生成失败'
      return
    }
    if (data.job.status === 'completed') {
      if (data.job.result?.proposal && typeof data.job.result.proposal === 'object') {
        rewriteProposal.value = data.job.result.proposal as PageRecord
        proposalVersion.value = String(data.job.result.expectedUpdatedAt || '')
        message.value = '改写建议已生成，请审阅并选择采用内容。'
        return
      }
      const pageId = data.job.result?.pageId
      if (typeof pageId !== 'string') throw new Error('任务结果缺少 pageId')
      resultPageId.value = pageId
      message.value = '页面已保存'
      await router.push(draftPageDetailRoute(draftId.value, pageId))
      return
    }
    await new Promise(resolve => setTimeout(resolve, 800))
  }
}

async function submit() {
  error.value = ''
  message.value = ''
  resultPageId.value = ''
  job.value = null
  if (!knowledgeBaseId.value) {
    error.value = '生成必须选择知识库'
    return
  }
  if (!form.value.title.trim() || !form.value.slug.trim()) {
    error.value = '标题与 slug 必填'
    return
  }
  busy.value = true
  try {
    const payload = buildPageJobRequest({
      draftId: draftId.value, knowledgeBaseId: knowledgeBaseId.value, operation: operation.value,
      form: form.value, source: sourcePage.value,
      target: translationTargets.value.find(page => page.pageId === targetPageId.value),
    })
    const created = await api<{ job?: JobRecord; page?: { pageId: string } }>(
      'POST',
      '/api/jobs/generate_page',
      { ...payload, ...(operation.value === 'rewrite' ? { reviewBeforeSave: true } : {}) },
    )
    if (created.job?.jobId) {
      job.value = created.job
      message.value = `任务已提交：${created.job.jobId}`
      await router.replace({ path: route.path, query: { ...route.query, jobId: created.job.jobId } })
      await waitForJob(created.job.jobId)
    } else if (created.page?.pageId) {
      resultPageId.value = created.page.pageId
      message.value = '生成完成'
    } else {
      throw new Error('接口未返回 job 或 page')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function openPage() {
  if (resultPageId.value && draftId.value) {
    router.push(draftPageDetailRoute(draftId.value, resultPageId.value))
  }
}
</script>

<template>
  <section class="panel">
    <h1>{{ operation === 'rewrite' ? '改写页面' : operation === 'translate' ? '翻译页面' : '生成页面' }}</h1>
    <p v-if="sourcePage" class="muted">来源页面：{{ sourcePage.title }} · {{ sourcePage.locale }}</p>
    <p v-if="draft" class="muted">当前网站内容：{{ draft.name }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <label>
      知识库（必选）
      <select v-model="knowledgeBaseId" @change="onKbChange">
        <option disabled value="">请选择</option>
        <option v-for="kb in knowledgeBases" :key="kb.kbId" :value="kb.kbId">
          {{ kb.name }}
        </option>
      </select>
    </label>

    <div class="row" style="margin-bottom: 1rem;">
      <input v-model="newKbName" placeholder="新建知识库名称" style="max-width: 240px;" />
      <button type="button" class="secondary" @click="createKb">新建知识库</button>
    </div>

    <div v-if="knowledgeBaseId" class="panel" style="background: #fff; margin: 0 0 1rem;">
      <h3 style="margin-top: 0;">知识库文档（{{ documents.length }}）</h3>
      <p v-if="wikiStatus" class="muted">本地 llm-wiki：{{ !wikiStatus.configured ? '尚未配置目录' : wikiStatus.allowed ? '可以同步' : '当前用户没有同步权限' }}</p>
      <button type="button" class="secondary" :disabled="wikiBusy || !wikiStatus?.configured || !wikiStatus.allowed" @click="importWiki">{{ wikiBusy ? '正在同步本地知识…' : '同步本地知识' }}</button>
      <ul v-if="documents.length">
        <li v-for="d in documents" :key="d.docId">{{ d.title }}<span v-if="d.source" class="muted"> · {{ d.source }}</span></li>
      </ul>
      <p v-else class="muted">暂无文档，请先添加，否则生成可能失败。</p>
      <div class="grid">
        <label>文档标题 <input v-model="newDoc.title" /></label>
        <label>文档内容 <textarea v-model="newDoc.content" rows="4" /></label>
        <button type="button" class="secondary" @click="addDocument">添加文档</button>
      </div>
    </div>

    <div class="grid">
      <label>
        类型
        <select v-model="form.kind" :disabled="Boolean(sourcePage) || busy">
          <option value="site">通用站页</option>
          <option value="content">内容页</option>
          <option value="ads">广告承接页</option>
        </select>
      </label>
      <label>标题 <input v-model="form.title" /></label>
      <label>页面地址 <input v-model="form.slug" /></label>
      <label>
        目标语言
        <select v-model="form.locale" :disabled="operation === 'rewrite' || busy">
          <option v-for="locale in draft?.settings.locales || []" :key="locale" :value="locale" :disabled="operation === 'translate' && locale === sourcePage?.locale">{{ locale }}</option>
        </select>
      </label>
      <label v-if="operation === 'translate'">
        目标页面
        <select v-model="targetPageId" :disabled="busy">
          <option value="">创建目标语言页面</option>
          <option v-for="target in translationTargets" :key="target.pageId" :value="target.pageId">更新：{{ target.title }} · {{ target.slug }}</option>
        </select>
      </label>
      <label>内容要求 <textarea v-model="form.brief" rows="3" /></label>
      <label v-if="form.kind === 'ads'">
        关键词（逗号分隔）
        <input v-model="form.keywords" />
      </label>
      <button type="button" :disabled="busy || !canSubmit" @click="submit">
        {{ busy ? '生成中…' : '提交生成任务' }}
      </button>
    </div>

    <div v-if="job" style="margin-top: 1rem;">
      <p>任务状态：<span class="badge">{{ job.status }}</span> · {{ job.jobId }}</p>
      <p v-if="job.result">处理阶段：{{ job.result.stage }} · {{ job.result.progress }}%</p>
      <p v-if="job.error" class="error">{{ job.error }}</p>
    </div>
    <div v-if="resultPageId" class="row" style="margin-top: 0.75rem;">
      <button type="button" @click="openPage">打开页面详情</button>
      <RouterLink v-if="draftId" :to="draftPageDetailRoute(draftId, resultPageId)">{{
        resultPageId
      }}</RouterLink>
    </div>
  </section>
  <RewriteProposalReview v-if="rewriteProposal && sourcePage" :draft-id="draftId" :source="sourcePage" :proposal="rewriteProposal" :expected-updated-at="proposalVersion" @adopted="router.push(draftPageDetailRoute(draftId, $event))" />
</template>
