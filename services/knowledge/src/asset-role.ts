export const ASSET_ROLE_CONFIDENCE_THRESHOLD = 0.55 as const

export const KNOWLEDGE_ASSET_ROLES = [
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

export type KnowledgeAssetRole = (typeof KNOWLEDGE_ASSET_ROLES)[number]

const ROLE_SET = new Set<string>(KNOWLEDGE_ASSET_ROLES)

export function isKnowledgeAssetRole(value: string): value is KnowledgeAssetRole {
  return ROLE_SET.has(value)
}

export function parseKnowledgeAssetRole(value: unknown): KnowledgeAssetRole | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  if (!isKnowledgeAssetRole(normalized)) {
    return null
  }
  return normalized
}

export type FinalizedAssetRole = {
  role: KnowledgeAssetRole
  storedConfidence: number
  needsReview: boolean
  reviewSuggestedRole?: KnowledgeAssetRole
  reviewReason?: string
}

export function finalizeAssetRoleAssignment(input: {
  suggestedRole: KnowledgeAssetRole
  confidence: number
  reason: string
}): FinalizedAssetRole {
  if (Number.isNaN(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error(`非法 confidence: ${input.confidence}`)
  }
  if (!input.reason.trim()) {
    throw new Error('角色识别缺少 reason')
  }
  if (input.confidence < ASSET_ROLE_CONFIDENCE_THRESHOLD) {
    return {
      role: 'other',
      storedConfidence: input.confidence,
      needsReview: true,
      reviewSuggestedRole: input.suggestedRole,
      reviewReason: input.reason.trim(),
    }
  }
  const role = input.suggestedRole === 'other' ? 'other' : input.suggestedRole
  return {
    role,
    storedConfidence: input.confidence,
    needsReview: false,
  }
}