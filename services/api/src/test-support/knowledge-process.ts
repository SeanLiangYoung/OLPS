import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopChildProcess } from './wait-for-child-exit.js'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const knowledgeIntegrationToken = 'olps-knowledge-integration-token'

type KnowledgeStartupPayload = { baseUrl: string; knowledgeRoot: string }

function resolveTsxImportSpecifier(): string {
  const localPkg = path.join(apiRoot, 'node_modules', 'tsx', 'package.json')
  const workspacePkg = path.join(apiRoot, '..', '..', 'node_modules', 'tsx', 'package.json')
  if (fs.existsSync(localPkg) || fs.existsSync(workspacePkg)) {
    return 'tsx'
  }
  throw new Error(`找不到 tsx 包: ${localPkg}`)
}

async function readKnowledgeStartupPayload(child: ChildProcess): Promise<KnowledgeStartupPayload> {
  let stdout = ''
  let stderr = ''
  let settled = false

  return await new Promise<KnowledgeStartupPayload>((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (settled) return
      settled = true
      void stopChildProcess(child, 10_000).finally(() => {
        reject(new Error(`knowledge 子进程启动超时\n${stderr}`))
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
    const finishResolve = (payload: KnowledgeStartupPayload) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      resolve(payload)
    }

    if (!child.stdout || !child.stderr) {
      finishReject(new Error('knowledge 子进程缺少 stdout/stderr'))
      return
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const line = stdout.trim().split('\n').find((l) => l.startsWith('{'))
      if (!line) return
      const parsed = JSON.parse(line) as { baseUrl?: string; knowledgeRoot?: string }
      if (parsed.baseUrl && parsed.knowledgeRoot) {
        finishResolve({ baseUrl: parsed.baseUrl, knowledgeRoot: parsed.knowledgeRoot })
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', finishReject)
    child.on('exit', (code) => {
      if (settled) return
      if (code !== null && code !== 0) {
        finishReject(new Error(`knowledge 子进程退出 code=${code}\n${stderr}`))
      }
    })
  })
}

export async function startKnowledgeHttpServiceFromWorktree(): Promise<{
  baseUrl: string
  knowledgeRoot: string
  stop: () => Promise<void>
}> {
  const launcher = path.join(apiRoot, 'src', 'test-support', 'launch-knowledge-server.ts')
  const tsxImport = resolveTsxImportSpecifier()
  const child = spawn(process.execPath, ['--import', tsxImport, launcher], {
    cwd: apiRoot,
    env: {
      ...process.env,
      KNOWLEDGE_SERVICE_TOKEN: process.env.KNOWLEDGE_SERVICE_TOKEN ?? knowledgeIntegrationToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const payload = await readKnowledgeStartupPayload(child)

  return {
    baseUrl: payload.baseUrl,
    knowledgeRoot: payload.knowledgeRoot,
    stop: async () => {
      await stopChildProcess(child, 10_000)
    },
  }
}