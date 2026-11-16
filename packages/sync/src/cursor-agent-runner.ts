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

export function cursorAgentInvocation(input: {
  platform: NodeJS.Platform
  command: string
  cwd: string
  prompt: string
  promptPath: string
  localAppData?: string
}): { command: string; args: string[] } {
  let command = input.command
  if (input.platform === 'win32' && command === 'cursor-agent') {
    if (!input.localAppData) throw new Error('未找到 LOCALAPPDATA，无法定位 cursor-agent')
    command = path.win32.join(input.localAppData, 'cursor-agent', 'cursor-agent.ps1')
  }
  if (input.platform === 'win32' && command.toLowerCase().endsWith('.ps1')) {
    return {
      command: resolvePwshExecutable(),
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveWrapperScript(),
        '-AgentScript', command, '-Workspace', input.cwd, '-PromptFile', input.promptPath],
    }
  }
  return {
    command,
    args: ['-p', '--force', '--trust', '--workspace', input.cwd, '--output-format', 'text', input.prompt],
  }
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
  command?: string
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

  const agentScript = input.command ?? process.env.CURSOR_AGENT_COMMAND?.trim() ?? 'cursor-agent'
  const invocation = cursorAgentInvocation({
    platform: process.platform, command: agentScript, cwd: input.cwd,
    prompt: promptReadBack, promptPath,
    localAppData: process.env.LOCALAPPDATA,
  })

  return await new Promise((resolve, reject) => {
    let timedOut = false
    const child = spawn(invocation.command, invocation.args, {
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
        '=== executable ===',
        invocation.command,
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
