export type KnowledgeAssetRef = {
  assetId: string
  role: string | null
}

export type KnowledgeDocumentWithAssets = {
  documentId: string
  assets: KnowledgeAssetRef[]
}

export type SelectedKnowledgeAssetSummary = {
  total: number
  byRole: Record<string, number>
  summaryText: string
}

const UNLABELED_ROLE = '未标注'

function roleKey(role: string | null): string {
  if (role === null || role.trim() === '') return UNLABELED_ROLE
  return role
}

export function summarizeSelectedKnowledgeAssets(
  selectedDocumentIds: string[],
  documents: KnowledgeDocumentWithAssets[],
): SelectedKnowledgeAssetSummary {
  if (selectedDocumentIds.length === 0) {
    return { total: 0, byRole: {}, summaryText: '共 0 个素材' }
  }

  const selected = new Set(selectedDocumentIds)
  const byAssetId = new Map<string, string | null>()
  for (const document of documents) {
    if (!selected.has(document.documentId)) continue
    for (const asset of document.assets) {
      if (!byAssetId.has(asset.assetId)) {
        byAssetId.set(asset.assetId, asset.role)
      }
    }
  }

  const byRole: Record<string, number> = {}
  for (const role of byAssetId.values()) {
    const key = roleKey(role)
    byRole[key] = (byRole[key] ?? 0) + 1
  }

  const total = byAssetId.size
  if (total === 0) {
    return { total: 0, byRole: {}, summaryText: '共 0 个素材' }
  }

  const roleParts = Object.entries(byRole)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role} ${count}`)
  return {
    total,
    byRole,
    summaryText: `共 ${total} 个素材：${roleParts.join('、')}`,
  }
}
