import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_FILE, resolveInsideWorkspace } from './paths.js'

function packageRootFromModule(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..')
}

export async function installSiteBuilder(workspacePath: string): Promise<void> {
  const bundlePath = path.join(packageRootFromModule(import.meta.url), 'dist', 'site-build.mjs')
  const bundle = await fs.readFile(bundlePath)

  const toolsDir = resolveInsideWorkspace(workspacePath, 'tools')
  await fs.mkdir(toolsDir, { recursive: true })
  const destCli = path.join(toolsDir, 'site-build.mjs')
  await fs.writeFile(destCli, bundle)

  const manifestPath = resolveInsideWorkspace(workspacePath, MANIFEST_FILE)
  const raw = await fs.readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as Record<string, unknown>
  manifest.buildCommand = ['node', 'tools/site-build.mjs']
  manifest.verifyCommand = ['node', 'tools/site-build.mjs', '--verify']
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
