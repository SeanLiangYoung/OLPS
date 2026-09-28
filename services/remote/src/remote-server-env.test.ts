import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRemoteListenPort } from './env-config.js'

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'server.js')

describe('remote server 环境变量', () => {
  it('缺少 REMOTE_SERVICE_TOKEN 时进程非零退出', () => {
    const pkgRoot = path.resolve(path.dirname(serverEntry), '..')
    const result = spawnSync(process.execPath, [serverEntry], {
      cwd: pkgRoot,
      env: {
        ...process.env,
        REMOTE_SERVICE_TOKEN: '',
        REMOTE_PUBLIC_BASE_URL: 'http://127.0.0.1:8790',
      },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/REMOTE_SERVICE_TOKEN/)
  })

  it('监听端口使用 REMOTE_PORT 而非 API 的 PORT', () => {
    expect(readRemoteListenPort({ REMOTE_PORT: '8791', PORT: '8787' })).toBe(8791)
    expect(readRemoteListenPort({ PORT: '8787' })).toBe(8790)
  })
})
