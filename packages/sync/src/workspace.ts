import fs from 'node:fs/promises'
import path from 'node:path'
import { git, gitOrThrow } from './git-exec.js'
import { assertSafeRelativePath, SITE_PATHS } from './paths.js'
import { assertWorkspaceReadPath, assertWorkspaceWritePath } from './path-guard.js'
import {
  remoteCreateSite,
  remoteDownloadBundle,
  remoteGetSite,
  remotePushBundle,
  RemotePushError,
} from './remote-client.js'
import { continueAfterUser, resolveConflictsWithAgent } from './agent-merge.js'
import { runWorkspaceValidation } from './validation.js'
import { loadDraftMeta, saveDraftMeta } from './workspace-metadata.js'
import { resolveSyncIntermediateRoot } from './sync-intermediate.js'
import {
  bootstrapRepoFromSiteBundle,
  createGitBundle,
  fetchBundleIntoRepo,
  gitMergeInProgress,
  gitUnmergedPaths,
} from './git-bundle.js'
import {
  applyRepoLocalLineEndingPolicy,
  binaryGitAttributesContent,
} from './git-line-endings.js'
import type {
  AgentContinueInput,
  CommitResult,
  DraftSyncState,
  DraftSyncStatus,
  PullResult,
  PushResult,
  RunValidationResult,
  SyncWorkspaceOpenOptions,
} from './types.js'

export class SyncWorkspace {
  private constructor(
    private readonly options: SyncWorkspaceOpenOptions,
    private readonly workspacePath: string,
    private readonly intermediateRoot: string,
    private remoteSiteId: string | null,
    private baseCommitId: string | null,
    private pendingIncomingCommitId: string | null,
    private conflictSummary?: string,
    private validationLog?: string,
    private agentFailureLog?: string,
    private persistedStatus: DraftSyncStatus | null = null,
  ) {}

  static async create(options: SyncWorkspaceOpenOptions): Promise<SyncWorkspace> {
    const intermediateRoot = resolveSyncIntermediateRoot(options.sandboxRoot)
    await fs.mkdir(options.sandboxRoot, { recursive: true })
    const workspacePath = path.join(options.sandboxRoot, options.draftId)

    const existing = await pathExists(path.join(workspacePath, '.git'))
    if (existing) {
      throw new Error(`工作目录已存在: ${workspacePath}`)
    }

    let remoteSiteId = options.remoteSiteId ?? null
    let baseCommitId = options.baseCommitId ?? null

    if (remoteSiteId && baseCommitId) {
      const bundlePath = path.join(intermediateRoot, 'bundles', `${options.draftId}-init.bundle`)
      await remoteDownloadBundle(options.remote, remoteSiteId, bundlePath)
      const cloneParent = path.join(intermediateRoot, 'repos', options.draftId)
      const repoDirName = `repo-${Date.now().toString(36)}`
      const repoRoot = path.join(cloneParent, repoDirName)
      await fs.mkdir(repoRoot, { recursive: true })
      const importRef = `refs/olps/import/${options.draftId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
      bootstrapRepoFromSiteBundle({
        repoRoot,
        bundlePath,
        baseCommitId,
        importRef,
      })
      await fs.rm(workspacePath, { recursive: true, force: true })
      const draftBranch = `olps/${options.draftId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
      gitOrThrow(repoRoot, ['worktree', 'add', '-b', draftBranch, workspacePath, baseCommitId])
      applyRepoLocalLineEndingPolicy(workspacePath)
      const workHead = gitOrThrow(workspacePath, ['rev-parse', 'HEAD'])
      if (workHead !== baseCommitId) {
        throw new Error(`worktree HEAD 与 baseCommitId 不一致: ${workHead} vs ${baseCommitId}`)
      }
    } else {
      await fs.mkdir(workspacePath, { recursive: true })
      gitOrThrow(workspacePath, ['init', '-b', 'main'])
      applyRepoLocalLineEndingPolicy(workspacePath)
      await writeInitialTree(workspacePath, options.build)
      gitOrThrow(workspacePath, ['add', '-A'])
      gitOrThrow(workspacePath, ['commit', '-m', 'init: empty site workspace'])
      baseCommitId = gitOrThrow(workspacePath, ['rev-parse', 'HEAD'])
    }

    const ws = new SyncWorkspace(
      options,
      workspacePath,
      intermediateRoot,
      remoteSiteId,
      baseCommitId,
      null,
    )
    await ws.persistMeta('clean')
    return ws
  }

  static async open(options: SyncWorkspaceOpenOptions): Promise<SyncWorkspace> {
    const workspacePath = path.join(options.sandboxRoot, options.draftId)
    const gitDir = path.join(workspacePath, '.git')
    if (!(await pathExists(gitDir))) {
      throw new Error(`工作目录不存在: ${workspacePath}`)
    }
    const intermediateRoot = resolveSyncIntermediateRoot(options.sandboxRoot)
    const head = gitOrThrow(workspacePath, ['rev-parse', 'HEAD'])
    if (options.headCommitId && options.headCommitId !== head) {
      throw new Error(`headCommitId 不匹配: 期望 ${options.headCommitId} 实际 ${head}`)
    }
    const meta = await loadDraftMeta(intermediateRoot, options.draftId)
    const ws = new SyncWorkspace(
      options,
      workspacePath,
      intermediateRoot,
      meta?.remoteSiteId ?? options.remoteSiteId ?? null,
      meta?.baseCommitId ?? options.baseCommitId ?? null,
      meta?.pendingIncomingCommitId ?? null,
      meta?.conflictSummary,
      meta?.validationLog,
      meta?.agentFailureLog,
      meta?.status ?? null,
    )
    return ws
  }

  getState(): DraftSyncState {
    const headCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD'])
    return {
      draftId: this.options.draftId,
      workspacePath: this.workspacePath,
      remoteSiteId: this.remoteSiteId,
      baseCommitId: this.baseCommitId,
      headCommitId,
      status: this.computeStatus(),
      conflictSummary: this.conflictSummary,
      validationLog: this.validationLog,
      pendingIncomingCommitId: this.pendingIncomingCommitId,
      agentFailureLog: this.agentFailureLog,
    }
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const full = await assertWorkspaceReadPath(this.workspacePath, relativePath)
    const stat = await fs.lstat(full)
    if (stat.isSymbolicLink()) {
      throw new Error(`路径不允许跟随符号链接: ${relativePath}`)
    }
    return fs.readFile(full)
  }

  async writeFile(relativePath: string, content: Buffer | Uint8Array): Promise<void> {
    const full = await assertWorkspaceWritePath(this.workspacePath, relativePath)
    await fs.writeFile(full, content)
  }

  async listFiles(relativePrefix = ''): Promise<string[]> {
    if (relativePrefix) {
      assertSafeRelativePath(relativePrefix)
    }
    const out: string[] = []
    await walkFiles(this.workspacePath, this.workspacePath, relativePrefix, out)
    return out.sort()
  }

  async saveVersion(message: string): Promise<CommitResult> {
    this.assertNoActiveMergeBlockingCommit()
    gitOrThrow(this.workspacePath, ['add', '-A'])
    gitOrThrow(this.workspacePath, ['commit', '-m', message])
    if (this.persistedStatus === 'validation_failed') {
      this.persistedStatus = null
      this.validationLog = undefined
      await this.persistMeta('clean')
    }
    return {
      headCommitId: gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD']),
      status: 'clean',
    }
  }

  async pull(): Promise<PullResult> {
    if (!this.remoteSiteId) {
      throw new Error('pull 需要 remoteSiteId')
    }
    const site = await remoteGetSite(this.options.remote, this.remoteSiteId)
    if (!site.publishedCommitId) {
      return {
        remoteSiteId: this.remoteSiteId,
        baseCommitId: this.baseCommitId ?? '',
        headCommitId: gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD']),
        status: 'clean',
      }
    }
    await this.ensureCommitPresent(site.publishedCommitId)
    const mergeStatus = await this.mergePublishedCommit(site.publishedCommitId)
    const headCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD'])
    if (mergeStatus === 'merge_conflict') {
      this.recordPendingIncomingForConflict(site.publishedCommitId)
      await this.persistMeta(this.computeStatus())
      return {
        remoteSiteId: this.remoteSiteId,
        baseCommitId: this.baseCommitId ?? '',
        headCommitId,
        status: this.computeStatus(),
        conflictSummary: this.conflictSummary,
        pendingIncomingCommitId: this.pendingIncomingCommitId,
      }
    }
    const regen = await this.regeneratePublicAfterMerge(site.publishedCommitId)
    if (regen !== 'clean') {
      this.persistedStatus = regen
      await this.persistMeta(regen)
      return {
        remoteSiteId: this.remoteSiteId,
        baseCommitId: this.baseCommitId ?? '',
        headCommitId: gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD']),
        status: regen,
        conflictSummary: this.conflictSummary,
      }
    }
    this.baseCommitId = site.publishedCommitId
    this.pendingIncomingCommitId = null
    this.persistedStatus = null
    this.conflictSummary = undefined
    await this.persistMeta('clean')
    return {
      remoteSiteId: this.remoteSiteId,
      baseCommitId: this.baseCommitId,
      headCommitId: gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD']),
      status: 'clean',
    }
  }

  async push(input?: { expectedPublishedCommitId?: string | null }): Promise<PushResult> {
    let remoteSiteId = this.remoteSiteId
    if (!remoteSiteId) {
      const created = await remoteCreateSite(this.options.remote)
      remoteSiteId = created.remoteSiteId
      this.remoteSiteId = remoteSiteId
      await this.persistMeta(this.computeStatus())
    }

    const site = await remoteGetSite(this.options.remote, remoteSiteId)
    const expected =
      input?.expectedPublishedCommitId !== undefined
        ? input.expectedPublishedCommitId
        : site.publishedCommitId

    if (site.publishedCommitId) {
      await this.ensureCommitPresent(site.publishedCommitId)
      const mergeStatus = await this.mergePublishedCommit(site.publishedCommitId)
      const headCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD'])
      if (mergeStatus === 'merge_conflict') {
        this.recordPendingIncomingForConflict(site.publishedCommitId)
        await this.persistMeta(this.computeStatus())
        return await this.failedPush(site, headCommitId, this.computeStatus())
      }
    }

    if (this.computeStatus() === 'dirty') {
      await this.saveVersion('sync: pre-push snapshot')
    }

    const validation = await runWorkspaceValidation(this.workspacePath, this.options.build)
    this.validationLog = validation.log
    if (!validation.ok) {
      const headCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD'])
      this.persistedStatus = 'validation_failed'
      await this.persistMeta('validation_failed')
      return await this.failedPush(site, headCommitId, 'validation_failed', validation.log)
    }

    const dirtyAfterValidation = git(this.workspacePath, ['status', '--porcelain']).stdout.trim()
    if (dirtyAfterValidation) {
      await this.saveVersion('sync: build and verify output')
    }

    const headCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD'])
    const bundlePath = path.join(
      this.intermediateRoot,
      'bundles',
      `${this.options.draftId}-push-${Date.now()}.bundle`,
    )
    await fs.mkdir(path.dirname(bundlePath), { recursive: true })
    createGitBundle({ workspacePath: this.workspacePath, bundlePath })

    try {
      const pushed = await remotePushBundle({
        remote: this.options.remote,
        remoteSiteId,
        bundlePath,
        commitId: headCommitId,
        expectedPublishedCommitId: expected,
      })
      this.baseCommitId = pushed.publishedCommitId
      this.pendingIncomingCommitId = null
      this.persistedStatus = null
      this.conflictSummary = undefined
      await this.persistMeta('clean')
      return {
        remoteSiteId,
        publishedCommitId: pushed.publishedCommitId,
        deploymentId: pushed.deploymentId,
        publicUrl: pushed.publicUrl,
        baseCommitId: this.baseCommitId,
        headCommitId: gitOrThrow(this.workspacePath, ['rev-parse', 'HEAD']),
        status: 'clean',
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof RemotePushError && err.status === 409) {
        return await this.failedVersionConflictPush(site, headCommitId, message)
      }
      if (err instanceof RemotePushError && err.status >= 400 && err.status < 500) {
        return await this.failedPush(site, headCommitId, 'validation_failed', message)
      }
      throw err
    }
  }

  async resolveConflictsWithAgent(): Promise<DraftSyncState> {
    const state = this.getState()
    const next = await resolveConflictsWithAgent({
      workspacePath: this.workspacePath,
      draftId: this.options.draftId,
      intermediateRoot: this.intermediateRoot,
      build: this.options.build,
      state,
    })
    this.conflictSummary = next.conflictSummary
    this.validationLog = next.validationLog
    this.agentFailureLog = next.agentFailureLog
    if (next.baseCommitId) {
      this.baseCommitId = next.baseCommitId
    }
    if (next.pendingIncomingCommitId === null) {
      this.pendingIncomingCommitId = null
    }
    this.persistedStatus = next.status === 'clean' ? null : next.status
    await this.persistMeta(next.status)
    return next
  }

  async continueAfterUser(input: AgentContinueInput): Promise<DraftSyncState> {
    const state = this.getState()
    const next = await continueAfterUser({
      ...input,
      workspacePath: this.workspacePath,
      draftId: this.options.draftId,
      intermediateRoot: this.intermediateRoot,
      build: this.options.build,
      state: { ...state, status: 'awaiting_user' },
    })
    this.conflictSummary = next.conflictSummary
    this.validationLog = next.validationLog
    this.agentFailureLog = next.agentFailureLog
    if (next.baseCommitId) {
      this.baseCommitId = next.baseCommitId
    }
    if (next.pendingIncomingCommitId === null) {
      this.pendingIncomingCommitId = null
    }
    this.persistedStatus = next.status === 'clean' ? null : next.status
    await this.persistMeta(next.status)
    return next
  }

  async runValidation(): Promise<RunValidationResult> {
    const result = await runWorkspaceValidation(this.workspacePath, this.options.build)
    this.validationLog = result.log
    return result
  }

  private async failedVersionConflictPush(
    site: Awaited<ReturnType<typeof remoteGetSite>>,
    headCommitId: string,
    error: string,
  ): Promise<PushResult> {
    return {
      remoteSiteId: this.remoteSiteId ?? '',
      publishedCommitId: site.publishedCommitId ?? '',
      deploymentId: site.deploymentId ?? '',
      publicUrl: site.publicUrl,
      baseCommitId: this.baseCommitId ?? '',
      headCommitId,
      status: 'dirty',
      error,
    }
  }

  private async failedPush(
    site: Awaited<ReturnType<typeof remoteGetSite>>,
    headCommitId: string,
    status: DraftSyncStatus,
    error?: string,
  ): Promise<PushResult> {
    if (status === 'validation_failed' || status === 'awaiting_user' || status === 'merge_conflict') {
      this.persistedStatus = status
      if (error && status === 'awaiting_user') {
        this.conflictSummary = error
      }
      await this.persistMeta(status)
    }
    return {
      remoteSiteId: this.remoteSiteId ?? '',
      publishedCommitId: site.publishedCommitId ?? '',
      deploymentId: site.deploymentId ?? '',
      publicUrl: site.publicUrl,
      baseCommitId: this.baseCommitId ?? '',
      headCommitId,
      status,
      error,
      conflictSummary: status === 'awaiting_user' ? error : undefined,
    }
  }

  private computeStatus(): DraftSyncStatus {
    if (
      this.persistedStatus === 'validation_failed' ||
      this.persistedStatus === 'awaiting_user'
    ) {
      return this.persistedStatus
    }
    const unmerged = gitUnmergedPaths(this.workspacePath)
    if (unmerged.length > 0) {
      return 'merge_conflict'
    }
    if (gitMergeInProgress(this.workspacePath)) {
      return 'merge_conflict'
    }
    const porcelain = git(this.workspacePath, ['status', '--porcelain'])
    if (porcelain.status !== 0) {
      throw new Error(`git status --porcelain 失败: ${porcelain.stderr || porcelain.stdout}`)
    }
    if (porcelain.stdout.trim()) {
      return 'dirty'
    }
    if (this.persistedStatus === 'merge_conflict') {
      return 'merge_conflict'
    }
    if (this.conflictSummary) {
      return 'awaiting_user'
    }
    return 'clean'
  }

  private hasActiveMergeInWorkspace(): boolean {
    return (
      gitMergeInProgress(this.workspacePath) || gitUnmergedPaths(this.workspacePath).length > 0
    )
  }

  private assertNoActiveMergeBlockingCommit(): void {
    if (this.hasActiveMergeInWorkspace()) {
      throw new Error('合并冲突未解决，禁止 saveVersion')
    }
    if (this.persistedStatus === 'awaiting_user') {
      throw new Error(`当前状态为 ${this.persistedStatus}，禁止 saveVersion`)
    }
  }

  private recordPendingIncomingForConflict(sitePublishedCommitId: string): void {
    if (gitMergeInProgress(this.workspacePath)) {
      this.pendingIncomingCommitId = gitOrThrow(this.workspacePath, ['rev-parse', 'MERGE_HEAD'])
      return
    }
    if (this.pendingIncomingCommitId) {
      return
    }
    this.pendingIncomingCommitId = sitePublishedCommitId
  }

  private async persistMeta(status: DraftSyncStatus): Promise<void> {
    if (status === 'clean') {
      await saveDraftMeta(this.intermediateRoot, {
        draftId: this.options.draftId,
        remoteSiteId: this.remoteSiteId,
        baseCommitId: this.baseCommitId,
        pendingIncomingCommitId: this.pendingIncomingCommitId,
        status: null,
        conflictSummary: undefined,
        validationLog: undefined,
        agentFailureLog: undefined,
      })
      return
    }
    await saveDraftMeta(this.intermediateRoot, {
      draftId: this.options.draftId,
      remoteSiteId: this.remoteSiteId,
      baseCommitId: this.baseCommitId,
      pendingIncomingCommitId: this.pendingIncomingCommitId,
      status,
      conflictSummary: this.conflictSummary,
      validationLog: this.validationLog,
      agentFailureLog: this.agentFailureLog,
    })
  }

  private async ensureCommitPresent(commitId: string): Promise<void> {
    const verify = git(this.workspacePath, ['cat-file', '-t', commitId])
    if (verify.status === 0) {
      return
    }
    if (!this.remoteSiteId) {
      throw new Error(`本地缺少 commit ${commitId}`)
    }
    const bundlePath = path.join(
      this.intermediateRoot,
      'bundles',
      `${this.options.draftId}-fetch-${commitId.slice(0, 8)}.bundle`,
    )
    await remoteDownloadBundle(this.options.remote, this.remoteSiteId, bundlePath)
    fetchBundleIntoRepo({
      repoPath: this.workspacePath,
      bundlePath,
      remoteRef: 'refs/remotes/olps/published-head',
      commitId,
    })
  }

  private async mergePublishedCommit(publishedCommitId: string): Promise<DraftSyncStatus> {
    const unmerged = gitUnmergedPaths(this.workspacePath)
    if (unmerged.length > 0 || gitMergeInProgress(this.workspacePath)) {
      return 'merge_conflict'
    }
    if (this.persistedStatus === 'awaiting_user' || this.persistedStatus === 'merge_conflict') {
      return 'merge_conflict'
    }
    const porcelain = git(this.workspacePath, ['status', '--porcelain'])
    if (porcelain.status !== 0) {
      throw new Error(`git status --porcelain 失败: ${porcelain.stderr || porcelain.stdout}`)
    }
    const dirty = porcelain.stdout.trim()
    if (dirty) {
      gitOrThrow(this.workspacePath, ['add', '-A'])
      gitOrThrow(this.workspacePath, ['commit', '-m', 'sync: pre-merge working tree'])
    }
    const mergeResult = git(this.workspacePath, ['merge', '--no-edit', publishedCommitId])
    if (mergeResult.status !== 0) {
      const conflictFiles = git(this.workspacePath, ['diff', '--name-only', '--diff-filter=U'])
      this.conflictSummary = `合并冲突: ${conflictFiles.stdout.trim() || mergeResult.stderr}`
      return 'merge_conflict'
    }
    this.conflictSummary = undefined
    return 'clean'
  }

  private async regeneratePublicAfterMerge(publishedCommitId: string): Promise<DraftSyncStatus> {
    const validation = await runWorkspaceValidation(this.workspacePath, this.options.build)
    this.validationLog = validation.log
    if (!validation.ok) {
      return 'validation_failed'
    }
    const dirty = git(this.workspacePath, ['status', '--porcelain']).stdout.trim()
    if (dirty) {
      gitOrThrow(this.workspacePath, ['add', '-A'])
      gitOrThrow(this.workspacePath, ['commit', '-m', 'sync: public from merged source'])
    }
    void publishedCommitId
    return 'clean'
  }
}

async function writeInitialTree(
  workspacePath: string,
  build?: SyncWorkspaceOpenOptions['build'],
): Promise<void> {
  const verifyCommand =
    build?.verifyCommand && build.verifyCommand.length > 0
      ? build.verifyCommand
      : ['node', SITE_PATHS.siteVerify]
  const manifest = {
    schemaVersion: 1,
    verifyCommand,
  }
  const directories = [
    SITE_PATHS.pagesDir,
    SITE_PATHS.collectionsDir,
    SITE_PATHS.mediaDir,
    SITE_PATHS.i18nDir,
    SITE_PATHS.uploadsDir,
    SITE_PATHS.themesDir,
    SITE_PATHS.pluginsDir,
    SITE_PATHS.serverConfigDir,
    SITE_PATHS.cacheDir,
    SITE_PATHS.publicDir,
    path.dirname(SITE_PATHS.siteVerify),
  ]
  for (const dir of directories) {
    await fs.mkdir(path.join(workspacePath, dir), { recursive: true })
  }
  // Git 不保存空目录，用 .gitkeep 保留骨架
  const trackedEmptyDirs = [
    SITE_PATHS.pagesDir,
    SITE_PATHS.collectionsDir,
    SITE_PATHS.mediaDir,
    SITE_PATHS.i18nDir,
    SITE_PATHS.uploadsDir,
    SITE_PATHS.themesDir,
    SITE_PATHS.pluginsDir,
    SITE_PATHS.serverConfigDir,
    SITE_PATHS.publicDir,
  ]
  for (const dir of trackedEmptyDirs) {
    await fs.writeFile(path.join(workspacePath, dir, '.gitkeep'), '', 'utf8')
  }
  await fs.writeFile(
    path.join(workspacePath, SITE_PATHS.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(workspacePath, '.gitignore'),
    '.olps-cache/\n',
    'utf8',
  )
  await fs.writeFile(
    path.join(workspacePath, '.gitattributes'),
    binaryGitAttributesContent(),
    'utf8',
  )
  await fs.writeFile(
    path.join(workspacePath, SITE_PATHS.siteVerify),
    "process.exit(0)\n",
    'utf8',
  )
  const skeletonJson = `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`
  await fs.writeFile(
    path.join(workspacePath, SITE_PATHS.siteSettings),
    `${JSON.stringify({ defaultLocale: 'en', locales: ['en'] }, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(path.join(workspacePath, SITE_PATHS.appearance), skeletonJson, 'utf8')
  await fs.writeFile(path.join(workspacePath, SITE_PATHS.pluginsConfig), skeletonJson, 'utf8')
  await fs.writeFile(path.join(workspacePath, SITE_PATHS.publishConfig), skeletonJson, 'utf8')
  await fs.writeFile(path.join(workspacePath, SITE_PATHS.redirects), skeletonJson, 'utf8')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function relMatchesPrefix(rel: string, prefix: string): boolean {
  const p = prefix.replace(/\\/g, '/').replace(/\/$/, '')
  if (!p) {
    return true
  }
  const r = rel.replace(/\\/g, '/')
  return r === p || r.startsWith(`${p}/`) || p.startsWith(`${r}/`)
}

async function walkFiles(
  root: string,
  dir: string,
  prefix: string,
  out: string[],
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).replace(/\\/g, '/')
    if (prefix && !relMatchesPrefix(rel, prefix)) {
      continue
    }
    if (entry.isDirectory()) {
      await walkFiles(root, full, prefix, out)
    } else {
      if (!prefix || rel.startsWith(prefix.replace(/\\/g, '/')) || rel === prefix.replace(/\\/g, '/')) {
        out.push(rel)
      }
    }
  }
}
