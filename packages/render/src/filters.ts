import type { Liquid } from 'liquidjs'
import { generate,lexer,parse } from 'css-tree'

export type FilterMediaInfo = {
  path: string
  width: number | null
  height: number | null
}

export type FilterRuntime = {
  locale: string
  themeId: string
  assetHashes: Record<string, string>
  mediaById: Record<string, FilterMediaInfo>
  strings: Record<string, string>
  resolveLink: (value: unknown) => string
  imageWidths: number[]
  roleUrls: Record<string, string>
}

export type CreateFilterRuntimeInput = {
  locale: string
  themeId: string
  assetHashes?: Record<string, string>
  mediaById?: Record<string, FilterMediaInfo>
  strings?: Record<string, string>
  resolveLink: (value: unknown) => string
  imageWidths?: number[]
  roleUrls?: Record<string, string>
}

const DEFAULT_IMAGE_WIDTHS = [480, 960, 1440, 1920]

export function createFilterRuntime(input: CreateFilterRuntimeInput): FilterRuntime {
  return {
    locale: input.locale,
    themeId: input.themeId,
    assetHashes: input.assetHashes ?? {},
    mediaById: input.mediaById ?? {},
    strings: input.strings ?? {},
    resolveLink: input.resolveLink,
    imageWidths: input.imageWidths ?? DEFAULT_IMAGE_WIDTHS,
    roleUrls: input.roleUrls ?? {},
  }
}

function asMediaId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'mediaId' in value
    && typeof (value as { mediaId: unknown }).mediaId === 'string'
  ) {
    return (value as { mediaId: string }).mediaId
  }
  throw new Error(`media_url 需要 mediaId 或 MediaRef，收到：${JSON.stringify(value)}`)
}

function publicMediaUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function imageVariantUrl(path: string, width: number): string {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const file = slash >= 0 ? path.slice(slash + 1) : path
  const dot = file.lastIndexOf('.')
  const stem = dot >= 0 ? file.slice(0, dot) : file
  const ext = dot >= 0 ? file.slice(dot) : ''
  return publicMediaUrl(`${dir}${stem}-${width}w${ext}`)
}

export function registerFilters(engine: Liquid, runtime: FilterRuntime): void {
  engine.registerFilter('css_value',(value:unknown,property:string)=>{
    if(typeof value!=='string')throw new Error('CSS属性值必须是文字')
    const ast=parse(value,{context:'value'})
    const result=lexer.matchProperty(property,ast)
    if(result.error)throw result.error
    return generate(ast).replaceAll('<','\\3c ')
  })
  engine.registerFilter('role_url', (role: string) => {
    const url = runtime.roleUrls[role]
    if (!url) throw new Error(`缺少页面职责地址：${role}`)
    return url
  })
  engine.registerFilter('asset_url', (fileName: unknown) => {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new Error(`asset_url 需要非空文件名，收到：${JSON.stringify(fileName)}`)
    }
    const hashed = runtime.assetHashes[fileName] ?? fileName
    return `/assets/theme/${runtime.themeId}/${hashed}`
  })

  engine.registerFilter('media_url', (value: unknown) => {
    const mediaId = asMediaId(value)
    const media = runtime.mediaById[mediaId]
    if (!media) {
      throw new Error(`media_url 找不到媒体：${mediaId}`)
    }
    return publicMediaUrl(media.path)
  })

  engine.registerFilter('image_srcset', (value: unknown) => {
    const mediaId = asMediaId(value)
    const media = runtime.mediaById[mediaId]
    if (!media) {
      throw new Error(`image_srcset 找不到媒体：${mediaId}`)
    }
    if (media.width === null) {
      throw new Error(`image_srcset 要求图片宽度，媒体：${mediaId}`)
    }
    if (!/\.(png|jpe?g|webp)$/i.test(media.path)) {
      return `${publicMediaUrl(media.path)} ${media.width}w`
    }
    const parts: string[] = []
    for (const width of runtime.imageWidths) {
      if (width > media.width) {
        continue
      }
      parts.push(`${imageVariantUrl(media.path, width)} ${width}w`)
    }
    parts.push(`${publicMediaUrl(media.path)} ${media.width}w`)
    return parts.join(', ')
  })

  engine.registerFilter('link', (value: unknown) => runtime.resolveLink(value))

  engine.registerFilter('t', (key: unknown) => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`t 需要非空键名，收到：${JSON.stringify(key)}`)
    }
    const text = runtime.strings[key]
    if (text === undefined) {
      throw new Error(`缺少翻译键：${key}（locale=${runtime.locale}）`)
    }
    return text
  })

  engine.registerFilter('format_date', (value: unknown, options?: unknown) => {
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) {
      throw new Error(`format_date 无法解析日期：${JSON.stringify(value)}`)
    }
    const formatOptions =
      typeof options === 'object' && options !== null
        ? (options as Intl.DateTimeFormatOptions)
        : ({ dateStyle: 'medium' } as Intl.DateTimeFormatOptions)
    return new Intl.DateTimeFormat(runtime.locale, formatOptions).format(date)
  })

  engine.registerFilter('format_number', (value: unknown, options?: unknown) => {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number)) {
      throw new Error(`format_number 无法解析数字：${JSON.stringify(value)}`)
    }
    const formatOptions =
      typeof options === 'object' && options !== null
        ? (options as Intl.NumberFormatOptions)
        : undefined
    return new Intl.NumberFormat(runtime.locale, formatOptions).format(number)
  })
}
