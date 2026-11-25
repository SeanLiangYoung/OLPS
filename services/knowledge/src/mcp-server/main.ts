import '../load-root-env.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createKnowledgeHttpClient, loadMcpHttpConfig } from './http-client.js'
import { createKnowledgeMcpServer } from './server.js'

async function main(): Promise<void> {
  const config = loadMcpHttpConfig(process.env)
  const client = createKnowledgeHttpClient(config)
  const server = createKnowledgeMcpServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err)
  console.error(detail)
  process.exit(1)
})
