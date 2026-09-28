import fs from 'node:fs/promises'
import path from 'node:path'
import { assertSafePathChain } from './path-guard.js'
import { PUBLIC_DIR } from './paths.js'
import type { AssetCopyPlan } from './assets.js'
import type { PlannedFile } from './types.js'

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

export async function writePublicOutputs(
  workspacePath: string,
  htmlFiles: PlannedFile[],
  assetFiles: AssetCopyPlan[],
): Promise<void> {
  await assertSafePathChain(workspacePath, PUBLIC_DIR, { allowMissingSuffix: true })

  const expected = new Set<string>()
  for (const file of htmlFiles) {
    expected.add(file.relativePath.replace(/\\/g, '/'))
  }
  for (const asset of assetFiles) {
    const rel = asset.relativePath.replace(/^public\//, '')
    expected.add(rel)
  }

  for (const file of htmlFiles) {
    const rel = path.posix.join(PUBLIC_DIR, file.relativePath.replace(/\\/g, '/'))
    const dest = await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    await fs.writeFile(dest, file.content, 'utf8')
  }

  for (const asset of assetFiles) {
    const relInsidePublic = asset.relativePath.replace(/^public\//, '')
    const rel = path.posix.join(PUBLIC_DIR, relInsidePublic)
    const dest = await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await assertSafePathChain(workspacePath, rel, { allowMissingSuffix: true })
    await fs.writeFile(dest, asset.content)
  }

  const publicRoot = await assertSafePathChain(workspacePath, PUBLIC_DIR)
  let existing: string[] = []
  try {
    existing = await listAllFiles(publicRoot, publicRoot)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  for (const rel of existing) {
    if (!expected.has(rel)) {
      const target = await assertSafePathChain(workspacePath, path.posix.join(PUBLIC_DIR, rel))
      await fs.rm(target, { force: true })
    }
  }

  existing = await listAllFiles(publicRoot, publicRoot)
  for (const rel of existing) {
    if (!expected.has(rel)) {
      const target = await assertSafePathChain(workspacePath, path.posix.join(PUBLIC_DIR, rel))
      await fs.rm(target, { force: true })
    }
  }
}

export async function verifyPublicMatchesPlan(
  workspacePath: string,
  htmlFiles: PlannedFile[],
  assetFiles: AssetCopyPlan[],
): Promise<void> {
  const publicRoot = await assertSafePathChain(workspacePath, PUBLIC_DIR)
  const expectedContents = new Map<string, Buffer>()
  for (const file of htmlFiles) {
    expectedContents.set(file.relativePath.replace(/\\/g, '/'), Buffer.from(file.content, 'utf8'))
  }
  for (const asset of assetFiles) {
    const rel = asset.relativePath.replace(/^public\//, '')
    expectedContents.set(rel, asset.content)
  }

  for (const [rel, expected] of expectedContents) {
    const abs = path.join(publicRoot, rel)
    await assertSafePathChain(workspacePath, path.posix.join(PUBLIC_DIR, rel))
    let actual: Buffer
    try {
      actual = await fs.readFile(abs)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(`verify 缺少产物: ${rel}`)
      }
      throw err
    }
    if (!actual.equals(expected)) {
      throw new Error(`verify 产物不一致: ${rel}`)
    }
  }

  let onDisk: string[] = []
  try {
    onDisk = await listAllFiles(publicRoot, publicRoot)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('verify 缺少 public 目录')
    }
    throw err
  }

  for (const rel of onDisk) {
    if (!expectedContents.has(rel)) {
      throw new Error(`verify 存在多余产物: ${rel}`)
    }
  }
}
