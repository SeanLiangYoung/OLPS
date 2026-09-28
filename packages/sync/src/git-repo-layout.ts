import { randomUUID } from 'node:crypto'
import { git, gitOrThrow } from './git-exec.js'

export function resolveAbsoluteGitCommonDir(workspacePath: string): string {
  return gitOrThrow(workspacePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
}

export function resolveWorktreeHeadCommitId(workspacePath: string): string {
  return gitOrThrow(workspacePath, ['rev-parse', 'HEAD'])
}

export function gitOrThrowInCommonDir(workspacePath: string, args: string[]): string {
  const commonDir = resolveAbsoluteGitCommonDir(workspacePath)
  return gitOrThrow(commonDir, args)
}

export function assertCommitObjectVisible(workspacePath: string, commitId: string): void {
  const fromWorktree = gitOrThrow(workspacePath, ['cat-file', '-t', commitId])
  if (fromWorktree !== 'commit') {
    throw new Error(`对象 ${commitId} 在工作树仓库中不是 commit: ${fromWorktree}`)
  }
  const commonDir = resolveAbsoluteGitCommonDir(workspacePath)
  const fromCommon = gitOrThrow(commonDir, ['cat-file', '-t', commitId])
  if (fromCommon !== 'commit') {
    throw new Error(`对象 ${commitId} 在 git-common-dir 中不是 commit: ${fromCommon}`)
  }
}

export function withTemporaryBundleExportRef(input: {
  workspacePath: string
  commitId: string
  run: (tempRef: string) => void
}): void {
  const commonDir = resolveAbsoluteGitCommonDir(input.workspacePath)
  const tempRef = `refs/olps/b/${randomUUID().replace(/-/g, '').slice(0, 12)}`
  gitOrThrow(commonDir, ['update-ref', tempRef, input.commitId])
  try {
    input.run(tempRef)
  } finally {
    const deleted = git(commonDir, ['update-ref', '-d', tempRef])
    if (deleted.status !== 0) {
      throw new Error(
        `清理临时 ref ${tempRef} 失败: ${deleted.stderr || deleted.stdout}`,
      )
    }
  }
}
