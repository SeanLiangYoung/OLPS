export function readRemoteListenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.REMOTE_PORT?.trim()
  if (raw) {
    return Number(raw)
  }
  return 8790
}
