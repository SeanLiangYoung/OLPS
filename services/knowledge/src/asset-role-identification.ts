import path from 'node:path'
import { completeJson } from './ai-client.js'
import type { KnowledgeAiConfig } from './ai-config.js'
import { requireKnowledgeAiConfig } from './ai-config.js'
import { readAssetMeta, writeAssetMeta } from './asset-meta.js'
import type { AssetMetaRecord } from './asset-meta.js'
import {
  finalizeAssetRoleAssignment,
  KNOWLEDGE_ASSET_ROLES,
  parseKnowledgeAssetRole,
} from './asset-role.js'
import { rebuildAssetsCatalogMarkdown } from './assets-catalog.js'
import { appendAssetRoleReview } from './project-reviews.js'
import { readExtractedText } from './source-processing.js'
import { classifySourceByExtension } from './source-kind.js'
import { patchImportItem } from './import-items.js'
import {
  readFingerprintStore,
  type FingerprintStore,
} from './project-fingerprints.js'

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

export type AssetRoleIdentificationStats = {
  identified: number
  skippedAlready: number
  reviewsAdded: number
}

function isMediaSourcePath(sourcePath: string): boolean {
  const fileName = path.posix.basename(sourcePath)
  const kind = classifySourceByExtension(fileName)
  return kind === 'image' || kind === 'video'
}

/** Office 打开文档时产生的临时锁文件（扩展名仍是 .docx/.xlsx 等） */
function isOfficeLockFileName(fileName: string): boolean {
  return fileName.startsWith('~$')
}

/**
 * 汇总包内已成功抽取的文字，供素材角色识别参考。
 * 跳过 Office 锁文件、fingerprint 非 text 的来源，以及 extracted JSON 缺失的条目。
 */
export async function collectPackageTextSummary(
  projectDir: string,
  writtenPaths: string[],
  store: FingerprintStore,
): Promise<string> {
  const parts: string[] = []
  for (const sourcePath of [...writtenPaths].sort()) {
    const fileName = path.posix.basename(sourcePath)
    if (isOfficeLockFileName(fileName)) {
      continue
    }
    if (classifySourceByExtension(fileName) !== 'text') {
      continue
    }
    const entry = store[sourcePath]
    if (!entry || entry.kind !== 'text') {
      continue
    }
    let extracted
    try {
      extracted = await readExtractedText(projectDir, sourcePath)
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        continue
      }
      throw err
    }
    const snippet = extracted.text.replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (snippet) {
      parts.push(`[${sourcePath}]\n${snippet}`)
    }
  }
  return parts.join('\n\n').slice(0, 24_000)
}

type AiAssetRoleRow = {
  assetId: string
  role: string
  confidence: number
  reason: string
}

function parseAiAssetRoles(payload: Record<string, unknown>, expectedIds: Set<string>): Map<string, AiAssetRoleRow> {
  const rowsRaw = payload.assets
  if (!Array.isArray(rowsRaw)) {
    throw new Error('角色识别 AI 返回缺少 assets 数组')
  }
  const out = new Map<string, AiAssetRoleRow>()
  for (const item of rowsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const assetId = (item as { assetId?: unknown }).assetId
    const role = (item as { role?: unknown }).role
    const confidence = (item as { confidence?: unknown }).confidence
    const reason = (item as { reason?: unknown }).reason
    if (typeof assetId !== 'string' || !expectedIds.has(assetId)) {
      continue
    }
    const parsedRole = parseKnowledgeAssetRole(role)
    if (!parsedRole) {
      throw new Error(`非法 role: ${String(role)}（assetId=${assetId}）`)
    }
    if (typeof confidence !== 'number') {
      throw new Error(`非法 confidence（assetId=${assetId}）`)
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new Error(`非法 reason（assetId=${assetId}）`)
    }
    out.set(assetId, {
      assetId,
      role: parsedRole,
      confidence,
      reason: reason.trim(),
    })
  }
  for (const assetId of expectedIds) {
    if (!out.has(assetId)) {
      throw new Error(`角色识别 AI 未返回 assetId: ${assetId}`)
    }
  }
  return out
}

async function identifyRolesWithAi(
  ai: KnowledgeAiConfig,
  assets: AssetMetaRecord[],
  packageTextSummary: string,
): Promise<Map<string, AiAssetRoleRow>> {
  const expectedIds = new Set(assets.map((item) => item.assetId))
  const payload = await completeJson(ai, {
    system: `你是素材用途分类助手。根据路径、文件名与同包文字摘要，为每个素材选择 role。role 只能是以下枚举之一：${KNOWLEDGE_ASSET_ROLES.join(', ')}。输出严格 JSON：{"assets":[{"assetId","role","confidence"(0-1),"reason"}]}。不要输出 markdown 代码围栏。`,
    user: JSON.stringify({
      packageTextSummary,
      assets: assets.map((item) => ({
        assetId: item.assetId,
        sourcePath: item.sourcePath,
        kind: item.kind,
        mime: item.mime,
        width: item.width ?? null,
        height: item.height ?? null,
      })),
    }),
  })
  return parseAiAssetRoles(payload, expectedIds)
}

export async function runAssetRoleIdentification(input: {
  projectDir: string
  importId: string
  writtenPaths: string[]
  ai?: KnowledgeAiConfig
  /** 角色写入 meta 后立刻投影，供导入过程中刷新媒体资料角色 */
  projectAsset?: (assetId: string) => Promise<void>
}): Promise<AssetRoleIdentificationStats> {
  const stats: AssetRoleIdentificationStats = {
    identified: 0,
    skippedAlready: 0,
    reviewsAdded: 0,
  }
  const store = await readFingerprintStore(input.projectDir)
  const pending: AssetMetaRecord[] = []
  for (const sourcePath of input.writtenPaths) {
    if (!isMediaSourcePath(sourcePath)) {
      continue
    }
    const entry = store[sourcePath]
    if (!entry?.assetId) {
      continue
    }
    const meta = await readAssetMeta(input.projectDir, entry.assetId)
    if (meta.importId !== input.importId) {
      continue
    }
    if (meta.roleAssignedFingerprint === meta.fingerprint && meta.role) {
      stats.skippedAlready += 1
      continue
    }
    pending.push(meta)
  }
  if (pending.length === 0) {
    await rebuildAssetsCatalogMarkdown(input.projectDir)
    return stats
  }

  try {
    const ai = input.ai ?? requireKnowledgeAiConfig(process.env)
    const packageTextSummary = await collectPackageTextSummary(
      input.projectDir,
      input.writtenPaths,
      store,
    )
    const aiRows = await identifyRolesWithAi(ai, pending, packageTextSummary)

    for (const meta of pending) {
      try {
        const row = aiRows.get(meta.assetId)
        if (!row) {
          throw new Error(`内部错误：缺少 AI 行 ${meta.assetId}`)
        }
        const parsedRole = parseKnowledgeAssetRole(row.role)
        if (!parsedRole) {
          throw new Error(`非法 AI role: ${row.role}`)
        }
        const finalized = finalizeAssetRoleAssignment({
          suggestedRole: parsedRole,
          confidence: row.confidence,
          reason: row.reason,
        })
        const updated: AssetMetaRecord = {
          ...meta,
          role: finalized.role,
          roleConfidence: finalized.storedConfidence,
          roleReason: row.reason,
          roleAssignedFingerprint: meta.fingerprint,
        }
        await writeAssetMeta(input.projectDir, updated)
        if (input.projectAsset) {
          await input.projectAsset(meta.assetId)
        }
        stats.identified += 1
        if (finalized.needsReview && finalized.reviewSuggestedRole) {
          await appendAssetRoleReview(input.projectDir, {
            importId: meta.importId,
            assetId: meta.assetId,
            sourcePath: meta.sourcePath,
            suggestedRole: finalized.reviewSuggestedRole,
            confidence: finalized.storedConfidence,
            reason: finalized.reviewReason ?? row.reason,
          })
          stats.reviewsAdded += 1
        }
        await markItemSafe(input.projectDir, input.importId, meta.sourcePath, {
          status: 'succeeded',
          fingerprint: meta.fingerprint,
          kind: meta.kind,
          error: null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await markItemSafe(input.projectDir, input.importId, meta.sourcePath, {
          status: 'failed',
          fingerprint: meta.fingerprint,
          kind: meta.kind,
          error: message,
        })
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    for (const meta of pending) {
      await markItemSafe(input.projectDir, input.importId, meta.sourcePath, {
        status: 'failed',
        fingerprint: meta.fingerprint,
        kind: meta.kind,
        error: message,
      })
    }
  }

  await rebuildAssetsCatalogMarkdown(input.projectDir)
  return stats
}