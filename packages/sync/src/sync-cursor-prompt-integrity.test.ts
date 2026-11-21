import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { sandboxRoot } from './test-helpers.js'

const RESOLVED_LINE = 'OLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}'

function runPowerShell(script: string): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'powershell.exe' : process.execPath,
      process.platform === 'win32' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script] : ['--input-type=module', '-e', 'import fs from "node:fs";process.stdout.write(fs.readFileSync(process.argv[1],"utf8"))', script],
      { windowsHide: true, shell: false },
    )
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, exitCode: code ?? 1 }))
  })
}

describe('Cursor Agent 提示文件完整性', () => {
  it('UTF-8 提示文件经当前系统子进程读取后保留 JSON 双引号', async () => {
    const root = await sandboxRoot('prompt-integ')
    const promptPath = path.join(root, 'agent-prompt.txt')
    const prompt = [
      '测试提示',
      RESOLVED_LINE,
      'OLPS_AGENT_RESULT_JSON={"status":"needs_user","message":"需要用户决定：示例"}',
    ].join('\n')
    await fs.writeFile(promptPath, prompt, 'utf8')

    const readScript = [
      `$p = Get-Content -LiteralPath '${promptPath.replace(/'/g, "''")}' -Raw -Encoding utf8`,
      'if ($p -notmatch \'OLPS_AGENT_RESULT_JSON=\\{"status":"resolved","message":""\\}\') { exit 2 }',
      'Write-Output $p',
    ].join('; ')
    const result = await runPowerShell(process.platform === 'win32' ? readScript : promptPath)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(RESOLVED_LINE)
    expect(result.stdout).toContain('"status":"resolved"')
  })
})
