import type { TestProject } from 'vitest/node'
import { registerGlobalRemoteSession } from './global-remote-session.js'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'
import { knowledgeIntegrationToken, startKnowledgeHttpServiceFromWorktree } from './knowledge-process.js'

let stopRemote: (() => Promise<void>) | undefined
let stopKnowledge: (() => Promise<void>) | undefined

export async function setup(project: TestProject): Promise<void> {
  const remote = await startRemoteHttpServiceFromWorktree()
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  project.provide('remoteServiceUrl', remote.baseUrl)
  project.provide('remoteServiceToken', token)
  project.provide('remoteDataRoot', remote.dataRoot)
  stopRemote = remote.stop
  registerGlobalRemoteSession({ baseUrl: remote.baseUrl, token, stop: remote.stop })

  const knowledge = await startKnowledgeHttpServiceFromWorktree()
  project.provide('knowledgeServiceUrl', knowledge.baseUrl)
  project.provide('knowledgeServiceToken', knowledgeIntegrationToken)
  project.provide('knowledgeDataRoot', knowledge.knowledgeRoot)
  stopKnowledge = knowledge.stop
}

export async function teardown(): Promise<void> {
  await stopKnowledge?.()
  await stopRemote?.()
}
