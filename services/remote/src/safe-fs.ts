import fs from 'node:fs/promises'
import path from 'node:path'

export async function assertDirectoryTreeSafe(rootDir: string): Promise<void> {
  const rootReal = await fs.realpath(rootDir)
  await walkSafe(rootDir, rootReal)
}

async function walkSafe(currentDir: string, rootReal: string): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name)
    const stat = await fs.lstat(full)
    if (stat.isSymbolicLink()) {
      throw new Error(`不允许符号链接: ${full}`)
    }
    const resolved = await fs.realpath(full)
    if (!resolved.startsWith(rootReal + path.sep) && resolved !== rootReal) {
      throw new Error(`路径越界: ${full}`)
    }
    if (entry.isDirectory()) {
      await walkSafe(full, rootReal)
    }
  }
}

export async function copyTreeSafe(srcDir: string, destDir: string): Promise<void> {
  await assertDirectoryTreeSafe(srcDir)
  await fs.mkdir(destDir, { recursive: true })
  const destRoot = await fs.realpath(destDir)
  await copyRecursive(srcDir, destDir, destRoot)
}

async function copyRecursive(src: string, dest: string, destRoot: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    const stat = await fs.lstat(from)
    if (stat.isSymbolicLink()) {
      throw new Error(`不允许复制符号链接: ${from}`)
    }
    const fromReal = await fs.realpath(from)
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true })
      const toReal = await fs.realpath(to)
      if (!toReal.startsWith(destRoot + path.sep) && toReal !== destRoot) {
        throw new Error(`目标路径越界: ${to}`)
      }
      await copyRecursive(from, to, destRoot)
    } else if (entry.isFile()) {
      const toResolved = path.resolve(to)
      if (!toResolved.startsWith(destRoot + path.sep) && toResolved !== destRoot) {
        throw new Error(`目标文件越界: ${to}`)
      }
      await fs.copyFile(fromReal, to)
    }
  }
}
