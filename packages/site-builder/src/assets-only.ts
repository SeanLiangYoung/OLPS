import fs from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { createArtifactManifest } from './artifact-manifest.js'
import { assertSafePathChain } from './path-guard.js'

export type AssetsOnlyDecision = { kind: 'assets_only' | 'full'; changedMediaPaths: string[] }

export async function classifyAssetsOnly(previousRoot: string, currentRoot: string): Promise<AssetsOnlyDecision> {
  const include = (file: string, directory: boolean) => /^(source|assets|themes|plugins|tools)\//.test(file) || file === 'olps.manifest.json' || (directory && ['source', 'assets', 'themes', 'plugins', 'tools'].includes(file))
  const previous = await createArtifactManifest(previousRoot, include)
  const current = await createArtifactManifest(currentRoot, include)
  const full: AssetsOnlyDecision = { kind: 'full', changedMediaPaths: [] }
  const relevant = (file: string) => /^(source|assets|themes|plugins|tools)\//.test(file) || file === 'olps.manifest.json'
  const files = [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(relevant)
  const allowedMedia = new Set<string>()
  for (const file of files.filter(file => /^source\/media\/[^/]+\.json$/.test(file))) {
    if (!previous[file] || !current[file]) return full
    const read = async (root: string) => JSON.parse(await fs.readFile(await assertSafePathChain(root, file), 'utf8')) as Record<string, unknown>
    const before = await read(previousRoot)
    const after = await read(currentRoot)
    if (typeof before.path !== 'string' || before.path !== after.path || !before.path.startsWith('assets/uploads/')) return full
    allowedMedia.add(before.path)
    for (const key of ['size', 'uploadedAt', 'uploadedBy']) {
      delete before[key]
      delete after[key]
    }
    if (!isDeepStrictEqual(before, after)) return full
  }
  const changed: string[] = []
  for (const file of files) {
    if (previous[file]?.sha256 === current[file]?.sha256) continue
    if (/^source\/media\/[^/]+\.json$/.test(file)) continue
    if (!previous[file] || !current[file] || !allowedMedia.has(file)) return full
    changed.push(file)
  }
  return changed.length ? { kind: 'assets_only', changedMediaPaths: changed.sort() } : full
}
