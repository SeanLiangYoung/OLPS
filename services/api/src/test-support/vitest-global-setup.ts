import type { TestProject } from 'vitest/node'
import { registerGlobalRemoteSession } from './global-remote-session.js'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'
import { knowledgeIntegrationToken, startKnowledgeHttpServiceFromWorktree } from './knowledge-process.js'

let stopRemote: (() => Promise<void>) | undefined
let stopKnowledge: (() => Promise<void>) | undefined

const defaultTestDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://olps:olps@127.0.0.1:5434/olps_test_api'

export async function setup(project: TestProject): Promise<void> {
  if (!defaultTestDatabaseUrl.includes('_test_')) {
    throw new Error(`Vitest 只允许连接名称包含 _test_ 的数据库: ${defaultTestDatabaseUrl}`)
  }
  process.env.TEST_DATABASE_URL = defaultTestDatabaseUrl
  process.env.DATABASE_URL = defaultTestDatabaseUrl

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
