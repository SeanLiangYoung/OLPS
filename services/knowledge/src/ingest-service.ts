import fs from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeAiConfig } from './ai-config.js'
import { completeJson, completeJsonMessages, type ChatMessage } from './ai-client.js'
import {
  readFingerprintStore,
  writeFingerprintStore,
  type FingerprintEntry,
  type FingerprintStore,
} from './project-fingerprints.js'
import { readExtractedText } from './source-processing.js'
import { classifySourceByExtension } from './source-kind.js'
import { requireKnowledgeAiConfig } from './ai-config.js'
import { appendIngestRejectedUpdateReview } from './project-reviews.js'
import { patchImportItem } from './import-items.js'
import {
  buildExistingByPath,
  collectReimportCandidates,
  decideReimportWithAi,
  finalizeReimportIngestDecision,
  type ReimportWritePlan,
} from './ingest-reimport.js'
import {
  INGEST_SEGMENT_SIZE_CHARS,
  INGEST_SEGMENT_THRESHOLD_CHARS,
  segmentExtractedText,
  slugifyProductKey,
} from './ingest-text-segments.js'
import {
  ingestAnalysisRelativePath,
  ingestProgressRelativePath,
  wikiPathForImportedProduct,
  wikiPathForImportedSource,
} from './source-wiki-path.js'

export class IngestInterruptedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type IngestProgress = {
  importId: string
  completedSourcePaths: string[]
  failedSourcePaths: string[]
  metaPagesUpdated: boolean
}

export type IngestStats = {
  pagesWritten: number
  pagesSkipped: number
  pagesCreated: number
  pagesUpdated: number
  rejectedUpdates: number
  pagesFailed: number
  pagesDuplicated: number
}

type IngestedCanonical = {
  sourcePath: string
  entry: FingerprintEntry
  wikiPath: string
}

type ProductAnalysis = {
  productKey: string
  title: string
  summary: string
  sections: Array<{ heading: string; body: string }>
  keyPoints: string[]
}

/** 单个文字源的 Ingest 分析结果：一篇短索引 + 按产品拆分的多篇正文 */
type SourceAnalysis = {
  sourcePath: string
  title: string
  summary: string
  products: ProductAnalysis[]
}

function titleFromSourcePath(sourcePath: string): string {
  const base = path.posix.basename(sourcePath)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return base
  }
  return base.slice(0, dot)
}

async function readJsonFile<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

async function writeJsonFile(absPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readIngestProgress(projectDir: string, importId: string): Promise<IngestProgress> {
  const rel = ingestProgressRelativePath(importId)
  const abs = path.join(projectDir, ...rel.split('/'))
  const existing = await readJsonFile<IngestProgress>(abs)
  if (existing && existing.importId === importId) {
    return {
      importId,
      completedSourcePaths: existing.completedSourcePaths ?? [],
      failedSourcePaths: existing.failedSourcePaths ?? [],
      metaPagesUpdated: Boolean(existing.metaPagesUpdated),
    }
  }
  return { importId, completedSourcePaths: [], failedSourcePaths: [], metaPagesUpdated: false }
}

function resolveCanonicalWikiPath(entry: FingerprintEntry): string | null {
  if (entry.aliasOfWikiPath) {
    return entry.aliasOfWikiPath
  }
  if (entry.wikiPath) {
    return entry.wikiPath
  }
  return null
}

export function findIngestedCanonicalByHash(
  store: FingerprintStore,
  sha256: string,
  excludeSourcePath: string,
): IngestedCanonical | null {
  for (const [sourcePath, entry] of Object.entries(store)) {
    if (sourcePath === excludeSourcePath) {
      continue
    }
    if (entry.kind !== 'text') {
      continue
    }
    if (entry.sha256 !== sha256 || entry.ingestedSha256 !== sha256) {
      continue
    }
    const wikiPath = resolveCanonicalWikiPath(entry)
    if (!wikiPath) {
      continue
    }
    if (entry.aliasOfWikiPath) {
      continue
    }
    return { sourcePath, entry, wikiPath }
  }
  for (const [sourcePath, entry] of Object.entries(store)) {
    if (sourcePath === excludeSourcePath) {
      continue
    }
    if (entry.kind !== 'text') {
      continue
    }
    if (entry.sha256 !== sha256 || entry.ingestedSha256 !== sha256) {
      continue
    }
    const wikiPath = resolveCanonicalWikiPath(entry)
    if (!wikiPath) {
      continue
    }
    return { sourcePath, entry, wikiPath }
  }
  return null
}

function formatAliasWikiPageMarkdown(input: {
  sourcePath: string
  fingerprint: string
  importId: string
  canonicalWikiPath: string
  title: string
}): string {
  const relativeTarget = path.posix.relative(path.posix.dirname(wikiPathForImportedSource(input.sourcePath)), input.canonicalWikiPath)
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(input.title)}`,
    'kind: imported_source_alias',
    `sourcePath: ${JSON.stringify(input.sourcePath)}`,
    `sourceFingerprint: ${JSON.stringify(input.fingerprint)}`,
    `importId: ${JSON.stringify(input.importId)}`,
    `canonicalWikiPath: ${JSON.stringify(input.canonicalWikiPath)}`,
    '---',
    '',
    `本页对应原始路径 \`${input.sourcePath}\`，内容指纹与已有摘要相同，未再次调用 AI 解析。`,
    '',
    `请阅读完整摘要：[${input.title}](${relativeTarget})`,
    '',
  ]
  return lines.join('\n')
}

async function writeAliasWikiPage(input: {
  projectDir: string
  sourcePath: string
  fingerprint: string
  importId: string
  store: FingerprintStore
  canonical: IngestedCanonical
}): Promise<string> {
  const wikiPath = wikiPathForImportedSource(input.sourcePath)
  const canonicalText = await readWikiText(input.projectDir, input.canonical.wikiPath)
  let title = titleFromSourcePath(input.sourcePath)
  if (canonicalText) {
    const match = /^title:\s*("(?:\\.|[^"])*"|[^\n]+)/m.exec(canonicalText)
    if (match) {
      const raw = match[1]!.trim()
      if (raw.startsWith('"')) {
        try {
          title = JSON.parse(raw) as string
        } catch {
          title = raw
        }
      } else {
        title = raw
      }
    }
  }
  const markdown = formatAliasWikiPageMarkdown({
    sourcePath: input.sourcePath,
    fingerprint: input.fingerprint,
    importId: input.importId,
    canonicalWikiPath: input.canonical.wikiPath,
    title,
  })
  const abs = path.join(input.projectDir, ...wikiPath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, markdown, 'utf8')
  const entry = input.store[input.sourcePath]
  if (!entry) {
    throw new Error(`指纹库缺少来源: ${input.sourcePath}`)
  }
  entry.wikiPath = wikiPath
  entry.aliasOfWikiPath = input.canonical.wikiPath
  entry.ingestedSha256 = input.fingerprint
  input.store[input.sourcePath] = entry
  return wikiPath
}

async function markItemSafe(
  projectDir: string,
  importId: string,
  sourcePath: string,
  patch: Parameters<typeof patchImportItem>[3],
): Promise<void> {
  try {
    await patchImportItem(projectDir, importId, sourcePath, patch)
  } catch (err) {
    const nodeErr = err as Error
    if (nodeErr.message.includes('items.json 不存在') || nodeErr.message.includes('items 中缺少来源')) {
      return
    }
    throw err
  }
}

async function writeIngestProgress(projectDir: string, progress: IngestProgress): Promise<void> {
  const rel = ingestProgressRelativePath(progress.importId)
  const abs = path.join(projectDir, ...rel.split('/'))
  await writeJsonFile(abs, progress)
}

async function readWikiText(projectDir: string, wikiPath: string): Promise<string | null> {
  const abs = path.join(projectDir, ...wikiPath.split('/'))
  try {
    return await fs.readFile(abs, 'utf8')
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

function parseSections(raw: unknown): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = []
  if (!Array.isArray(raw)) {
    return sections
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const heading = (item as { heading?: unknown }).heading
    const body = (item as { body?: unknown }).body
    if (typeof heading === 'string' && typeof body === 'string' && heading.trim() && body.trim()) {
      sections.push({ heading: heading.trim(), body: body.trim() })
    }
  }
  return sections
}

function parseKeyPoints(raw: unknown): string[] {
  const keyPoints: string[] = []
  if (!Array.isArray(raw)) {
    return keyPoints
  }
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      keyPoints.push(item.trim())
    }
  }
  return keyPoints
}

function parseProductDrafts(raw: unknown): Array<{ productKey: string; title: string; notes: string }> {
  const drafts: Array<{ productKey: string; title: string; notes: string }> = []
  if (!Array.isArray(raw)) {
    return drafts
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const productKeyRaw = (item as { productKey?: unknown }).productKey
    const titleRaw = (item as { title?: unknown }).title
    const notesRaw = (item as { notes?: unknown }).notes
    const title = typeof titleRaw === 'string' ? titleRaw.trim() : ''
    const productKey =
      typeof productKeyRaw === 'string' && productKeyRaw.trim()
        ? slugifyProductKey(productKeyRaw)
        : title
          ? slugifyProductKey(title)
          : ''
    if (!productKey) {
      continue
    }
    drafts.push({
      productKey,
      title: title || productKey,
      notes: typeof notesRaw === 'string' ? notesRaw.trim() : '',
    })
  }
  return drafts
}

function parseProductAnalysis(raw: unknown, fallbackKey: string): ProductAnalysis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackKey
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  if (!summary) {
    return null
  }
  const productKeyRaw = typeof obj.productKey === 'string' ? obj.productKey : fallbackKey
  return {
    productKey: slugifyProductKey(productKeyRaw),
    title,
    summary,
    keyPoints: parseKeyPoints(obj.keyPoints),
    sections: parseSections(obj.sections),
  }
}

function parseAnalysisPayload(sourcePath: string, payload: Record<string, unknown>): SourceAnalysis {
  const titleRaw = payload.title
  const summaryRaw = payload.summary
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : titleFromSourcePath(sourcePath)
  const summary = typeof summaryRaw === 'string' ? summaryRaw.trim() : ''
  if (!summary) {
    throw new Error(`Ingest 分析缺少 summary: ${sourcePath}`)
  }
  const products: ProductAnalysis[] = []
  if (Array.isArray(payload.products)) {
    for (const item of payload.products) {
      const parsed = parseProductAnalysis(item, title)
      if (parsed) {
        products.push(parsed)
      }
    }
  }
  if (products.length === 0) {
    // 兼容旧单页结构：整份当作一个产品
    const legacy = parseProductAnalysis(
      {
        productKey: titleFromSourcePath(sourcePath),
        title,
        summary,
        keyPoints: payload.keyPoints,
        sections: payload.sections,
      },
      titleFromSourcePath(sourcePath),
    )
    if (legacy) {
      products.push(legacy)
    }
  }
  if (products.length === 0) {
    throw new Error(`Ingest 分析未识别到产品: ${sourcePath}`)
  }
  // 同 key 去重，后者覆盖前者
  const byKey = new Map<string, ProductAnalysis>()
  for (const product of products) {
    byKey.set(product.productKey, product)
  }
  return { sourcePath, title, summary, products: [...byKey.values()] }
}

async function discoverProductsAcrossSegments(
  ai: KnowledgeAiConfig,
  sourcePath: string,
  segments: string[],
): Promise<Array<{ productKey: string; title: string; notes: string }>> {
  const byKey = new Map<string, { productKey: string; title: string; notes: string }>()
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是产品手册拆解助手。每次只根据当前片段识别产品型号/名称，输出严格 JSON：{ products: [{ productKey, title, notes }] }。productKey 用稳定英文或拼音短标识。不要输出 markdown 代码围栏。',
    },
  ]
  for (let index = 0; index < segments.length; index += 1) {
    messages.push({
      role: 'user',
      content: JSON.stringify({
        sourcePath,
        segmentIndex: index + 1,
        segmentCount: segments.length,
        knownProducts: [...byKey.values()].map((item) => ({
          productKey: item.productKey,
          title: item.title,
        })),
        segmentText: segments[index],
        instruction: '合并已知产品并补充本段新出现的产品；products 返回本段相关项即可。',
      }),
    })
    const payload = await completeJsonMessages(ai, messages)
    const drafts = parseProductDrafts(payload.products)
    messages.push({ role: 'assistant', content: JSON.stringify(payload) })
    for (const draft of drafts) {
      const existing = byKey.get(draft.productKey)
      if (existing) {
        byKey.set(draft.productKey, {
          productKey: draft.productKey,
          title: draft.title || existing.title,
          notes: [existing.notes, draft.notes].filter(Boolean).join('\n').slice(0, 4000),
        })
      } else {
        byKey.set(draft.productKey, draft)
      }
    }
  }
  return [...byKey.values()]
}

async function finalizeProductPage(
  ai: KnowledgeAiConfig,
  sourcePath: string,
  draft: { productKey: string; title: string; notes: string },
  relatedText: string,
): Promise<ProductAnalysis> {
  const payload = await completeJson(ai, {
    system:
      '你是知识库产品页撰写助手。根据给定产品与相关原文，输出严格 JSON：{ productKey, title, summary(2-4句), keyPoints(string[] 3-8条), sections({heading,body}[] 2-6节) }。只写这一个产品。不要输出 markdown 代码围栏。',
    user: JSON.stringify({
      sourcePath,
      product: draft,
      relatedText: relatedText.slice(0, 80_000),
    }),
  })
  const parsed = parseProductAnalysis(payload, draft.productKey)
  if (!parsed) {
    throw new Error(`产品页定稿失败: ${sourcePath}#${draft.productKey}`)
  }
  return {
    ...parsed,
    productKey: draft.productKey,
    title: parsed.title || draft.title,
  }
}

async function runStep1Analyze(
  ai: KnowledgeAiConfig,
  sourcePath: string,
  extractedText: string,
): Promise<SourceAnalysis> {
  const trimmed = extractedText.trim()
  if (trimmed.length <= INGEST_SEGMENT_THRESHOLD_CHARS) {
    const payload = await completeJson(ai, {
      system:
        '你是知识库入库分析助手。一份资料可能宣传多个产品。输出严格 JSON：{ title, summary(整份概述 2-4句), products:[{ productKey, title, summary, keyPoints(string[]), sections({heading,body}[]) }] }。若只有一个主题，products 长度为 1。不要输出 markdown 代码围栏。',
      user: JSON.stringify({
        sourcePath,
        extractedText: trimmed.slice(0, 120_000),
      }),
    })
    return parseAnalysisPayload(sourcePath, payload)
  }

  const segments = segmentExtractedText(trimmed, INGEST_SEGMENT_SIZE_CHARS)
  const drafts = await discoverProductsAcrossSegments(ai, sourcePath, segments)
  if (drafts.length === 0) {
    throw new Error(`分段识别未得到产品: ${sourcePath}`)
  }
  const products: ProductAnalysis[] = []
  for (const draft of drafts) {
    const related = segments
      .filter((segment) => {
        const hay = segment.toLowerCase()
        return hay.includes(draft.productKey.toLowerCase()) || hay.includes(draft.title.toLowerCase())
      })
      .join('\n\n')
    const relatedText = related.trim() || segments.slice(0, 2).join('\n\n')
    products.push(await finalizeProductPage(ai, sourcePath, draft, relatedText))
  }
  return {
    sourcePath,
    title: titleFromSourcePath(sourcePath),
    summary: `本资料共整理 ${products.length} 个产品条目。`,
    products,
  }
}

function formatProductWikiMarkdown(
  sourcePath: string,
  product: ProductAnalysis,
  fingerprint: string,
  importId: string,
): string {
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(product.title)}`,
    'kind: imported_product',
    `sourcePath: ${JSON.stringify(sourcePath)}`,
    `sourceFingerprint: ${JSON.stringify(fingerprint)}`,
    `importId: ${JSON.stringify(importId)}`,
    `productKey: ${JSON.stringify(product.productKey)}`,
    '---',
    '',
    product.summary,
    '',
  ]
  if (product.keyPoints.length > 0) {
    lines.push('## 要点', '')
    for (const point of product.keyPoints) {
      lines.push(`- ${point}`)
    }
    lines.push('')
  }
  for (const section of product.sections) {
    lines.push(`## ${section.heading}`, '', section.body, '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function formatSourceIndexMarkdown(
  analysis: SourceAnalysis,
  fingerprint: string,
  importId: string,
  productWikiPaths: Array<{ productKey: string; title: string; wikiPath: string }>,
): string {
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(analysis.title)}`,
    'kind: imported_source_index',
    `sourcePath: ${JSON.stringify(analysis.sourcePath)}`,
    `sourceFingerprint: ${JSON.stringify(fingerprint)}`,
    `importId: ${JSON.stringify(importId)}`,
    '---',
    '',
    analysis.summary,
    '',
    '## 产品条目',
    '',
  ]
  for (const item of productWikiPaths) {
    const relative = path.posix.relative(path.posix.dirname(wikiPathForImportedSource(analysis.sourcePath)), item.wikiPath)
    lines.push(`- [${item.title}](${relative}) (\`${item.productKey}\`)`)
  }
  lines.push('')
  return `${lines.join('\n').trimEnd()}\n`
}

async function removeWikiFiles(projectDir: string, wikiPaths: string[]): Promise<void> {
  for (const wikiPath of wikiPaths) {
    const abs = path.join(projectDir, ...wikiPath.split('/'))
    try {
      await fs.unlink(abs)
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code !== 'ENOENT') {
        throw err
      }
    }
  }
}

async function runStep2WriteSourcePages(
  projectDir: string,
  analysis: SourceAnalysis,
  fingerprint: string,
  importId: string,
  store: FingerprintStore,
  indexWikiPath: string,
): Promise<{ indexWikiPath: string; productWikiPaths: string[] }> {
  const entry = store[analysis.sourcePath]
  if (!entry) {
    throw new Error(`指纹库缺少来源: ${analysis.sourcePath}`)
  }
  await removeWikiFiles(projectDir, entry.productWikiPaths ?? [])

  const productLinks: Array<{ productKey: string; title: string; wikiPath: string }> = []
  const productWikiPaths: string[] = []
  for (const product of analysis.products) {
    const wikiPath = wikiPathForImportedProduct(analysis.sourcePath, product.productKey)
    const abs = path.join(projectDir, ...wikiPath.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, formatProductWikiMarkdown(analysis.sourcePath, product, fingerprint, importId), 'utf8')
    productWikiPaths.push(wikiPath)
    productLinks.push({ productKey: product.productKey, title: product.title, wikiPath })
  }

  const indexAbs = path.join(projectDir, ...indexWikiPath.split('/'))
  await fs.mkdir(path.dirname(indexAbs), { recursive: true })
  await fs.writeFile(
    indexAbs,
    formatSourceIndexMarkdown(analysis, fingerprint, importId, productLinks),
    'utf8',
  )

  entry.wikiPath = indexWikiPath
  entry.productWikiPaths = productWikiPaths
  entry.aliasOfWikiPath = undefined
  entry.ingestedSha256 = fingerprint
  store[analysis.sourcePath] = entry
  return { indexWikiPath, productWikiPaths }
}

type MetaPagesPayload = {
  indexMarkdown: string
  logAppend: string
  overviewMarkdown: string
}

async function runStep2MetaPages(
  ai: KnowledgeAiConfig,
  importId: string,
  analyses: SourceAnalysis[],
  indexExisting: string,
  overviewExisting: string,
): Promise<MetaPagesPayload> {
  const payload = await completeJson(ai, {
    system:
      '你是知识库索引维护助手。根据新入库来源摘要，输出 JSON：indexMarkdown（完整 index.md 正文，含 # 标题）、logAppend（仅追加到 log.md 的新段落 markdown）、overviewMarkdown（完整 overview.md 正文）。保留已有信息并融入新来源。产品级条目请按产品列出。',
    user: JSON.stringify({
      importId,
      newSources: analyses.map((item) => ({
        sourcePath: item.sourcePath,
        title: item.title,
        summary: item.summary,
        products: item.products.map((product) => ({
          productKey: product.productKey,
          title: product.title,
          summary: product.summary,
          keyPoints: product.keyPoints,
        })),
      })),
      indexExisting: indexExisting.slice(0, 40_000),
      overviewExisting: overviewExisting.slice(0, 40_000),
    }),
  })
  const indexMarkdown = payload.indexMarkdown
  const logAppend = payload.logAppend
  const overviewMarkdown = payload.overviewMarkdown
  if (typeof indexMarkdown !== 'string' || !indexMarkdown.trim()) {
    throw new Error('Ingest meta 缺少 indexMarkdown')
  }
  if (typeof logAppend !== 'string' || !logAppend.trim()) {
    throw new Error('Ingest meta 缺少 logAppend')
  }
  if (typeof overviewMarkdown !== 'string' || !overviewMarkdown.trim()) {
    throw new Error('Ingest meta 缺少 overviewMarkdown')
  }
  return {
    indexMarkdown: indexMarkdown.trimEnd() + '\n',
    logAppend: logAppend.trimEnd() + '\n',
    overviewMarkdown: overviewMarkdown.trimEnd() + '\n',
  }
}

function collectTextSources(writtenPaths: string[]): string[] {
  return writtenPaths.filter((sourcePath) => {
    const fileName = path.posix.basename(sourcePath)
    return classifySourceByExtension(fileName) === 'text'
  })
}

export async function runIngestPipeline(input: {
  projectDir: string
  importId: string
  writtenPaths: string[]
  ai?: KnowledgeAiConfig
  interruptAfter?: number
  resume?: boolean
}): Promise<IngestStats> {
  const stats: IngestStats = {
    pagesWritten: 0,
    pagesSkipped: 0,
    pagesCreated: 0,
    pagesUpdated: 0,
    rejectedUpdates: 0,
    pagesFailed: 0,
    pagesDuplicated: 0,
  }
  const textSources = collectTextSources(input.writtenPaths)
  if (textSources.length === 0) {
    return stats
  }
  const store = await readFingerprintStore(input.projectDir)
  const progress = await readIngestProgress(input.projectDir, input.importId)
  const completed = new Set(progress.completedSourcePaths)
  const failed = new Set(progress.failedSourcePaths)
  let processedThisRun = 0
  let ai: KnowledgeAiConfig | null = null
  const requireAi = (): KnowledgeAiConfig => {
    if (!ai) {
      ai = input.ai ?? requireKnowledgeAiConfig(process.env)
    }
    return ai
  }

  for (const sourcePath of textSources) {
    const entry = store[sourcePath]
    if (!entry || entry.kind !== 'text') {
      continue
    }
    if (entry.ingestedSha256 === entry.sha256 && entry.wikiPath) {
      const wikiText = await readWikiText(input.projectDir, entry.wikiPath)
      if (wikiText) {
        stats.pagesSkipped += 1
        if (!completed.has(sourcePath)) {
          progress.completedSourcePaths.push(sourcePath)
          completed.add(sourcePath)
        }
        failed.delete(sourcePath)
        progress.failedSourcePaths = [...failed]
        await markItemSafe(input.projectDir, input.importId, sourcePath, {
          status: entry.aliasOfWikiPath ? 'skipped_duplicate' : 'succeeded',
          fingerprint: entry.sha256,
          kind: 'text',
          wikiPath: entry.wikiPath,
          aliasOfWikiPath: entry.aliasOfWikiPath ?? null,
          error: null,
        })
        await writeIngestProgress(input.projectDir, progress)
        continue
      }
    }
    if (completed.has(sourcePath)) {
      stats.pagesSkipped += 1
      continue
    }

    try {
      await markItemSafe(input.projectDir, input.importId, sourcePath, {
        status: 'analyzing',
        fingerprint: entry.sha256,
        kind: 'text',
        error: null,
      })

      const duplicate = findIngestedCanonicalByHash(store, entry.sha256, sourcePath)
      if (duplicate) {
        const wikiPath = await writeAliasWikiPage({
          projectDir: input.projectDir,
          sourcePath,
          fingerprint: entry.sha256,
          importId: input.importId,
          store,
          canonical: duplicate,
        })
        stats.pagesDuplicated += 1
        stats.pagesSkipped += 1
        stats.pagesCreated += 1
        completed.add(sourcePath)
        progress.completedSourcePaths.push(sourcePath)
        failed.delete(sourcePath)
        progress.failedSourcePaths = [...failed]
        await markItemSafe(input.projectDir, input.importId, sourcePath, {
          status: 'skipped_duplicate',
          fingerprint: entry.sha256,
          kind: 'text',
          wikiPath,
          aliasOfWikiPath: duplicate.wikiPath,
          error: null,
        })
        await writeIngestProgress(input.projectDir, progress)
        await writeFingerprintStore(input.projectDir, store)
        processedThisRun += 1
        if (input.interruptAfter !== undefined && processedThisRun >= input.interruptAfter) {
          throw new IngestInterruptedError(`Ingest 在 ${processedThisRun} 个来源后中断`)
        }
        continue
      }

      const extracted = await readExtractedText(input.projectDir, sourcePath)
      const analysisRel = ingestAnalysisRelativePath(input.importId, sourcePath)
      const analysisAbs = path.join(input.projectDir, ...analysisRel.split('/'))
      let analysis = await readJsonFile<SourceAnalysis>(analysisAbs)
      if (!analysis) {
        analysis = await runStep1Analyze(requireAi(), sourcePath, extracted.text)
        await writeJsonFile(analysisAbs, analysis)
      }

      await markItemSafe(input.projectDir, input.importId, sourcePath, {
        status: 'writing',
        fingerprint: extracted.fingerprint,
        kind: 'text',
        error: null,
      })

      const canonicalWikiPath = wikiPathForImportedSource(sourcePath)
      const candidates = await collectReimportCandidates(input.projectDir, sourcePath, store)
      const existingByPath = buildExistingByPath(candidates)
      let writePlan: ReimportWritePlan = {
        action: 'create',
        wikiPath: canonicalWikiPath,
        rejectedForcedUpdate: false,
      }
      if (candidates.length > 0 && entry.wikiPath) {
        const aiDecision = await decideReimportWithAi(requireAi(), {
          sourcePath,
          fingerprint: extracted.fingerprint,
          extractedText: extracted.text,
          candidates,
        })
        writePlan = finalizeReimportIngestDecision({
          sourcePath,
          canonicalWikiPath,
          ai: aiDecision,
          existingByPath,
        })
        if (writePlan.rejectedForcedUpdate) {
          stats.rejectedUpdates += 1
          await appendIngestRejectedUpdateReview(input.projectDir, {
            importId: input.importId,
            sourcePath,
            attemptedTargetWikiPath: aiDecision.targetWikiPath ?? canonicalWikiPath,
            aiReason: aiDecision.reason,
          })
        }
      }
      if (writePlan.action === 'skip') {
        const entryAfter = store[sourcePath]
        if (entryAfter) {
          entryAfter.ingestedSha256 = extracted.fingerprint
          store[sourcePath] = entryAfter
        }
        stats.pagesSkipped += 1
        if (!completed.has(sourcePath)) {
          progress.completedSourcePaths.push(sourcePath)
          completed.add(sourcePath)
        }
        failed.delete(sourcePath)
        progress.failedSourcePaths = [...failed]
        await markItemSafe(input.projectDir, input.importId, sourcePath, {
          status: 'succeeded',
          fingerprint: extracted.fingerprint,
          kind: 'text',
          wikiPath: entryAfter?.wikiPath ?? null,
          aliasOfWikiPath: null,
          error: null,
        })
        await writeIngestProgress(input.projectDir, progress)
        await writeFingerprintStore(input.projectDir, store)
        continue
      }

      const written = await runStep2WriteSourcePages(
        input.projectDir,
        analysis,
        extracted.fingerprint,
        input.importId,
        store,
        writePlan.wikiPath,
      )
      const pageCount = 1 + written.productWikiPaths.length
      stats.pagesWritten += pageCount
      const sameWikiAsBefore = Boolean(entry.wikiPath && entry.wikiPath === writePlan.wikiPath)
      if (writePlan.action === 'update' || sameWikiAsBefore) {
        stats.pagesUpdated += pageCount
      } else {
        stats.pagesCreated += pageCount
      }
      completed.add(sourcePath)
      progress.completedSourcePaths.push(sourcePath)
      failed.delete(sourcePath)
      progress.failedSourcePaths = [...failed]
      await markItemSafe(input.projectDir, input.importId, sourcePath, {
        status: 'succeeded',
        fingerprint: extracted.fingerprint,
        kind: 'text',
        wikiPath: writePlan.wikiPath,
        aliasOfWikiPath: null,
        error: null,
      })
      await writeIngestProgress(input.projectDir, progress)
      await writeFingerprintStore(input.projectDir, store)
      processedThisRun += 1
      if (input.interruptAfter !== undefined && processedThisRun >= input.interruptAfter) {
        throw new IngestInterruptedError(`Ingest 在 ${processedThisRun} 个来源后中断`)
      }
    } catch (err) {
      if (err instanceof IngestInterruptedError) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      stats.pagesFailed += 1
      if (!failed.has(sourcePath)) {
        failed.add(sourcePath)
        progress.failedSourcePaths.push(sourcePath)
      }
      await markItemSafe(input.projectDir, input.importId, sourcePath, {
        status: 'failed',
        fingerprint: entry.sha256,
        kind: 'text',
        error: message,
      })
      await writeIngestProgress(input.projectDir, progress)
      await writeFingerprintStore(input.projectDir, store)
    }
  }

  const allTextSourcesTerminal = textSources.every(
    (sourcePath) => completed.has(sourcePath) || failed.has(sourcePath),
  )
  if (!progress.metaPagesUpdated && allTextSourcesTerminal && completed.size > 0) {
    const analysesForMeta: SourceAnalysis[] = []
    for (const sourcePath of textSources) {
      if (!completed.has(sourcePath) || failed.has(sourcePath)) {
        continue
      }
      const storeEntry = store[sourcePath]
      if (storeEntry?.aliasOfWikiPath) {
        continue
      }
      const analysisRel = ingestAnalysisRelativePath(input.importId, sourcePath)
      const analysisAbs = path.join(input.projectDir, ...analysisRel.split('/'))
      const saved = await readJsonFile<SourceAnalysis>(analysisAbs)
      if (saved) {
        analysesForMeta.push(saved)
      }
    }
    if (analysesForMeta.length === 0) {
      const logExisting = (await readWikiText(input.projectDir, 'wiki/log.md')) ?? '# Change log\n\n'
      const aliasNote = `\n## import ${input.importId}\n\n本次仅写入内容重复指向页，未新增 AI 摘要。\n`
      await fs.writeFile(path.join(input.projectDir, 'wiki/log.md'), `${logExisting.trimEnd()}\n${aliasNote}`, 'utf8')
      progress.metaPagesUpdated = true
      await writeIngestProgress(input.projectDir, progress)
    } else {
      try {
        const indexExisting = (await readWikiText(input.projectDir, 'wiki/index.md')) ?? '# Knowledge index\n\n'
        const overviewExisting = (await readWikiText(input.projectDir, 'wiki/overview.md')) ?? '# Overview\n\n'
        const logExisting = (await readWikiText(input.projectDir, 'wiki/log.md')) ?? '# Change log\n\n'
        const meta = await runStep2MetaPages(
          requireAi(),
          input.importId,
          analysesForMeta,
          indexExisting,
          overviewExisting,
        )
        await fs.writeFile(path.join(input.projectDir, 'wiki/index.md'), meta.indexMarkdown, 'utf8')
        await fs.writeFile(path.join(input.projectDir, 'wiki/overview.md'), meta.overviewMarkdown, 'utf8')
        await fs.writeFile(
          path.join(input.projectDir, 'wiki/log.md'),
          `${logExisting.trimEnd()}\n\n${meta.logAppend}`,
          'utf8',
        )
        progress.metaPagesUpdated = true
        await writeIngestProgress(input.projectDir, progress)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        for (const sourcePath of textSources) {
          if (!completed.has(sourcePath)) {
            continue
          }
          await markItemSafe(input.projectDir, input.importId, sourcePath, {
            error: `索引页更新失败: ${message}`,
          })
        }
      }
    }
  }

  await writeFingerprintStore(input.projectDir, store)
  return stats
}