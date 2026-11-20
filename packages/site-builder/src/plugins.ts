import fs from 'node:fs/promises'
import path from 'node:path'
import {
  runOnBuild,
  runTransformHtml,
  type PluginOnBuildFile,
  type PluginPermissions,
} from '@olps/plugin-runtime'
import type { SiteModel } from '@olps/render'
import { SITE_PATHS } from './paths.js'
import { assertSafePathChain } from './path-guard.js'

type PluginManifest = {
  id: string
  server?: {
    build?: string
  }
  permissions?: PluginPermissions
}

export type PluginBuildArtifacts = {
  files: PluginOnBuildFile[]
}

function enabledPlugins(model: SiteModel): Array<[string, Record<string, unknown>]> {
  return Object.entries(model.plugins.plugins)
    .filter(([, config]) => config.enabled)
    .map(([id, config]) => [id, config.settings])
}

async function readPluginManifest(
  workspacePath: string,
  pluginId: string,
): Promise<PluginManifest> {
  const abs = await assertSafePathChain(
    workspacePath,
    path.posix.join(SITE_PATHS.pluginsDir, pluginId, 'plugin.json'),
  )
  return JSON.parse(await fs.readFile(abs, 'utf8')) as PluginManifest
}

async function readBuildScript(
  workspacePath: string,
  pluginId: string,
  relativeBuild: string,
): Promise<string | null> {
  try {
    const abs = await assertSafePathChain(
      workspacePath,
      path.posix.join(SITE_PATHS.pluginsDir, pluginId, relativeBuild),
    )
    return await fs.readFile(abs, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function defaultLog(level: string, message: string, meta?: Record<string, unknown>): void {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : ''
  console.error(`[plugin:${level}] ${message}${suffix}`)
}

export async function runPluginOnBuildHooks(
  workspacePath: string,
  model: SiteModel,
): Promise<PluginBuildArtifacts> {
  const files: PluginOnBuildFile[] = []
  let remainingMs = 60_000

  for (const [pluginId, settings] of enabledPlugins(model)) {
    const manifest = await readPluginManifest(workspacePath, pluginId)
    const buildRelative = manifest.server?.build
    if (!buildRelative) {
      continue
    }
    const scriptSource = await readBuildScript(workspacePath, pluginId, buildRelative)
    if (!scriptSource) {
      throw new Error(`插件缺少 build 脚本：${pluginId} ${buildRelative}`)
    }
    if (!scriptSource.includes('onBuild')) {
      continue
    }
    const result = await runOnBuild({
      pluginId,
      scriptSource,
      permissions: manifest.permissions ?? {},
      settings,
      site: {
        settings: model.settings,
        appearance: model.appearance,
      },
      log: defaultLog,
      timeoutBudgetMs: remainingMs,
    })
    remainingMs = result.remainingMs
    files.push(...result.files)
  }

  return { files }
}

export async function applyPluginTransformHtml(
  workspacePath: string,
  model: SiteModel,
  html: string,
  pageInfo: Record<string, unknown>,
): Promise<string> {
  let current = html
  let remainingMs = 60_000

  for (const [pluginId, settings] of enabledPlugins(model)) {
    const manifest = await readPluginManifest(workspacePath, pluginId)
    const buildRelative = manifest.server?.build
    if (!buildRelative) {
      continue
    }
    const scriptSource = await readBuildScript(workspacePath, pluginId, buildRelative)
    if (!scriptSource) {
      throw new Error(`插件缺少 build 脚本：${pluginId} ${buildRelative}`)
    }
    if (!scriptSource.includes('transformHtml')) {
      continue
    }
    const result = await runTransformHtml({
      pluginId,
      scriptSource,
      permissions: manifest.permissions ?? {},
      settings,
      site: {
        settings: model.settings,
        appearance: model.appearance,
      },
      log: defaultLog,
      html: current,
      pageInfo,
      timeoutBudgetMs: remainingMs,
    })
    remainingMs = result.remainingMs
    current = result.html
  }

  return current
}
