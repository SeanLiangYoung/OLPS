import { describe, expect, it } from 'vitest'
import {
  summarizeSelectedKnowledgeAssets,
  type KnowledgeDocumentWithAssets,
} from './summarizeSelectedKnowledgeAssets'

const documents: KnowledgeDocumentWithAssets[] = [
  {
    documentId: 'doc-empty',
    assets: [],
  },
  {
    documentId: 'doc-with-assets',
    assets: [
      { assetId: 'a1', role: 'product_image' },
      { assetId: 'a2', role: 'qr_code' },
      { assetId: 'a3', role: 'product_image' },
    ],
  },
  {
    documentId: 'doc-other',
    assets: [{ assetId: 'a2', role: 'qr_code' }],
  },
]

describe('summarizeSelectedKnowledgeAssets', () => {
  it('无资料选中时总数为 0', () => {
    const summary = summarizeSelectedKnowledgeAssets([], documents)
    expect(summary.total).toBe(0)
    expect(summary.byRole).toEqual({})
    expect(summary.summaryText).toContain('0')
  })

  it('选中有关联资产的资料时数量至少为 1，并给出角色分布', () => {
    const summary = summarizeSelectedKnowledgeAssets(['doc-with-assets'], documents)
    expect(summary.total).toBeGreaterThanOrEqual(1)
    expect(summary.total).toBe(3)
    expect(summary.byRole).toEqual({ product_image: 2, qr_code: 1 })
    expect(summary.summaryText).toContain('product_image')
    expect(summary.summaryText).toContain('qr_code')
  })

  it('多份资料去重同一素材', () => {
    const summary = summarizeSelectedKnowledgeAssets(['doc-with-assets', 'doc-other'], documents)
    expect(summary.total).toBe(3)
    expect(summary.byRole.qr_code).toBe(1)
  })
})
