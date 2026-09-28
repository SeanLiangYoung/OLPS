import fs from 'node:fs'
import path from 'node:path'
import { registerGlobalRemoteSession } from './global-remote-session.js'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'
import { vitestRemoteEnvFile } from './vitest-remote-env-path.js'

let stopRemote: (() => Promise<void>) | undefined

export async function setup(): Promise<void> {
  fs.mkdirSync(path.dirname(vitestRemoteEnvFile), { recursive: true })
  const remote = await startRemoteHttpServiceFromWorktree()
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  fs.writeFileSync(
    vitestRemoteEnvFile,
    `${JSON.stringify(
      {
        REMOTE_SERVICE_URL: remote.baseUrl,
        REMOTE_SERVICE_TOKEN: token,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  stopRemote = remote.stop
  registerGlobalRemoteSession({ baseUrl: remote.baseUrl, token, stop: remote.stop })
}

export async function teardown(): Promise<void> {
  await stopRemote?.()
  if (fs.existsSync(vitestRemoteEnvFile)) {
    fs.unlinkSync(vitestRemoteEnvFile)
  }
}
