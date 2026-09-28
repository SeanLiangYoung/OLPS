import fs from 'node:fs/promises'
import path from 'node:path'
import { appConfig } from '../config.js'

function assertSafeTestSandboxRoot(sandboxRoot: string): void {
  const resolved = path.resolve(sandboxRoot)
  const intermediateDir = path.resolve(appConfig.root, '.intermediate')
  const relative = path.relative(intermediateDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`测试 sandbox 根目录须在 worktree .intermediate 内: ${resolved}`)
  }
  if (path.basename(resolved) !== 'sandboxes-test') {
    throw new Error(`测试 sandbox 根目录目录名必须为 sandboxes-test: ${resolved}`)
  }
  const normalized = resolved.replace(/\\/g, '/').toLowerCase()
  if (normalized.includes('/production') || normalized.includes('rehearsal')) {
    throw new Error(`禁止对 production 或 rehearsal 路径执行测试 sandbox 清理: ${resolved}`)
  }
}

export function resolveTestSandboxRoot(): string {
  const sandboxRoot = path.resolve(appConfig.sandboxRoot)
  assertSafeTestSandboxRoot(sandboxRoot)
  return sandboxRoot
}

export async function resetTestSandboxes(): Promise<void> {
  const sandboxRoot = resolveTestSandboxRoot()
  await fs.rm(sandboxRoot, { force: true, recursive: true })
  await fs.mkdir(sandboxRoot, { recursive: true })
}
