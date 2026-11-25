import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const knowledgeRoot = path.resolve(apiRoot, '../knowledge')

async function main(): Promise<void> {
  const harnessPath = path.join(knowledgeRoot, 'src', 'test-harness.ts')
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`knowledge test-harness 不存在: ${harnessPath}`)
  }

  const token = process.env.KNOWLEDGE_SERVICE_TOKEN ?? 'olps-knowledge-integration-token'

  const harness = (await import(pathToFileURL(harnessPath).href)) as {
    makeIsolatedKnowledgeRoot: (label: string) => Promise<string>
    startKnowledgeServer: (config: { knowledgeRoot: string; serviceToken: string }) => Promise<{
      baseUrl: string
      close: () => void
    }>
  }

  const root = await harness.makeIsolatedKnowledgeRoot('api-integration-child')
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  const server = await harness.startKnowledgeServer({
    knowledgeRoot: root,
    serviceToken: token,
    databaseUrl: databaseUrl?.trim(),
  })

  process.stdout.write(`${JSON.stringify({ baseUrl: server.baseUrl, knowledgeRoot: root })}\n`)

  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => {
      server.close()
      resolve()
    })
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})