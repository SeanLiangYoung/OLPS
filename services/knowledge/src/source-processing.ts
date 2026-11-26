import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildAssetMetaRecord, readAssetMeta, writeAssetMeta } from './asset-meta.js'
import { patchImportItem } from './import-items.js'
import {
  readFingerprintStore,
  writeFingerprintStore,
  type FingerprintEntry,
  type FingerprintStore,
} from './project-fingerprints.js'
import { classifySourceByExtension } from './source-kind.js'
import { extractTextFromSource } from './text-extract.js'

async function markItemSafe(
  projectDir: string,
  importId: string,
  sourcePath: string,
  patch: Parameters<typeof patchImportItem>[3],
): Promise<void> {
  try {
    await patchImportItem(projectDir, importId, sourcePath, patch)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('items.json 不存在') || message.includes('items 中缺少来源')) {
      return
    }
    throw err
  }
}

export type SourceProcessingStats = {
  extracted: number
  skipped: number
  fingerprintSkips: number
  assetsRegistered: number
}

export type ExtractedTextRecord = {
  sourcePath: string
  text: string
  importId: string
  fingerprint: string
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function extractedRelativePathForSource(sourcePath: string): string {
  return `.olps-knowledge/extracted/${sourcePath}.json`
}

async function writeExtractedText(
  projectDir: string,
  relativePath: string,
  record: ExtractedTextRecord,
): Promise<void> {
  const abs = path.join(projectDir, ...relativePath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export async function readExtractedText(
  projectDir: string,
  sourcePath: string,
): Promise<ExtractedTextRecord> {
  const relativePath = extractedRelativePathForSource(sourcePath)
  const abs = path.join(projectDir, ...relativePath.split('/'))
  const raw = await fs.readFile(abs, 'utf8')
  return JSON.parse(raw) as ExtractedTextRecord
}

export type ProcessImportedSourcesOptions = {
  /** 素材 meta 写入后立刻投影，供导入过程中刷新媒体资料列表 */
  projectAsset?: (assetId: string) => Promise<void>
}

async function processOneSourceFile(
  projectDir: string,
  sourcePath: string,
  importId: string,
  store: FingerprintStore,
  stats: SourceProcessingStats,
  projectAsset?: (assetId: string) => Promise<void>,
): Promise<void> {
  await markItemSafe(projectDir, importId, sourcePath, {
    status: 'extracting',
    error: null,
  })
  const abs = path.join(projectDir, ...sourcePath.split('/'))
  const bytes = await fs.readFile(abs)
  const fileName = path.posix.basename(sourcePath)
  const fingerprint = sha256Hex(bytes)
  const existing = store[sourcePath]
  if (existing && existing.sha256 === fingerprint) {
    stats.fingerprintSkips += 1
    if (existing.assetId && existing.kind !== 'text' && existing.kind !== 'skipped') {
      const meta = await readAssetMeta(projectDir, existing.assetId)
      await writeAssetMeta(projectDir, { ...meta, importId })
      if (projectAsset) {
        await projectAsset(existing.assetId)
      }
    }
    if (existing.kind === 'skipped') {
      await markItemSafe(projectDir, importId, sourcePath, {
        status: 'skipped_unsupported',
        fingerprint,
        kind: 'skipped',
        error: null,
      })
    } else if (existing.kind !== 'text') {
      await markItemSafe(projectDir, importId, sourcePath, {
        status: 'succeeded',
        fingerprint,
        kind: existing.kind,
        error: null,
      })
    } else {
      await markItemSafe(projectDir, importId, sourcePath, {
        status: 'pending',
        fingerprint,
        kind: 'text',
        error: null,
      })
    }
    return
  }

  const kind = classifySourceByExtension(fileName)
  if (kind === 'unsupported') {
    stats.skipped += 1
    const entry: FingerprintEntry = { sha256: fingerprint, kind: 'skipped' }
    store[sourcePath] = entry
    await markItemSafe(projectDir, importId, sourcePath, {
      status: 'skipped_unsupported',
      fingerprint,
      kind: 'skipped',
      error: null,
    })
    return
  }

  if (kind === 'text') {
    let text: string
    try {
      text = await extractTextFromSource(bytes, fileName)
    } catch {
      // 损坏的 docx/xlsx、Office 临时锁文件（~$*.docx）等：跳过并继续其余文件
      stats.skipped += 1
      store[sourcePath] = { sha256: fingerprint, kind: 'skipped' }
      await markItemSafe(projectDir, importId, sourcePath, {
        status: 'skipped_unsupported',
        fingerprint,
        kind: 'skipped',
        error: '文本抽取失败或文件损坏',
      })
      return
    }
    const extractedRel = extractedRelativePathForSource(sourcePath)
    await writeExtractedText(projectDir, extractedRel, {
      sourcePath,
      text,
      importId,
      fingerprint,
    })
    stats.extracted += 1
    store[sourcePath] = {
      sha256: fingerprint,
      kind: 'text',
      extractedRelativePath: extractedRel,
    }
    await markItemSafe(projectDir, importId, sourcePath, {
      status: 'pending',
      fingerprint,
      kind: 'text',
      error: null,
    })
    return
  }

  const assetKind = kind
  const assetId = existing?.assetId ?? randomUUID()
  const meta = await buildAssetMetaRecord(sourcePath, fileName, bytes, assetKind, assetId, importId, fingerprint)
  if (existing?.assetId) {
    const prior = await readAssetMeta(projectDir, assetId)
    meta.role = prior.role
    meta.roleConfidence = prior.roleConfidence
    meta.roleReason = prior.roleReason
    meta.roleAssignedFingerprint = prior.roleAssignedFingerprint
  }
  await writeAssetMeta(projectDir, meta)
  if (projectAsset) {
    await projectAsset(assetId)
  }
  stats.assetsRegistered += 1
  stats.extracted += 1
  store[sourcePath] = {
    sha256: fingerprint,
    kind: assetKind,
    assetId,
  }
  await markItemSafe(projectDir, importId, sourcePath, {
    status: 'succeeded',
    fingerprint,
    kind: assetKind,
    error: null,
  })
}

export async function processImportedSources(
  projectDir: string,
  writtenPaths: string[],
  importId: string,
  options?: ProcessImportedSourcesOptions,
): Promise<SourceProcessingStats> {
  const store = await readFingerprintStore(projectDir)
  const stats: SourceProcessingStats = {
    extracted: 0,
    skipped: 0,
    fingerprintSkips: 0,
    assetsRegistered: 0,
  }
  const ordered = [...writtenPaths].sort()
  for (const sourcePath of ordered) {
    await processOneSourceFile(projectDir, sourcePath, importId, store, stats, options?.projectAsset)
  }
  await writeFingerprintStore(projectDir, store)
  return stats
}