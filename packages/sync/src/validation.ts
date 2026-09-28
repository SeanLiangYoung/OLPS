import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { SITE_PATHS } from './paths.js'
import type { RunValidationResult, SyncBuildConfig } from './types.js'

type Manifest = {
  verifyCommand?: string[]
  buildCommand?: string[]
}

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

export async function assertSourceStructure(workspacePath: string): Promise<void> {
  const settingsRaw = await fs.readFile(
    path.join(workspacePath, SITE_PATHS.siteSettings),
    'utf8',
  )
  if (settingsRaw.includes('<<<<<<<') || settingsRaw.includes('>>>>>>>')) {
    throw new Error('site-settings.json 仍含冲突标记')
  }
  JSON.parse(settingsRaw)
  const pagesDir = path.join(workspacePath, SITE_PATHS.pagesDir)
  try {
    const pages = await fs.readdir(pagesDir)
    for (const name of pages) {
      if (!name.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(pagesDir, name), 'utf8')
      if (raw.includes('<<<<<<<')) {
        throw new Error(`${name} 仍含冲突标记`)
      }
      JSON.parse(raw)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw err
  }
}

export async function runWorkspaceValidation(
  workspacePath: string,
  buildOverride?: SyncBuildConfig,
): Promise<RunValidationResult> {
  await assertSourceStructure(workspacePath)
  const manifest = await readManifest(workspacePath)
  const verify = manifest.verifyCommand ?? buildOverride?.verifyCommand
  const build = manifest.buildCommand ?? buildOverride?.buildCommand

  let combinedLog = ''
  if (build && build.length > 0) {
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
