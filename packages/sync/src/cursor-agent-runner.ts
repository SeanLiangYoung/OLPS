import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export type AgentRunResult = {
  exitCode: number
  logPath: string
  stdout: string
  stderr: string
  timedOut: boolean
}

function resolveCursorAgentExecutable(): string {
  if (process.platform !== 'win32') return process.env.CURSOR_AGENT_COMMAND?.trim() || 'cursor-agent'
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    throw new Error('未找到 LOCALAPPDATA，无法定位 cursor-agent')
  }
  return path.join(localAppData, 'cursor-agent', 'cursor-agent.ps1')
}

function resolveWrapperScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, 'scripts', 'run-cursor-agent.ps1'),
    path.join(here, '..', 'scripts', 'run-cursor-agent.ps1'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('未找到 scripts/run-cursor-agent.ps1')
}

function resolvePwshExecutable(): string {
  const fromEnv = process.env.OLPS_PWSH_PATH?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv
  }
  return 'pwsh'
}

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  process.kill(-pid, 'SIGKILL')
}

export async function runCursorAgent(input: {
  cwd: string
  prompt: string
  logDir: string
  timeoutMs?: number
}): Promise<AgentRunResult> {
  const timeoutMs = input.timeoutMs ?? 12 * 60 * 1000
  await fsPromises.mkdir(input.logDir, { recursive: true })
  const stamp = Date.now()
  const logPath = path.join(input.logDir, `agent-${stamp}.log`)
  const promptPath = path.join(input.logDir, `prompt-${stamp}.txt`)
  await fsPromises.writeFile(promptPath, input.prompt, 'utf8')

  const promptReadBack = await fsPromises.readFile(promptPath, 'utf8')
  const promptSha256 = createHash('sha256').update(promptReadBack, 'utf8').digest('hex')
  const markerProbe = 'OLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}'
  const promptContainsExactResolvedLine = promptReadBack.includes(markerProbe)

  const agentScript = resolveCursorAgentExecutable()
  const wrapperScript = process.platform === 'win32' ? resolveWrapperScript() : ''
  const pwsh = process.platform === 'win32' ? resolvePwshExecutable() : agentScript
  const args = process.platform === 'win32' ? [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wrapperScript,
    '-AgentScript',
    agentScript,
    '-Workspace',
    input.cwd,
    '-PromptFile',
    promptPath,
  ] : ['-p', '--force', '--trust', '--workspace', input.cwd, '--output-format', 'text', promptReadBack]

  return await new Promise((resolve, reject) => {
    let timedOut = false
    const child = spawn(pwsh, args, {
      cwd: input.cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) {
        killProcessTree(child.pid)
      }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', async (code) => {
      clearTimeout(timer)
      const exitCode = timedOut ? 124 : (code ?? 1)
      const logBody = [
        '=== prompt file ===',
        promptPath,
        '=== prompt sha256 ===',
        promptSha256,
        '=== prompt contains exact resolved marker line ===',
        String(promptContainsExactResolvedLine),
        '=== pwsh ===',
        pwsh,
        '=== wrapper ===',
        wrapperScript,
        '=== agent script ===',
        agentScript,
        '=== timed out ===',
        String(timedOut),
        '=== prompt ===',
        promptReadBack,
        '',
        '=== stdout ===',
        stdout,
        '',
        '=== stderr ===',
        stderr,
        '',
        '=== exit ===',
        String(exitCode),
        '',
      ].join('\n')
      await fsPromises.writeFile(logPath, logBody, 'utf8')
      resolve({
        exitCode,
        logPath,
        stdout,
        stderr,
        timedOut,
      })
    })
  })
}
