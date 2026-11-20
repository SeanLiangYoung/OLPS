import fs from 'node:fs/promises'
import path from 'node:path'
import { loadSiteModel, type SourceReader } from '@olps/render'
import { assertSafePathChain } from './path-guard.js'
import type { LoadedSiteWorkspace } from './types.js'

export function createFsSourceReader(workspacePath: string): SourceReader {
  const root = path.resolve(workspacePath)
  return {
    async readText(relativePath: string): Promise<string> {
      const abs = await assertSafePathChain(root, relativePath)
      return fs.readFile(abs, 'utf8')
    },
    async list(relativePath: string): Promise<string[]> {
      const abs =
        relativePath === '' || relativePath === '.'
          ? root
          : await assertSafePathChain(root, relativePath)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      return entries
        .map((entry) => entry.name)
        .filter((name) => name !== '.gitkeep')
        .sort()
    },
  }
}

export async function loadWorkspace(workspacePath: string): Promise<LoadedSiteWorkspace> {
  const reader = createFsSourceReader(workspacePath)
  const model = await loadSiteModel(reader)
  return {
    workspacePath: path.resolve(workspacePath),
    reader,
    model,
    domainPublishConfig: model.publishConfig,
  }
}
