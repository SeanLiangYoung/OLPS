import fs from 'node:fs/promises'
import path from 'node:path'
import { assertSafeRelativePath } from './paths.js'

export async function assertWorkspaceReadPath(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  assertSafeRelativePath(relativePath)
  const workspaceReal = await fs.realpath(workspacePath)
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  let current = workspacePath
  for (const part of parts) {
    if (part.toLowerCase() === '.git') {
      throw new Error(`路径不允许访问 .git: ${relativePath}`)
    }
    current = path.join(current, part)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) {
      throw new Error(`路径不允许跟随符号链接: ${relativePath}`)
    }
  }
  const full = path.join(workspacePath, relativePath)
  const fullReal = await fs.realpath(full)
  if (!fullReal.startsWith(workspaceReal + path.sep) && fullReal !== workspaceReal) {
    throw new Error(`路径越界: ${relativePath}`)
  }
  return full
}

export async function assertWorkspaceWritePath(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  assertSafeRelativePath(relativePath)
  const workspaceReal = await fs.realpath(workspacePath)
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  let current = workspacePath
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    if (part.toLowerCase() === '.git') {
      throw new Error(`路径不允许访问 .git: ${relativePath}`)
    }
    current = path.join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) {
        throw new Error(`路径不允许跟随符号链接: ${relativePath}`)
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        break
      }
      throw err
    }
  }
  const full = path.join(workspacePath, relativePath)
  const parent = path.dirname(full)
  await fs.mkdir(parent, { recursive: true })
  const parentReal = await fs.realpath(parent)
  if (!parentReal.startsWith(workspaceReal + path.sep) && parentReal !== workspaceReal) {
    throw new Error(`路径越界: ${relativePath}`)
  }
  return full
}
