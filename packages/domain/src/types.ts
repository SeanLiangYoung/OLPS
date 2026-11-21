import type { ManagedSiteSettings } from './site-settings.js'
import type { SiteStatus } from './content.js'

export type SiteSettings = ManagedSiteSettings

export type UserRecord = {
  userId: string
  account: string
  name: string
}

export type SiteRecord = {
  siteId: string
  name: string
  status: SiteStatus
  settings: SiteSettings
  remoteSiteId: string | null
  publishedCommitId: string | null
  publicUrl: string | null
  createdAt: string
  updatedAt: string
}
export type DraftStatus = 'active' | 'syncing' | 'conflict' | 'error' | 'archived'

export type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

export type DraftInitStatus = 'initializing' | 'ready' | 'failed'

export type DraftRecord = {
  draftId: string
  siteId: string
  name: string
  initStatus: DraftInitStatus
  settings: SiteSettings
  sandboxId: string
  baseCommitId: string | null
  headCommitId: string | null
  status: DraftStatus
  syncStatus?: DraftSyncStatus
  conflictMessage?: string | null
  conflictSummary?: string | null
  validationLog?: string | null
  pendingOperation?: 'pull' | 'push' | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
}
