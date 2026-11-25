import fs from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeAiConfig } from './ai-config.js'
import { completeJson } from './ai-client.js'
import { readFingerprintStore, writeFingerprintStore, type FingerprintStore } from './project-fingerprints.js'
import { readExtractedText } from './source-processing.js'
import { classifySourceByExtension } from './source-kind.js'
import { requireKnowledgeAiConfig } from './ai-config.js'
import {
  ingestAnalysisRelativePath,
  ingestProgressRelativePath,
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
  metaPagesUpdated: boolean
}

export type IngestStats = {
  pagesWritten: number
  pagesSkipped: number
}

type SourceAnalysis = {
  sourcePath: string
  title: string
  summary: string
  sections: Array<{ heading: string; body: string }>
  keyPoints: string[]
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
    return existing
  }
  return { importId, completedSourcePaths: [], metaPagesUpdated: false }
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

function parseAnalysisPayload(sourcePath: string, payload: Record<string, unknown>): SourceAnalysis {
  const titleRaw = payload.title
  const summaryRaw = payload.summary
  const keyPointsRaw = payload.keyPoints
  const sectionsRaw = payload.sections
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : titleFromSourcePath(sourcePath)
  const summary = typeof summaryRaw === 'string' ? summaryRaw.trim() : ''
  if (!summary) {
    throw new Error(`Ingest 分析缺少 summary: ${sourcePath}`)
  }
  const keyPoints: string[] = []
  if (Array.isArray(keyPointsRaw)) {
    for (const item of keyPointsRaw) {
      if (typeof item === 'string' && item.trim()) {
        keyPoints.push(item.trim())
      }
    }
  }
  const sections: Array<{ heading: string; body: string }> = []
  if (Array.isArray(sectionsRaw)) {
    for (const item of sectionsRaw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const heading = (item as { heading?: unknown }).heading
      const body = (item as { body?: unknown }).body
      if (typeof heading === 'string' && typeof body === 'string' && heading.trim() && body.trim()) {
        sections.push({ heading: heading.trim(), body: body.trim() })
      }
    }
  }
  return { sourcePath, title, summary, sections, keyPoints }
}

async function runStep1Analyze(
  ai: KnowledgeAiConfig,
  sourcePath: string,
  extractedText: string,
): Promise<SourceAnalysis> {
  const payload = await completeJson(ai, {
    system:
      '你是知识库入库分析助手。根据源文件抽出文本，输出严格 JSON 对象，字段：title（string）、summary（string，2-4句）、keyPoints（string[]，3-8条）、sections（{heading,body}[]，2-6节）。不要输出 markdown 代码围栏。',
    user: JSON.stringify({
      sourcePath,
      extractedText: extractedText.slice(0, 120_000),
    }),
  })
  return parseAnalysisPayload(sourcePath, payload)
}

function formatWikiPageMarkdown(analysis: SourceAnalysis, fingerprint: string, importId: string): string {
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(analysis.title)}`,
    'kind: imported_source',
    `sourcePath: ${JSON.stringify(analysis.sourcePath)}`,
    `sourceFingerprint: ${JSON.stringify(fingerprint)}`,
    `importId: ${JSON.stringify(importId)}`,
    '---',
    '',
    analysis.summary,
    '',
  ]
  if (analysis.keyPoints.length > 0) {
    lines.push('## 要点', '')
    for (const point of analysis.keyPoints) {
      lines.push(`- ${point}`)
    }
    lines.push('')
  }
  for (const section of analysis.sections) {
    lines.push(`## ${section.heading}`, '', section.body, '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

async function runStep2WriteSourcePage(
  projectDir: string,
  analysis: SourceAnalysis,
  fingerprint: string,
  importId: string,
  store: FingerprintStore,
): Promise<string> {
  const wikiPath = wikiPathForImportedSource(analysis.sourcePath)
  const markdown = formatWikiPageMarkdown(analysis, fingerprint, importId)
  const abs = path.join(projectDir, ...wikiPath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, markdown, 'utf8')
  const entry = store[analysis.sourcePath]
  if (!entry) {
    throw new Error(`指纹库缺少来源: ${analysis.sourcePath}`)
  }
  entry.wikiPath = wikiPath
  entry.ingestedSha256 = fingerprint
  store[analysis.sourcePath] = entry
  return wikiPath
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
      '你是知识库索引维护助手。根据新入库来源摘要，输出 JSON：indexMarkdown（完整 index.md 正文，含 # 标题）、logAppend（仅追加到 log.md 的新段落 markdown）、overviewMarkdown（完整 overview.md 正文）。保留已有信息并融入新来源。',
    user: JSON.stringify({
      importId,
      newSources: analyses.map((item) => ({
        sourcePath: item.sourcePath,
        title: item.title,
        summary: item.summary,
        keyPoints: item.keyPoints,
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
  const stats: IngestStats = { pagesWritten: 0, pagesSkipped: 0 }
  const textSources = collectTextSources(input.writtenPaths)
  if (textSources.length === 0) {
    return stats
  }
  const ai = input.ai ?? requireKnowledgeAiConfig(process.env)
  const store = await readFingerprintStore(input.projectDir)
  const progress = await readIngestProgress(input.projectDir, input.importId)
  const completed = new Set(progress.completedSourcePaths)
  let processedThisRun = 0

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
        }
        continue
      }
    }
    if (completed.has(sourcePath)) {
      stats.pagesSkipped += 1
      continue
    }

    const extracted = await readExtractedText(input.projectDir, sourcePath)
    const analysisRel = ingestAnalysisRelativePath(input.importId, sourcePath)
    const analysisAbs = path.join(input.projectDir, ...analysisRel.split('/'))
    let analysis = await readJsonFile<SourceAnalysis>(analysisAbs)
    if (!analysis) {
      analysis = await runStep1Analyze(ai, sourcePath, extracted.text)
      await writeJsonFile(analysisAbs, analysis)
    }
    await runStep2WriteSourcePage(input.projectDir, analysis, extracted.fingerprint, input.importId, store)
    stats.pagesWritten += 1
    completed.add(sourcePath)
    progress.completedSourcePaths.push(sourcePath)
    await writeIngestProgress(input.projectDir, progress)
    await writeFingerprintStore(input.projectDir, store)
    processedThisRun += 1
    if (input.interruptAfter !== undefined && processedThisRun >= input.interruptAfter) {
      throw new IngestInterruptedError(`Ingest 在 ${processedThisRun} 个来源后中断`)
    }
  }

  const allTextSourcesDone = textSources.every((sourcePath) => progress.completedSourcePaths.includes(sourcePath))
  if (!progress.metaPagesUpdated && allTextSourcesDone && textSources.length > 0) {
    const analysesForMeta: SourceAnalysis[] = []
    for (const sourcePath of textSources) {
      const analysisRel = ingestAnalysisRelativePath(input.importId, sourcePath)
      const analysisAbs = path.join(input.projectDir, ...analysisRel.split('/'))
      const saved = await readJsonFile<SourceAnalysis>(analysisAbs)
      if (saved) {
        analysesForMeta.push(saved)
      }
    }
    if (analysesForMeta.length !== textSources.length) {
      throw new Error('Ingest 分析文件不完整，无法更新索引页')
    }
    {
      const indexExisting = (await readWikiText(input.projectDir, 'wiki/index.md')) ?? '# Knowledge index\n\n'
      const overviewExisting = (await readWikiText(input.projectDir, 'wiki/overview.md')) ?? '# Overview\n\n'
      const logExisting = (await readWikiText(input.projectDir, 'wiki/log.md')) ?? '# Change log\n\n'
      const meta = await runStep2MetaPages(ai, input.importId, analysesForMeta, indexExisting, overviewExisting)
      await fs.writeFile(path.join(input.projectDir, 'wiki/index.md'), meta.indexMarkdown, 'utf8')
      await fs.writeFile(path.join(input.projectDir, 'wiki/overview.md'), meta.overviewMarkdown, 'utf8')
      await fs.writeFile(path.join(input.projectDir, 'wiki/log.md'), `${logExisting.trimEnd()}\n\n${meta.logAppend}`, 'utf8')
      progress.metaPagesUpdated = true
      await writeIngestProgress(input.projectDir, progress)
    }
  }

  await writeFingerprintStore(input.projectDir, store)
  return stats
}