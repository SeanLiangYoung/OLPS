import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopChildProcess } from './wait-for-child-exit.js'

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

type RemoteStartupPayload = { baseUrl: string; dataRoot: string }

async function readRemoteStartupPayload(child: ChildProcess): Promise<RemoteStartupPayload> {
  let stdout = ''
  let stderr = ''
  let settled = false

  return await new Promise<RemoteStartupPayload>((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (settled) return
      settled = true
      void stopChildProcess(child, 10_000).finally(() => {
        reject(new Error(`远端子进程启动超时\n${stderr}`))
      })
    }, 60_000)

    const finishReject = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      void stopChildProcess(child, 10_000).finally(() => {
        reject(err)
      })
    }
    const finishResolve = (payload: RemoteStartupPayload) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      resolve(payload)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const line = stdout.trim().split('\n').find((l) => l.startsWith('{'))
      if (!line) return
      const parsed = JSON.parse(line) as { baseUrl?: string; dataRoot?: string }
      if (parsed.baseUrl && parsed.dataRoot) {
        finishResolve({ baseUrl: parsed.baseUrl, dataRoot: parsed.dataRoot })
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
}

export async function startRemoteHttpServiceFromWorktree(): Promise<{
  baseUrl: string
  dataRoot: string
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

  const payload = await readRemoteStartupPayload(child)

  return {
    baseUrl: payload.baseUrl,
    dataRoot: payload.dataRoot,
    stop: async () => {
      await stopChildProcess(child, 10_000)
    },
  }
}
