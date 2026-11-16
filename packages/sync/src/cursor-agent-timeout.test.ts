import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runCursorAgent } from './cursor-agent-runner.js'
import { sandboxRoot } from './test-helpers.js'

describe('Cursor Agent 执行错误', () => {
  it('真实 CLI 超时后终止并保存完整提示和退出状态', async () => {
    const root = await sandboxRoot('agent-timeout')
    const result = await runCursorAgent({ cwd: root, logDir: root, prompt: '回复执行结果', timeoutMs: 1 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(124)
    expect(await fs.readFile(result.logPath, 'utf8')).toContain('回复执行结果')
  })

  it('缺少配置的可执行文件时立即返回明确错误', async () => {
    const root = await sandboxRoot('agent-missing')
    await expect(runCursorAgent({ cwd: root, logDir: root, prompt: '执行', command: `${root}/missing-agent` }))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
