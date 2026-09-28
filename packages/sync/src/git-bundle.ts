import path from 'node:path'
import { git, gitOrThrow } from './git-exec.js'
import { applyRepoLocalLineEndingPolicy } from './git-line-endings.js'
import {
  assertCommitObjectVisible,
  gitOrThrowInCommonDir,
  resolveWorktreeHeadCommitId,
  withTemporaryBundleExportRef,
} from './git-repo-layout.js'

export type BundleHead = {
  commitId: string
  ref: string
}

export function listBundleHeads(bundlePath: string, workspacePath: string): BundleHead[] {
  const bundleForGit = path.resolve(bundlePath).replace(/\\/g, '/')
  const stdout = gitOrThrowInCommonDir(workspacePath, ['bundle', 'list-heads', bundleForGit])
  const heads: BundleHead[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const space = trimmed.indexOf(' ')
    if (space === -1) {
      continue
    }
    heads.push({
      commitId: trimmed.slice(0, space),
      ref: trimmed.slice(space + 1),
    })
  }
  if (heads.length === 0) {
    throw new Error(`bundle 不含任何 ref: ${bundlePath}`)
  }
  return heads
}

function selectBundleSourceRef(heads: BundleHead[], commitId: string | undefined): string {
  if (commitId) {
    const matching = heads.filter((h) => h.commitId === commitId)
    if (matching.length > 0) {
      const headNamed = matching.find((h) => h.ref === 'HEAD')
      if (headNamed) {
        return 'HEAD'
      }
      const olpsExport = matching.find(
        (h) => h.ref.startsWith('refs/olps/b/') || h.ref.startsWith('refs/olps/bundle-export/'),
      )
      if (olpsExport) {
        return olpsExport.ref
      }
      return matching[0]!.ref
    }
  }
  const headNamed = heads.find((h) => h.ref === 'HEAD')
  if (headNamed) {
    return 'HEAD'
  }
  const olpsExport = heads.find(
    (h) => h.ref.startsWith('refs/olps/b/') || h.ref.startsWith('refs/olps/bundle-export/'),
  )
  if (olpsExport) {
    return olpsExport.ref
  }
  return heads[0]!.ref
}

export function bootstrapRepoFromSiteBundle(input: {
  repoRoot: string
  bundlePath: string
  baseCommitId: string
  importRef: string
}): string {
  gitOrThrow(input.repoRoot, ['init'])
  applyRepoLocalLineEndingPolicy(input.repoRoot)
  const heads = listBundleHeads(input.bundlePath, input.repoRoot)
  const sourceRef = selectBundleSourceRef(heads, input.baseCommitId)
  const bundleForGit = path.resolve(input.bundlePath).replace(/\\/g, '/')
  gitOrThrowInCommonDir(input.repoRoot, ['fetch', bundleForGit, `${sourceRef}:${input.importRef}`])
  const bundleTip = gitOrThrow(input.repoRoot, ['rev-parse', input.importRef])
  gitOrThrow(input.repoRoot, ['cat-file', '-t', input.baseCommitId])
  const mergeBase = gitOrThrow(input.repoRoot, ['merge-base', input.baseCommitId, bundleTip])
  if (mergeBase !== input.baseCommitId) {
    throw new Error(`bundle 不含 baseCommitId 祖先: merge-base ${mergeBase} 期望 ${input.baseCommitId}`)
  }
  return bundleTip
}

export function createGitBundle(input: {
  workspacePath: string
  bundlePath: string
  commitId?: string
}): void {
  const headCommitId = input.commitId ?? resolveWorktreeHeadCommitId(input.workspacePath)
  assertCommitObjectVisible(input.workspacePath, headCommitId)
  const bundleForGit = path.resolve(input.bundlePath).replace(/\\/g, '/')
  withTemporaryBundleExportRef({
    workspacePath: input.workspacePath,
    commitId: headCommitId,
    run: (tempRef) => {
      gitOrThrowInCommonDir(input.workspacePath, ['bundle', 'create', bundleForGit, tempRef])
    },
  })
}

export function fetchBundleIntoRepo(input: {
  repoPath: string
  bundlePath: string
  remoteRef: string
  commitId?: string
}): void {
  const bundleForGit = path.resolve(input.bundlePath).replace(/\\/g, '/')
  const heads = listBundleHeads(input.bundlePath, input.repoPath)
  const fetchRef = selectBundleSourceRef(heads, input.commitId)
  const spec = `${fetchRef}:${input.remoteRef}`
  gitOrThrowInCommonDir(input.repoPath, ['fetch', bundleForGit, spec])
}

export function gitMergeInProgress(workspacePath: string): boolean {
  const result = git(workspacePath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (result.status === 0) {
    return true
  }
  if (result.status === 1) {
    return false
  }
  throw new Error(`git rev-parse MERGE_HEAD 失败: ${result.stderr || result.stdout}`)
}

export function gitUnmergedPaths(workspacePath: string): string[] {
  const result = git(workspacePath, ['diff', '--name-only', '--diff-filter=U'])
  if (result.status !== 0) {
    throw new Error(`git diff 未合并文件列表失败: ${result.stderr || result.stdout}`)
  }
  const seen = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const name = line.trim()
    if (name) {
      seen.add(name)
    }
  }
  return [...seen]
}
