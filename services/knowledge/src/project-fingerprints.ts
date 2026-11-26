import fs from 'node:fs/promises'
import path from 'node:path'
import type { SourceKind } from './source-kind.js'

export type FingerprintKind = SourceKind | 'skipped'

export type FingerprintEntry = {
  sha256: string
  kind: FingerprintKind
  assetId?: string
  extractedRelativePath?: string
  wikiPath?: string
  /** 同一源文件按产品拆出的 wiki 页路径 */
  productWikiPaths?: string[]
  /** 若本页为指向已有摘要的 alias，则记录目标摘要 wiki 路径 */
  aliasOfWikiPath?: string
  ingestedSha256?: string
}

export type FingerprintStore = Record<string, FingerprintEntry>

function fingerprintsFilePath(projectDir: string): string {
  return path.join(projectDir, '.olps-knowledge', 'fingerprints.json')
}

export async function readFingerprintStore(projectDir: string): Promise<FingerprintStore> {
  const filePath = fingerprintsFilePath(projectDir)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return {}
    }
    throw err
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('fingerprints.json must be an object')
  }
  return parsed as FingerprintStore
}

export async function writeFingerprintStore(projectDir: string, store: FingerprintStore): Promise<void> {
  const filePath = fingerprintsFilePath(projectDir)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}