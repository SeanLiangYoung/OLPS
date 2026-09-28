import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(adminRoot, '../..')
const apiRoot = path.join(repoRoot, 'services', 'api')

export const E2E_API_PORT = 8788
export const E2E_REMOTE_PORT = 8792
export const E2E_ADMIN_PORT = 5175

export type DedicatedE2eStack = {
  apiBaseUrl: string
  adminBaseUrl: string
  remoteDataRoot: string
  stopRemoteOnly: () => Promise<void>
  restartRemote: () => Promise<void>
  stop: () => Promise<void>
}

function resolveTsxImport(): string {
  const localPkg = path.join(apiRoot, 'node_modules', 'tsx', 'package.json')
  const workspacePkg = path.join(repoRoot, 'node_modules', 'tsx', 'package.json')
  if (fs.existsSync(localPkg) || fs.existsSync(workspacePkg)) {
    return 'tsx'
  }
  throw new Error('找不到 tsx 包')
}

async function stopChildProcess(child: ChildProcess, termGraceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, termGraceMs)
    }),
  ])
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGKILL')
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
}

async function readJsonLineFromChild(child: ChildProcess, timeoutMs: number): Promise<string> {
  let stdout = ''
  let stderr = ''
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      void stopChildProcess(child, 10_000).finally(() => {
        reject(new Error(`子进程启动超时\n${stderr}`))
      })
    }, timeoutMs)

    if (!child.stdout || !child.stderr) {
      clearTimeout(timer)
      reject(new Error('子进程缺少 stdout/stderr'))
      return
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const line = stdout.trim().split('\n').find((l) => l.startsWith('{'))
      if (!line) return
      const parsed = JSON.parse(line) as { baseUrl?: string }
      if (parsed.baseUrl) {
        clearTimeout(timer)
        resolve(parsed.baseUrl)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer)
        reject(new Error(`子进程退出 code=${code}\n${stderr}`))
      }
    })
  })
}

async function waitForApiHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`)
      if (response.ok) {
        return
      }
      lastError = `status=${response.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`API 健康检查超时: ${lastError}`)
}

function stackIntermediateRoot(label: string): string {
  return path.join(repoRoot, '.intermediate', 'e2e', label)
}

function assertE2eDatabaseUrl(databaseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error(`E2E 数据库连接串无效: ${databaseUrl}`)
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!dbName.includes('_test_')) {
    throw new Error(`E2E 须使用测试库（库名含 _test_），当前为: ${dbName}`)
  }
}

async function ensurePgTestSchema(databaseUrl: string, schema: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error(`非法 PG schema 名称: ${schema}`)
  }
  const pg = await import('pg')
  const admin = new pg.default.Pool({ connectionString: databaseUrl })
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
  } finally {
    await admin.end()
  }
}

export async function startDedicatedE2eStack(label: string): Promise<DedicatedE2eStack> {
  const suffix = randomBytes(4).toString('hex')
  const runRoot = path.join(stackIntermediateRoot(label), `${Date.now().toString(36)}-${suffix}`)
  const remoteDataRoot = path.join(runRoot, 'remote-data')
  const sandboxRoot = path.join(runRoot, 'sandboxes')
  const publishRoot = path.join(runRoot, 'publish')
  const previewRoot = path.join(runRoot, 'preview')
  fs.mkdirSync(remoteDataRoot, { recursive: true })
  fs.mkdirSync(sandboxRoot, { recursive: true })
  fs.mkdirSync(publishRoot, { recursive: true })
  fs.mkdirSync(previewRoot, { recursive: true })

  const schema = `e2e_${suffix}`
  const databaseUrl =
    process.env.E2E_DATABASE_URL?.trim() ||
    'postgres://olps:olps@127.0.0.1:5434/olps_test_e2e'
  assertE2eDatabaseUrl(databaseUrl)

  const remoteToken = `e2e-remote-${suffix}`
  const tsxImport = resolveTsxImport()
  const remoteLauncher = path.join(adminRoot, 'e2e', 'launch-remote-e2e.ts')
  const apiLauncher = path.join(apiRoot, 'src', 'test-support', 'launch-api-server.ts')

  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    PG_TEST_SCHEMA: schema,
    SANDBOX_ROOT: sandboxRoot,
    PUBLISH_ROOT: publishRoot,
    PREVIEW_ROOT: previewRoot,
    REMOTE_SERVICE_TOKEN: remoteToken,
    PUBLIC_API_BASE_URL: `http://127.0.0.1:${E2E_API_PORT}`,
    API_TEST_LISTEN_PORT: String(E2E_API_PORT),
    PORT: String(E2E_API_PORT),
  }

  await ensurePgTestSchema(databaseUrl, schema)

  let remoteChild = spawn(process.execPath, ['--import', tsxImport, remoteLauncher], {
    cwd: repoRoot,
    env: {
      ...sharedEnv,
      E2E_REMOTE_DATA_ROOT: remoteDataRoot,
      E2E_REMOTE_PORT: String(E2E_REMOTE_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let remoteBaseUrl: string
  try {
    remoteBaseUrl = await readJsonLineFromChild(remoteChild, 120_000)
  } catch (err) {
    await stopChildProcess(remoteChild, 15_000)
    throw err
  }

  let apiChild = spawn(process.execPath, ['--import', tsxImport, apiLauncher], {
    cwd: apiRoot,
    env: {
      ...sharedEnv,
      REMOTE_SERVICE_URL: remoteBaseUrl.replace(/\/+$/, ''),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let apiBaseUrl: string
  try {
    apiBaseUrl = await readJsonLineFromChild(apiChild, 120_000)
    await waitForApiHealth(apiBaseUrl, 30_000)
  } catch (err) {
    await stopChildProcess(apiChild, 15_000)
    await stopChildProcess(remoteChild, 15_000)
    throw err
  }

  const adminBaseUrl = `http://127.0.0.1:${E2E_ADMIN_PORT}`
  const viteBin = path.join(adminRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const viteEntry = fs.existsSync(viteBin)
    ? viteBin
    : path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  let viteChild = spawn(
    process.execPath,
    [
      viteEntry,
      '--config',
      path.join(adminRoot, 'vite.config.e2e.ts'),
      '--host',
      '127.0.0.1',
      '--port',
      String(E2E_ADMIN_PORT),
      '--strictPort',
    ],
    {
      cwd: adminRoot,
      env: {
        ...process.env,
        OLPS_E2E_API_URL: apiBaseUrl.replace(/\/+$/, ''),
        OLPS_E2E_ADMIN_PORT: String(E2E_ADMIN_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  )

  try {
    await waitForAdminHome(adminBaseUrl, 60_000)
  } catch (err) {
    await stopChildProcess(viteChild, 15_000)
    await stopChildProcess(apiChild, 15_000)
    await stopChildProcess(remoteChild, 15_000)
    throw err
  }

  let remoteStopped = false

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    adminBaseUrl,
    remoteDataRoot,
    stop: async () => {
      await stopChildProcess(viteChild, 15_000)
      await stopChildProcess(apiChild, 15_000)
      if (!remoteStopped) {
        await stopChildProcess(remoteChild, 15_000)
      }
    },
    async stopRemoteOnly(): Promise<void> {
      if (remoteStopped) return
      await stopChildProcess(remoteChild, 15_000)
      remoteStopped = true
      await new Promise((resolve) => setTimeout(resolve, 500))
    },
    async restartRemote(): Promise<void> {
      if (!remoteStopped) {
        await stopChildProcess(remoteChild, 15_000)
        remoteStopped = true
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      remoteChild = spawn(process.execPath, ['--import', tsxImport, remoteLauncher], {
        cwd: repoRoot,
        env: {
          ...sharedEnv,
          E2E_REMOTE_DATA_ROOT: remoteDataRoot,
          E2E_REMOTE_PORT: String(E2E_REMOTE_PORT),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      remoteBaseUrl = await readJsonLineFromChild(remoteChild, 120_000)
      remoteStopped = false
      // API 子进程仍指向同一端口上的远端
      void remoteBaseUrl
    },
  }
}

async function waitForAdminHome(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/`)
      if (response.ok) {
        return
      }
      lastError = `status=${response.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Admin 启动超时: ${lastError}`)
}
