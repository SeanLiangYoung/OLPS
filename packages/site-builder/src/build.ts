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
): Promise<OutputFile[]> {
  await runBuildChecks(loaded)

  const onBuild = await runPluginOnBuildHooks(workspacePath, loaded.model)
  const imageResult = await processImages(workspacePath, loaded.model.media)
  const bundles = await bundleThemeAndPluginAssets(workspacePath, loaded.model)
  const staticAssets = await planAssetCopies(workspacePath, {
    themeId: loaded.model.appearance.themeId,
    enabledPluginIds: enabledPluginIds(loaded.model.plugins.plugins),
  })

  const routes = collectPublicHtmlRoutes(loaded.model)
  const htmlFiles: OutputFile[] = []

  for (const route of routes) {
    let html = await renderTarget(loaded.model, route.target, route.locale, {
      mode: 'publish',
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

  return [
    ...htmlFiles,
    ...imageResult.outputs,
    ...bundles.files,
    ...staticAssets,
    ...onBuild.files.map((file) => ({
      relativePath: file.path,
      content: file.content,
    })),
  ]
}

export async function buildSite(workspacePath: string): Promise<void> {
  const loaded = await loadWorkspace(workspacePath)
  const allFiles = await collectBuildOutputs(workspacePath, loaded)
  await writePublicOutputs(workspacePath, allFiles)
}

export async function planPublicOutputs(workspacePath: string): Promise<OutputFile[]> {
  const loaded = await loadWorkspace(workspacePath)
  return collectBuildOutputs(workspacePath, loaded)
}
