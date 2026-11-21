import ivm from 'isolated-vm'

import { PluginRuntimeError } from './errors.js'
import type {
  PluginFetchInit,
  PluginPermissions,
  PluginRuntimeBindings,
} from './types.js'

const CTX_FACTORY_SOURCE = `
globalThis.__olpsBuildCtx = function(settings, permissions, site) {
  const ctx = { settings: settings };
  if (site !== undefined && site !== null) {
    ctx.site = site;
  }

  ctx.log = function(level, message, meta) {
    globalThis.__olps_log(
      String(level),
      String(message),
      meta === undefined ? null : JSON.stringify(meta)
    );
  };

  if (permissions && permissions.store === true) {
    ctx.store = {
      get: function(key) {
        const raw = globalThis.__olps_store_get.applySyncPromise(undefined, [String(key)]);
        return raw === null ? null : JSON.parse(raw);
      },
      set: function(key, value) {
        return globalThis.__olps_store_set.applySyncPromise(
          undefined,
          [String(key), JSON.stringify(value)]
        );
      },
      delete: function(key) {
        return globalThis.__olps_store_delete.applySyncPromise(undefined, [String(key)]);
      }
    };
  } else {
    Object.defineProperty(ctx, 'store', {
      configurable: true,
      get: function() {
        throw new Error('permission "store" is not declared');
      }
    });
  }

  if (permissions && permissions.inquiries === true) {
    ctx.inquiries = {
      create: function(payload) {
        const raw = globalThis.__olps_inquiries_create.applySyncPromise(
          undefined,
          [JSON.stringify(payload)]
        );
        return raw === null ? null : JSON.parse(raw);
      }
    };
  } else {
    Object.defineProperty(ctx, 'inquiries', {
      configurable: true,
      get: function() {
        throw new Error('permission "inquiries" is not declared');
      }
    });
  }

  if (permissions && Array.isArray(permissions.fetch)) {
    ctx.fetch = function(url, init) {
      const raw = globalThis.__olps_fetch.applySyncPromise(
        undefined,
        [String(url), init === undefined ? null : JSON.stringify(init)]
      );
      return JSON.parse(raw);
    };
  } else {
    Object.defineProperty(ctx, 'fetch', {
      configurable: true,
      get: function() {
        throw new Error('permission "fetch" is not declared');
      }
    });
  }

  return ctx;
};
`

function normalizeAllowedHosts(fetchHosts: string[] | undefined): Set<string> {
  const hosts = new Set<string>()
  if (!fetchHosts) {
    return hosts
  }
  for (const host of fetchHosts) {
    hosts.add(String(host).toLowerCase())
  }
  return hosts
}

function assertFetchUrlAllowed(pluginId: string, url: string, allowedHosts: Set<string>): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new PluginRuntimeError(pluginId, `invalid fetch URL: ${url}`, error)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginRuntimeError(pluginId, `fetch protocol not allowed: ${parsed.protocol}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (!allowedHosts.has(host)) {
    throw new PluginRuntimeError(pluginId, `fetch host not allowed: ${host}`)
  }
}

export type InstallPluginContextOptions = {
  pluginId: string
  isolate: ivm.Isolate
  context: ivm.Context
  jail: ivm.Reference<Record<string, unknown>>
  permissions: PluginPermissions
  bindings: PluginRuntimeBindings
}

export async function installPluginContext(options: InstallPluginContextOptions): Promise<void> {
  const { pluginId, isolate, context, jail, permissions, bindings } = options
  const allowedHosts = normalizeAllowedHosts(permissions.fetch)

  if (permissions.store === true && !bindings.store) {
    throw new PluginRuntimeError(pluginId, 'store binding is required when store permission is declared')
  }
  if (permissions.inquiries === true && !bindings.inquiries) {
    throw new PluginRuntimeError(
      pluginId,
      'inquiries binding is required when inquiries permission is declared',
    )
  }
  if (Array.isArray(permissions.fetch) && !bindings.fetchImpl) {
    throw new PluginRuntimeError(
      pluginId,
      'fetchImpl binding is required when fetch permission is declared',
    )
  }

  await jail.set(
    '__olps_log',
    new ivm.Callback((level: string, message: string, metaJson: string | null) => {
      if (metaJson === null || metaJson === undefined) {
        bindings.log(level, message)
        return
      }
      bindings.log(level, message, JSON.parse(metaJson) as Record<string, unknown>)
    }),
  )

  await jail.set(
    '__olps_store_get',
    new ivm.Reference(async (key: string) => {
      if (permissions.store !== true) throw new PluginRuntimeError(pluginId, 'permission "store" is not declared')
      const value = await bindings.store!.get(key)
      if (value === null || value === undefined) {
        return null
      }
      return JSON.stringify(value)
    }),
  )

  await jail.set(
    '__olps_store_set',
    new ivm.Reference(async (key: string, valueJson: string) => {
      if (permissions.store !== true) throw new PluginRuntimeError(pluginId, 'permission "store" is not declared')
      await bindings.store!.set(key, JSON.parse(valueJson))
      return null
    }),
  )

  await jail.set(
    '__olps_store_delete',
    new ivm.Reference(async (key: string) => {
      if (permissions.store !== true) throw new PluginRuntimeError(pluginId, 'permission "store" is not declared')
      await bindings.store!.delete(key)
      return null
    }),
  )

  await jail.set(
    '__olps_inquiries_create',
    new ivm.Reference(async (payloadJson: string) => {
      if (permissions.inquiries !== true) throw new PluginRuntimeError(pluginId, 'permission "inquiries" is not declared')
      const payload = JSON.parse(payloadJson) as Record<string, unknown>
      const created = await bindings.inquiries!.create(payload)
      if (created === null || created === undefined) {
        return null
      }
      return JSON.stringify(created)
    }),
  )

  await jail.set(
    '__olps_fetch',
    new ivm.Reference(async (url: string, initJson: string | null) => {
      if (!Array.isArray(permissions.fetch)) throw new PluginRuntimeError(pluginId, 'permission "fetch" is not declared')
      assertFetchUrlAllowed(pluginId, url, allowedHosts)
      const init =
        initJson === null || initJson === undefined
          ? undefined
          : (JSON.parse(initJson) as PluginFetchInit)
      const result = await bindings.fetchImpl!(url, init)
      return JSON.stringify({
        status: result.status,
        headers: result.headers,
        body: result.body,
      })
    }),
  )

  const factoryScript = await isolate.compileScript(CTX_FACTORY_SOURCE, {
    filename: 'olps-plugin-context.js',
  })
  await factoryScript.run(context)

  await jail.set('__olps_settings', new ivm.ExternalCopy(bindings.settings).copyInto())
  await jail.set('__olps_permissions', new ivm.ExternalCopy(permissions).copyInto())
  await jail.set(
    '__olps_site',
    bindings.site === undefined
      ? new ivm.ExternalCopy(null).copyInto()
      : new ivm.ExternalCopy(bindings.site).copyInto(),
  )

  await context.eval(
    'globalThis.__olpsCtx = globalThis.__olpsBuildCtx(globalThis.__olps_settings, globalThis.__olps_permissions, globalThis.__olps_site);',
  )
}
