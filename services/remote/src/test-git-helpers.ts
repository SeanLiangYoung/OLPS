import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${result.stderr || result.stdout}`)
  }
}

export async function initSiteRepository(
  repoDir: string,
  files: Record<string, string | Buffer>,
): Promise<{ commitId: string }> {
  await fs.mkdir(repoDir, { recursive: true })
  git(repoDir, ['init'])
  git(repoDir, ['config', 'core.autocrlf', 'false'])
  git(repoDir, ['config', 'core.eol', 'lf'])
  git(repoDir, ['checkout', '-b', 'main'])
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content)
  }
  git(repoDir, ['add', '-A'])
  git(repoDir, ['commit', '-m', 'test: site snapshot'])
  const commitId = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
    .stdout!.trim()
  return { commitId }
}

export async function writeGitBundle(repoDir: string, bundlePath: string): Promise<void> {
  await fs.mkdir(path.dirname(bundlePath), { recursive: true })
  git(repoDir, ['bundle', 'create', bundlePath, 'HEAD'])
}

export async function pushBundleHttp(input: {
  baseUrl: string
  token: string
  remoteSiteId: string
  bundlePath: string
  commitId: string
  expectedPublishedCommitId: string | null
}): Promise<Response> {
  const bundleBytes = await fs.readFile(input.bundlePath)
  return fetch(
    `${input.baseUrl.replace(/\/$/, '')}/api/remote/sites/${encodeURIComponent(input.remoteSiteId)}/push`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/octet-stream',
        'X-Commit-Id': input.commitId,
        'X-Expected-Published-Commit-Id': input.expectedPublishedCommitId ?? '',
      },
      body: bundleBytes,
    },
  )
}

export function syncFixtureScript(name: string): string {
  return path.resolve(process.cwd(), '../../packages/sync/test-fixtures', name)
}

export async function manifestJsonForPublishedSite(dataRoot: string): Promise<string> {
  const scriptsDir = path.join(dataRoot, 'sc')
  await fs.mkdir(scriptsDir, { recursive: true })
  const verifyDest = path.join(scriptsDir, 'verify.mjs')
  const buildDest = path.join(scriptsDir, 'build.mjs')
  await fs.copyFile(syncFixtureScript('verify-site-consistency.mjs'), verifyDest)
  await fs.copyFile(syncFixtureScript('build-public-from-source.mjs'), buildDest)
  return JSON.stringify({
    version: 1,
    verifyCommand: [process.execPath, verifyDest],
    buildCommand: [process.execPath, buildDest],
  })
}
