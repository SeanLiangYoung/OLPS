import fs from 'node:fs/promises'
import path from 'node:path'
import { assetMetaDir, readAssetMeta } from './asset-meta.js'
import type { AssetMetaRecord } from './asset-meta.js'
import { isKnowledgeAssetRole, type KnowledgeAssetRole } from './asset-role.js'

export type AssetListItem = {
  assetId: string
  sourcePath: string
  kind: AssetMetaRecord['kind']
  mime: string
  sizeBytes: number
  width?: number
  height?: number
  importId: string
  fingerprint: string
  role: KnowledgeAssetRole
  roleConfidence?: number
  roleReason?: string
}

function normalizeRole(meta: AssetMetaRecord): KnowledgeAssetRole {
  if (meta.role && isKnowledgeAssetRole(meta.role)) {
    return meta.role
  }
  return 'other'
}

export async function listAllAssetMetaRecords(projectDir: string): Promise<AssetMetaRecord[]> {
  const dir = assetMetaDir(projectDir)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  const assetIds = names.filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''))
  assetIds.sort()
  const records: AssetMetaRecord[] = []
  for (const assetId of assetIds) {
    records.push(await readAssetMeta(projectDir, assetId))
  }
  return records
}

export function assetMetaToListItem(meta: AssetMetaRecord): AssetListItem {
  return {
    assetId: meta.assetId,
    sourcePath: meta.sourcePath,
    kind: meta.kind,
    mime: meta.mime,
    sizeBytes: meta.sizeBytes,
    width: meta.width,
    height: meta.height,
    importId: meta.importId,
    fingerprint: meta.fingerprint,
    role: normalizeRole(meta),
    roleConfidence: meta.roleConfidence,
    roleReason: meta.roleReason,
  }
}

export async function listProjectAssets(
  projectDir: string,
  roleFilter?: KnowledgeAssetRole,
): Promise<AssetListItem[]> {
  const items = (await listAllAssetMetaRecords(projectDir)).map(assetMetaToListItem)
  if (!roleFilter) {
    return items
  }
  return items.filter((item) => item.role === roleFilter)
}

export async function rebuildAssetsCatalogMarkdown(projectDir: string): Promise<void> {
  const records = await listAllAssetMetaRecords(projectDir)
  records.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
  const lines: string[] = ['# Assets catalog', '']
  if (records.length === 0) {
    lines.push('_暂无登记素材。_', '')
  } else {
    lines.push('| assetId | role | sourcePath | mime | sizeBytes | width | height | confidence |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const meta of records) {
      const role = normalizeRole(meta)
      const width = meta.width ?? ''
      const height = meta.height ?? ''
      const confidence = meta.roleConfidence ?? ''
      lines.push(
        `| \`${meta.assetId}\` | ${role} | \`${meta.sourcePath}\` | ${meta.mime} | ${meta.sizeBytes} | ${width} | ${height} | ${confidence} |`,
      )
    }
    lines.push('')
  }
  const abs = path.join(projectDir, 'wiki', 'assets-catalog.md')
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, `${lines.join('\n')}\n`, 'utf8')
}