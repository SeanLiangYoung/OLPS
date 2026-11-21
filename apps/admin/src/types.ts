import type { ManagedSiteSettings } from '@olps/domain'

export type DraftStatus = 'active' | 'syncing' | 'conflict' | 'error'

/** sandbox Git 工作区处理状态（API 透传 @olps/sync） */
export type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

export type User = {
  userId: string
  account: string
  name: string
}

export type PublishedSite = {
  siteId: string
  name: string
  settings?: SiteSettings
  remoteSiteId?: string
  publishedCommitId?: string | null
  publicUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

export type SiteDraft = {
  draftId: string
  siteId: string
  name: string
  settings: SiteSettings
  sandboxId: string
  baseCommitId: string | null
  headCommitId: string | null
  status: DraftStatus
  syncStatus?: DraftSyncStatus | null
  conflictMessage?: string | null
  conflictSummary?: string | null
  validationLog?: string | null
  lastError?: string | null
  pendingOperation?: 'pull' | 'push' | null
  createdAt: string
  updatedAt: string
}

export type SiteSettings = ManagedSiteSettings
