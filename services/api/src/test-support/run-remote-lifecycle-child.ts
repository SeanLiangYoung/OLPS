import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scenario = process.env.REMOTE_LIFECYCLE_SCENARIO ?? 'success'

function parsePort(baseUrl: string): number {
  const parsed = new URL(baseUrl)
  if (!parsed.port) {
    throw new Error(`baseUrl 缺少端口: ${baseUrl}`)
  }
  return Number(parsed.port)
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const finish = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.on('connect', () => finish(true))
    socket.on('error', () => finish(false))
    setTimeout(() => finish(false), timeoutMs)
  })
}

const FAIL_START_NODE_OPTIONS = '--invalid-flag-for-olps-lifecycle-fail-start'

function assertFailStartLaunchError(startError: unknown): void {
  const message = startError instanceof Error ? startError.message : String(startError)
  const fromChildExit = message.includes('远端子进程退出')
  const fromInvalidNodeOptions =
    message.includes('is not allowed in NODE_OPTIONS') ||
    message.includes(FAIL_START_NODE_OPTIONS)
  if (!fromChildExit && !fromInvalidNodeOptions) {
    throw new Error(`fail-start 预期远端 launcher 子进程启动失败，实际: ${message}`)
  }
}

async function runFailStart(): Promise<void> {
  const previousNodeOptions = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = FAIL_START_NODE_OPTIONS

  let remote: Awaited<ReturnType<typeof startRemoteHttpServiceFromWorktree>> | undefined
  let startError: unknown
  try {
    try {
      remote = await startRemoteHttpServiceFromWorktree()
    } catch (error) {
      startError = error
    }

    if (remote !== undefined) {
      await remote.stop()
      throw new Error('fail-start 场景下远端启动应当失败')
    }

    if (startError === undefined) {
      throw new Error('fail-start 场景下远端启动应当失败')
    }

    assertFailStartLaunchError(startError)
  } finally {
    if (previousNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions
    }
  }
}

async function runSuccess(): Promise<void> {
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  const remote = await startRemoteHttpServiceFromWorktree()
  const port = parsePort(remote.baseUrl)

  if (!(await probeTcp('127.0.0.1', port, 3_000))) {
    throw new Error(`远端启动后端口不可访问: ${remote.baseUrl}`)
  }

  const response = await fetch(`${remote.baseUrl.replace(/\/+$/, '')}/api/remote/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (response.status !== 200) {
    const text = await response.text()
    throw new Error(`远端 HTTP 不可用 status=${response.status} body=${text}`)
  }

  await remote.stop()

  if (await probeTcp('127.0.0.1', port, 3_000)) {
    throw new Error(`stop 后端口仍可访问: ${remote.baseUrl}`)
  }
}

async function run(): Promise<void> {
  if (scenario === 'fail-start') {
    await runFailStart()
    return
  }
  await runSuccess()
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
