import { createHash } from 'node:crypto'
import { slugifyProductKey } from './ingest-text-segments.js'

export function wikiPathForImportedSource(sourcePath: string): string {
  const slug = createHash('sha256').update(`imported\0${sourcePath}`).digest('hex').slice(0, 32)
  return `wiki/sources/files/${slug}.md`
}

/** 同一源文件下按产品拆分的 wiki 页 */
export function wikiPathForImportedProduct(sourcePath: string, productKey: string): string {
  const sourceHash = createHash('sha256').update(`imported\0${sourcePath}`).digest('hex').slice(0, 24)
  const productSlug = slugifyProductKey(productKey)
  return `wiki/sources/products/${sourceHash}/${productSlug}.md`
}

export function ingestAnalysisRelativePath(importId: string, sourcePath: string): string {
  const slug = createHash('sha256').update(`${importId}\0${sourcePath}`).digest('hex').slice(0, 32)
  return `.olps-knowledge/imports/${importId}/ingest-analysis/${slug}.json`
}

export function ingestProgressRelativePath(importId: string): string {
  return `.olps-knowledge/imports/${importId}/ingest-progress.json`
}