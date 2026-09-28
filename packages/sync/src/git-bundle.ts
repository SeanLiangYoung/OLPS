import path from 'node:path'
import { git, gitOrThrow } from './git-exec.js'

export type BundleHead = {
  commitId: string
  ref: string
}

export function listBundleHeads(bundlePath: string, gitCwd: string): BundleHead[] {
  const bundleForGit = path.resolve(bundlePath).replace(/\\/g, '/')
  const stdout = gitOrThrow(gitCwd, ['bundle', 'list-heads', bundleForGit])
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

export function fetchBundleIntoRepo(input: {
  repoPath: string
  bundlePath: string
  remoteRef: string
  commitId?: string
}): void {
  const bundleForGit = path.resolve(input.bundlePath).replace(/\\/g, '/')
  const heads = listBundleHeads(input.bundlePath, input.repoPath)
  let fetchRef = heads[0].ref
  if (input.commitId) {
    const match = heads.find((h) => h.commitId === input.commitId)
    if (match) {
      fetchRef = match.ref
    }
  }
  const spec = `${fetchRef}:${input.remoteRef}`
  gitOrThrow(input.repoPath, ['fetch', bundleForGit, spec])
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
