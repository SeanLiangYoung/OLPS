import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { SITE_PATHS } from './paths.js'
import type { RunValidationResult, SyncBuildConfig } from './types.js'

type Manifest = {
  schemaVersion?: number
  verifyCommand?: string[]
  buildCommand?: string[]
}

const REQUIRED_DIRECTORIES = [
  SITE_PATHS.pagesDir,
  SITE_PATHS.collectionsDir,
  SITE_PATHS.mediaDir,
  SITE_PATHS.i18nDir,
  SITE_PATHS.uploadsDir,
  SITE_PATHS.themesDir,
  SITE_PATHS.pluginsDir,
  SITE_PATHS.serverConfigDir,
  SITE_PATHS.publicDir,
] as const

const REQUIRED_JSON_FILES = [
  SITE_PATHS.siteSettings,
  SITE_PATHS.appearance,
  SITE_PATHS.pluginsConfig,
  SITE_PATHS.publishConfig,
  SITE_PATHS.redirects,
] as const

async function readManifest(workspacePath: string): Promise<Manifest> {
  const manifestPath = path.join(workspacePath, SITE_PATHS.manifest)
  const raw = await fs.readFile(manifestPath, 'utf8')
  return JSON.parse(raw) as Manifest
}

function runCommand(cwd: string, argv: string[]): { exitCode: number; log: string } {
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
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return { exitCode: result.status ?? 1, log }
}

async function walkRelativeFiles(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkRelativeFiles(root, full, out)
    } else {
      out.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
}

function assertNoConflictMarkersInText(relativePath: string, text: string): void {
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>')) {
    throw new Error(`${relativePath} 仍含冲突标记`)
  }
}

export async function assertWorkspaceConflictMarkersCleared(
  workspacePath: string,
  extraRelativePaths: string[],
): Promise<void> {
  const toScan = new Set<string>(extraRelativePaths)
  const sourceRoot = path.join(workspacePath, 'source')
  try {
    const sourceFiles: string[] = []
    await walkRelativeFiles(workspacePath, sourceRoot, sourceFiles)
    for (const rel of sourceFiles) {
      toScan.add(rel)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
  toScan.add(`${SITE_PATHS.publicDir}/index.html`)
  for (const rel of toScan) {
    const full = path.join(workspacePath, rel)
    let raw: string
    try {
      raw = await fs.readFile(full, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw err
    }
    assertNoConflictMarkersInText(rel, raw)
  }
}

async function assertDirectoryExists(workspacePath: string, relativeDir: string): Promise<void> {
  const full = path.join(workspacePath, relativeDir)
  const stat = await fs.stat(full)
  if (!stat.isDirectory()) {
    throw new Error(`缺少目录: ${relativeDir}`)
  }
}

async function assertJsonFile(workspacePath: string, relativePath: string): Promise<void> {
  const raw = await fs.readFile(path.join(workspacePath, relativePath), 'utf8')
  if (raw.includes('<<<<<<<') || raw.includes('>>>>>>>')) {
    throw new Error(`${relativePath} 仍含冲突标记`)
  }
  JSON.parse(raw)
}

export async function assertSourceStructure(workspacePath: string): Promise<void> {
  for (const dir of REQUIRED_DIRECTORIES) {
    await assertDirectoryExists(workspacePath, dir)
  }
  for (const file of REQUIRED_JSON_FILES) {
    await assertJsonFile(workspacePath, file)
  }
  await fs.access(path.join(workspacePath, SITE_PATHS.siteVerify))
  const gitignore = await fs.readFile(path.join(workspacePath, '.gitignore'), 'utf8')
  if (!gitignore.includes('.olps-cache/')) {
    throw new Error('.gitignore 缺少 .olps-cache/')
  }
  const pagesDir = path.join(workspacePath, SITE_PATHS.pagesDir)
  const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true })
  for (const entry of pageEntries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const relativePath = `${SITE_PATHS.pagesDir}/${entry.name}`
      await assertJsonFile(workspacePath, relativePath)
      continue
    }
    if (!entry.isDirectory()) {
      continue
    }
    const pageDir = path.join(pagesDir, entry.name)
    const localeFiles = await fs.readdir(pageDir)
    for (const name of localeFiles) {
      if (!name.endsWith('.json')) {
        continue
      }
      await assertJsonFile(workspacePath, `${SITE_PATHS.pagesDir}/${entry.name}/${name}`)
    }
  }
}

function resolveBuildCommand(buildOverride?: SyncBuildConfig): string[] {
  const build = buildOverride?.buildCommand
  if (!build || build.length === 0) {
    throw new Error('缺少 SyncBuildConfig.buildCommand')
  }
  return build
}

export async function runWorkspaceValidation(
  workspacePath: string,
  buildOverride?: SyncBuildConfig,
): Promise<RunValidationResult> {
  await assertSourceStructure(workspacePath)
  const manifest = await readManifest(workspacePath)
  if (Object.prototype.hasOwnProperty.call(manifest, 'buildCommand')) {
    throw new Error('olps.manifest.json 不允许包含 buildCommand')
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error('olps.manifest.json 缺少 schemaVersion: 1')
  }
  const build = resolveBuildCommand(buildOverride)
  const verify = manifest.verifyCommand ?? buildOverride?.verifyCommand

  let combinedLog = ''
  const b = runCommand(workspacePath, build)
  combinedLog += `[build] exit=${b.exitCode}\n${b.log}\n`
  if (b.exitCode !== 0) {
    return {
      ok: false,
      exitCode: b.exitCode,
      log: combinedLog,
      status: 'validation_failed',
    }
  }
  if (verify && verify.length > 0) {
    const v = runCommand(workspacePath, verify)
    combinedLog += `[verify] exit=${v.exitCode}\n${v.log}\n`
    if (v.exitCode !== 0) {
      return {
        ok: false,
        exitCode: v.exitCode,
        log: combinedLog,
        status: 'validation_failed',
      }
    }
  }
  return {
    ok: true,
    exitCode: 0,
    log: combinedLog,
    status: 'clean',
  }
}
