import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { runOnBuild, runTransformHtml } from './build-hooks.js'
import { runPluginApi } from './api-handler.js'
import { compilePluginServerScripts } from './compile-check.js'

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test-fixtures',
  'plugins',
)

function readPluginScript(pluginId: string, relativePath: string): string {
  return readFileSync(join(fixturesRoot, pluginId, relativePath), 'utf8')
}

function expectPluginIdInError(error: unknown, pluginId: string): void {
  expect(error).toBeInstanceOf(Error)
  const message = error instanceof Error ? error.message : String(error)
  expect(message).toContain(pluginId)
}

describe('plugin-runtime real isolate', () => {
  it('runs onBuild and returns files under the plugin public path', async () => {
    const result = await runOnBuild({
      pluginId: 'happy-build',
      scriptSource: readPluginScript('happy-build', 'server/build.js'),
      permissions: {},
      settings: { marker: 'm1' },
      log: () => {},
      timeoutBudgetMs: 60_000,
    })

    expect(result.files).toEqual([
      {
        path: 'public/plugins/happy-build/marker.txt',
        content: 'built-by=m1',
      },
    ])
    expect(result.remainingMs).toBeGreaterThan(0)
    expect(result.remainingMs).toBeLessThanOrEqual(60_000)
  })

  it('runs transformHtml and returns modified HTML', async () => {
    const result = await runTransformHtml({
      pluginId: 'happy-build',
      scriptSource: readPluginScript('happy-build', 'server/build.js'),
      permissions: {},
      settings: { pluginStamp: 'stamp-1' },
      log: () => {},
      html: '<html><body>ok</body></html>',
      pageInfo: { path: '/about' },
      timeoutBudgetMs: 60_000,
    })

    expect(result.html).toBe(
      '<html><body>ok</body></html><!-- plugin:stamp-1 page:/about -->',
    )
    expect(result.remainingMs).toBeGreaterThan(0)
  })

  it('runs handle for plugin API requests', async () => {
    const store = new Map<string, unknown>()
    const inquiries: Array<Record<string, unknown>> = []
    const logs: Array<{ level: string; message: string }> = []
    const fetchCalls: string[] = []

    const response = await runPluginApi({
      pluginId: 'happy-api',
      scriptSource: readPluginScript('happy-api', 'server/api.js'),
      permissions: {
        store: true,
        inquiries: true,
        fetch: ['api.example.com'],
      },
      settings: {},
      store: {
        get: async (key) => (store.has(key) ? store.get(key)! : null),
        set: async (key, value) => {
          store.set(key, value)
        },
        delete: async (key) => {
          store.delete(key)
        },
      },
      inquiries: {
        create: async (payload) => {
          inquiries.push(payload)
          return { id: 'inq-1' }
        },
      },
      log: (level, message) => {
        logs.push({ level, message })
      },
      fetchImpl: async (url) => {
        fetchCalls.push(url)
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"echo":true}',
        }
      },
      request: {
        method: 'POST',
        path: '/submit',
        query: { q: '1' },
        headers: { 'content-type': 'application/json' },
        body: { hello: 'world' },
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      stored: 'POST',
      remoteStatus: 200,
      query: { q: '1' },
    })
    expect(store.get('lastMethod')).toBe('POST')
    expect(inquiries).toEqual([{ source: 'happy-api', path: '/submit' }])
    expect(fetchCalls).toEqual(['https://api.example.com/echo'])
    expect(logs.some((entry) => entry.message === 'handle ok')).toBe(true)
  })

  it('rejects when handle exceeds the 5 second limit', async () => {
    let error: unknown
    try {
      await runPluginApi({
        pluginId: 'timeout-loop',
        scriptSource: readPluginScript('timeout-loop', 'server/api.js'),
        permissions: {},
        settings: {},
        log: () => {},
        request: {
          method: 'GET',
          path: '/',
          query: {},
          headers: {},
          body: null,
        },
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'timeout-loop')
  }, 20_000)

  it('rejects when isolate exceeds the 128 MB memory limit', async () => {
    let error: unknown
    try {
      await runOnBuild({
        pluginId: 'oom-alloc',
        scriptSource: readPluginScript('oom-alloc', 'server/build.js'),
        permissions: {},
        settings: {},
        log: () => {},
        timeoutBudgetMs: 60_000,
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'oom-alloc')
  }, 60_000)

  it('rejects fetch to an undeclared domain', async () => {
    let error: unknown
    try {
      await runPluginApi({
        pluginId: 'bad-fetch',
        scriptSource: readPluginScript('bad-fetch', 'server/api.js'),
        permissions: {
          fetch: ['api.example.com'],
        },
        settings: {},
        log: () => {},
        fetchImpl: async () => {
          throw new Error('fetchImpl should not be called for unauthorized host')
        },
        request: {
          method: 'GET',
          path: '/',
          query: {},
          headers: {},
          body: null,
        },
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'bad-fetch')
  })

  it('rejects undeclared store permission', async () => {
    let error: unknown
    try {
      await runPluginApi({
        pluginId: 'no-store-perm',
        scriptSource: readPluginScript('no-store-perm', 'server/api.js'),
        permissions: {},
        settings: {},
        log: () => {},
        store: {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
        },
        request: {
          method: 'GET',
          path: '/',
          query: {},
          headers: {},
          body: null,
        },
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'no-store-perm')
  })

  it('rejects onBuild files outside public/plugins/<pluginId>/', async () => {
    let error: unknown
    try {
      await runOnBuild({
        pluginId: 'path-escape',
        scriptSource: readPluginScript('path-escape', 'server/build.js'),
        permissions: {},
        settings: {},
        log: () => {},
        timeoutBudgetMs: 60_000,
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'path-escape')
  })

  it('rejects when plugin script throws', async () => {
    let error: unknown
    try {
      await runOnBuild({
        pluginId: 'throws',
        scriptSource: readPluginScript('throws', 'server/build.js'),
        permissions: {},
        settings: {},
        log: () => {},
        timeoutBudgetMs: 60_000,
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'throws')
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toContain('boom-from-plugin')
  })

  it('compile-check accepts valid scripts and rejects invalid scripts', async () => {
    await compilePluginServerScripts({
      pluginId: 'compile-ok',
      scripts: [
        {
          path: 'server/api.js',
          source: readPluginScript('compile-ok', 'server/api.js'),
        },
      ],
    })

    let error: unknown
    try {
      await compilePluginServerScripts({
        pluginId: 'compile-bad',
        scripts: [
          {
            path: 'server/api.js',
            source: readPluginScript('compile-bad', 'server/api.js'),
          },
        ],
      })
    } catch (caught) {
      error = caught
    }

    expectPluginIdInError(error, 'compile-bad')
  })
})
