export type SyncRemoteConfig = {
  baseUrl: string
  token: string
}

export type SyncBuildConfig = {
  verifyCommand?: string[]
  buildCommand?: string[]
  buildEnvironment?: () => Promise<Record<string,string>>
}

export type SyncWorkspaceOpenOptions = {
  sandboxRoot: string
  draftId: string
  remote: SyncRemoteConfig
  remoteSiteId?: string | null
  baseCommitId?: string | null
  headCommitId?: string | null
  build?: SyncBuildConfig
  onPushPrepared?: (candidate:{remoteSiteId:string;headCommitId:string})=>Promise<void>
}

export type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

export type DraftSyncState = {
  draftId: string
  workspacePath: string
  remoteSiteId: string | null
  baseCommitId: string | null
  headCommitId: string | null
  status: DraftSyncStatus
  conflictSummary?: string
  validationLog?: string
  pendingIncomingCommitId?: string | null
  agentFailureLog?: string
}

export type CommitResult = {
  headCommitId: string
  status: DraftSyncStatus
}

export type PullResult = {
  remoteSiteId: string
  baseCommitId: string
  headCommitId: string
  status: DraftSyncStatus
  conflictSummary?: string
  pendingIncomingCommitId?: string | null
}

export type PushResult = {
  remoteSiteId: string
  publishedCommitId: string
  deploymentId: string
  publicUrl: string
  baseCommitId: string
  headCommitId: string
  status: DraftSyncStatus
  conflictSummary?: string
  error?: string
}

export type AgentContinueInput = {
  userMessage: string
}

export type RunValidationResult = {
  ok: boolean
  exitCode: number
  log: string
  status: DraftSyncStatus
}
