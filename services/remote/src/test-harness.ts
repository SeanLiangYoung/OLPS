import fs from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { AddressInfo } from 'node:net'
import { createRemoteApp } from './app.js'
import type { RemoteServiceConfig } from './types.js'

export async function makeIsolatedDataRoot(label: string): Promise<string> {
  const root = path.resolve(process.cwd(), '.intermediate', `${label}-${Date.now().toString(36)}`)
  await fs.mkdir(root, { recursive: true })
  return root
}

export async function startRemoteServer(
  config: RemoteServiceConfig,
): Promise<{
  baseUrl: string
  close: () => void
}> {
  const holder: { app: Hono | null } = { app: null }
  const server = serve({
    fetch: (req) => {
      if (!holder.app) {
        return new Response('not ready', { status: 503 })
      }
      return holder.app.fetch(req)
    },
    port: config.listenPort ?? 0,
  })
  await new Promise<void>((resolve) => {
    server.on('listening', () => resolve())
  })
  const addr = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${addr.port}`
  holder.app = createRemoteApp({
    ...config,
    publicBaseUrl: baseUrl,
  })
  return {
    baseUrl,
    close: () => {
      server.close()
    },
  }
}
