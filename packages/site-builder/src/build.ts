import { renderTarget } from '@olps/render'
import { planAssetCopies } from './assets.js'
import { runBuildChecks } from './build-checks.js'
import { bundleThemeAndPluginAssets, rewriteHashedAssetPaths } from './bundles.js'
import { processImages } from './images.js'
import { loadWorkspace } from './load.js'
import {
  applyPluginTransformHtml,
  runPluginOnBuildHooks,
} from './plugins.js'
import { collectPublicHtmlRoutes } from './public-html-routes.js'
import { writePublicOutputs } from './write-public.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { makeCssPortable, makeHtmlPortable } from './portable-html.js'
import { planHiddenFiles } from './hidden-files.js'
import { planRedirects } from './redirects.js'
import { planNotFound } from './not-found.js'
import { planServerConfig } from './server-config.js'
import { buildSearchIndex } from './search-index.js'
import { recordBuildVerification } from './verify.js'
import { installSiteBuilder } from './install.js'
import { assertSafePathChain } from './path-guard.js'
import { planSiteIcons } from './site-icons.js'
import type { LoadedSiteWorkspace, OutputFile } from './types.js'

function enabledPluginIds(
  plugins: Record<string, { enabled: boolean }>,
): string[] {
  return Object.entries(plugins)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id)
}

async function collectBuildOutputs(
  workspacePath: string,
  loaded: LoadedSiteWorkspace,
  mode: 'publish' | 'preview' = 'publish',
): Promise<OutputFile[]> {
  await runBuildChecks(loaded, mode)

  const onBuild = await runPluginOnBuildHooks(workspacePath, loaded.model)
  const imageResult = await processImages(workspacePath, loaded.model.media)
  const bundles = await bundleThemeAndPluginAssets(workspacePath, loaded.model)
  const staticAssets = await planAssetCopies(workspacePath, {
    themeId: loaded.model.appearance.themeId,
    enabledPluginIds: enabledPluginIds(loaded.model.plugins.plugins),
  })

  const routes = collectPublicHtmlRoutes(loaded.model, mode)
  const htmlFiles: OutputFile[] = []

  for (const route of routes) {
    let html = await renderTarget(loaded.model, route.target, route.locale, {
      mode,
      reader: loaded.reader,
      pageNumber: route.pageNumber,
      assetHashes: bundles.assetHashes,
    })
    html = rewriteHashedAssetPaths(html, bundles.publicPathRewrites)
    html = await applyPluginTransformHtml(workspacePath, loaded.model, html, {
      locale: route.locale,
      url: route.url,
      target: route.target,
      pageNumber: route.pageNumber,
    })
    htmlFiles.push({
      relativePath: route.relativePath,
      content: html,
    })
  }

  const pages = htmlFiles.map(file => ({ ...file, content: makeHtmlPortable(String(file.content), file.relativePath) }))
  const redirects = planRedirects(loaded.model, mode)
  const notFound = await planNotFound(loaded.model, loaded.reader, mode)
  const hidden = await planHiddenFiles(loaded.model, routes, pages, mode)
  const search = await buildSearchIndex(pages)
  const icons = await planSiteIcons(workspacePath, loaded.model)
  const outputs: OutputFile[] = [
    ...pages,
    ...redirects,
    ...notFound,
    ...hidden,
    ...search,
    ...icons,
    ...imageResult.outputs,
    ...bundles.files.filter(file => mode === 'publish' || !file.relativePath.endsWith('/olps-tracking.js')),
    ...staticAssets,
    ...onBuild.files.map((file) => ({
      relativePath: file.path,
      content: file.content,
    })),
  ]
  return outputs.map(file => file.relativePath.endsWith('.css') ? { ...file, content: makeCssPortable(String(file.content), file.relativePath) } : file)
}

export async function buildSite(workspacePath: string): Promise<void> {
  const loaded = await loadWorkspace(workspacePath)
  const allFiles = await collectBuildOutputs(workspacePath, loaded)
  await writePublicOutputs(workspacePath, allFiles)
  const configFiles = planServerConfig(loaded.model)
  for (const file of configFiles) {
    const destination = await assertSafePathChain(workspacePath, file.relativePath, { allowMissingSuffix: true })
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.content)
  }
  await installSiteBuilder(workspacePath)
  await recordBuildVerification(workspacePath)
}

export async function planPublicOutputs(workspacePath: string, mode: 'publish' | 'preview' = 'publish'): Promise<OutputFile[]> {
  const loaded = await loadWorkspace(workspacePath)
  return collectBuildOutputs(workspacePath, loaded, mode)
}
