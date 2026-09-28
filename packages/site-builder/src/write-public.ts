import fs from 'node:fs/promises'
import path from 'node:path'
import { PUBLIC_DIR, resolveInsideWorkspace } from './paths.js'
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
  const publicRoot = resolveInsideWorkspace(workspacePath, PUBLIC_DIR)
  await fs.mkdir(publicRoot, { recursive: true })

  const expected = new Set<string>()
  for (const file of htmlFiles) {
    expected.add(file.relativePath.replace(/\\/g, '/'))
  }
  for (const asset of assetFiles) {
    const rel = asset.relativePath.replace(/^public\//, '')
    expected.add(rel)
  }

  for (const file of htmlFiles) {
    const dest = resolveInsideWorkspace(workspacePath, path.join(PUBLIC_DIR, file.relativePath))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, file.content, 'utf8')
  }

  for (const asset of assetFiles) {
    const rel = asset.relativePath.replace(/^public\//, '')
    const dest = resolveInsideWorkspace(workspacePath, path.join(PUBLIC_DIR, rel))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, asset.content)
  }

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
      await fs.rm(resolveInsideWorkspace(workspacePath, path.join(PUBLIC_DIR, rel)), { force: true })
    }
  }

  existing = await listAllFiles(publicRoot, publicRoot)
  for (const rel of existing) {
    if (!expected.has(rel)) {
      const dir = path.dirname(resolveInsideWorkspace(workspacePath, path.join(PUBLIC_DIR, rel)))
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export async function verifyPublicMatchesPlan(
  workspacePath: string,
  htmlFiles: PlannedFile[],
  assetFiles: AssetCopyPlan[],
): Promise<void> {
  const publicRoot = resolveInsideWorkspace(workspacePath, PUBLIC_DIR)
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
