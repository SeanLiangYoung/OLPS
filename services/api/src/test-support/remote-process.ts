import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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

export async function startRemoteHttpServiceFromWorktree(): Promise<{
  baseUrl: string
  stop: () => Promise<void>
}> {
  const launcher = path.join(apiRoot, 'src/test-support/launch-remote-server.ts')
  const tsxCli = resolveTsxCli()
  const child = spawn(process.execPath, [tsxCli, launcher], {
    cwd: apiRoot,
    env: {
      ...process.env,
      REMOTE_SERVICE_TOKEN:
        process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const baseUrl = await new Promise<string>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finishReject = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const finishResolve = (url: string) => {
      if (settled) return
      settled = true
      resolve(url)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const line = stdout.trim().split('\n').find((l) => l.startsWith('{'))
      if (!line) return
      const parsed = JSON.parse(line) as { baseUrl?: string }
      if (parsed.baseUrl) {
        finishResolve(parsed.baseUrl)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', finishReject)
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        finishReject(new Error(`远端子进程退出 code=${code}\n${stderr}`))
      }
    })
    setTimeout(() => {
      finishReject(new Error(`远端子进程启动超时\n${stderr}`))
    }, 60_000)
  })

  return {
    baseUrl,
    stop: async () => {
      if (child.killed || child.exitCode !== null) {
        return
      }
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 10_000)
        child.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}
