let stopGlobalRemote: (() => Promise<void>) | undefined
let lastBaseUrl: string | undefined
let lastToken: string | undefined

export function registerGlobalRemoteSession(input: {
  baseUrl: string
  token: string
  stop: () => Promise<void>
}): void {
  lastBaseUrl = input.baseUrl
  lastToken = input.token
  stopGlobalRemote = input.stop
}

export function getGlobalRemoteSession(): {
  baseUrl: string
  token: string
  stop: () => Promise<void>
} {
  if (!lastBaseUrl || !lastToken || !stopGlobalRemote) {
    throw new Error('globalSetup 尚未注册远端会话')
  }
  return { baseUrl: lastBaseUrl, token: lastToken, stop: stopGlobalRemote }
}

export async function restartGlobalRemote(): Promise<{ baseUrl: string; token: string }> {
  const { startRemoteHttpServiceFromWorktree } = await import('./remote-process.js')
  if (stopGlobalRemote) {
    await stopGlobalRemote()
    stopGlobalRemote = undefined
  }
  const remote = await startRemoteHttpServiceFromWorktree()
  const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'
  registerGlobalRemoteSession({ baseUrl: remote.baseUrl, token, stop: remote.stop })
  process.env.REMOTE_SERVICE_URL = remote.baseUrl
  process.env.REMOTE_SERVICE_TOKEN = token
  return { baseUrl: remote.baseUrl, token }
}
