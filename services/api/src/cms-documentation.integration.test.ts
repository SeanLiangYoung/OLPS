import { existsSync, readFileSync } from 'node:fs'
import { inspectRoutes } from 'hono/dev'
import { expect, it } from 'vitest'
import { cmsApp } from './cms-app.js'

it('API 方法和路径清单与管理服务实际注册的接口一致', () => {
  const inventory = new URL('../docs/routes.json', import.meta.url)
  expect(existsSync(inventory), '缺少 API 路由清单').toBe(true)
  const documented: string[] = JSON.parse(readFileSync(inventory, 'utf8'))

  // Hono 对 use 和 all 都登记 ALL，自定义插件的终止处理器仍属于正式路由。
  const endpoints = new Set(inspectRoutes(cmsApp)
    .filter(route => !route.isMiddleware)
    .map(route => `${route.method} ${route.path}`))

  expect([...endpoints].sort()).toEqual([...documented].sort())
})
