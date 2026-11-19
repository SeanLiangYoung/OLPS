<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import VisualPageEditor from '../components/VisualPageEditor.vue'
import PublicationPanel from '../components/PublicationPanel.vue'
import { editorMetadata } from '../editor/styles'
import { api } from '../api'
import { requireSelectedDraftId } from '../draft'
import { pageDraftMismatchMessage } from '../pageDraftGuard'
import { applySavedPageMetadata, pageEditSnapshot, protectPageUnload, PageEditSession } from '../pageEditSession'
import {
  draftPageDetailApiPath,
  draftPageGuideApiPath,
  draftPagePreviewApiPath,
} from '../pagePaths'
import { selectedDraftIdState } from '../workspaceSession'
import type { GuideOption, PageRecord, Screen } from '../types'

type PreviewWidth = 'mobile' | 'tablet' | 'desktop'

const route = useRoute()
const router = useRouter()
const lifecycleBusy = ref(false)
const confirmDelete = ref(false)
const page = ref<PageRecord | null>(null)
const error = ref('')
const message = ref('')
const previewUrl = ref('')
const previewWidth = ref<PreviewWidth>('desktop')
const selectedScreenId = ref('')
const graphMode = ref<'svg' | 'css'>('svg')
const publishVisible = ref(false)
const pageCandidates = ref<PageRecord[]>([])
const generationUsage = computed(() => {
  const usage = page.value?.metadata?.generation?.model?.usage
  return usage && typeof usage === 'object' ? usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } : null
})
const editSession = reactive(new PageEditSession())
const saving = computed(() => editSession.pending)
const saveStatus = computed(() => page.value ? editSession.saveStatus(page.value) : '')
const needsLeaveWarning = computed(() => editSession.needsLeaveWarning(page.value))

function confirmLeave(): boolean {
  return !needsLeaveWarning.value || window.confirm('修改尚未保存完成，离开可能丢失输入。确定离开？')
}

onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.params.draftId === from.params.draftId && to.params.pageId === from.params.pageId) return true
  return confirmLeave()
})

function onBeforeUnload(event: BeforeUnloadEvent): void {
  protectPageUnload(event, needsLeaveWarning.value)
}

watch(needsLeaveWarning, (shouldWarn) => {
  if (shouldWarn) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}, { flush: 'sync' })

onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

const widthPx = computed(() => {
  if (previewWidth.value === 'mobile') return 390
  if (previewWidth.value === 'tablet') return 768
  return 1100
})

const screens = computed(() => page.value?.body.ads?.screens ?? [])

const selectedScreen = computed(() =>
  screens.value.find((s) => s.screenId === selectedScreenId.value) ?? null,
)

const edgeRows = computed(() => {
  const ads = page.value?.body.ads
  if (!ads) return []
  const rows: Array<{ from: string; optionId: string; label: string; action: string; to: string }> = []
  for (const [from, node] of Object.entries(ads.guide.nodes)) {
    for (const opt of node.options) {
      rows.push({
        from,
        optionId: opt.id,
        label: opt.label,
        action: opt.action,
        to: opt.action === 'go_cta' ? 'CTA' : (opt.targetScreenId ?? ''),
      })
    }
  }
  return rows
})

const graphLayout = computed(() => {
  const list = screens.value
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length || 1)))
  const nodeW = 140
  const nodeH = 56
  const gapX = 80
  const gapY = 70
  const positions = new Map<string, { x: number; y: number; screen: Screen }>()
  list.forEach((screen, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    positions.set(screen.screenId, {
      x: 40 + col * (nodeW + gapX),
      y: 40 + row * (nodeH + gapY),
      screen,
    })
  })
  const edges = edgeRows.value.map((row) => {
    const from = positions.get(row.from)
    const toId = row.to === 'CTA'
      ? list.find((s) => s.role === 'cta')?.screenId
      : row.to
    const to = toId ? positions.get(toId) : undefined
    return { ...row, fromPos: from, toPos: to }
  })
  const width = 40 + cols * (nodeW + gapX)
  const rows = Math.ceil((list.length || 1) / cols)
  const height = 40 + rows * (nodeH + gapY) + 40
  return { positions: [...positions.values()], edges, width, height, nodeW, nodeH }
})

function routeDraftId(): string {
  return String(route.params.draftId ?? '')
}

function routePageId(): string {
  return String(route.params.pageId ?? '')
}

async function load() {
  const generation = editSession.reset()
  page.value = null
  previewUrl.value = ''
  selectedScreenId.value = ''
  error.value = ''
  message.value = ''
  try {
    const selectedDraftId = requireSelectedDraftId()
    const draftId = routeDraftId()
    const pageId = routePageId()
    const mismatch = pageDraftMismatchMessage(selectedDraftId, draftId)
    if (mismatch) {
      error.value = mismatch
      return
    }
    const data = await api<{ page: PageRecord }>(
      'GET',
      draftPageDetailApiPath(draftId, pageId),
    )
    if (!editSession.isCurrent(generation)) return
    editSession.acceptSaved(pageEditSnapshot(data.page))
    page.value = data.page
    const candidates = await api<{ pages: PageRecord[] }>('GET', `/api/drafts/${encodeURIComponent(draftId)}/pages`)
    if (!editSession.isCurrent(generation)) return
    pageCandidates.value = candidates.pages
    if (data.page.body.ads?.screens?.length) {
      selectedScreenId.value = data.page.body.ads.screens[0]!.screenId
    }
  } catch (e) {
    if (editSession.isCurrent(generation)) error.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => [route.params.draftId, route.params.pageId, selectedDraftIdState.value],
  load,
  { immediate: true, flush: 'sync' },
)

onBeforeUnmount(() => {
  editSession.reset()
})

async function savePage(current: PageRecord, draftId: string, generation: number) {
  const sent = pageEditSnapshot(current)
  const data = await api<{ page: PageRecord; issues?: { message: string }[] }>(
    'PATCH',
    draftPageDetailApiPath(draftId, current.pageId) + '/editor',
    {
      expectedUpdatedAt: current.updatedAt,
      title: current.title,
      slug: current.slug,
      seo: current.seo,
      body: current.body,
      metadata: { ...current.metadata, editor: editorMetadata([current.body.html, ...(current.body.ads?.screens.map(screen => screen.html) || [])]) },
      locale: current.locale,
      translationGroupId: current.translationGroupId || null,
    },
  )
  if (!editSession.isCurrent(generation)) return
  applySavedPageMetadata(current, data.page)
  editSession.acceptSaved(sent)
  message.value = data.issues?.length ? `已保存；需要处理：${data.issues.map(issue => issue.message).join('；')}` : '已保存'
}

async function runOperation(action: (current: PageRecord, draftId: string, generation: number) => Promise<void>) {
  if (!page.value) return
  const generation = editSession.begin()
  if (generation === null) return
  const current = page.value
  const draftId = routeDraftId()
  error.value = ''
  message.value = ''
  try {
    await action(current, draftId, generation)
  } catch (e) {
    if (editSession.isCurrent(generation)) {
      editSession.saveFailed = !editSession.savedDuringOperation
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    editSession.finish(generation)
  }
}

async function saveMetaAndBody() {
  await runOperation(async (current, draftId, generation) => {
    await savePage(current, draftId, generation)
  })
}

async function saveGuide() {
  if (!page.value?.body.ads) return
  await runOperation(async (current, draftId, generation) => {
    const sent = pageEditSnapshot(current)
    const data = await api<{ page: PageRecord }>(
      'PATCH', draftPageGuideApiPath(draftId, current.pageId),
      { guide: current.body.ads!.guide },
    )
    if (!editSession.isCurrent(generation)) return
    applySavedPageMetadata(current, data.page)
    editSession.acceptSaved(sent, 'guide')
    message.value = 'Guide 已保存'
  })
}

async function publishCurrent() {
  if (editSession.pending) return
  await saveMetaAndBody()
  if (!error.value && page.value && !editSession.hasUnsaved(page.value)) publishVisible.value = true
}

async function refreshPublication() {
  const current = page.value
  if (!current) return
  const generation = editSession.generation
  const data = await api<{ page: PageRecord }>('GET', draftPageDetailApiPath(routeDraftId(), current.pageId))
  if (editSession.isCurrent(generation)) applySavedPageMetadata(current, data.page)
}

async function preview() {
  await runOperation(async (current, draftId, generation) => {
    previewUrl.value = ''
    await savePage(current, draftId, generation)
    if (!editSession.isCurrent(generation)) return
    const data = await api<{ previewUrl: string }>(
      'POST',
      draftPagePreviewApiPath(draftId, current.pageId),
    )
    if (!editSession.isCurrent(generation)) return
    previewUrl.value = data.previewUrl
    message.value = '预览已更新'
  })
}

async function setPublication(included: boolean) {
  if (!page.value || lifecycleBusy.value) return
  lifecycleBusy.value = true
  error.value = ''
  message.value = ''
  try {
    const data = await api<{ page: PageRecord }>('PATCH',
      draftPageDetailApiPath(routeDraftId(), page.value.pageId),
      { status: included ? 'draft' : 'unpublished', expectedUpdatedAt: page.value.updatedAt })
    page.value.status = data.page.status
    page.value.updatedAt = data.page.updatedAt
    message.value = included ? '已加入发布范围，执行 Push 后生效' : '已暂停发布，执行 Push 后生效'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    lifecycleBusy.value = false
  }
}

async function deletePage() {
  if (!page.value || lifecycleBusy.value) return
  lifecycleBusy.value = true
  error.value = ''
  try {
    await api('DELETE', draftPageDetailApiPath(routeDraftId(), page.value.pageId), { expectedUpdatedAt: page.value.updatedAt })
    editSession.acceptSaved(pageEditSnapshot(page.value))
    await router.push('/pages')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    lifecycleBusy.value = false
  }
}

function updateEdgeLabel(from: string, optionId: string, label: string) {
  const node = page.value?.body.ads?.guide.nodes[from]
  if (!node) return
  const opt = node.options.find((o) => o.id === optionId)
  if (opt) opt.label = label
}

function updateEdgeTarget(from: string, optionId: string, targetScreenId: string) {
  const node = page.value?.body.ads?.guide.nodes[from]
  if (!node) return
  const opt = node.options.find((o) => o.id === optionId)
  if (!opt) return
  if (targetScreenId === 'CTA') {
    opt.action = 'go_cta'
    delete opt.targetScreenId
  } else {
    opt.action = 'navigate'
    opt.targetScreenId = targetScreenId
  }
}

function addOption(from: string) {
  const node = page.value?.body.ads?.guide.nodes[from]
  if (!node) return
  const id = `opt-${Date.now().toString(36)}`
  const first = screens.value.find((s) => s.role !== 'cta' && s.screenId !== from)
  const opt: GuideOption = first
    ? { id, label: '新选项', action: 'navigate', targetScreenId: first.screenId }
    : { id, label: '去询盘', action: 'go_cta' }
  node.options.push(opt)
}

function removeOption(from: string, optionId: string) {
  const node = page.value?.body.ads?.guide.nodes[from]
  if (!node) return
  node.options = node.options.filter((o) => o.id !== optionId)
}

function updateEntry(keyword: string, screenId: string) {
  if (!page.value?.body.ads) return
  page.value.body.ads.guide.entryByKeyword[keyword] = screenId
}

function updateScreenTitle(screenId: string, title: string) {
  const screen = screens.value.find((s) => s.screenId === screenId)
  if (screen) screen.title = title
}

function updateScreenHtml(html: string) {
  if (!selectedScreen.value) return
  selectedScreen.value.html = html
}
</script>

<template>
  <section v-if="error && !page" class="panel">
    <p><RouterLink to="/pages">← 返回列表</RouterLink></p>
    <p class="error" role="alert">{{ error }}</p>
    <RouterLink class="btn" to="/workspace">切换工作区</RouterLink>
  </section>

  <section v-if="page" class="panel">
    <p><RouterLink to="/pages">← 返回列表</RouterLink></p>
    <h1>{{ page.title }}</h1>
    <p class="muted">
      {{ page.kind }} ·
      <span class="badge" :class="page.status">{{ page.status === 'unpublished' ? '暂停发布' : page.status === 'published' ? '已发布' : '待发布' }}</span>
      · {{ page.slug }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
    <div class="row">
      <button type="button" :disabled="saving" @click="saveMetaAndBody">{{ saving ? '正在保存…' : '保存页面' }}</button>
      <button type="button" :disabled="saving" @click="publishCurrent">发布此页面</button>
    </div>
    <PublicationPanel v-if="publishVisible" :draft-id="routeDraftId()" :page-ids="[page.pageId]" @published="refreshPublication" />
    <p role="status" aria-live="polite" data-page-save-status>{{ saveStatus }}</p>
    <button v-if="editSession.saveFailed" type="button" @click="saveMetaAndBody">重试保存全部修改</button>

    <section v-if="page.kind !== 'ads'">
      <h2>页面内容</h2>
      <VisualPageEditor :key="page.pageId" v-model:html="page.body.html" :draft-id="routeDraftId()" :pages="pageCandidates" />
    </section>
    <section v-else-if="page.body.ads">
      <h2>广告页面内容</h2>
      <label>当前屏<select v-model="selectedScreenId"><option v-for="screen in screens" :key="screen.screenId" :value="screen.screenId">{{ screen.title }} · {{ screen.role }}</option></select></label>
      <VisualPageEditor v-if="selectedScreen" :key="page.pageId + selectedScreen.screenId" v-model:html="selectedScreen.html" v-model:ads="page.body.ads" :screen-id="selectedScreenId" :draft-id="routeDraftId()" :pages="pageCandidates" />
    </section>

    <details><summary>页面信息与 SEO</summary>
    <div class="row">
      <RouterLink class="btn" :to="{ path: '/generate', query: { operation: 'rewrite', pageId: page.pageId } }">改写页面</RouterLink>
      <RouterLink class="btn" :to="{ path: '/generate', query: { operation: 'translate', pageId: page.pageId } }">翻译页面</RouterLink>
    </div>
    <label>标题 <input v-model="page.title" /></label>
    <label>页面地址 <input v-model="page.slug" /></label>
    <label>语言 <input v-model="page.locale" /></label>
    <label>翻译组 <input v-model="page.translationGroupId" /></label>
    <label>SEO title <input v-model="page.seo.title" /></label>
    <label>SEO description <textarea v-model="page.seo.description" rows="2" /></label>
    <label>Canonical URL <input v-model="page.seo.canonical" /></label>
    <label>分享图片 URL <input v-model="page.seo.image" /></label>
    <label>搜索收录
      <select v-model="page.seo.robots">
        <option :value="undefined">允许收录</option>
        <option value="index,follow">允许收录及访问链接</option>
        <option value="noindex,nofollow">禁止收录及访问链接</option>
      </select>
    </label>
    </details>
    <section v-if="page.metadata?.generation">
      <h2>生成来源</h2>
      <p>任务：{{ page.metadata.generation.jobId }}</p>
      <p v-if="page.metadata.generation.model">模型：{{ page.metadata.generation.model.model }} · {{ page.metadata.generation.model.provider }}</p>
      <p v-if="generationUsage">Tokens：输入 {{ generationUsage.prompt_tokens ?? '未提供' }} · 输出 {{ generationUsage.completion_tokens ?? '未提供' }} · 总数 {{ generationUsage.total_tokens ?? '未提供' }}</p>
      <ul>
        <li v-for="source in page.metadata.generation.sources || []" :key="source.docId">
          {{ source.title }} · {{ source.source || '知识库' }} · {{ source.docId }}
          <details v-if="source.content"><summary>查看引用内容</summary><p style="white-space: pre-wrap;">{{ source.content }}</p></details>
        </li>
      </ul>
    </section>

    <details v-if="page.kind !== 'ads'">
      <summary>高级 HTML 正文</summary>
      <h2>HTML 正文</h2>
      <label>
        body.html
        <textarea v-model="page.body.html" rows="14" style="font-family: ui-monospace, monospace;" />
      </label>
    </details>

    <div class="row">
      <button type="button" :disabled="editSession.pending" @click="saveMetaAndBody">保存</button>
      <button type="button" class="secondary" :disabled="editSession.pending" @click="preview">保存并预览</button>
      <RouterLink class="btn" to="/publish">前往 Push 发布</RouterLink>
    </div>
    <p class="muted">保存内容后，使用「发布此页面」更新当前页面的线上内容。</p>
    <div class="row">
      <button v-if="page.status === 'unpublished'" type="button" :disabled="lifecycleBusy" @click="setPublication(true)">加入发布范围</button>
      <button v-else type="button" class="secondary" :disabled="lifecycleBusy" @click="setPublication(false)">暂停发布此页</button>
      <button type="button" class="secondary" :disabled="lifecycleBusy" @click="confirmDelete = true">删除页面</button>
    </div>
    <div v-if="confirmDelete" role="group" aria-label="删除页面确认">
      <p>确认从当前草稿删除「{{ page.title }}」？执行 Push 后，公开地址将停止提供此页面。</p>
      <div class="row">
        <button type="button" :disabled="lifecycleBusy" @click="deletePage">确认删除页面</button>
        <button type="button" class="secondary" :disabled="lifecycleBusy" @click="confirmDelete = false">取消删除</button>
      </div>
    </div>
  </section>

  <section v-if="page?.body.ads" class="panel">
    <h2>屏列表与 HTML</h2>
    <div class="tabs">
      <button
        v-for="s in screens"
        :key="s.screenId"
        type="button"
        :class="{ active: selectedScreenId === s.screenId }"
        @click="selectedScreenId = s.screenId"
      >
        {{ s.screenId }} · {{ s.role }}
      </button>
    </div>
    <table class="table">
      <thead>
        <tr><th>screenId</th><th>role</th><th>标题</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in screens" :key="s.screenId">
          <td>{{ s.screenId }}</td>
          <td>{{ s.role }}</td>
          <td>
            <input :value="s.title" @input="updateScreenTitle(s.screenId, ($event.target as HTMLInputElement).value)" />
          </td>
        </tr>
      </tbody>
    </table>
    <label v-if="selectedScreen">
      屏 HTML（{{ selectedScreen.screenId }}）
      <textarea
        :value="selectedScreen.html"
        rows="10"
        style="font-family: ui-monospace, monospace;"
        @input="updateScreenHtml(($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <button type="button" class="secondary" :disabled="editSession.pending" @click="saveMetaAndBody">保存屏内容</button>
  </section>

  <section v-if="page?.body.ads" class="panel">
    <h2>Guide 工作台</h2>
    <h3>关键词 → 起始屏</h3>
    <table class="table">
      <thead>
        <tr><th>关键词</th><th>entry screenId</th></tr>
      </thead>
      <tbody>
        <tr v-for="(sid, kw) in page.body.ads.guide.entryByKeyword" :key="kw">
          <td>{{ kw }}</td>
          <td>
            <select :value="sid" @change="updateEntry(String(kw), ($event.target as HTMLSelectElement).value)">
              <option v-for="s in screens" :key="s.screenId" :value="s.screenId">{{ s.screenId }}</option>
            </select>
          </td>
        </tr>
      </tbody>
    </table>

    <h3>关系边</h3>
    <table class="table">
      <thead>
        <tr><th>从</th><th>选项文案</th><th>动作/目标</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="row in edgeRows" :key="row.from + row.optionId">
          <td>{{ row.from }}</td>
          <td>
            <input
              :value="row.label"
              @input="updateEdgeLabel(row.from, row.optionId, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <select
              :value="row.to"
              @change="updateEdgeTarget(row.from, row.optionId, ($event.target as HTMLSelectElement).value)"
            >
              <option value="CTA">go_cta</option>
              <option
                v-for="s in screens.filter((x) => x.role !== 'cta')"
                :key="s.screenId"
                :value="s.screenId"
              >
                navigate → {{ s.screenId }}
              </option>
            </select>
          </td>
          <td>
            <button type="button" class="ghost" @click="removeOption(row.from, row.optionId)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="row" style="margin-bottom: 1rem;">
      <button
        v-for="s in screens.filter((x) => x.role !== 'cta')"
        :key="'add-' + s.screenId"
        type="button"
        class="secondary"
        @click="addOption(s.screenId)"
      >
        给 {{ s.screenId }} 加选项
      </button>
      <button type="button" :disabled="editSession.pending" @click="saveGuide">保存 Guide</button>
    </div>

    <h3>关系图</h3>
    <div class="tabs">
      <button type="button" :class="{ active: graphMode === 'svg' }" @click="graphMode = 'svg'">SVG</button>
      <button type="button" :class="{ active: graphMode === 'css' }" @click="graphMode = 'css'">CSS</button>
    </div>

    <div v-if="graphMode === 'svg'" class="graph-wrap">
      <svg :width="graphLayout.width" :height="graphLayout.height">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#41545c" />
          </marker>
        </defs>
        <g v-for="(edge, idx) in graphLayout.edges" :key="'e' + idx">
          <line
            v-if="edge.fromPos && edge.toPos"
            :x1="edge.fromPos.x + graphLayout.nodeW / 2"
            :y1="edge.fromPos.y + graphLayout.nodeH"
            :x2="edge.toPos.x + graphLayout.nodeW / 2"
            :y2="edge.toPos.y"
            stroke="#41545c"
            stroke-width="1.5"
            marker-end="url(#arrow)"
          />
          <text
            v-if="edge.fromPos && edge.toPos"
            :x="(edge.fromPos.x + edge.toPos.x) / 2 + graphLayout.nodeW / 2"
            :y="(edge.fromPos.y + edge.toPos.y) / 2 + graphLayout.nodeH / 2"
            font-size="11"
            fill="#5b6b73"
          >
            {{ edge.label }}
          </text>
        </g>
        <g v-for="node in graphLayout.positions" :key="node.screen.screenId">
          <rect
            :x="node.x"
            :y="node.y"
            :width="graphLayout.nodeW"
            :height="graphLayout.nodeH"
            rx="10"
            :fill="node.screen.role === 'cta' ? '#d7efe6' : '#fff'"
            stroke="#0f6a5a"
          />
          <text :x="node.x + 12" :y="node.y + 24" font-size="12" font-weight="700">
            {{ node.screen.screenId }}
          </text>
          <text :x="node.x + 12" :y="node.y + 42" font-size="11" fill="#5b6b73">
            {{ node.screen.role }} · {{ node.screen.title.slice(0, 12) }}
          </text>
        </g>
      </svg>
    </div>

    <div v-else class="css-graph">
      <div
        v-for="node in graphLayout.positions"
        :key="'css-' + node.screen.screenId"
        class="css-node"
        :style="{ left: node.x + 'px', top: node.y + 'px' }"
      >
        <strong>{{ node.screen.screenId }}</strong>
        <span class="muted">{{ node.screen.role }}</span>
        <ul>
          <li v-for="opt in page.body.ads.guide.nodes[node.screen.screenId]?.options ?? []" :key="opt.id">
            {{ opt.label }} → {{ opt.action === 'go_cta' ? 'CTA' : opt.targetScreenId }}
          </li>
        </ul>
      </div>
    </div>
  </section>

  <section v-if="page" class="panel">
    <h2>预览</h2>
    <div class="tabs">
      <button type="button" :class="{ active: previewWidth === 'mobile' }" @click="previewWidth = 'mobile'">
        手机
      </button>
      <button type="button" :class="{ active: previewWidth === 'tablet' }" @click="previewWidth = 'tablet'">
        平板
      </button>
      <button type="button" :class="{ active: previewWidth === 'desktop' }" @click="previewWidth = 'desktop'">
        桌面
      </button>
      <button type="button" class="secondary" :disabled="editSession.pending" @click="preview">保存并预览</button>
    </div>
    <p v-if="previewUrl" class="muted">
      <a :href="previewUrl" target="_blank" rel="noopener">{{ previewUrl }}</a>
    </p>
    <p v-else class="muted">点击「保存并预览」后显示 iframe。</p>
    <div v-if="previewUrl" class="preview-frame" :style="{ width: widthPx + 'px', maxWidth: '100%' }">
      <iframe
        :src="previewUrl"
        title="page-preview"
        sandbox="allow-scripts allow-forms"
      />
    </div>
  </section>

  <section v-if="!page && !error" class="panel">
    <p class="muted">加载中…</p>
  </section>
  <section v-if="!page && error" class="panel">
    <p class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.css-graph {
  position: relative;
  min-height: 360px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #faf8f3;
  overflow: auto;
}
.css-node {
  position: absolute;
  width: 160px;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: #fff;
  font-size: 0.85rem;
}
.css-node ul {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
}
</style>
