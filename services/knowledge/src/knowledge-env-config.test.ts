import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  readKnowledgeImportMaxBytes,
  readKnowledgeListenPort,
  readKnowledgeSingleFileMaxBytes,
} from './env-config.js'

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'server.js')

describe('knowledge 环境变量', () => {
  it('缺少 KNOWLEDGE_SERVICE_TOKEN 时进程非零退出', () => {
    const pkgRoot = path.resolve(path.dirname(serverEntry), '..')
    const result = spawnSync(process.execPath, [serverEntry], {
      cwd: pkgRoot,
      env: {
        ...process.env,
        KNOWLEDGE_SERVICE_TOKEN: '',
      },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/KNOWLEDGE_SERVICE_TOKEN/)
  })

  it('导入与单文件默认上限', () => {
    expect(readKnowledgeImportMaxBytes({})).toBe(104_857_600)
    expect(readKnowledgeSingleFileMaxBytes({})).toBe(20_971_520)
  })

  it('监听端口使用 KNOWLEDGE_PORT', () => {
    expect(readKnowledgeListenPort({ KNOWLEDGE_PORT: '19829', PORT: '8787' })).toBe(19_829)
    expect(readKnowledgeListenPort({ PORT: '8787' })).toBe(19_828)
  })
})