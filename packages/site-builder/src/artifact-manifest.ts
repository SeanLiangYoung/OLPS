import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { assertSafePathChain } from './path-guard.js'

export type ArtifactManifest = Record<string, { sha256: string; size: number }>

export async function createArtifactManifest(root: string, include: (relativePath: string, isDirectory: boolean) => boolean = () => true): Promise<ArtifactManifest> {
  const result: ArtifactManifest = {}
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name)
      if (!include(relative, entry.isDirectory())) continue
      const absolute = await assertSafePathChain(root, relative)
      if (entry.isDirectory()) await walk(relative)
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute)
        result[relative] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
      }
    }
  }
  await walk('')
  return result
}

export function compareArtifactManifests(previous: ArtifactManifest, current: ArtifactManifest): { upload: string[]; remove: string[] } {
  return {
    upload: Object.keys(current).filter(file => previous[file]?.sha256 !== current[file]!.sha256).sort(),
    remove: Object.keys(previous).filter(file => !current[file]).sort(),
  }
}
