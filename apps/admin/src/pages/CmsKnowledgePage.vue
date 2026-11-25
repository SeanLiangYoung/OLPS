<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { UploadFile } from 'element-plus'
import { api, ApiError } from '../api'
import { selectedSiteIdState, selectedDraftIdState } from '../workspaceSession'
import type { CmsSite } from '../cms-state'

type Document = { documentId: string; title: string; content: string }
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
const folderInput = ref<HTMLInputElement | null>(null)
let importPollTimer: ReturnType<typeof setTimeout> | null = null

const base = () => `/api/sites/${selectedSiteIdState.value}/knowledge-base`
const documentsPath = () => `${base()}/documents`
const importsPath = () => `${base()}/imports`
const reviewsPath = () => `${base()}/reviews`
const assetsPath = () => `${base()}/assets`

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
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
  if (record.import.status === 'completed') {
    importSummary.value = formatImportSummary(record.import)
    importStatus.value = ''
    message.value = '资料包导入完成'
    await load()
    return
  }
  importStatus.value = ''
  error.value = record.import.error ?? '资料包导入失败'
}

async function startImport(body: Record<string, unknown>): Promise<void> {
  if (importBusy.value || busy.value) return
  importBusy.value = true
  error.value = ''
  message.value = ''
  importSummary.value = ''
  importProgress.value = null
  importStatus.value = '正在提交资料包…'
  stopImportPoll()
  const draftId = selectedDraftIdState.value.trim()
  if (draftId) {
    body.draftId = draftId
  }
  try {
    const created = await api<{ importId: string }>('POST', importsPath(), body)
    importStatus.value = '等待处理…'
    await pollImport(created.importId)
  } catch (reason) {
    importBusy.value = false
    importStatus.value = ''
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  }
}

async function onZipUpload(file: UploadFile): Promise<void> {
  if (!file.raw) return
  const zipBase64 = await fileToBase64(file.raw)
  await startImport({ sourceName: file.name, zipBase64 })
}

async function onFolderSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const fileList = input.files
  if (!fileList?.length) return
  const files: Array<{ relativePath: string; contentBase64: string }> = []
  for (const file of fileList) {
    const relative = file.webkitRelativePath || file.name
    files.push({
      relativePath: relative,
      contentBase64: await fileToBase64(file),
    })
  }
  input.value = ''
  const folderName = files[0]?.relativePath.split('/')[0] ?? 'folder'
  await startImport({ sourceName: folderName, files })
}

function openFolderPicker(): void {
  folderInput.value?.click()
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
  await loadReviewsAndAssets()
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
</script>
<template>
  <section>
    <h1>网站资料</h1>
    <p>添加公司介绍、产品资料和常见问题，供 AI 生成网站内容时使用。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
  <el-card shadow="never" class="import-card">
      <template #header><span>导入资料包</span></template>
      <p class="import-hint">可上传 zip 压缩包，或选择本地文件夹（保留子目录结构）。单次合计默认不超过 100MB。</p>
      <div class="import-actions">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".zip,application/zip"
          :disabled="importBusy || busy"
          data-testid="knowledge-zip-upload"
          @change="(uploadFile: UploadFile) => void onZipUpload(uploadFile)"
        >
          <el-button type="primary" :loading="importBusy" :disabled="busy">选择 zip 文件</el-button>
        </el-upload>
        <el-button :disabled="importBusy || busy" data-testid="knowledge-folder-upload" @click="openFolderPicker">
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
      </div>
      <p v-if="importStatus" class="import-status" data-testid="knowledge-import-status">{{ importStatus }}</p>
      <el-alert
        v-if="importSummary"
        :title="importSummary"
        type="info"
        show-icon
        :closable="false"
        class="page-alert"
        data-testid="knowledge-import-summary"
      />
      <dl v-if="importProgress && importProgress.status !== 'completed'" class="import-stats">
        <dt>状态</dt>
        <dd>{{ importProgress.status === 'queued' ? '排队中' : '处理中' }}</dd>
        <template v-if="importProgress.stats.fileCount">
          <dt>文件数</dt>
          <dd>{{ importProgress.stats.fileCount }}</dd>
        </template>
      </dl>
    </el-card>
    <el-card shadow="never" class="review-card" data-testid="knowledge-reviews-panel">
      <template #header><span>待审事项</span></template>
      <article v-for="review in reviews" :key="review.id" class="review-item">
        <h3>{{ review.kind }}</h3>
        <p v-if="review.sourcePath">路径：{{ review.sourcePath }}</p>
        <p v-if="review.suggestedRole">建议角色：{{ review.suggestedRole }}</p>
        <p v-if="review.confidence !== undefined">置信度：{{ review.confidence }}</p>
        <p v-if="review.reason">原因：{{ review.reason }}</p>
        <el-button
          type="primary"
          :loading="reviewBusyId === review.id"
          :disabled="busy || importBusy"
          data-testid="knowledge-review-resolve"
          @click="resolveReview(review)"
        >
          标记已处理
        </el-button>
      </article>
      <el-empty v-if="!reviews.length" description="当前没有待审事项。" :image-size="64" />
    </el-card>
    <el-card shadow="never" class="assets-card" data-testid="knowledge-assets-panel">
      <template #header><span>素材角色</span></template>
      <article v-for="asset in assets" :key="asset.assetId" class="asset-item">
        <h3>{{ asset.sourcePath }}</h3>
        <p>当前角色：{{ asset.role }}</p>
        <div class="asset-role-row">
          <el-select
            v-model="assetRoleDrafts[asset.assetId]"
            :disabled="busy || importBusy || assetBusyId === asset.assetId"
            data-testid="knowledge-asset-role-select"
          >
            <el-option v-for="role in ASSET_ROLE_OPTIONS" :key="role" :label="role" :value="role" />
          </el-select>
          <el-button
            type="primary"
            :loading="assetBusyId === asset.assetId"
            :disabled="busy || importBusy || assetRoleDrafts[asset.assetId] === asset.role"
            data-testid="knowledge-asset-role-save"
            @click="saveAssetRole(asset)"
          >
            保存角色
          </el-button>
        </div>
      </article>
      <el-empty v-if="!assets.length" description="尚未登记素材。" :image-size="64" />
    </el-card>
    <div class="cms-knowledge-layout">
      <el-card shadow="never">
        <template #header><span>{{ editing ? '编辑资料' : '添加资料' }}</span></template>
        <el-form label-position="top" @submit.prevent="save">
          <el-form-item label="资料标题" required>
            <el-input v-model="title" required />
          </el-form-item>
          <el-form-item label="资料正文" required>
            <el-input v-model="content" type="textarea" :rows="14" required />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="busy" native-type="submit">{{ busy ? '正在保存…' : '保存资料' }}</el-button>
            <el-button v-if="editing" @click="clear">取消编辑</el-button>
          </el-form-item>
        </el-form>
      </el-card>
      <el-card shadow="never">
        <template #header><span>已有资料</span></template>
        <article v-for="document in documents" :key="document.documentId" class="document-item">
          <h3>{{ document.title }}</h3>
          <p>{{ document.content.slice(0,180) }}</p>
          <div class="row">
            <el-button @click="edit(document)">编辑</el-button>
            <el-button @click="copying = document">复制到其他网站</el-button>
            <el-button type="danger" plain @click="deleting = document">删除</el-button>
          </div>
        </article>
        <el-empty v-if="!documents.length" description="尚未添加资料。" :image-size="72" />
      </el-card>
    </div>
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
.page-alert { margin-bottom: 12px; }
.import-card { margin-bottom: 24px; }
.review-card, .assets-card { margin-bottom: 24px; }
.import-hint { margin-top: 0; color: var(--el-text-color-secondary); }
.import-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.folder-input { display: none; }
.import-status { margin: 12px 0 0; color: var(--el-color-primary); }
.import-stats { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 12px 0 0; font-size: 14px; }
.cms-knowledge-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.review-item, .asset-item { padding-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 12px; }
.review-item:last-child, .asset-item:last-child { border-bottom: 0; margin-bottom: 0; }
.review-item h3, .asset-item h3 { margin-top: 0; }
.asset-role-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.document-item { padding-bottom: 20px; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 16px; }
.document-item:last-child { border-bottom: 0; margin-bottom: 0; }
.document-item h3 { margin-top: 0; }
.site-targets { display: grid; gap: 8px; }
@media (max-width: 800px) { .cms-knowledge-layout { grid-template-columns: 1fr; } }
</style>