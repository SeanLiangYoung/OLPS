import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { extract } from 'tar'
import { assertSafeGitCommitId } from './validation.js'

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function gitOrThrow(cwd: string, args: string[]): string {
  const { status, stdout, stderr } = git(cwd, args)
  if (status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${stderr || stdout}`)
  }
  return stdout.trim()
}

export async function ensureBareRepo(repoDir: string): Promise<void> {
  await fs.mkdir(repoDir, { recursive: true })
  const headPath = path.join(repoDir, 'HEAD')
  try {
    await fs.access(headPath)
    return
  } catch {
    gitOrThrow(repoDir, ['init', '--bare'])
    gitOrThrow(repoDir, ['config', 'core.autocrlf', 'false'])
    gitOrThrow(repoDir, ['config', 'core.eol', 'lf'])
    gitOrThrow(repoDir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }
}

export async function fetchBundleToCandidateRef(
  repoDir: string,
  bundlePath: string,
  commitId: string,
): Promise<string> {
  assertSafeGitCommitId(commitId)
  await ensureBareRepo(repoDir)
  const candidateRef = `refs/candidate/${randomUUID()}`
  const bundleForGit = path.resolve(bundlePath).replace(/\\/g, '/')
  const { status, stderr } = git(repoDir, ['fetch', bundleForGit, `HEAD:${candidateRef}`])
  if (status !== 0) {
    throw new Error(`bundle 导入失败: ${stderr}`)
  }
  const resolved = gitOrThrow(repoDir, ['rev-parse', candidateRef])
  if (resolved !== commitId) {
    throw new Error(`commitId 与 bundle HEAD 不一致: 期望 ${commitId} 实际 ${resolved}`)
  }
  return candidateRef
}

export async function promoteCommitToMain(repoDir: string, commitId: string): Promise<void> {
  assertSafeGitCommitId(commitId)
  gitOrThrow(repoDir, ['update-ref', 'refs/heads/main', commitId])
}

export async function createBundleFromBareRepo(
  repoDir: string,
  bundlePath: string,
  publishedCommitId: string | null,
): Promise<void> {
  await fs.mkdir(path.dirname(bundlePath), { recursive: true })
  if (!publishedCommitId) {
    throw new Error('尚无发布版本，无法生成 bundle')
  }
  assertSafeGitCommitId(publishedCommitId)
  gitOrThrow(repoDir, ['cat-file', '-e', `${publishedCommitId}^{commit}`])
  const bundleForGit = path.resolve(bundlePath).replace(/\\/g, '/')
  gitOrThrow(repoDir, ['bundle', 'create', bundleForGit, publishedCommitId])
}

export async function extractCommitToDir(
  repoDir: string,
  commitId: string,
  workDir: string,
): Promise<void> {
  assertSafeGitCommitId(commitId)
  await fs.rm(workDir, { recursive: true, force: true })
  await fs.mkdir(workDir, { recursive: true })
  const archivePath = path.join(workDir, '..', `archive-${commitId.slice(0, 8)}.tar`)
  const archive = spawnSync(
    'git',
    [
      '-C',
      repoDir,
      '-c',
      'core.autocrlf=false',
      'archive',
      '--format=tar',
      '-o',
      archivePath,
      commitId,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (archive.status !== 0) {
    throw new Error(`git archive 失败: ${archive.stderr}`)
  }
  await extract({ file: archivePath, cwd: workDir, sync: true })
  await fs.rm(archivePath, { force: true })
}
