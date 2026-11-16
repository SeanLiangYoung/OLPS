import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sandboxRoot } from './test-helpers.js'
import { runCursorAgent } from './cursor-agent-runner.js'

const RESOLVED_LINE = 'OLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}'

describe('Cursor Agent 提示文件完整性', () => {
  it('真实 CLI 接收中文和 JSON 双引号并保留原始提示', async () => {
    const root = await sandboxRoot('prompt-integ')
    const prompt = `请直接回复下面这行内容，保留全部双引号：\n${RESOLVED_LINE}`
    const result = await runCursorAgent({ cwd: root, logDir: root, prompt, timeoutMs: 90_000 })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain(RESOLVED_LINE)
    expect(await fs.readFile(result.logPath, 'utf8')).toContain(prompt)
  }, 100_000)
})
