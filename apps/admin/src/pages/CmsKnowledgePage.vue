<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { UploadFile, UploadRawFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api'
import {
  formatUploadBytes,
  uploadFolderInChunks,
  uploadZipInChunks,
  type UploadProgress,
} from '../knowledgeChunkUpload'
import { selectedSiteIdState, selectedDraftIdState } from '../workspaceSession'
import type { CmsSite } from '../cms-state'
import KnowledgeGraphCanvas from '../components/KnowledgeGraphCanvas.vue'

type Document = {
  documentId: string
  title: string
  content: string
  kind?: string
  sourcePath?: string | null
}
type ImportStats = {
  fileCount: number
  extracted: number
  skipped: number
  assetsRegistered: number
  fingerprintSkips: number
}
type ImportRecord = {
  importId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  sourceName: string
  stats: ImportStats
  error: string | null
}
type ReviewItem = {
  id: string
  kind: string
  status: 'open' | 'resolved'
  createdAt: string
  assetId?: string
  sourcePath?: string
  suggestedRole?: string
  confidence?: number
  reason?: string
}
type KnowledgeAsset = {
  assetId: string
  sourcePath: string
  role: string
  mime: string
  caption?: string
}
type GraphNode = {
  id: string
  label: string
  type: string
  path: string
  linkCount: number
}
type GraphEdge = {
  source: string
  target: string
  weight: number
}

const ASSET_ROLE_OPTIONS = [
  'logo',
  'partner_logo',
  'locale_icon',
  'product_image',
  'certificate',
  'background',
  'map_screenshot',
  'qr_code',
  'video_product',
  'document_scan',
  'other',
] as const

const documents = ref<Document[]>([])
const reviews = ref<ReviewItem[]>([])
const assets = ref<KnowledgeAsset[]>([])
const graphNodes = ref<GraphNode[]>([])
const graphEdges = ref<GraphEdge[]>([])
const assetRoleDrafts = ref<Record<string, string>>({})
const sites = ref<CmsSite[]>([])
const title = ref('')
const content = ref('')
const editing = ref('')
const targets = ref<string[]>([])
const copying = ref<Document | null>(null)
const deleting = ref<Document | null>(null)
const error = ref('')
const message = ref('')
const busy = ref(false)
const reviewBusyId = ref('')
const assetBusyId = ref('')
const importBusy = ref(false)
const importStatus = ref('')
const importProgress = ref<ImportRecord | null>(null)
const importSummary = ref('')
const uploadPercent = ref(0)
const folderInput = ref<HTMLInputElement | null>(null)
const addDialogOpen = ref(false)
const addTab = ref<'zip' | 'folder' | 'text'>('zip')
const mainTab = ref<'graph' | 'text' | 'media'>('graph')
const zipDragActive = ref(false)
let importPollTimer: ReturnType<typeof setTimeout> | null = null

const reviewCount = computed(() => reviews.value.length)

const base = () => `/api/sites/${selectedSiteIdState.value}/knowledge-base`
const documentsPath = () => `${base()}/documents`
const importsPath = () => `${base()}/imports`
const reviewsPath = () => `${base()}/reviews`
const assetsPath = () => `${base()}/assets`
const graphPath = () => `${base()}/graph`

function onChunkProgress(progress: UploadProgress): void {
  uploadPercent.value = progress.percent
  if (progress.phase === 'completing') {
    importStatus.value = '分片已传完，正在提交导入…'
    return
  }
  importStatus.value = `正在上传 ${formatUploadBytes(progress.bytesSent)} / ${formatUploadBytes(progress.totalBytes)}（${progress.percent}%）`
}

function stopImportPoll(): void {
  if (importPollTimer !== null) {
    clearTimeout(importPollTimer)
    importPollTimer = null
  }
}

function formatImportSummary(record: ImportRecord): string {
  const stats = record.stats
  const parts = [
    `共 ${stats.fileCount} 个文件`,
    `文字资料 ${stats.extracted} 条`,
    `素材 ${stats.assetsRegistered} 个`,
  ]
  if (stats.skipped > 0) {
    parts.push(`跳过 ${stats.skipped} 个不支持的类型`)
  }
  if (stats.fingerprintSkips > 0) {
    parts.push(`重复跳过 ${stats.fingerprintSkips} 个`)
  }
  return parts.join('；')
}

function kindLabel(kind: string | undefined): string {
  switch (kind) {
    case 'manual':
      return '手工资料'
    case 'imported_text':
      return '导入文字'
    case 'wiki_page':
      return 'Wiki 页'
    default:
      return kind || '资料'
  }
}

async function pollImport(importId: string): Promise<void> {
  const record = await api<{ import: ImportRecord }>('GET', `${importsPath()}/${importId}`)
  importProgress.value = record.import
  if (record.import.status === 'queued' || record.import.status === 'processing') {
    importStatus.value = record.import.status === 'queued' ? '等待处理…' : '正在导入资料…'
    importPollTimer = setTimeout(() => {
      void pollImport(importId)
    }, 400)
    return
  }
  stopImportPoll()
  importBusy.value = false
  uploadPercent.value = 0
  if (record.import.status === 'completed') {
    importSummary.value = formatImportSummary(record.import)
    importStatus.value = ''
    message.value = '资料包导入完成'
    addDialogOpen.value = false
    await load()
    return
  }
  importStatus.value = ''
  error.value = record.import.error ?? '资料包导入失败'
}

async function beginChunkedImport(run: () => Promise<string>): Promise<void> {
  if (importBusy.value || busy.value) return
  importBusy.value = true
  error.value = ''
  message.value = ''
  importSummary.value = ''
  importProgress.value = null
  uploadPercent.value = 0
  importStatus.value = '正在准备分片上传…'
  stopImportPoll()
  try {
    const importId = await run()
    importStatus.value = '等待处理…'
    await pollImport(importId)
  } catch (reason) {
    importBusy.value = false
    importStatus.value = ''
    uploadPercent.value = 0
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  }
}

async function onZipUpload(file: UploadFile): Promise<void> {
  if (!file.raw) return
  await ingestZipFile(file.raw)
}

async function ingestZipFile(file: File): Promise<void> {
  const siteId = selectedSiteIdState.value
  const draftId = selectedDraftIdState.value.trim() || undefined
  await beginChunkedImport(() =>
    uploadZipInChunks({
      siteId,
      draftId,
      file,
      onProgress: onChunkProgress,
    }),
  )
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
}

async function onFolderSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const fileList = input.files
  if (!fileList?.length) return
  const files = Array.from(fileList)
  input.value = ''
  const folderName = (files[0]?.webkitRelativePath || files[0]?.name || 'folder').split('/')[0] ?? 'folder'
  const siteId = selectedSiteIdState.value
  const draftId = selectedDraftIdState.value.trim() || undefined
  await beginChunkedImport(() =>
    uploadFolderInChunks({
      siteId,
      draftId,
      sourceName: folderName,
      files,
      onProgress: onChunkProgress,
    }),
  )
}

function openFolderPicker(): void {
  folderInput.value?.click()
}

function openAddDialog(tab: 'zip' | 'folder' | 'text' = 'zip'): void {
  addTab.value = tab
  addDialogOpen.value = true
  error.value = ''
  if (tab === 'text' && !editing.value) {
    title.value = ''
    content.value = ''
  }
}

function onZipDragOver(event: DragEvent): void {
  event.preventDefault()
  zipDragActive.value = true
}

function onZipDragLeave(): void {
  zipDragActive.value = false
}

async function onZipDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  zipDragActive.value = false
  if (importBusy.value || busy.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  if (!isZipFile(file)) {
    error.value = '请拖入 zip 压缩包'
    return
  }
  await ingestZipFile(file)
}

async function loadGraph(): Promise<void> {
  const graph = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>('GET', graphPath())
  graphNodes.value = graph.nodes
  graphEdges.value = graph.edges
}

async function loadReviewsAndAssets(): Promise<void> {
  const [reviewRes, assetRes] = await Promise.all([
    api<{ reviews: ReviewItem[] }>('GET', `${reviewsPath()}?status=open`),
    api<{ assets: KnowledgeAsset[] }>('GET', assetsPath()),
  ])
  reviews.value = reviewRes.reviews
  assets.value = assetRes.assets
  const drafts: Record<string, string> = {}
  for (const item of assetRes.assets) {
    drafts[item.assetId] = item.role
  }
  assetRoleDrafts.value = drafts
}

async function load(): Promise<void> {
  documents.value = (await api<{ documents: Document[] }>('GET', documentsPath())).documents
  await Promise.all([loadReviewsAndAssets(), loadGraph()])
}

async function resolveReview(review: ReviewItem): Promise<void> {
  if (reviewBusyId.value || busy.value || importBusy.value) return
  reviewBusyId.value = review.id
  error.value = ''
  message.value = ''
  try {
    await api('POST', `${reviewsPath()}/${review.id}/resolve`, {})
    message.value = '待审项已处理'
    await loadReviewsAndAssets()
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  } finally {
    reviewBusyId.value = ''
  }
}

async function saveAssetRole(asset: KnowledgeAsset): Promise<void> {
  if (assetBusyId.value || busy.value || importBusy.value) return
  const nextRole = assetRoleDrafts.value[asset.assetId]
  if (!nextRole || nextRole === asset.role) return
  assetBusyId.value = asset.assetId
  error.value = ''
  message.value = ''
  try {
    await api('PATCH', `${assetsPath()}/${asset.assetId}`, { role: nextRole })
    message.value = '素材角色已更新'
    await loadReviewsAndAssets()
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  } finally {
    assetBusyId.value = ''
  }
}

onMounted(async () => {
  try {
    await load()
    sites.value = (await api<{ sites: CmsSite[] }>('GET', '/api/sites')).sites.filter(
      (site) => site.siteId !== selectedSiteIdState.value,
    )
  } catch (reason) {
    error.value = (reason as Error).message
  }
})

function edit(document: Document): void {
  editing.value = document.documentId
  title.value = document.title
  content.value = document.content
  addTab.value = 'text'
  addDialogOpen.value = true
}
function clear(): void {
  editing.value = ''
  title.value = ''
  content.value = ''
}
async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await api(editing.value ? 'PUT' : 'POST', editing.value ? `${documentsPath()}/${editing.value}` : documentsPath(), {
      title: title.value,
      content: content.value,
    })
    clear()
    addDialogOpen.value = false
    await load()
    message.value = '资料已保存'
  } catch (reason) {
    error.value = (reason as Error).message
  } finally {
    busy.value = false
  }
}
async function remove(): Promise<void> {
  if (!deleting.value) return
  try {
    await api('DELETE', `${documentsPath()}/${deleting.value.documentId}`)
    deleting.value = null
    await load()
  } catch (reason) {
    error.value = (reason as Error).message
  }
}
async function copy(): Promise<void> {
  if (!copying.value || !targets.value.length) return
  try {
    await api('POST', `${documentsPath()}/${copying.value.documentId}/copy`, { targetSiteIds: targets.value })
    copying.value = null
    targets.value = []
    message.value = '资料已复制到所选网站'
  } catch (reason) {
    error.value = (reason as Error).message
  }
}
function closeCopy(): void {
  copying.value = null
  targets.value = []
}
function closeDelete(): void {
  deleting.value = null
}
function onCopyVisible(open: boolean): void {
  if (!open) closeCopy()
}
function onDeleteVisible(open: boolean): void {
  if (!open) closeDelete()
}
function onAddDialogVisible(open: boolean): void {
  addDialogOpen.value = open
  if (!open && !busy.value) {
    clear()
  }
}
function onZipChange(uploadFile: UploadFile): void {
  void onZipUpload(uploadFile)
}
function beforeZipUpload(file: UploadRawFile): boolean {
  if (!isZipFile(file)) {
    error.value = '请选择 zip 压缩包'
    return false
  }
  return true
}
</script>
<template>
  <section class="knowledge-page">
    <header class="page-header">
      <el-button
        type="primary"
        :icon="Plus"
        data-testid="knowledge-add-button"
        :disabled="importBusy || busy"
        @click="openAddDialog('zip')"
      >
        添加
      </el-button>
      <div class="page-heading">
        <h1>网站资料</h1>
        <p>添加公司介绍、产品资料和常见问题，供 AI 生成网站内容时使用。</p>
      </div>
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-alert
      v-if="importSummary"
      :title="importSummary"
      type="info"
      show-icon
      :closable="false"
      class="page-alert"
      data-testid="knowledge-import-summary"
    />

    <div class="knowledge-body">
      <div class="main-pane">
        <el-tabs v-model="mainTab" data-testid="knowledge-main-tabs">
          <el-tab-pane label="关系图" name="graph">
            <KnowledgeGraphCanvas v-if="graphNodes.length" :nodes="graphNodes" :edges="graphEdges" />
            <el-empty v-else description="暂无图谱节点，请先导入或添加资料。" :image-size="72" />
          </el-tab-pane>
          <el-tab-pane label="文字资料" name="text">
            <el-table :data="documents" stripe data-testid="knowledge-text-table" empty-text="尚未添加文字资料。">
              <el-table-column prop="title" label="标题" min-width="160" />
              <el-table-column label="类型" width="110">
                <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
              </el-table-column>
              <el-table-column label="来源路径" min-width="180">
                <template #default="{ row }">{{ row.sourcePath || '—' }}</template>
              </el-table-column>
              <el-table-column label="摘要" min-width="220">
                <template #default="{ row }">{{ row.content.slice(0, 120) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="260" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="edit(row)">编辑</el-button>
                  <el-button link @click="copying = row">复制</el-button>
                  <el-button link type="danger" @click="deleting = row">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="媒体资料" name="media">
            <el-table :data="assets" stripe data-testid="knowledge-media-table" empty-text="尚未登记媒体资料。">
              <el-table-column prop="sourcePath" label="路径" min-width="220" />
              <el-table-column prop="mime" label="类型" width="140" />
              <el-table-column label="角色" width="200">
                <template #default="{ row }">
                  <el-select
                    v-model="assetRoleDrafts[row.assetId]"
                    :disabled="busy || importBusy || assetBusyId === row.assetId"
                    data-testid="knowledge-asset-role-select"
                  >
                    <el-option v-for="role in ASSET_ROLE_OPTIONS" :key="role" :label="role" :value="role" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="说明" min-width="160">
                <template #default="{ row }">{{ row.caption || '—' }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button
                    type="primary"
                    link
                    :loading="assetBusyId === row.assetId"
                    :disabled="busy || importBusy || assetRoleDrafts[row.assetId] === row.role"
                    data-testid="knowledge-asset-role-save"
                    @click="saveAssetRole(row)"
                  >
                    保存角色
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>

      <aside class="review-pane" data-testid="knowledge-reviews-panel">
        <header class="review-header">
          <h2>待审事项</h2>
          <el-badge :value="reviewCount" :hidden="reviewCount === 0" type="warning" data-testid="knowledge-review-badge">
            <span class="badge-anchor" />
          </el-badge>
        </header>
        <article v-for="review in reviews" :key="review.id" class="review-item">
          <h3>{{ review.kind }}</h3>
          <p v-if="review.sourcePath">路径：{{ review.sourcePath }}</p>
          <p v-if="review.suggestedRole">建议角色：{{ review.suggestedRole }}</p>
          <p v-if="review.confidence !== undefined">置信度：{{ review.confidence }}</p>
          <p v-if="review.reason">原因：{{ review.reason }}</p>
          <el-button
            type="primary"
            size="small"
            :loading="reviewBusyId === review.id"
            :disabled="busy || importBusy"
            data-testid="knowledge-review-resolve"
            @click="resolveReview(review)"
          >
            标记已处理
          </el-button>
        </article>
        <el-empty v-if="!reviews.length" description="当前没有待审事项。" :image-size="56" />
      </aside>
    </div>

    <el-dialog
      :model-value="addDialogOpen"
      title="添加资料"
      width="640px"
      data-testid="knowledge-add-dialog"
      @update:model-value="onAddDialogVisible"
    >
      <el-tabs v-model="addTab">
        <el-tab-pane label="zip 上传" name="zip">
          <div
            class="zip-dropzone"
            :class="{ active: zipDragActive }"
            data-testid="knowledge-zip-dropzone"
            @dragenter="onZipDragOver"
            @dragover="onZipDragOver"
            @dragleave="onZipDragLeave"
            @drop="onZipDrop"
          >
            <p>拖拽 zip 到此处，或点击下方按钮选择文件。大文件自动分片上传，中断后可续传。</p>
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              accept=".zip,application/zip"
              :disabled="importBusy || busy"
              :before-upload="beforeZipUpload"
              data-testid="knowledge-zip-upload"
              @change="onZipChange"
            >
              <el-button type="primary" :loading="importBusy" :disabled="busy">选择 zip 文件</el-button>
            </el-upload>
          </div>
        </el-tab-pane>
        <el-tab-pane label="文件夹上传" name="folder">
          <p class="import-hint">选择本地文件夹，按文件分片上传并可续传。单次合计默认不超过 16GB，单文件默认不超过 2GB。</p>
          <el-button
            type="primary"
            :disabled="importBusy || busy"
            data-testid="knowledge-folder-upload"
            @click="openFolderPicker"
          >
            选择文件夹
          </el-button>
          <input
            ref="folderInput"
            type="file"
            class="folder-input"
            webkitdirectory
            multiple
            @change="onFolderSelected"
          >
        </el-tab-pane>
        <el-tab-pane :label="editing ? '编辑文字资料' : '添加文字资料'" name="text">
          <el-form label-position="top" @submit.prevent="save">
            <el-form-item label="资料标题" required>
              <el-input v-model="title" required data-testid="knowledge-text-title" />
            </el-form-item>
            <el-form-item label="资料正文" required>
              <el-input v-model="content" type="textarea" :rows="10" required data-testid="knowledge-text-content" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="busy" native-type="submit">{{ busy ? '正在保存…' : '保存资料' }}</el-button>
              <el-button v-if="editing" @click="clear">取消编辑</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <p v-if="importStatus" class="import-status" data-testid="knowledge-import-status">{{ importStatus }}</p>
      <el-progress
        v-if="importBusy && uploadPercent > 0 && uploadPercent < 100"
        :percentage="uploadPercent"
        data-testid="knowledge-upload-progress"
      />
      <dl v-if="importProgress && importProgress.status !== 'completed'" class="import-stats">
        <dt>状态</dt>
        <dd>{{ importProgress.status === 'queued' ? '排队中' : '处理中' }}</dd>
        <template v-if="importProgress.stats.fileCount">
          <dt>文件数</dt>
          <dd>{{ importProgress.stats.fileCount }}</dd>
        </template>
      </dl>
    </el-dialog>

    <el-dialog :model-value="!!copying" title="复制资料" width="480px" @update:model-value="onCopyVisible">
      <p>每个目标网站会保存独立资料，后续可分别编辑。</p>
      <el-checkbox-group v-model="targets" class="site-targets">
        <el-checkbox v-for="site in sites" :key="site.siteId" :value="site.siteId">{{ site.name }}</el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!sites.length" description="没有其他可管理的网站。" :image-size="64" />
      <template #footer>
        <el-button type="primary" :disabled="!targets.length" @click="copy">确认复制</el-button>
        <el-button @click="closeCopy">取消</el-button>
      </template>
    </el-dialog>
    <el-dialog :model-value="!!deleting" title="删除资料确认" width="420px" @update:model-value="onDeleteVisible">
      <p>确认删除「{{ deleting?.title }}」？</p>
      <template #footer>
        <el-button type="danger" @click="remove">确认删除</el-button>
        <el-button @click="closeDelete">取消</el-button>
      </template>
    </el-dialog>
  </section>
</template>
<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}
.page-heading h1 {
  margin: 0 0 4px;
}
.page-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.page-alert {
  margin-bottom: 12px;
}
.knowledge-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
  align-items: start;
}
.main-pane {
  min-width: 0;
}
.review-pane {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--el-bg-color);
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 120px);
  overflow: auto;
}
.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.review-header h2 {
  margin: 0;
  font-size: 16px;
}
.badge-anchor {
  display: inline-block;
  width: 8px;
  height: 8px;
}
.review-item {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 12px;
}
.review-item:last-child {
  border-bottom: 0;
  margin-bottom: 0;
}
.review-item h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
.review-item p {
  margin: 0 0 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.zip-dropzone {
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  padding: 24px 16px;
  text-align: center;
  background: var(--el-fill-color-blank);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.zip-dropzone.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.import-hint {
  margin-top: 0;
  color: var(--el-text-color-secondary);
}
.folder-input {
  display: none;
}
.import-status {
  margin: 12px 0 0;
  color: var(--el-color-primary);
}
.import-stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 12px 0 0;
  font-size: 14px;
}
.site-targets {
  display: grid;
  gap: 8px;
}
@media (max-width: 960px) {
  .knowledge-body {
    grid-template-columns: 1fr;
  }
  .review-pane {
    position: static;
    max-height: none;
  }
}
</style>
