import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeAssetRole } from './asset-role.js'

export type ReviewKind = 'asset_role_low_confidence'

export type ReviewRecord = {
  id: string
  kind: ReviewKind
  status: 'open' | 'resolved'
  createdAt: string
  importId?: string
  assetId?: string
  sourcePath?: string
  suggestedRole?: KnowledgeAssetRole
  confidence?: number
  reason?: string
}

function reviewsFilePath(projectDir: string): string {
  return path.join(projectDir, '.olps-knowledge', 'reviews.json')
}

export async function readProjectReviews(projectDir: string): Promise<ReviewRecord[]> {
  const abs = reviewsFilePath(projectDir)
  const raw = await fs.readFile(abs, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('reviews.json 必须是数组')
  }
  return parsed as ReviewRecord[]
}

async function writeProjectReviews(projectDir: string, records: ReviewRecord[]): Promise<void> {
  const abs = reviewsFilePath(projectDir)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

export async function appendAssetRoleReview(
  projectDir: string,
  input: {
    importId: string
    assetId: string
    sourcePath: string
    suggestedRole: KnowledgeAssetRole
    confidence: number
    reason: string
  },
): Promise<ReviewRecord> {
  const existing = await readProjectReviews(projectDir)
  const duplicate = existing.find(
    (item) => item.kind === 'asset_role_low_confidence' && item.assetId === input.assetId && item.status === 'open',
  )
  if (duplicate) {
    return duplicate
  }
  const record: ReviewRecord = {
    id: randomUUID(),
    kind: 'asset_role_low_confidence',
    status: 'open',
    createdAt: new Date().toISOString(),
    importId: input.importId,
    assetId: input.assetId,
    sourcePath: input.sourcePath,
    suggestedRole: input.suggestedRole,
    confidence: input.confidence,
    reason: input.reason,
  }
  existing.push(record)
  await writeProjectReviews(projectDir, existing)
  return record
}