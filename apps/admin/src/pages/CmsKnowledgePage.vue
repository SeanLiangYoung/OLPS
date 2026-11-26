<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { UploadFile, UploadRawFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api, ApiError, getAccessToken } from '../api'
import {
  formatUploadBytes,
  uploadFolderInChunks,
  uploadZipInChunks,
  type UploadProgress,
} from '../knowledgeChunkUpload'
import { renderKnowledgeDocumentMarkdown } from '../renderKnowledgeDocumentMarkdown'
import { selectedSiteIdState, selectedDraftIdState } from '../workspaceSession'
import type { CmsSite } from '../cms-state'
import KnowledgeGraphCanvas from '../components/KnowledgeGraphCanvas.vue'

const LIST_PAGE_SIZE = 20

type Document = {
  documentId: string
  title: string
  content: string
  kind?: string
  sourcePath?: string | null
}
type ImportItemStatus =
  | 'pending'
  | 'extracting'
  | 'analyzing'
  | 'writing'
  | 'succeeded'
  | 'failed'
  | 'skipped_duplicate'
  | 'skipped_unsupported'
type ImportItem = {
  sourcePath: string
  status: ImportItemStatus
  fingerprint: string | null
  kind: string | null
  wikiPath: string | null
  aliasOfWikiPath: string | null
  error: string | null
}
type ImportStats = {
  fileCount: number
  extracted: number
  skipped: number
  assetsRegistered: number
  fingerprintSkips: number
  itemSucceeded?: number
  itemFailed?: number
  itemSkippedDuplicate?: number
  itemSkippedUnsupported?: number
}
type ImportRecord = {
  importId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  sourceName: string
  stats: ImportStats
  items?: ImportItem[]
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
const graphLoading = ref(true)
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
const reviewDialogOpen = ref(false)
const addTab = ref<'zip' | 'folder' | 'text'>('zip')
const mainTab = ref<'graph' | 'text' | 'media'>('graph')
const zipDragActive = ref(false)
const retryBusyPath = ref('')
const progressCardDismissed = ref(false)
const textPage = ref(1)
const mediaPage = ref(1)
const documentsTotal = ref(0)
const assetsTotal = ref(0)
const documentsLoading = ref(false)
const assetsLoading = ref(false)
const documentDrawerOpen = ref(false)
const viewingDocument = ref<Document | null>(null)
const assetDrawerOpen = ref(false)
const viewingAsset = ref<KnowledgeAsset | null>(null)
const assetPreviewUrl = ref('')
const assetPreviewLoading = ref(false)
const assetPreviewError = ref('')
let importPollTimer: ReturnType<typeof setTimeout> | null = null
/** 导入过程中最近一次按页签刷新所对应的已完成条目数 */
let liveTabRefreshDoneCount = -1
let liveTabRefreshInFlight = false
let liveTabRefreshQueued = false
/** 切换页码时跳过 watch，避免与主动加载重复请求 */
let skipTextPageWatch = false
let skipMediaPageWatch = false

const ACTIVE_IMPORT_STORAGE_PREFIX = 'olps-knowledge-active-import:'

const reviewCount = computed(() => reviews.value.length)
const documentHtml = computed(() => {
  const doc = viewingDocument.value
  if (!doc) return ''
  return renderKnowledgeDocumentMarkdown(doc.content || '')
})
const importItems = computed(() => importProgress.value?.items ?? [])
const failedImportItems = computed(() => importItems.value.filter((item) => item.status === 'failed'))
const importItemDoneCount = computed(
  () =>
    importItems.value.filter((item) =>
      ['succeeded', 'failed', 'skipped_duplicate', 'skipped_unsupported'].includes(item.status),
    ).length,
)
const importInFlight = computed(() => {
  const status = importProgress.value?.status
  return importBusy.value || status === 'queued' || status === 'processing'
})
const showImportProgressCard = computed(() => {
  if (progressCardDismissed.value) return false
  if (importInFlight.value) return true
  if (uploadPercent.value > 0 && uploadPercent.value < 100) return true
  if (failedImportItems.value.length > 0) return true
  if (importStatus.value) return true
  return false
})
const importProgressPercent = computed(() => {
  if (importBusy.value && uploadPercent.value > 0 && uploadPercent.value < 100) {
    return uploadPercent.value
  }
  const total = importItems.value.length
  if (total > 0) {
    return Math.min(100, Math.round((importItemDoneCount.value / total) * 100))
  }
  if (importProgress.value?.status === 'completed') return 100
  if (importProgress.value?.status === 'failed') return 100
  if (importProgress.value?.status === 'processing') return 8
  if (importProgress.value?.status === 'queued') return 2
  if (importBusy.value) return Math.max(uploadPercent.value, 1)
  return 0
})
const importProgressDescription = computed(() => {
  if (importStatus.value) return importStatus.value
  const record = importProgress.value
  if (!record) return '正在准备导入…'
  if (record.status === 'queued') return '资料已提交，等待处理…'
  if (record.status === 'processing') {
    const total = importItems.value.length
    if (total > 0) {
      return `正在处理资料（${importItemDoneCount.value}/${total}）`
    }
    return '正在导入资料…'
  }
  if (record.status === 'completed') {
    if (failedImportItems.value.length > 0) {
      return `导入完成，${failedImportItems.value.length} 个失败，可单独重试`
    }
    return importSummary.value || '资料包导入完成'
  }
  if (record.status === 'failed') {
    return record.error ?? '资料包导入失败'
  }
  return '资料导入进行中'
})

function activeImportStorageKey(siteId: string): string {
  return `${ACTIVE_IMPORT_STORAGE_PREFIX}${siteId}`
}

function rememberActiveImport(importId: string): void {
  const siteId = selectedSiteIdState.value
  if (!siteId) return
  sessionStorage.setItem(activeImportStorageKey(siteId), importId)
}

function clearActiveImport(siteId = selectedSiteIdState.value): void {
  if (!siteId) return
  sessionStorage.removeItem(activeImportStorageKey(siteId))
}

function readRememberedImportId(siteId = selectedSiteIdState.value): string | null {
  if (!siteId) return null
  return sessionStorage.getItem(activeImportStorageKey(siteId))
}

function dismissImportProgressCard(): void {
  progressCardDismissed.value = true
}

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
    parts.push(`内容未变跳过 ${stats.fingerprintSkips} 个`)
  }
  if ((stats.itemSkippedDuplicate ?? 0) > 0) {
    parts.push(`重复内容指向 ${stats.itemSkippedDuplicate} 个`)
  }
  if ((stats.itemFailed ?? 0) > 0) {
    parts.push(`失败 ${stats.itemFailed} 个`)
  }
  if ((stats.itemSucceeded ?? 0) > 0) {
    parts.push(`成功 ${stats.itemSucceeded} 个`)
  }
  return parts.join('；')
}

function importItemStatusLabel(status: ImportItemStatus): string {
  switch (status) {
    case 'pending':
      return '等待中'
    case 'extracting':
      return '抽取中'
    case 'analyzing':
      return 'AI 解析中'
    case 'writing':
      return '写入中'
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'skipped_duplicate':
      return '重复跳过'
    case 'skipped_unsupported':
      return '类型不支持'
    default:
      return status
  }
}

function shortSourcePath(sourcePath: string): string {
  return sourcePath.replace(/^raw\/sources\//, '')
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

function isMarkdownDocument(document: Document): boolean {
  if (document.kind === 'wiki_page') return true
  return (document.sourcePath ?? '').toLowerCase().endsWith('.md')
}

function isPreviewableAsset(asset: KnowledgeAsset): boolean {
  return asset.mime.startsWith('image/') || asset.mime.startsWith('video/')
}

function openDocumentDrawer(document: Document): void {
  if (!isMarkdownDocument(document)) return
  viewingDocument.value = document
  documentDrawerOpen.value = true
}

function onDocumentDrawerClosed(): void {
  viewingDocument.value = null
}

function revokeAssetPreview(): void {
  if (assetPreviewUrl.value) {
    URL.revokeObjectURL(assetPreviewUrl.value)
    assetPreviewUrl.value = ''
  }
}

async function openAssetDrawer(asset: KnowledgeAsset): Promise<void> {
  if (!isPreviewableAsset(asset)) return
  const requestId = asset.assetId
  viewingAsset.value = asset
  assetDrawerOpen.value = true
  assetPreviewError.value = ''
  revokeAssetPreview()
  assetPreviewLoading.value = true
  try {
    const token = getAccessToken()
    if (!token) throw new Error('尚未登录')
    const response = await fetch(`${assetsPath()}/${encodeURIComponent(asset.assetId)}/file`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text.slice(0, 200) || `HTTP ${response.status}`)
    }
    const blob = await response.blob()
    if (!assetDrawerOpen.value || viewingAsset.value?.assetId !== requestId) {
      return
    }
    assetPreviewUrl.value = URL.createObjectURL(blob)
  } catch (reason) {
    if (!assetDrawerOpen.value || viewingAsset.value?.assetId !== requestId) return
    assetPreviewError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (viewingAsset.value?.assetId === requestId) {
      assetPreviewLoading.value = false
    }
  }
}

function onAssetDrawerClosed(): void {
  viewingAsset.value = null
  assetPreviewError.value = ''
  assetPreviewLoading.value = false
  revokeAssetPreview()
}

async function pollImport(importId: string): Promise<void> {
  rememberActiveImport(importId)
  const record = await api<{ import: ImportRecord }>('GET', `${importsPath()}/${importId}`)
  importProgress.value = record.import
  if (record.import.status === 'queued' || record.import.status === 'processing') {
    importBusy.value = true
    const done = importItemDoneCount.value
    const total = importItems.value.length
    if (total > 0) {
      importStatus.value =
        record.import.status === 'queued'
          ? `等待处理…（0/${total}）`
          : `正在导入资料…（${done}/${total}）`
    } else {
      importStatus.value = record.import.status === 'queued' ? '等待处理…' : '正在导入资料…'
    }
    if (done !== liveTabRefreshDoneCount) {
      liveTabRefreshDoneCount = done
      void refreshActiveMainTabDuringImport()
    }
    importPollTimer = setTimeout(() => {
      void pollImport(importId)
    }, 400)
    return
  }
  stopImportPoll()
  importBusy.value = false
  uploadPercent.value = 0
  liveTabRefreshDoneCount = -1
  importSummary.value = formatImportSummary(record.import)
  importStatus.value = ''
  if (record.import.status === 'completed') {
    const failedCount = record.import.stats.itemFailed ?? 0
    if (failedCount > 0) {
      message.value = `资料包导入完成，其中 ${failedCount} 个失败，可单独重试`
      error.value = record.import.error ?? ''
    } else {
      message.value = '资料包导入完成'
      error.value = ''
      addDialogOpen.value = false
      clearActiveImport()
    }
    await load()
    return
  }
  error.value = record.import.error ?? '资料包导入失败'
}

async function retryFailedItems(sourcePaths?: string[]): Promise<void> {
  const current = importProgress.value
  if (!current || importBusy.value) return
  retryBusyPath.value = sourcePaths?.length === 1 ? sourcePaths[0]! : '__all__'
  error.value = ''
  message.value = ''
  progressCardDismissed.value = false
  importBusy.value = true
  liveTabRefreshDoneCount = -1
  importStatus.value = '正在重试失败资料…'
  try {
    const result = await api<{ importId: string; status: string }>('POST', `${importsPath()}/${current.importId}/retry`, {
      sourcePaths,
    })
    rememberActiveImport(result.importId)
    await pollImport(result.importId)
  } catch (reason) {
    importBusy.value = false
    importStatus.value = ''
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  } finally {
    retryBusyPath.value = ''
  }
}

async function beginChunkedImport(run: () => Promise<string>): Promise<void> {
  if (importBusy.value || busy.value) return
  importBusy.value = true
  progressCardDismissed.value = false
  error.value = ''
  message.value = ''
  importSummary.value = ''
  importProgress.value = null
  uploadPercent.value = 0
  liveTabRefreshDoneCount = -1
  importStatus.value = '正在准备分片上传…'
  stopImportPoll()
  try {
    const importId = await run()
    rememberActiveImport(importId)
    importStatus.value = '等待处理…'
    await pollImport(importId)
  } catch (reason) {
    importBusy.value = false
    importStatus.value = ''
    uploadPercent.value = 0
    clearActiveImport()
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  }
}

async function resumeRememberedImport(): Promise<void> {
  const importId = readRememberedImportId()
  if (!importId) return
  try {
    progressCardDismissed.value = false
    await pollImport(importId)
  } catch (reason) {
    clearActiveImport()
    if (reason instanceof ApiError && reason.status === 404) {
      return
    }
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
  graphLoading.value = true
  try {
    const graph = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>('GET', graphPath())
    graphNodes.value = graph.nodes
    graphEdges.value = graph.edges
  } finally {
    graphLoading.value = false
  }
}

async function loadDocuments(): Promise<void> {
  documentsLoading.value = true
  try {
    const result = await api<{ documents: Document[]; total: number; page: number }>(
      'GET',
      `${documentsPath()}?page=${textPage.value}&pageSize=${LIST_PAGE_SIZE}`,
    )
    documentsTotal.value = result.total
    const maxPage = Math.max(1, Math.ceil(result.total / LIST_PAGE_SIZE))
    if (textPage.value > maxPage) {
      textPage.value = maxPage
      return
    }
    documents.value = result.documents
  } finally {
    documentsLoading.value = false
  }
}

async function loadReviews(): Promise<void> {
  reviews.value = (await api<{ reviews: ReviewItem[] }>('GET', `${reviewsPath()}?status=open`)).reviews
}

async function loadAssets(): Promise<void> {
  assetsLoading.value = true
  try {
    const result = await api<{ assets: KnowledgeAsset[]; total: number; page: number }>(
      'GET',
      `${assetsPath()}?page=${mediaPage.value}&pageSize=${LIST_PAGE_SIZE}`,
    )
    assetsTotal.value = result.total
    const maxPage = Math.max(1, Math.ceil(result.total / LIST_PAGE_SIZE))
    if (mediaPage.value > maxPage) {
      mediaPage.value = maxPage
      return
    }
    assets.value = result.assets
    const drafts = { ...assetRoleDrafts.value }
    for (const item of result.assets) {
      drafts[item.assetId] = item.role
    }
    assetRoleDrafts.value = drafts
  } finally {
    assetsLoading.value = false
  }
}

async function loadReviewsAndAssets(): Promise<void> {
  await Promise.all([loadReviews(), loadAssets()])
}

async function loadActiveMainTab(): Promise<void> {
  if (mainTab.value === 'graph') {
    await loadGraph()
    return
  }
  if (mainTab.value === 'text') {
    await loadDocuments()
    return
  }
  await loadReviewsAndAssets()
}

async function refreshActiveMainTabDuringImport(): Promise<void> {
  if (liveTabRefreshInFlight) {
    liveTabRefreshQueued = true
    return
  }
  liveTabRefreshInFlight = true
  try {
    do {
      liveTabRefreshQueued = false
      await loadActiveMainTab()
    } while (liveTabRefreshQueued)
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  } finally {
    liveTabRefreshInFlight = false
  }
}

async function load(): Promise<void> {
  await loadDocuments()
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
  progressCardDismissed.value = false
  try {
    await load()
    sites.value = (await api<{ sites: CmsSite[] }>('GET', '/api/sites')).sites.filter(
      (site) => site.siteId !== selectedSiteIdState.value,
    )
    await resumeRememberedImport()
  } catch (reason) {
    error.value = (reason as Error).message
  }
})

onUnmounted(() => {
  stopImportPoll()
  revokeAssetPreview()
})

watch(textPage, () => {
  if (skipTextPageWatch) {
    skipTextPageWatch = false
    return
  }
  void loadDocuments().catch((reason) => {
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  })
})

watch(mediaPage, () => {
  if (skipMediaPageWatch) {
    skipMediaPageWatch = false
    return
  }
  void loadAssets().catch((reason) => {
    error.value = reason instanceof ApiError ? reason.message : (reason as Error).message
  })
})

watch(
  () => selectedSiteIdState.value,
  async () => {
    stopImportPoll()
    importBusy.value = false
    importProgress.value = null
    importStatus.value = ''
    importSummary.value = ''
    uploadPercent.value = 0
    liveTabRefreshDoneCount = -1
    progressCardDismissed.value = false
    skipTextPageWatch = true
    skipMediaPageWatch = true
    textPage.value = 1
    mediaPage.value = 1
    try {
      await load()
      await resumeRememberedImport()
    } catch (reason) {
      error.value = (reason as Error).message
    }
  },
)

watch(mainTab, () => {
  if (!importInFlight.value) return
  void refreshActiveMainTabDuringImport()
})

function beforeLeaveMainTab(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
  return true
}

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
    <header class="page-actions">
      <el-button
        type="primary"
        :icon="Plus"
        data-testid="knowledge-add-button"
        :disabled="importBusy || busy"
        @click="openAddDialog('zip')"
      >
        添加
      </el-button>
      <el-badge
        :value="reviewCount"
        :max="99"
        :hidden="reviewCount === 0"
        type="warning"
        data-testid="knowledge-review-badge"
      >
        <el-button
          data-testid="knowledge-reviews-button"
          :disabled="reviewCount === 0"
          @click="reviewDialogOpen = true"
        >
          待审事项
        </el-button>
      </el-badge>
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-alert
      v-if="importSummary && !showImportProgressCard"
      :title="importSummary"
      type="info"
      show-icon
      :closable="false"
      class="page-alert"
      data-testid="knowledge-import-summary"
    />

    <el-card
      v-if="showImportProgressCard"
      class="import-progress-card"
      shadow="never"
      data-testid="knowledge-import-progress-card"
    >
      <div class="import-progress-card-header">
        <div>
          <h2 class="import-progress-card-title">资料导入进度</h2>
          <p class="import-progress-card-desc" data-testid="knowledge-import-progress-desc">
            {{ importProgressDescription }}
          </p>
        </div>
        <el-button
          text
          data-testid="knowledge-import-progress-close"
          @click="dismissImportProgressCard"
        >
          关闭
        </el-button>
      </div>
      <el-progress
        :percentage="importProgressPercent"
        :status="
          failedImportItems.length && !importInFlight
            ? 'warning'
            : importProgress?.status === 'failed'
              ? 'exception'
              : importProgressPercent >= 100 && !importInFlight
                ? 'success'
                : undefined
        "
        data-testid="knowledge-import-progress-bar"
      />
      <p v-if="importSummary && !importInFlight" class="import-progress-card-summary">{{ importSummary }}</p>
      <div v-if="importItems.length" class="import-items" data-testid="knowledge-import-items">
        <div v-for="item in importItems" :key="item.sourcePath" class="import-item-row">
          <div class="import-item-main">
            <span class="import-item-path" :title="item.sourcePath">{{ shortSourcePath(item.sourcePath) }}</span>
            <span class="import-item-status" :data-status="item.status">{{ importItemStatusLabel(item.status) }}</span>
          </div>
          <p v-if="item.error" class="import-item-error">{{ item.error }}</p>
          <el-button
            v-if="item.status === 'failed'"
            size="small"
            type="primary"
            link
            :loading="retryBusyPath === item.sourcePath"
            :disabled="importBusy"
            @click="retryFailedItems([item.sourcePath])"
          >
            重试
          </el-button>
        </div>
        <el-button
          v-if="failedImportItems.length > 1"
          size="small"
          type="primary"
          :loading="retryBusyPath === '__all__'"
          :disabled="importBusy"
          data-testid="knowledge-import-retry-all"
          @click="retryFailedItems()"
        >
          重试全部失败项（{{ failedImportItems.length }}）
        </el-button>
      </div>
    </el-card>

    <div class="knowledge-body">
      <el-tabs
        v-model="mainTab"
        class="knowledge-tabs"
        data-testid="knowledge-main-tabs"
        :before-leave="beforeLeaveMainTab"
      >
        <el-tab-pane label="关系图" name="graph" lazy>
          <div
            v-if="mainTab === 'graph'"
            class="graph-pane"
            v-loading="graphLoading"
            element-loading-text="正在加载关系图…"
          >
            <KnowledgeGraphCanvas
              v-if="!graphLoading && graphNodes.length"
              :nodes="graphNodes"
              :edges="graphEdges"
            />
            <el-empty
              v-else-if="!graphLoading"
              description="暂无图谱节点，请先导入或添加资料。"
              :image-size="72"
            />
          </div>
        </el-tab-pane>
        <el-tab-pane label="文字资料" name="text" lazy>
          <div v-if="mainTab === 'text'" class="list-pane" v-loading="documentsLoading">
            <el-table
              :data="documents"
              stripe
              data-testid="knowledge-text-table"
              empty-text="尚未添加文字资料。"
            >
              <el-table-column label="标题" min-width="160">
                <template #default="{ row }">
                  <el-button
                    v-if="isMarkdownDocument(row)"
                    link
                    type="primary"
                    data-testid="knowledge-document-title-open"
                    @click="openDocumentDrawer(row)"
                  >
                    {{ row.title }}
                  </el-button>
                  <span v-else>{{ row.title }}</span>
                </template>
              </el-table-column>
              <el-table-column label="类型" width="110">
                <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
              </el-table-column>
              <el-table-column label="来源路径" min-width="180">
                <template #default="{ row }">{{ row.sourcePath || '—' }}</template>
              </el-table-column>
              <el-table-column label="摘要" min-width="220">
                <template #default="{ row }">{{ row.content.slice(0, 120) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="300" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="isMarkdownDocument(row)"
                    link
                    type="primary"
                    data-testid="knowledge-document-view"
                    @click="openDocumentDrawer(row)"
                  >
                    查看
                  </el-button>
                  <el-button link type="primary" @click="edit(row)">编辑</el-button>
                  <el-button link @click="copying = row">复制</el-button>
                  <el-button link type="danger" @click="deleting = row">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="list-pagination">
              <el-pagination
                v-model:current-page="textPage"
                :page-size="LIST_PAGE_SIZE"
                :total="documentsTotal"
                layout="total, prev, pager, next"
                background
                data-testid="knowledge-text-pagination"
              />
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="媒体资料" name="media" lazy>
          <div v-if="mainTab === 'media'" class="list-pane" v-loading="assetsLoading">
            <el-table
              :data="assets"
              stripe
              data-testid="knowledge-media-table"
              empty-text="尚未登记媒体资料。"
            >
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
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="isPreviewableAsset(row)"
                    link
                    type="primary"
                    data-testid="knowledge-asset-view"
                    @click="openAssetDrawer(row)"
                  >
                    查看
                  </el-button>
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
            <div class="list-pagination">
              <el-pagination
                v-model:current-page="mediaPage"
                :page-size="LIST_PAGE_SIZE"
                :total="assetsTotal"
                layout="total, prev, pager, next"
                background
                data-testid="knowledge-media-pagination"
              />
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-drawer
      v-model="documentDrawerOpen"
      :title="viewingDocument?.title || '文字资料'"
      size="48%"
      destroy-on-close
      data-testid="knowledge-document-drawer"
      @closed="onDocumentDrawerClosed"
    >
      <p v-if="viewingDocument?.sourcePath" class="drawer-meta">来源：{{ viewingDocument.sourcePath }}</p>
      <div class="markdown-body" data-testid="knowledge-document-markdown" v-html="documentHtml" />
    </el-drawer>

    <el-drawer
      v-model="assetDrawerOpen"
      :title="viewingAsset?.sourcePath || '媒体资料'"
      size="48%"
      destroy-on-close
      data-testid="knowledge-asset-drawer"
      @closed="onAssetDrawerClosed"
    >
      <p v-if="viewingAsset" class="drawer-meta">类型：{{ viewingAsset.mime }}</p>
      <div v-loading="assetPreviewLoading" class="asset-preview-pane">
        <p v-if="assetPreviewError" class="asset-preview-error">{{ assetPreviewError }}</p>
        <img
          v-else-if="assetPreviewUrl && viewingAsset?.mime.startsWith('image/')"
          :src="assetPreviewUrl"
          class="asset-preview-image"
          alt="媒体预览"
        />
        <video
          v-else-if="assetPreviewUrl && viewingAsset?.mime.startsWith('video/')"
          :src="assetPreviewUrl"
          class="asset-preview-video"
          controls
        />
      </div>
    </el-drawer>

    <el-dialog
      v-model="reviewDialogOpen"
      title="待审事项"
      width="560px"
      data-testid="knowledge-reviews-dialog"
    >
      <div class="review-dialog-body" data-testid="knowledge-reviews-panel">
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
      </div>
    </el-dialog>

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
      <p v-if="importInFlight || importStatus" class="import-status" data-testid="knowledge-import-status">
        进度已显示在页面上方卡片中
      </p>
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
.page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.page-alert {
  margin-bottom: 12px;
}
.import-progress-card {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-lighter);
}
.import-progress-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.import-progress-card-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.import-progress-card-desc {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}
.import-progress-card-summary {
  margin: 10px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.knowledge-body {
  min-width: 0;
}
.knowledge-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
.graph-pane {
  min-height: calc(100vh - 260px);
  height: calc(100vh - 260px);
}
.list-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list-pagination {
  display: flex;
  justify-content: flex-end;
}
.drawer-meta {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.markdown-body {
  line-height: 1.7;
  color: var(--el-text-color-primary);
  word-break: break-word;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin: 1.2em 0 0.6em;
  font-weight: 600;
}
.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(pre) {
  margin: 0 0 0.9em;
}
.markdown-body :deep(pre),
.markdown-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--el-fill-color-light);
}
.markdown-body :deep(pre) {
  padding: 12px;
  overflow: auto;
  border-radius: 6px;
}
.markdown-body :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
}
.asset-preview-pane {
  min-height: 240px;
}
.asset-preview-error {
  margin: 0;
  color: var(--el-color-danger);
}
.asset-preview-image,
.asset-preview-video {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 180px);
  margin: 0 auto;
  border-radius: 8px;
  background: #0f172a0a;
}
.review-dialog-body {
  max-height: min(60vh, 520px);
  overflow: auto;
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
.import-items {
  margin-top: 12px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 10px;
}
.import-item-row {
  display: grid;
  gap: 4px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.import-item-row:last-child {
  border-bottom: 0;
}
.import-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.import-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.import-item-status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.import-item-status[data-status='succeeded'],
.import-item-status[data-status='skipped_duplicate'] {
  color: var(--el-color-success);
}
.import-item-status[data-status='failed'] {
  color: var(--el-color-danger);
}
.import-item-error {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
.site-targets {
  display: grid;
  gap: 8px;
}
@media (max-width: 960px) {
  .graph-pane {
    min-height: 420px;
    height: 60vh;
  }
}
</style>
