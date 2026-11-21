import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

type RemoteHarness = {
  makeIsolatedDataRoot: (label: string) => Promise<string>
  startRemoteServer: (config: {
    dataRoot: string
    serviceToken: string
    publicBaseUrl: string
    listenPort?: number
  }) => Promise<{ baseUrl: string; close: () => void }>
}

function remoteHarnessPath(): string {
  const remoteRoot = path.resolve(apiRoot, '../remote')
  const harnessPath = path.join(remoteRoot, 'src', 'test-harness.ts')
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`远端 test-harness 不存在: ${harnessPath}`)
  }
  return harnessPath
}

async function loadHarness(): Promise<RemoteHarness> {
  return (await import(pathToFileURL(remoteHarnessPath()).href)) as RemoteHarness
}

export type DedicatedRemoteSession = {
  dataRoot: string
  baseUrl: string
  token: string
  close: () => void
}

export async function startDedicatedRemote(label: string): Promise<DedicatedRemoteSession> {
  const harness = await loadHarness()
  const dataRoot = await harness.makeIsolatedDataRoot(label)
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  const server = await harness.startRemoteServer({
    dataRoot,
    serviceToken: token,
    publicBaseUrl: 'http://127.0.0.1:0',
  })
  return {
    dataRoot,
    baseUrl: server.baseUrl,
    token,
    close: server.close,
  }
}

export async function restartDedicatedRemote(
  dataRoot: string,
  label: string,
  listenPort?:number,
): Promise<DedicatedRemoteSession> {
  const harness = await loadHarness()
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  const server = await harness.startRemoteServer({
    dataRoot,
    serviceToken: token,
    publicBaseUrl: `http://127.0.0.1:${listenPort??0}`,
    listenPort,
  })
  void label
  return {
    dataRoot,
    baseUrl: server.baseUrl,
    token,
    close: server.close,
  }
}

export function applyRemoteEnv(baseUrl: string, token: string): void {
  process.env.REMOTE_SERVICE_URL = baseUrl.replace(/\/+$/, '')
  process.env.REMOTE_SERVICE_TOKEN = token
}

export function snapshotRemoteEnv(): { baseUrl: string; token: string } {
  return {
    baseUrl: process.env.REMOTE_SERVICE_URL ?? '',
    token: process.env.REMOTE_SERVICE_TOKEN ?? '',
  }
}
