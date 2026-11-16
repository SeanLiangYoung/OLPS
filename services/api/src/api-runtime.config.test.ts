import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, inject } from 'vitest'

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

async function loadProductionConfigInSubprocess(env: NodeJS.ProcessEnv): Promise<{
  host: string
  remoteServiceUrl: string
  remoteServiceToken: string
}> {
  const script = path.join(apiRoot, 'src/test-support/print-config-remote.ts')
  const tsxCli = resolveTsxCli()
  const child = spawn(process.execPath, [tsxCli, script], {
    cwd: apiRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
  }>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({ stdout, stderr, exitCode: code })
    })
  })

  if (exitCode !== 0) {
    throw new Error(`加载 config 子进程失败 code=${exitCode}\n${stderr}`)
  }

  return JSON.parse(stdout.trim()) as {
    host: string
    remoteServiceUrl: string
    remoteServiceToken: string
  }
}

describe('正式 config 与测试远端配置隔离', () => {
  it('允许通过 HOST 配置容器监听地址', async () => {
    const loaded = await loadProductionConfigInSubprocess({ HOST: '0.0.0.0' })
    expect(loaded.host).toBe('0.0.0.0')
  })

  it('默认监听本地地址', async () => {
    const loaded = await loadProductionConfigInSubprocess({ HOST: '' })
    expect(loaded.host).toBe('127.0.0.1')
  })

  const callerUrl = 'http://127.0.0.1:59991'
  const callerToken = 'caller-remote-token-from-env'
  const decoyUrl = 'http://127.0.0.1:59992'
  const decoyToken = 'decoy-remote-token-from-json'
  const decoyEnvFile = path.join(apiRoot, '.intermediate', 'vitest-remote-env-decoy.json')

  it('子进程加载正式 config 时保留调用方 REMOTE_SERVICE_URL/TOKEN，不读取磁盘上的测试 JSON', async () => {
    fs.mkdirSync(path.dirname(decoyEnvFile), { recursive: true })
    fs.writeFileSync(
      decoyEnvFile,
      `${JSON.stringify(
        {
          REMOTE_SERVICE_URL: decoyUrl,
          REMOTE_SERVICE_TOKEN: decoyToken,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const loaded = await loadProductionConfigInSubprocess({
      DATABASE_URL: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? '',
      REMOTE_SERVICE_URL: callerUrl,
      REMOTE_SERVICE_TOKEN: callerToken,
    })

    expect(loaded.remoteServiceUrl).toBe(callerUrl.replace(/\/+$/, ''))
    expect(loaded.remoteServiceToken).toBe(callerToken)
  })
})

describe('Vitest provide 注入的远端配置', () => {
  it('inject 的 URL 与 token 可访问当前测试进程的正式 remote 接口', async () => {
    const url = inject('remoteServiceUrl')
    const token = inject('remoteServiceToken')
    expect(url).toMatch(/^https?:\/\//)
    expect(token.length).toBeGreaterThan(0)

    const response = await fetch(`${url.replace(/\/+$/, '')}/api/remote/sites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { remoteSiteId?: string }
    expect(body.remoteSiteId).toMatch(/^[a-z0-9-]+$/i)
  })
})
