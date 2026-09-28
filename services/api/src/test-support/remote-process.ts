import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function resolveTsxImportSpecifier(): string {
  const localPkg = path.join(apiRoot, 'node_modules', 'tsx', 'package.json')
  const workspacePkg = path.join(apiRoot, '..', '..', 'node_modules', 'tsx', 'package.json')
  if (fs.existsSync(localPkg)) {
    return 'tsx'
  }
  if (fs.existsSync(workspacePkg)) {
    return 'tsx'
  }
  throw new Error(`找不到 tsx 包: ${localPkg}`)
}

async function waitForChildExit(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export async function startRemoteHttpServiceFromWorktree(): Promise<{
  baseUrl: string
  stop: () => Promise<void>
}> {
  const launcher = path.join(apiRoot, 'src/test-support/launch-remote-server.ts')
  const tsxImport = resolveTsxImportSpecifier()
  const child = spawn(process.execPath, ['--import', tsxImport, launcher], {
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
    const startupTimer = setTimeout(() => {
      if (settled) return
      settled = true
      void waitForChildExit(child, 10_000).finally(() => {
        reject(new Error(`远端子进程启动超时\n${stderr}`))
      })
    }, 60_000)

    const finishReject = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      void waitForChildExit(child, 10_000).finally(() => {
        reject(err)
      })
    }
    const finishResolve = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
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
      if (settled) return
      if (code !== null && code !== 0) {
        finishReject(new Error(`远端子进程退出 code=${code}\n${stderr}`))
      }
    })
  })

  return {
    baseUrl,
    stop: async () => {
      await waitForChildExit(child, 10_000)
    },
  }
}
