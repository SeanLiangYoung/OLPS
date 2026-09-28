const chains = new Map<string, Promise<void>>()

export async function withSiteLock<T>(remoteSiteId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(remoteSiteId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  chains.set(
    remoteSiteId,
    prev.then(() => gate),
  )
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}
