import { describe, expect, it } from 'vitest'
import {
  INGEST_SEGMENT_THRESHOLD_CHARS,
  segmentExtractedText,
  slugifyProductKey,
} from './ingest-text-segments.js'
import { wikiPathForImportedProduct, wikiPathForImportedSource } from './source-wiki-path.js'

describe('ingest 文本分段', () => {
  it('短文本保持单段', () => {
    expect(segmentExtractedText('hello world')).toEqual(['hello world'])
  })

  it('长文本按阈值切开且不丢内容', () => {
    const filler = '产品参数与工况说明。'.repeat(80)
    const parts = Array.from(
      { length: 60 },
      (_, index) => `## 产品 ${index}\n\n${filler}\n`,
    )
    const text = parts.join('\n')
    expect(text.length).toBeGreaterThan(INGEST_SEGMENT_THRESHOLD_CHARS)
    const segments = segmentExtractedText(text, 800)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.join('')).toContain('产品 0')
    expect(segments.join('')).toContain('产品 59')
  })

  it('productKey 规范化', () => {
    expect(slugifyProductKey('MLC-1000 / Cummins')).toBe('mlc-1000-cummins')
  })

  it('产品 wiki 路径落在 products 目录且与源索引分离', () => {
    const sourcePath = 'raw/sources/catalog/manual.pdf'
    const indexPath = wikiPathForImportedSource(sourcePath)
    const productPath = wikiPathForImportedProduct(sourcePath, 'MLC-1000')
    expect(indexPath.startsWith('wiki/sources/files/')).toBe(true)
    expect(productPath.startsWith('wiki/sources/products/')).toBe(true)
    expect(productPath).toContain('/mlc-1000.md')
  })
})
