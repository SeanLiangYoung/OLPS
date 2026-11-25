import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildAssetMetaRecord, readAssetMeta, writeAssetMeta } from './asset-meta.js'
import {
  readFingerprintStore,
  writeFingerprintStore,
  type FingerprintEntry,
  type FingerprintStore,
} from './project-fingerprints.js'
import { classifySourceByExtension } from './source-kind.js'
import { extractTextFromSource } from './text-extract.js'

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

async function processOneSourceFile(
  projectDir: string,
  sourcePath: string,
  importId: string,
  store: FingerprintStore,
  stats: SourceProcessingStats,
): Promise<void> {
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
    }
    return
  }

  const kind = classifySourceByExtension(fileName)
  if (kind === 'unsupported') {
    stats.skipped += 1
    const entry: FingerprintEntry = { sha256: fingerprint, kind: 'skipped' }
    store[sourcePath] = entry
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
  stats.assetsRegistered += 1
  stats.extracted += 1
  store[sourcePath] = {
    sha256: fingerprint,
    kind: assetKind,
    assetId,
  }
}

export async function processImportedSources(
  projectDir: string,
  writtenPaths: string[],
  importId: string,
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
    await processOneSourceFile(projectDir, sourcePath, importId, store, stats)
  }
  await writeFingerprintStore(projectDir, store)
  return stats
}