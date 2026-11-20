import fs from 'node:fs/promises'
import path from 'node:path'
import { assertSafePathChain } from './path-guard.js'
import { SITE_PATHS } from './paths.js'
import type { AssetCopyPlan } from './assets.js'
import type { OutputFile, PlannedFile } from './types.js'

async function listAllFiles(dir: string, base: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listAllFiles(abs, base)))
    } else if (entry.isFile()) {
      files.push(path.relative(base, abs).replace(/\\/g, '/'))
    }
  }
  return files
}

function toPublicRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith(`${SITE_PATHS.publicDir}/`)) {
    return normalized.slice(SITE_PATHS.publicDir.length + 1)
  }
  return normalized
}

export async function writePublicOutputs(
  workspacePath: string,
  files: OutputFile[],
): Promise<void> {
  await assertSafePathChain(workspacePath, SITE_PATHS.publicDir, { allowMissingSuffix: true })

  const expected = new Set<string>()
  for (const file of files) {
    expected.add(toPublicRelative(file.relativePath))
  }

  for (const file of files) {
    const relInsidePublic = toPublicRelative(file.relativePath)
    const rel = path.posix.join(SITE_PATHS.publicDir, relInsidePublic)
    const dest = await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    if (typeof file.content === 'string') {
      await fs.writeFile(dest, file.content, 'utf8')
    } else {
      await fs.writeFile(dest, file.content)
    }
  }

  const publicRoot = await assertSafePathChain(workspacePath, SITE_PATHS.publicDir)
  let existing: string[] = []
  try {
    existing = await listAllFiles(publicRoot, publicRoot)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  for (const rel of existing) {
    if (!expected.has(rel)) {
      const target = await assertSafePathChain(
        workspacePath,
        path.posix.join(SITE_PATHS.publicDir, rel),
      )
      await fs.rm(target, { force: true })
    }
  }
}

export async function verifyPublicMatchesPlan(
  workspacePath: string,
  files: OutputFile[],
): Promise<void> {
  const publicRoot = await assertSafePathChain(workspacePath, SITE_PATHS.publicDir)
  const expectedContents = new Map<string, Buffer>()
  for (const file of files) {
    const rel = toPublicRelative(file.relativePath)
    expectedContents.set(
      rel,
      typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content,
    )
  }

  for (const [rel, expected] of expectedContents) {
    const abs = path.join(publicRoot, rel)
    await assertSafePathChain(workspacePath, path.posix.join(SITE_PATHS.publicDir, rel))
    let actual: Buffer
    try {
      actual = await fs.readFile(abs)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(`verify 缺少产物: ${rel}`)
      }
      throw error
    }
    if (!actual.equals(expected)) {
      throw new Error(`verify 产物不一致: ${rel}`)
    }
  }

  let onDisk: string[] = []
  try {
    onDisk = await listAllFiles(publicRoot, publicRoot)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('verify 缺少 public 目录')
    }
    throw error
  }

  for (const rel of onDisk) {
    if (!expectedContents.has(rel)) {
      throw new Error(`verify 存在多余产物: ${rel}`)
    }
  }
}

/** @deprecated 保留签名供旧测试过渡；新构建使用 PlannedFile[] */
export async function writePublicOutputsLegacy(
  workspacePath: string,
  htmlFiles: PlannedFile[],
  assetFiles: AssetCopyPlan[],
): Promise<void> {
  await writePublicOutputs(workspacePath, [...htmlFiles, ...assetFiles])
}
