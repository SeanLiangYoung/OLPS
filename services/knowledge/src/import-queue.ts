const siteTails = new Map<string, Promise<void>>()

export function enqueueSiteWork(siteId: string, task: () => Promise<void>): Promise<void> {
  const previous = siteTails.get(siteId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(task)
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error)
      console.error(`[knowledge] site work failed siteId=${siteId}\n${detail}`)
    })
    .finally(() => {
      if (siteTails.get(siteId) === next) {
        siteTails.delete(siteId)
      }
    })
  siteTails.set(siteId, next)
  return next
}

export function resetSiteQueuesForTests(): void {
  siteTails.clear()
}