import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
}): Promise<{ exitCode: number | null; durationMs: number; stderr: string }> {
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
  return await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        exitCode: null,
        durationMs: Date.now() - started,
        stderr: `${stderr}\n父进程等待超时 ${input.maxDurationMs}ms`,
      })
    }, input.maxDurationMs)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: code,
        durationMs: Date.now() - started,
        stderr,
      })
    })
  })
}

describe('remote 子进程生命周期', () => {
  const childBudgetMs = 25_000

  it('子进程脚本 startRemoteHttpServiceFromWorktree 后 stop 并在合理时间内自然退出', async () => {
    const run = await runLifecycleChildSubprocess({ scenario: 'success', maxDurationMs: childBudgetMs })
    expect(run.exitCode).toBe(0)
    expect(run.durationMs).toBeLessThan(childBudgetMs)
    expect(run.stderr).toBe('')
  })

  it('远端启动失败时子进程脚本仍能在合理时间内自然退出', async () => {
    const run = await runLifecycleChildSubprocess({ scenario: 'fail-start', maxDurationMs: childBudgetMs })
    expect(run.exitCode).toBe(0)
    expect(run.durationMs).toBeLessThan(childBudgetMs)
  })
})
