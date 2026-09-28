const RESERVED_ROUTE_KEYS = new Set(['assets', 'index', 'sitemap.xml'])

export function routeKey(routeSlug: string): string {
  return routeSlug.toLowerCase()
}

export function assertReservedRoute(routeSlug: string): void {
  const key = routeKey(routeSlug)
  if (RESERVED_ROUTE_KEYS.has(key)) {
    throw new Error(`路由 slug 与保留路径冲突: ${routeSlug}`)
  }
}

export class RouteRegistry {
  private owners = new Map<string, string>()

  register(routeSlug: string, pageId: string): void {
    assertReservedRoute(routeSlug)
    const key = routeKey(routeSlug)
    if (this.owners.has(key)) {
      throw new Error(`重复 route: ${routeSlug}`)
    }
    this.owners.set(key, pageId)
  }
}
