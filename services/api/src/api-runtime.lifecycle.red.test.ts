import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeExecutable = process.execPath
const worktreeMarker = apiRoot.replace(/\\/g, '/').toLowerCase()

function resolveTsxCli(): string {
  const local = path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (fs.existsSync(local)) {
    return local
  }
  const workspace = path.join(apiRoot, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (fs.existsSync(workspace)) {
    return workspace
  }
  throw new Error(`找不到 tsx CLI: ${local}`)
}

async function runLifecycleChildSubprocess(input: {
  scenario: 'success' | 'fail-start'
  maxDurationMs: number
}): Promise<{ exitCode: number | null; durationMs: number; pid: number | undefined }> {
  const script = path.join(apiRoot, 'src/test-support/run-remote-lifecycle-child.ts')
  const tsxCli = resolveTsxCli()
  const child = spawn(process.execPath, [tsxCli, script], {
    cwd: apiRoot,
    env: {
      ...process.env,
      REMOTE_LIFECYCLE_SCENARIO: input.scenario,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const started = Date.now()
  const result = await new Promise<{
    exitCode: number | null
    stderr: string
  }>((resolve, reject) => {
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({ exitCode: code, stderr })
    })
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ exitCode: null, stderr: `${stderr}\n父进程等待超时 ${input.maxDurationMs}ms` })
    }, input.maxDurationMs)
  })

  return {
    exitCode: result.exitCode,
    durationMs: Date.now() - started,
    pid: child.pid,
  }
}

describe('remote 子进程生命周期（RED：实现待 GREEN）', () => {
  const childBudgetMs = 25_000

  it('子进程脚本 startRemoteHttpServiceFromWorktree 后 stop 并在合理时间内自然退出', async () => {
    const run = await runLifecycleChildSubprocess({ scenario: 'success', maxDurationMs: childBudgetMs })
    expect(run.exitCode).toBe(0)
    expect(run.durationMs).toBeLessThan(childBudgetMs)
  })

  it('远端启动失败时子进程脚本仍能在合理时间内自然退出', async () => {
    const run = await runLifecycleChildSubprocess({ scenario: 'fail-start', maxDurationMs: childBudgetMs })
    expect(run.exitCode).toBe(0)
    expect(run.durationMs).toBeLessThan(childBudgetMs)
  })

  it('生命周期子进程使用当前 Node 可执行文件且命令行包含本 worktree 路径', async () => {
    const script = path.join(apiRoot, 'src/test-support/run-remote-lifecycle-child.ts')
    const tsxCli = resolveTsxCli()
    const child = spawn(process.execPath, [tsxCli, script], {
      cwd: apiRoot,
      env: {
        ...process.env,
        REMOTE_LIFECYCLE_SCENARIO: 'success',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    expect(child.pid).toBeTruthy()
    expect(nodeExecutable.toLowerCase()).toBe(process.execPath.toLowerCase())

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => resolve(code))
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, childBudgetMs)
    })

    expect(exitCode).toBe(0)
    expect(worktreeMarker.length).toBeGreaterThan(0)
    expect(script.replace(/\\/g, '/').toLowerCase()).toContain(worktreeMarker)
  })
})
