<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import { requireSelectedDraftId } from '../draft'
import { pageDraftMismatchMessage } from '../pageDraftGuard'
import {
  draftPageDetailApiPath,
  draftPageGuideApiPath,
  draftPagePreviewApiPath,
} from '../pagePaths'
import { selectedDraftIdState } from '../workspaceSession'
import type { GuideOption, PageRecord, Screen } from '../types'

type PreviewWidth = 'mobile' | 'tablet' | 'desktop'

const route = useRoute()
const page = ref<PageRecord | null>(null)
const error = ref('')
const message = ref('')
const previewUrl = ref('')
const previewWidth = ref<PreviewWidth>('desktop')
const selectedScreenId = ref('')
const graphMode = ref<'svg' | 'css'>('svg')

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
  error.value = ''
  message.value = ''
  const selectedDraftId = requireSelectedDraftId()
  const draftId = routeDraftId()
  const pageId = routePageId()
  const mismatch = pageDraftMismatchMessage(selectedDraftId, draftId)
  if (mismatch) {
    page.value = null
    error.value = mismatch
    return
  }
  const data = await api<{ page: PageRecord }>(
    'GET',
    draftPageDetailApiPath(draftId, pageId),
  )
  page.value = data.page
  if (data.page.body.ads?.screens?.length) {
    selectedScreenId.value = data.page.body.ads.screens[0]!.screenId
  }
}

onMounted(async () => {
  try {
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch(
  () => [route.params.draftId, route.params.pageId],
  async () => {
    try {
      await load()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  },
)

watch(selectedDraftIdState, async () => {
  try {
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function saveMetaAndBody() {
  if (!page.value) return
  error.value = ''
  message.value = ''
  try {
    const patch: Record<string, unknown> = {
      title: page.value.title,
      seo: page.value.seo,
      body: page.value.body,
    }
    const data = await api<{ page: PageRecord }>(
      'PATCH',
      draftPageDetailApiPath(routeDraftId(), page.value.pageId),
      patch,
    )
    page.value = data.page
    message.value = '已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveGuide() {
  if (!page.value?.body.ads) return
  error.value = ''
  message.value = ''
  try {
    const data = await api<{ page: PageRecord }>(
      'PATCH',
      draftPageGuideApiPath(routeDraftId(), page.value.pageId),
      {
        guide: page.value.body.ads.guide,
      },
    )
    page.value = data.page
    message.value = 'Guide 已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function preview() {
  if (!page.value) return
  error.value = ''
  try {
    const data = await api<{ previewUrl: string }>(
      'POST',
      draftPagePreviewApiPath(routeDraftId(), page.value.pageId),
    )
    previewUrl.value = data.previewUrl
    message.value = '预览已更新'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
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
      <span class="badge" :class="page.status">{{ page.status === 'published' ? '已发布' : '草稿' }}</span>
      · {{ page.slug }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <h2>SEO</h2>
    <label>标题 <input v-model="page.title" /></label>
    <label>SEO title <input v-model="page.seo.title" /></label>
    <label>SEO description <textarea v-model="page.seo.description" rows="2" /></label>

    <template v-if="page.kind !== 'ads'">
      <h2>HTML 正文</h2>
      <label>
        body.html
        <textarea v-model="page.body.html" rows="14" style="font-family: ui-monospace, monospace;" />
      </label>
    </template>

    <div class="row">
      <button type="button" @click="saveMetaAndBody">保存</button>
      <button type="button" class="secondary" @click="preview">写预览</button>
      <RouterLink class="btn" to="/publish">前往 Push 发布</RouterLink>
    </div>
    <p class="muted">线上发布通过当前草稿整体 Push 完成，不提供单页发布接口。</p>
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
    <button type="button" class="secondary" @click="saveMetaAndBody">保存屏内容</button>
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
      <button type="button" @click="saveGuide">保存 Guide</button>
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
      <button type="button" class="secondary" @click="preview">刷新预览</button>
    </div>
    <p v-if="previewUrl" class="muted">
      <a :href="previewUrl" target="_blank" rel="noopener">{{ previewUrl }}</a>
    </p>
    <p v-else class="muted">点击「写预览」或「刷新预览」后显示 iframe。</p>
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
