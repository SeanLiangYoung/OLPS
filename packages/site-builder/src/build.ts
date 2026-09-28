import { planAssetCopies } from './assets.js'
import { loadWorkspace } from './load.js'
import { computeBuildPlan } from './plan.js'
import { writePublicOutputs } from './write-public.js'

export async function buildSite(workspacePath: string): Promise<void> {
  const loaded = await loadWorkspace(workspacePath)
  const htmlFiles = computeBuildPlan(loaded)
  const assetFiles = await planAssetCopies(workspacePath)
  await writePublicOutputs(workspacePath, htmlFiles, assetFiles)
}
