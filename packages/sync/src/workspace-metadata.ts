import fs from 'node:fs/promises'
import path from 'node:path'
import type { DraftSyncStatus } from './types.js'

export type PersistedDraftMeta = {
  draftId: string
  remoteSiteId: string | null
  baseCommitId: string | null
  pendingIncomingCommitId: string | null
  status: DraftSyncStatus | null
  conflictSummary?: string
  validationLog?: string
  agentFailureLog?: string
}

function metaPath(intermediateRoot: string, draftId: string): string {
  return path.join(intermediateRoot, 'meta', `${draftId}.json`)
}

export async function loadDraftMeta(
  intermediateRoot: string,
  draftId: string,
): Promise<PersistedDraftMeta | null> {
  const file = metaPath(intermediateRoot, draftId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as PersistedDraftMeta
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

export async function saveDraftMeta(
  intermediateRoot: string,
  meta: PersistedDraftMeta,
): Promise<void> {
  const file = metaPath(intermediateRoot, meta.draftId)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

export async function clearDraftMeta(intermediateRoot: string, draftId: string): Promise<void> {
  await fs.rm(metaPath(intermediateRoot, draftId), { force: true })
}
