import { createHash } from 'node:crypto'

export function wikiPathForImportedSource(sourcePath: string): string {
  const slug = createHash('sha256').update(`imported\0${sourcePath}`).digest('hex').slice(0, 32)
  return `wiki/sources/files/${slug}.md`
}

export function ingestAnalysisRelativePath(importId: string, sourcePath: string): string {
  const slug = createHash('sha256').update(`${importId}\0${sourcePath}`).digest('hex').slice(0, 32)
  return `.olps-knowledge/imports/${importId}/ingest-analysis/${slug}.json`
}

export function ingestProgressRelativePath(importId: string): string {
  return `.olps-knowledge/imports/${importId}/ingest-progress.json`
}