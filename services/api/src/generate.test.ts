import { describe, expect, it } from 'vitest'
import { generatePageContent } from './generate.js'
import { validateGuideGraph } from '@olps/domain'

describe('generatePageContent', () => {
  it('生成可校验的广告页', () => {
    const out = generatePageContent({
      kind: 'ads',
      title: 'Ads',
      slug: 'ads',
      brief: 'brief',
      locale: 'en',
      keywords: ['a', 'b'],
    })
    expect(out.body.ads).toBeTruthy()
    const result = validateGuideGraph(out.body.ads!, { screenCap: 20 })
    expect(result.ok).toBe(true)
  })
})
