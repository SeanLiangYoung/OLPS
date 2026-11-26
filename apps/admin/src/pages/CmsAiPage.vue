<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { api, getAccessToken } from '../api'
import { selectedSiteIdState, selectedDraftIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'
import {
  generationLabels,
  structureOperations,
  type GenerationNode,
  type GenerationType,
} from '../cms-generation'
import CmsGenerationTree from '../components/CmsGenerationTree.vue'
import CmsBasicInfoCompare, {
  type BasicInfoSnapshot,
} from '../components/CmsBasicInfoCompare.vue'
import {
  summarizeSelectedKnowledgeAssets,
  type KnowledgeDocumentWithAssets,
} from '../summarizeSelectedKnowledgeAssets'

type Content = {
  ref: 'page' | 'collection' | 'group' | 'item'
  meta: Record<string, unknown>
  locale: {
    title: string
    blocks?: Array<{ id: string; type: string; props: Record<string, unknown>; children: unknown[] }>
  }
}
type Job = {
  jobId: string
  type: GenerationType
  status: string
  result?: { nodes?: GenerationNode[]; nodeIds?: string[] }
  error?: unknown
}
type JobEvent = { eventId: number; type: string; payload: Record<string, unknown> }
type KnowledgeDocument = KnowledgeDocumentWithAssets & {
  title: string
  assetRefs: string[]
}
type BasicInfoRevisions = { settings: string; plugins: string }

const operation = ref<GenerationType>('extract_basic_info')
const instruction = ref('')
const title = ref('')
const targetLocale = ref('zh-CN')
const scope = ref<'all' | 'outdated'>('all')
const contents = ref<Content[]>([])
const documents = ref<KnowledgeDocument[]>([])
const knowledgeIds = ref<string[]>([])
const nodes = ref<GenerationNode[]>([])
const selectedAssetSummary = computed(() =>
  summarizeSelectedKnowledgeAssets(knowledgeIds.value, documents.value),
)
const selectedTarget = ref('')
const selectedBlock = ref('')
const job = ref<Job | null>(null)
const error = ref('')
const message = ref('')
const connection = ref('')
const sending = ref(false)
const completedAreas = ref(0)
const basicBefore = ref<BasicInfoSnapshot | null>(null)
const basicAfter = ref<BasicInfoSnapshot | null>(null)
const basicRevisions = ref<BasicInfoRevisions | null>(null)
const applyingBasic = ref(false)
const jobDismissed = ref(false)
let controller: AbortController | undefined
let generation = 0

const extractingBasic = computed(() => operation.value === 'extract_basic_info')
const proposingStructure = computed(() => operation.value === 'propose_site_structure')
const showKnowledgePicker = computed(() => !extractingBasic.value && !proposingStructure.value)
const showInstruction = computed(() => !extractingBasic.value && !proposingStructure.value)
const showJobProgress = computed(() => !!job.value && !jobDismissed.value)
const jobClosable = computed(
  () => !!job.value && ['completed', 'failed'].includes(job.value.status),
)
const showStructure = computed(() => structureOperations.has(operation.value))
const active = computed(
  () =>
    sending.value ||
    applyingBasic.value ||
    (!!job.value && !['completed', 'failed'].includes(job.value.status)),
)
const targetRequired = computed(() =>
  ['revise_node', 'rewrite_block', 'translate_node', 'generate_seo'].includes(operation.value),
)
const translating = computed(() => operation.value.startsWith('translate_'))
const startDisabled = computed(
  () =>
    !selectedDraftIdState.value ||
    (active.value && !sending.value) ||
    (operation.value === 'generate_nodes' && !nodes.value.length),
)

function id(content: Content): string {
  return String(content.meta[`${content.ref}Id`])
}
const target = computed(() =>
  contents.value.find((content) => `${content.ref}:${id(content)}` === selectedTarget.value),
)
const collections = computed(() =>
  contents.value
    .filter((item) => item.ref === 'collection')
    .map((item) => ({ id: id(item), title: item.locale.title })),
)
const blockLabels: Record<string, string> = {
  'core/html': '正文区域',
  'core/text': '文字区域',
  'core/image': '图片区域',
  'core/columns': '分栏区域',
  'core/collection-list': '内容列表',
  'plugin/inquiry-form/form': '询盘表单',
}

function businessError(value: unknown): string {
  if (typeof value === 'object' && value && 'error' in value) return String(value.error)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as { error?: unknown }
      if (parsed.error) return String(parsed.error)
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause
    }
    return value
  }
  return '生成没有完成，请查看网站与模型设置。'
}

function clearBasicResult(): void {
  basicBefore.value = null
  basicAfter.value = null
  basicRevisions.value = null
}

async function load() {
  const current = ++generation
  controller?.abort()
  error.value = ''
  message.value = ''
  job.value = null
  completedAreas.value = 0
  connection.value = ''
  if (!selectedSiteIdState.value || !selectedDraftIdState.value) {
    contents.value = []
    documents.value = []
    clearBasicResult()
    return
  }
  try {
    const base = `/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}`
    const locale = encodeURIComponent(contentLocale.value)
    const [pages, lists, knowledge] = await Promise.all([
      api<{ pages: Content[] }>('GET', `${base}/pages?locale=${locale}&limit=100`),
      api<{ collections: Content[] }>('GET', `${base}/collections?locale=${locale}&limit=100`),
      api<{ documents: KnowledgeDocument[] }>(
        'GET',
        `/api/sites/${encodeURIComponent(selectedSiteIdState.value)}/knowledge-base/documents`,
      ),
    ])
    const extra = await Promise.all(
      lists.collections.flatMap((collection) =>
        ['groups', 'items'].map(async (plural) => {
          const result = await api<Record<string, Content[]>>(
            'GET',
            `${base}/collections/${id(collection)}/${plural}?locale=${locale}&limit=100`,
          )
          return result[plural]!
        }),
      ),
    )
    if (current !== generation) return
    contents.value = [...pages.pages, ...lists.collections, ...extra.flat()]
    documents.value = knowledge.documents.map((document) => ({
      ...document,
      assetRefs: Array.isArray(document.assetRefs) ? document.assetRefs : [],
      assets: Array.isArray(document.assets) ? document.assets : [],
    }))
    if (!contents.value.some((item) => `${item.ref}:${id(item)}` === selectedTarget.value)) {
      selectedTarget.value = contents.value[0]
        ? `${contents.value[0].ref}:${id(contents.value[0])}`
        : ''
    }
    if (!extractingBasic.value) {
      const pending = localStorage.getItem(`olps_generation_${selectedDraftIdState.value}`)
      if (pending) {
        jobDismissed.value = false
        job.value = (await api<{ job: Job }>('GET', `/api/jobs/${pending}`)).job
        if (job.value.status === 'completed' && job.value.result?.nodes) {
          nodes.value = job.value.result.nodes
        }
        if (!['completed', 'failed'].includes(job.value.status)) void monitor(pending, current)
        if (job.value.status === 'failed') error.value = businessError(job.value.error)
      }
    }
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(
  [selectedSiteIdState, selectedDraftIdState, contentLocale],
  () => {
    nodes.value = []
    knowledgeIds.value = []
    clearBasicResult()
    void load()
  },
  { immediate: true },
)
watch(selectedTarget, () => {
  selectedBlock.value = target.value?.locale.blocks?.[0]?.id ?? ''
})
watch(operation, () => {
  error.value = ''
  message.value = ''
  if (extractingBasic.value) {
    job.value = null
    connection.value = ''
  } else {
    clearBasicResult()
  }
})
onUnmounted(() => {
  generation++
  controller?.abort()
})

async function monitor(jobId: string, current: number) {
  controller?.abort()
  const abort = new AbortController()
  controller = abort
  const saved = JSON.parse(
    localStorage.getItem(`olps_generation_progress_${jobId}`) ?? '{"after":0,"areas":0}',
  ) as { after: number; areas: number }
  let after = saved.after
  completedAreas.value = saved.areas
  while (!abort.signal.aborted && current === generation) {
    try {
      const response = await fetch(`/api/jobs/${jobId}/events`, {
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          'Last-Event-ID': String(after),
        },
        signal: abort.signal,
      })
      if (!response.ok) throw new Error((await response.json() as { error: string }).error)
      if (!response.body) throw new Error('生成进度连接没有返回内容')
      connection.value = '正在接收生成进度'
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader()
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          const event = JSON.parse(item.value.data) as JobEvent
          if (event.eventId <= after) continue
          after = event.eventId
          if (event.type === 'block_completed') completedAreas.value++
          if (event.type === 'node_failed' || event.type === 'job_failed') {
            error.value = businessError(event.payload)
          }
          localStorage.setItem(
            `olps_generation_progress_${jobId}`,
            JSON.stringify({ after, areas: completedAreas.value }),
          )
        }
      } finally {
        reader.releaseLock()
      }
    } catch (cause) {
      if (abort.signal.aborted || current !== generation) return
      connection.value =
        cause instanceof Error ? `进度连接中断：${cause.message}` : '进度连接中断'
    }
    if (current !== generation || abort.signal.aborted) return
    try {
      job.value = (await api<{ job: Job }>('GET', `/api/jobs/${jobId}`)).job
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return
    }
    if (['completed', 'failed'].includes(job.value.status)) {
      connection.value = ''
      if (job.value.result?.nodes) nodes.value = job.value.result.nodes
      if (job.value.status === 'failed') error.value = businessError(job.value.error)
      if (job.value.status === 'completed') {
        const completed = completedAreas.value
        await load()
        if (job.value?.jobId === jobId) completedAreas.value = completed
      }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

function newNode(): GenerationNode {
  return {
    nodeId: crypto.randomUUID(),
    ref: 'page',
    title: title.value || '新页面',
    requirements: instruction.value,
    children: [],
  }
}

async function startExtractBasicInfo(): Promise<void> {
  if (active.value || !selectedDraftIdState.value) return
  sending.value = true
  error.value = ''
  message.value = ''
  clearBasicResult()
  try {
    const result = await api<{
      before: BasicInfoSnapshot
      after: BasicInfoSnapshot
      revisions: BasicInfoRevisions
    }>('POST', `/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}/extract-basic-info`, {
      locale: contentLocale.value,
    })
    basicBefore.value = result.before
    basicAfter.value = result.after
    basicRevisions.value = result.revisions
    message.value = '已根据知识库生成建议，请核对后应用改动。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    sending.value = false
  }
}

async function applyExtractBasicInfo(): Promise<void> {
  if (
    active.value ||
    !selectedDraftIdState.value ||
    !basicAfter.value ||
    !basicRevisions.value
  ) {
    return
  }
  applyingBasic.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await api<{ revisions: BasicInfoRevisions }>(
      'POST',
      `/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}/apply-basic-info`,
      {
        locale: contentLocale.value,
        after: basicAfter.value,
        revisions: basicRevisions.value,
      },
    )
    basicBefore.value = JSON.parse(JSON.stringify(basicAfter.value)) as BasicInfoSnapshot
    basicRevisions.value = result.revisions
    message.value = '基本信息已保存到当前草稿。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    applyingBasic.value = false
  }
}

async function start() {
  if (extractingBasic.value) {
    await startExtractBasicInfo()
    return
  }
  if (active.value || !selectedDraftIdState.value) return
  sending.value = true
  error.value = ''
  message.value = ''
  completedAreas.value = 0
  try {
    const request: Record<string, unknown> = {
      draftId: selectedDraftIdState.value,
      locale: contentLocale.value,
      instruction: proposingStructure.value ? '' : instruction.value,
      knowledgeDocumentIds: proposingStructure.value
        ? documents.value.map((document) => document.documentId)
        : knowledgeIds.value,
    }
    jobDismissed.value = false
    if (targetRequired.value && target.value) {
      request.target = { ref: target.value.ref, id: id(target.value) }
    }
    if (operation.value === 'rewrite_block') request.blockId = selectedBlock.value
    if (translating.value) {
      request.targetLocale = targetLocale.value
      request.scope = scope.value
    }
    if (operation.value === 'generate_node') request.node = newNode()
    if (operation.value === 'generate_nodes') request.nodes = nodes.value
    const result = await api<{ job: Job }>(
      'POST',
      `/api/jobs/${operation.value}`,
      request,
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    )
    job.value = result.job
    localStorage.setItem(`olps_generation_${selectedDraftIdState.value}`, result.job.jobId)
    void monitor(result.job.jobId, generation)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    sending.value = false
  }
}

const jobStatusText = computed(() => {
  if (!job.value) return ''
  if (job.value.status === 'completed') return '处理完成'
  if (job.value.status === 'failed') return '处理没有完成'
  return '正在生成内容…'
})
const jobProgress = computed(() => {
  if (!job.value) return 0
  if (job.value.status === 'completed') return 100
  if (job.value.status === 'failed') return 100
  if (completedAreas.value > 0) return Math.min(90, completedAreas.value * 10)
  return 30
})

function dismissJob(): void {
  if (!job.value || !jobClosable.value) return
  if (selectedDraftIdState.value) {
    localStorage.removeItem(`olps_generation_${selectedDraftIdState.value}`)
    localStorage.removeItem(`olps_generation_progress_${job.value.jobId}`)
  }
  job.value = null
  jobDismissed.value = true
  connection.value = ''
  completedAreas.value = 0
}

async function startGenerateSelected(): Promise<void> {
  if (active.value || !selectedDraftIdState.value || !nodes.value.length) return
  if (!knowledgeIds.value.length) {
    knowledgeIds.value = documents.value.map((document) => document.documentId)
  }
  operation.value = 'generate_nodes'
  await start()
}

const pageLayoutClass = computed(() =>
  extractingBasic.value || showStructure.value ? 'page-layout' : undefined,
)
const generateSelectedDisabled = computed(
  () =>
    !selectedDraftIdState.value ||
    !nodes.value.length ||
    (active.value && !(sending.value && operation.value === 'generate_nodes')),
)
</script>
<template>
  <div :class="pageLayoutClass">
  <el-alert
    v-if="!selectedDraftIdState"
    title="请先选择网站的编辑版本。"
    type="warning"
    show-icon
    :closable="false"
    class="page-alert"
  />
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
  <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />

  <el-card class="panel-card operation-card" shadow="never">
    <div class="operation-row">
      <el-form class="operation-form" label-position="top" @submit.prevent>
        <fieldset :disabled="active" class="ai-fieldset">
          <el-form-item label="处理内容">
            <el-select v-model="operation" style="width: 100%">
              <el-option v-for="(label, key) in generationLabels" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
        </fieldset>
      </el-form>
      <el-button
        class="operation-start"
        type="primary"
        :loading="sending"
        :disabled="startDisabled"
        @click="start"
      >{{
        extractingBasic
          ? sending
            ? '正在提取…'
            : '开始提取'
          : sending
            ? '正在处理…'
            : '开始处理'
      }}</el-button>
    </div>
  </el-card>

  <el-card v-if="extractingBasic" class="panel-card extract-panel" shadow="never">
    <div class="extract-body">
      <div v-if="basicBefore && basicAfter" class="extract-scroll">
        <CmsBasicInfoCompare
          :draft-id="selectedDraftIdState"
          :before="basicBefore"
          v-model:after="basicAfter"
          :disabled="active"
        />
      </div>
      <p v-else class="muted extract-empty">完成后将显示改动前与改动后的对比，右侧可手工修改或上传图片。</p>
      <div v-if="basicBefore && basicAfter" class="basic-actions">
        <el-button type="primary" :loading="applyingBasic" :disabled="active && !applyingBasic" @click="applyExtractBasicInfo">
          应用改动
        </el-button>
        <el-button :disabled="active" @click="clearBasicResult">放弃</el-button>
      </div>
    </div>
  </el-card>

  <template v-else>
    <el-card class="panel-card form-card" shadow="never">
      <el-form label-position="top" @submit.prevent="start">
        <fieldset :disabled="active" class="ai-fieldset">
          <el-form-item v-if="targetRequired" label="选择已有内容" required>
            <el-select v-model="selectedTarget" style="width: 100%">
              <el-option
                v-for="content in contents"
                :key="`${content.ref}:${id(content)}`"
                :label="content.locale.title"
                :value="`${content.ref}:${id(content)}`"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="operation === 'rewrite_block'" label="选择内容区域" required>
            <el-select v-model="selectedBlock" style="width: 100%">
              <el-option
                v-for="block in target?.locale.blocks"
                :key="block.id"
                :label="blockLabels[block.type] ?? '内容区域'"
                :value="block.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="operation === 'generate_node'" label="新内容名称" required>
            <el-input v-model="title" />
          </el-form-item>
          <el-form-item v-if="showInstruction" label="你的要求">
            <el-input
              v-model="instruction"
              type="textarea"
              :rows="5"
              placeholder="说明网站内容、读者和需要调整的地方"
            />
          </el-form-item>
          <template v-if="translating">
            <el-form-item label="翻译为">
              <el-select v-model="targetLocale" style="width: 100%">
                <el-option label="简体中文" value="zh-CN" />
                <el-option label="English" value="en" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="operation === 'translate_site'" label="翻译范围">
              <el-select v-model="scope" style="width: 100%">
                <el-option label="全部内容" value="all" />
                <el-option label="只翻译需要更新的内容" value="outdated" />
              </el-select>
            </el-form-item>
          </template>
          <el-form-item v-if="showKnowledgePicker" label="使用的网站资料">
            <p v-if="!documents.length" class="muted">网站知识库中还没有资料。</p>
            <el-checkbox-group v-else v-model="knowledgeIds" class="knowledge-options">
              <el-checkbox
                v-for="document in documents"
                :key="document.documentId"
                :value="document.documentId"
              >{{ document.title }}</el-checkbox>
            </el-checkbox-group>
            <p class="asset-summary" aria-live="polite">关联素材：{{ selectedAssetSummary.summaryText }}</p>
          </el-form-item>
          <p v-else-if="proposingStructure" class="muted knowledge-hint">
            规划网站结构时会使用知识库中的全部资料。
          </p>
        </fieldset>
      </el-form>
      <section v-if="showJobProgress && job" aria-label="内容生成进度" class="job-progress">
        <div class="job-progress-header">
          <h2>{{ generationLabels[job.type] }}</h2>
          <el-button
            v-if="jobClosable"
            class="job-close"
            text
            aria-label="关闭进度"
            @click="dismissJob"
          >×</el-button>
        </div>
        <p role="status">{{ jobStatusText }}</p>
        <el-progress
          :percentage="jobProgress"
          :status="job.status === 'failed' ? 'exception' : job.status === 'completed' ? 'success' : undefined"
        />
        <p v-if="connection">{{ connection }}</p>
        <p v-if="completedAreas">已完成 {{ completedAreas }} 个内容区域。</p>
        <p v-if="job.status === 'completed' && job.result?.nodeIds?.length">
          已处理 {{ job.result.nodeIds.length }} 项内容。
        </p>
      </section>
    </el-card>

    <el-card v-if="showStructure" class="panel-card structure-panel" shadow="never">
      <div class="structure-header">
        <h2>网站内容结构</h2>
        <div class="structure-actions">
          <el-button :disabled="active" @click="nodes.push(newNode())">添加内容</el-button>
          <el-button
            type="primary"
            :loading="sending && operation === 'generate_nodes'"
            :disabled="generateSelectedDisabled"
            @click="startGenerateSelected"
          >生成所选内容</el-button>
        </div>
      </div>
      <div class="structure-table-wrap">
        <CmsGenerationTree
          :nodes="nodes"
          :disabled="active"
          :collections="[
            ...collections,
            ...nodes
              .filter((node) => node.ref === 'collection')
              .map((node) => ({ id: node.nodeId, title: node.title })),
          ]"
        />
      </div>
    </el-card>
  </template>
  </div>
</template>
<style scoped>
.page-layout {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 158px);
  min-height: 0;
  overflow: hidden;
}
.panel-card { margin-bottom: 22px; }
.page-layout .operation-card,
.page-layout .form-card {
  flex: 0 0 auto;
  margin-bottom: 12px;
}
.page-layout .form-card {
  max-height: 36vh;
  overflow: auto;
}
.page-alert { margin-bottom: 12px; }
.page-layout .page-alert {
  flex: 0 0 auto;
}
.ai-fieldset { border: 0; margin: 0; padding: 0; }
.operation-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.operation-form {
  flex: 1 1 auto;
  min-width: 0;
}
.operation-form :deep(.el-form-item) {
  margin-bottom: 0;
}
.operation-start {
  flex: 0 0 auto;
  margin-bottom: 2px;
}
.knowledge-hint {
  margin: 0;
}
.extract-panel,
.structure-panel {
  flex: 1 1 auto;
  min-height: 0;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
}
.extract-panel :deep(.el-card__body),
.structure-panel :deep(.el-card__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-bottom: 16px;
  overflow: hidden;
}
.structure-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.structure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.extract-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.extract-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}
.extract-empty {
  margin: 0;
  flex: 1 1 auto;
  min-height: 80px;
}
.knowledge-options { display: grid; gap: 8px; }
.asset-summary { margin: 10px 0 0; color: var(--el-text-color-regular); }
.job-progress { margin-top: 24px; }
.job-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.job-progress-header h2 {
  margin: 0;
}
.job-close {
  flex: 0 0 auto;
  font-size: 20px;
  line-height: 1;
  padding: 0 4px;
}
.structure-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.structure-header h2 {
  margin: 0;
}
.basic-actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.muted { color: var(--el-text-color-secondary); }
</style>
