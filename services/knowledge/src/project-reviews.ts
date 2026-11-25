import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeAssetRole } from './asset-role.js'

export type ReviewKind = 'asset_role_low_confidence' | 'ingest_rejected_update'

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
  let raw: string
  try {
    raw = await fs.readFile(abs, 'utf8')
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
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

export async function appendIngestRejectedUpdateReview(
  projectDir: string,
  input: {
    importId: string
    sourcePath: string
    attemptedTargetWikiPath: string
    aiReason: string
  },
): Promise<ReviewRecord> {
  const existing = await readProjectReviews(projectDir)
  const record: ReviewRecord = {
    id: randomUUID(),
    kind: 'ingest_rejected_update',
    status: 'open',
    createdAt: new Date().toISOString(),
    importId: input.importId,
    sourcePath: input.sourcePath,
    reason: `拒绝无关 update：目标 ${input.attemptedTargetWikiPath}；${input.aiReason}`,
  }
  existing.push(record)
  await writeProjectReviews(projectDir, existing)
  return record
}

export class ReviewMutationError extends Error {
  readonly code: 'review_not_found' | 'review_already_resolved'

  constructor(code: ReviewMutationError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export async function resolveProjectReview(projectDir: string, reviewId: string): Promise<ReviewRecord> {
  const existing = await readProjectReviews(projectDir)
  const index = existing.findIndex((item) => item.id === reviewId)
  if (index < 0) {
    throw new ReviewMutationError('review_not_found', `review not found: ${reviewId}`)
  }
  const current = existing[index]!
  if (current.status === 'resolved') {
    throw new ReviewMutationError('review_already_resolved', `review already resolved: ${reviewId}`)
  }
  const updated: ReviewRecord = { ...current, status: 'resolved' }
  existing[index] = updated
  await writeProjectReviews(projectDir, existing)
  return updated
}