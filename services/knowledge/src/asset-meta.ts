import fs from 'node:fs/promises'
import path from 'node:path'
import imageSize from 'image-size'
import type { SourceKind } from './source-kind.js'
import { mimeTypeForSourceExtension } from './source-kind.js'

export type AssetMetaRecord = {
  assetId: string
  sourcePath: string
  kind: Extract<SourceKind, 'image' | 'video'>
  mime: string
  sizeBytes: number
  width?: number
  height?: number
  importId: string
  fingerprint: string
}

export function assetMetaDir(projectDir: string): string {
  return path.join(projectDir, '.olps-knowledge', 'asset-meta')
}

export function assetMetaFilePath(projectDir: string, assetId: string): string {
  return path.join(assetMetaDir(projectDir), `${assetId}.json`)
}

export async function writeAssetMeta(projectDir: string, record: AssetMetaRecord): Promise<string> {
  const dir = assetMetaDir(projectDir)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${record.assetId}.json`)
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return path.relative(projectDir, filePath).split(path.sep).join('/')
}

export async function readAssetMeta(projectDir: string, assetId: string): Promise<AssetMetaRecord> {
  const raw = await fs.readFile(assetMetaFilePath(projectDir, assetId), 'utf8')
  return JSON.parse(raw) as AssetMetaRecord
}

export async function buildAssetMetaRecord(
  sourcePath: string,
  fileName: string,
  bytes: Buffer,
  kind: Extract<SourceKind, 'image' | 'video'>,
  assetId: string,
  importId: string,
  fingerprint: string,
): Promise<AssetMetaRecord> {
  const mime = mimeTypeForSourceExtension(fileName)
  if (!mime) {
    throw new Error(`missing mime mapping for asset: ${fileName}`)
  }
  const record: AssetMetaRecord = {
    assetId,
    sourcePath,
    kind,
    mime,
    sizeBytes: bytes.length,
    importId,
    fingerprint,
  }
  if (kind === 'image') {
    const dimensions = imageSize(bytes)
    if (dimensions.width !== undefined) {
      record.width = dimensions.width
    }
    if (dimensions.height !== undefined) {
      record.height = dimensions.height
    }
  }
  return record
}