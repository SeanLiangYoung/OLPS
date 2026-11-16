import { describe, expect, it } from 'vitest'
import { cursorAgentInvocation } from './cursor-agent-runner.js'

describe('Cursor Agent 跨平台命令', () => {
  it('macOS 和 Linux 直接传递工作目录及完整提示', () => {
    const prompt = '中文提示\nOLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}'
    for (const platform of ['darwin', 'linux'] as const) {
      const result = cursorAgentInvocation({
        platform, command: '/opt/agent path/cursor-agent', cwd: '/site path',
        prompt, promptPath: '/logs/prompt.txt',
      })
      expect(result.command).toBe('/opt/agent path/cursor-agent')
      expect(result.args).toEqual(['-p', '--force', '--trust', '--workspace', '/site path', '--output-format', 'text', prompt])
    }
  })

  it('Windows 可执行文件使用相同参数直接启动', () => {
    const result = cursorAgentInvocation({
      platform: 'win32', command: 'C:\\tools\\agent.exe', cwd: 'C:\\site',
      prompt: '提示', promptPath: 'C:\\logs\\prompt.txt',
    })
    expect(result.command).toBe('C:\\tools\\agent.exe')
    expect(result.args.at(-1)).toBe('提示')
  })

  it('Windows 默认命令通过 LOCALAPPDATA 定位 PowerShell 脚本', () => {
    const result = cursorAgentInvocation({
      platform: 'win32', command: 'cursor-agent', localAppData: 'C:\\Users\\owner\\AppData\\Local',
      cwd: 'C:\\site', prompt: '提示', promptPath: 'C:\\logs\\prompt.txt',
    })
    expect(result.args).toContain('C:\\Users\\owner\\AppData\\Local\\cursor-agent\\cursor-agent.ps1')
    expect(result.args).toContain('-PromptFile')
  })
})
