import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('run-cursor-agent.ps1 包装', () => {
  it('使用 Standard 参数传递并直接调用 AgentScript', async () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const wrapper = path.join(packageRoot, 'scripts', 'run-cursor-agent.ps1')
    const body = await fs.readFile(wrapper, 'utf8')
    expect(body).toContain("PSNativeCommandArgumentPassing = 'Standard'")
    expect(body).toContain('& $AgentScript')
    expect(body).not.toContain('powershell.exe')
    expect(body).not.toContain('versions')
  })
})
