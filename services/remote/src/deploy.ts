import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { releasePublicDir, releaseServerConfigDir } from './site-store.js'
import { copyTreeSafe } from './safe-fs.js'
import { readPublishedRedirects } from './artifacts.js'

type Manifest = {
  verifyCommand?: string[]
  buildCommand?: string[]
}

async function readManifest(workDir: string): Promise<Manifest> {
  const raw = await fs.readFile(path.join(workDir, 'olps.manifest.json'), 'utf8')
  return JSON.parse(raw) as Manifest
}

function runArgv(cwd: string, argv: string[]): { exitCode: number; log: string } {
  if (argv.length === 0) {
    return { exitCode: 0, log: '' }
  }
  const [cmd, ...args] = argv
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    exitCode: result.status ?? 1,
    log: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

export type DeployResult =
  | { ok: true; deploymentId: string; log: string }
  | { ok: false; exitCode: number; log: string }

export async function deployCommitFromWorkTree(input: {
  dataRoot: string
  remoteSiteId: string
  workDir: string
  deploymentId: string
}): Promise<DeployResult> {
  const manifest = await readManifest(input.workDir)
  let log = ''
  if (manifest.verifyCommand && manifest.verifyCommand.length > 0) {
    const v = runArgv(input.workDir, manifest.verifyCommand)
    log += `[verify] ${v.log}\n`
    if (v.exitCode !== 0) {
      return { ok: false, exitCode: v.exitCode, log }
    }
  }
  const publicSrc = path.join(input.workDir, 'public')
  const configSource = path.join(input.workDir, 'server-config')
  let configExists = false
  try {
    const stat = await fs.lstat(configSource)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('服务器配置目录类型无效')
    configExists = true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (configExists) await readPublishedRedirects(configSource)
  const releaseDir = releasePublicDir(input.dataRoot, input.remoteSiteId, input.deploymentId)
  await fs.mkdir(path.dirname(releaseDir), { recursive: true })
  await copyTreeSafe(publicSrc, releaseDir)
  if (configExists) await copyTreeSafe(configSource, releaseServerConfigDir(input.dataRoot, input.remoteSiteId, input.deploymentId))
  return { ok: true, deploymentId: input.deploymentId, log }
}
