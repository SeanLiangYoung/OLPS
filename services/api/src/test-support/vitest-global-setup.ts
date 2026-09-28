import type { TestProject } from 'vitest/node'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'

let stopRemote: (() => Promise<void>) | undefined

export async function setup(project: TestProject): Promise<void> {
  const remote = await startRemoteHttpServiceFromWorktree()
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  project.provide('remoteServiceUrl', remote.baseUrl)
  project.provide('remoteServiceToken', token)
  stopRemote = remote.stop
}

export async function teardown(): Promise<void> {
  await stopRemote?.()
}
