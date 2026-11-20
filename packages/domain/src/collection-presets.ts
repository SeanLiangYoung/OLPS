import type { FieldDefinition, FieldType } from './content.js'

export type CollectionPresetId = 'news' | 'products' | 'solutions'

export type CollectionPresetLevel = {
  name: string
}

export type CollectionPresetField = {
  key: string
  type: FieldType
  label: string
  translatable: boolean
  required: boolean
  options?: FieldDefinition['options']
  columns?: FieldDefinition['columns']
  referencePreset?: CollectionPresetId
}

export type CollectionPresetDefinition = {
  presetId: CollectionPresetId
  name: string
  labels: {
    en: string
    'zh-CN': string
  }
  prefix: string
  levels: CollectionPresetLevel[]
  fields: CollectionPresetField[]
  structuredData: 'Product' | 'NewsArticle' | 'Service' | null
  feed: boolean
}

export const collectionPresets: Record<CollectionPresetId, CollectionPresetDefinition> = {
  news: {
    presetId: 'news',
    name: '新闻',
    labels: {
      en: 'News',
      'zh-CN': '新闻',
    },
    prefix: 'news',
    levels: [],
    fields: [
      {
        key: 'publishedDate',
        type: 'date',
        label: '发布日期',
        translatable: false,
        required: true,
      },
      {
        key: 'author',
        type: 'text',
        label: '作者',
        translatable: true,
        required: false,
      },
      {
        key: 'cover',
        type: 'media',
        label: '封面',
        translatable: false,
        required: false,
      },
    ],
    structuredData: 'NewsArticle',
    feed: true,
  },
  products: {
    presetId: 'products',
    name: '产品',
    labels: {
      en: 'Products',
      'zh-CN': '产品',
    },
    prefix: 'products',
    levels: [
      { name: '产品系列' },
      { name: '产品分类' },
    ],
    fields: [
      {
        key: 'model',
        type: 'text',
        label: '型号',
        translatable: false,
        required: true,
      },
      {
        key: 'specifications',
        type: 'table',
        label: '规格参数',
        translatable: true,
        required: false,
        columns: [
          { key: 'name', label: '参数名', type: 'text' },
          { key: 'value', label: '参数值', type: 'text' },
        ],
      },
      {
        key: 'gallery',
        type: 'mediaList',
        label: '图集',
        translatable: false,
        required: false,
      },
    ],
    structuredData: 'Product',
    feed: false,
  },
  solutions: {
    presetId: 'solutions',
    name: '解决方案',
    labels: {
      en: 'Solutions',
      'zh-CN': '解决方案',
    },
    prefix: 'solutions',
    levels: [],
    fields: [
      {
        key: 'industries',
        type: 'text',
        label: '适用行业',
        translatable: true,
        required: false,
      },
      {
        key: 'relatedProducts',
        type: 'reference',
        label: '相关产品',
        translatable: false,
        required: false,
        referencePreset: 'products',
      },
    ],
    structuredData: 'Service',
    feed: false,
  },
}
