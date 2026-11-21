import fs from 'node:fs/promises'
import path from 'node:path'
import {
  runOnBuild,
  runTransformHtml,
  createPluginFetch,
  type PluginOnBuildFile,
  type PluginPermissions,
} from '@olps/plugin-runtime'
import {resolvePluginSettings,type PluginSettingDefinition,type SiteModel} from '@olps/render'
import type {PluginConfig} from '@olps/domain'
import { SITE_PATHS } from './paths.js'
import { assertSafePathChain } from './path-guard.js'
import type { BuildOptions } from './types.js'

type PluginManifest = {
  id: string
  settings: PluginSettingDefinition[]
  server?: {
    build?: string
  }
  permissions?: PluginPermissions
}

export type PluginBuildArtifacts = {
  files: PluginOnBuildFile[]
}

function enabledPlugins(model: SiteModel): Array<[string, PluginConfig]> {
  return Object.entries(model.plugins.plugins)
    .filter(([, config]) => config.enabled)
    .map(([id, config]) => [id, config])
}

function buildPermissions(pluginId:string,config:PluginConfig,manifest:PluginManifest):PluginPermissions{
  if(!config.permissionsAcceptedAt||!config.permissionsAcceptedBy)throw new Error(`插件服务器权限尚未确认：${pluginId}`)
  return manifest.permissions?.fetch?{fetch:manifest.permissions.fetch}:{}
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

function privateText(text:string,secrets:Record<string,string>):string{
  for(const secret of Object.values(secrets))if(secret)text=text.replaceAll(secret,'[已隐藏]')
  return text
}
function privateLog(secrets:Record<string,string>){
  const clean=(value:unknown):unknown=>typeof value==='string'?privateText(value,secrets):Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[privateText(key,secrets),clean(item)])):value
  return(level:string,message:string,meta?:Record<string,unknown>)=>defaultLog(privateText(level,secrets),privateText(message,secrets),meta?clean(meta) as Record<string,unknown>:undefined)
}
async function protectedHook<T>(secrets:Record<string,string>,run:()=>Promise<T>):Promise<T>{
  try{return await run()}catch(error){
    const message=error instanceof Error?error.message:String(error),safe=privateText(message,secrets)
    if(safe===message)throw error
    const sanitized=new Error(safe);if(error instanceof Error)sanitized.name=error.name;throw sanitized
  }
}

export async function runPluginOnBuildHooks(
  workspacePath: string,
  model: SiteModel,
  options:BuildOptions={},
): Promise<PluginBuildArtifacts> {
  const files: PluginOnBuildFile[] = []
  let remainingMs = 60_000

  for (const [pluginId, config] of enabledPlugins(model)) {
    const manifest = await readPluginManifest(workspacePath, pluginId)
    const buildRelative = manifest.server?.build
    if (!buildRelative) {
      continue
    }
    const permissions=buildPermissions(pluginId,config,manifest)
    const scriptSource = await readBuildScript(workspacePath, pluginId, buildRelative)
    if (!scriptSource) {
      throw new Error(`插件缺少 build 脚本：${pluginId} ${buildRelative}`)
    }
    if (!scriptSource.includes('onBuild')) {
      continue
    }
    const secrets=options.pluginSecrets?.[pluginId]??{}
    const result = await protectedHook(secrets,()=>runOnBuild({
      pluginId,
      scriptSource,
      permissions,
      fetchImpl:createPluginFetch({deadlineAt:Date.now()+remainingMs}),
      settings:{...resolvePluginSettings(manifest.settings,config.settings),...secrets},
      site: {
        settings: model.settings,
        appearance: model.appearance,
      },
      log: privateLog(secrets),
      timeoutBudgetMs: remainingMs,
    }))
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
  options:BuildOptions={},
): Promise<string> {
  let current = html
  let remainingMs = 60_000

  for (const [pluginId, config] of enabledPlugins(model)) {
    const manifest = await readPluginManifest(workspacePath, pluginId)
    const buildRelative = manifest.server?.build
    if (!buildRelative) {
      continue
    }
    const permissions=buildPermissions(pluginId,config,manifest)
    const scriptSource = await readBuildScript(workspacePath, pluginId, buildRelative)
    if (!scriptSource) {
      throw new Error(`插件缺少 build 脚本：${pluginId} ${buildRelative}`)
    }
    if (!scriptSource.includes('transformHtml')) {
      continue
    }
    const secrets=options.pluginSecrets?.[pluginId]??{}
    const result = await protectedHook(secrets,()=>runTransformHtml({
      pluginId,
      scriptSource,
      permissions,
      fetchImpl:createPluginFetch({deadlineAt:Date.now()+remainingMs}),
      settings:{...resolvePluginSettings(manifest.settings,config.settings),...secrets},
      site: {
        settings: model.settings,
        appearance: model.appearance,
      },
      log: privateLog(secrets),
      html: current,
      pageInfo,
      timeoutBudgetMs: remainingMs,
    }))
    remainingMs = result.remainingMs
    current = result.html
  }

  return current
}
