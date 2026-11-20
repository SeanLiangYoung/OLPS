import fs from 'node:fs/promises'
import path from 'node:path'
import type { SourceReader } from '../source-reader.js'

export function createNodeSourceReader(rootDirectory: string): SourceReader {
  return {
    async readText(relativePath: string): Promise<string> {
      const fullPath = path.join(rootDirectory, ...relativePath.split('/'))
      return fs.readFile(fullPath, 'utf8')
    },
    async list(relativePath: string): Promise<string[]> {
      const fullPath = relativePath === '' || relativePath === '.'
        ? rootDirectory
        : path.join(rootDirectory, ...relativePath.split('/'))
      const entries = await fs.readdir(fullPath, { withFileTypes: true })
      return entries
        .map((entry) => entry.name)
        .filter((name) => name !== '.gitkeep')
        .sort()
    },
  }
}
