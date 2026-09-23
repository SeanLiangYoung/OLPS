import { describe, expect, it } from 'vitest'
import { validateGuideGraph } from './validate-guide-graph.js'
import type { AdsPayload } from './index.js'

function sampleAds(): AdsPayload {
  return {
    keywordCluster: ['buy steel', 'rent steel'],
    screens: [
      {
        screenId: 'e1',
        role: 'entry',
        title: 'Buy',
        html: '<p>Buy</p>',
        entryFor: ['buy steel'],
      },
      {
        screenId: 'e2',
        role: 'entry',
        title: 'Rent',
        html: '<p>Rent</p>',
        entryFor: ['rent steel'],
      },
      {
        screenId: 'c1',
        role: 'content',
        title: 'Shared',
        html: '<p>Shared</p>',
      },
      {
        screenId: 'cta',
        role: 'cta',
        title: 'Inquiry',
        html: '<form data-olps-inquiry><button type="submit">Send</button></form>',
      },
    ],
    guide: {
      entryByKeyword: {
        'buy steel': 'e1',
        'rent steel': 'e2',
      },
      nodes: {
        e1: {
          options: [
            { id: 'o1', label: 'Learn more', action: 'navigate', targetScreenId: 'c1' },
            { id: 'o2', label: 'Inquiry now', action: 'go_cta' },
          ],
        },
        e2: {
          options: [
            { id: 'o3', label: 'Learn more', action: 'navigate', targetScreenId: 'c1' },
            { id: 'o4', label: 'Inquiry now', action: 'go_cta' },
          ],
        },
        c1: {
          options: [{ id: 'o5', label: 'Inquiry', action: 'go_cta' }],
        },
        cta: { options: [] },
      },
    },
  }
}

describe('validateGuideGraph', () => {
  it('接受合法共用屏图', () => {
    const result = validateGuideGraph(sampleAds(), { screenCap: 20 })
    expect(result.ok).toBe(true)
  })

  it('拒绝环', () => {
    const ads = sampleAds()
    ads.guide.nodes.c1!.options.push({
      id: 'bad',
      label: 'back',
      action: 'navigate',
      targetScreenId: 'e1',
    })
    const result = validateGuideGraph(ads, { screenCap: 20 })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'cycle')).toBe(true)
  })

  it('拒绝超过屏数上限', () => {
    const result = validateGuideGraph(sampleAds(), { screenCap: 2 })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'screen_cap_exceeded')).toBe(true)
  })
})
