import { describe, expect, it } from 'vitest'
import { collectionPresets } from './collection-presets.js'

describe('collectionPresets', () => {
  it('提供新闻、产品、解决方案三个预设', () => {
    expect(Object.keys(collectionPresets).sort()).toEqual(['news', 'products', 'solutions'])
  })

  it('新闻预设使用 NewsArticle 与 feed', () => {
    const news = collectionPresets.news
    expect(news.prefix).toBe('news')
    expect(news.levels).toEqual([])
    expect(news.structuredData).toBe('NewsArticle')
    expect(news.feed).toBe(true)
    expect(news.fields.map((field) => field.key)).toEqual([
      'publishedDate',
      'author',
      'cover',
    ])
    expect(news.fields.find((field) => field.key === 'publishedDate')?.type).toBe('date')
    expect(news.fields.find((field) => field.key === 'author')?.type).toBe('text')
    expect(news.fields.find((field) => field.key === 'cover')?.type).toBe('media')
  })

  it('产品预设含两层分组与 Product 字段', () => {
    const products = collectionPresets.products
    expect(products.prefix).toBe('products')
    expect(products.levels.map((level) => level.name)).toEqual(['产品系列', '产品分类'])
    expect(products.structuredData).toBe('Product')
    expect(products.feed).toBe(false)
    expect(products.fields.map((field) => field.key)).toEqual([
      'model',
      'specifications',
      'gallery',
    ])
    expect(products.fields.find((field) => field.key === 'model')?.type).toBe('text')
    expect(products.fields.find((field) => field.key === 'specifications')?.type).toBe('table')
    expect(products.fields.find((field) => field.key === 'gallery')?.type).toBe('mediaList')
  })

  it('解决方案预设引用产品并使用 Service', () => {
    const solutions = collectionPresets.solutions
    expect(solutions.prefix).toBe('solutions')
    expect(solutions.levels).toEqual([])
    expect(solutions.structuredData).toBe('Service')
    expect(solutions.feed).toBe(false)
    expect(solutions.fields.map((field) => field.key)).toEqual([
      'industries',
      'relatedProducts',
    ])
    expect(solutions.fields.find((field) => field.key === 'industries')?.type).toBe('text')
    const related = solutions.fields.find((field) => field.key === 'relatedProducts')
    expect(related?.type).toBe('reference')
    expect(related?.referencePreset).toBe('products')
  })
})
