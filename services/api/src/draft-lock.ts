const locks = new Map<string, Promise<void>>()

export async function withDraftLock<T>(draftId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(draftId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  locks.set(draftId, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(draftId) === tail) {
      locks.delete(draftId)
    }
  }
}
