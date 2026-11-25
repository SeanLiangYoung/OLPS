import './load-root-env.js'
import { serve } from '@hono/node-server'
import { createKnowledgeApp } from './app.js'
import { loadKnowledgeServiceConfig } from './env-config.js'

const config = loadKnowledgeServiceConfig(process.env)
const app = createKnowledgeApp(config)
const host = config.listenHost ?? '127.0.0.1'
const port = config.listenPort ?? 19_828
serve({ fetch: app.fetch, port, hostname: host })
console.log(`knowledge service listening on http://${host}:${port}`)