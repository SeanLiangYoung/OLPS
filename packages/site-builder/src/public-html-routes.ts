import type { BlockNode } from '@olps/domain'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  buildListData,
  collectionIndexUrl,
  paginationUrl,
  type RenderTargetRef,
  type SiteModel,
} from '@olps/render'

export type PublicHtmlRoute = {
  url: string
  relativePath: string
  target: RenderTargetRef
  locale: string
  pageNumber: number
}

function urlToRelativeHtmlPath(url: string): string {
  if (!url.startsWith('/')) {
    throw new Error(`公开地址必须以 / 开头：${url}`)
  }
  if (url.endsWith('.html')) {
    return url.slice(1)
  }
  const trimmed = url.endsWith('/') ? url.slice(1, -1) : url.slice(1)
  if (trimmed === '') {
    return 'index.html'
  }
  return `${trimmed}/index.html`
}

function findCollectionListProps(blocks: BlockNode[]): Record<string, unknown> | null {
  for (const block of blocks) {
    if (block.type === 'core/collection-list') {
      return block.props
    }
    const nested = findCollectionListProps(block.children)
    if (nested) {
      return nested
    }
  }
  return null
}

function listPageSize(blocks: BlockNode[]): number {
  const props = findCollectionListProps(blocks)
  if (props && typeof props.pageSize === 'number' && props.pageSize > 0) {
    return props.pageSize
  }
  return 10
}

function listSort(
  blocks: BlockNode[],
): 'manual' | 'publishedAt' | 'title' {
  const props = findCollectionListProps(blocks)
  if (props?.sort === 'publishedAt' || props?.sort === 'title') {
    return props.sort
  }
  return 'manual'
}

export function collectPublicHtmlRoutes(model: SiteModel): PublicHtmlRoute[] {
  const routes: PublicHtmlRoute[] = []
  const locales = model.settings.locales.map((locale) => locale.code)

  for (const locale of locales) {
    for (const page of model.pages) {
      if (page.meta.status !== 'published') {
        continue
      }
      if (page.meta.role === 'not-found') {
        continue
      }
      if (!page.locales[locale]) {
        continue
      }
      const url = absoluteUrlForPage(page, locale)
      if (!url) {
        continue
      }
      routes.push({
        url,
        relativePath: urlToRelativeHtmlPath(url),
        target: { kind: 'page', pageId: page.meta.pageId },
        locale,
        pageNumber: 1,
      })
    }

    for (const collection of model.collections) {
      if (collection.definition.status !== 'published') {
        continue
      }
      const indexLocale = collection.indexLocales[locale]
      if (indexLocale) {
        const url = collectionIndexUrl(locale, collection.definition.prefix)
        const pageSize = listPageSize(indexLocale.blocks)
        const sort = listSort(indexLocale.blocks)
        const list = buildListData(model, {
          kind: 'collection',
          collectionId: collection.definition.collectionId,
          locale,
          mode: 'publish',
          pageNumber: 1,
          pageSize,
          sort,
        })
        for (let pageNumber = 1; pageNumber <= list.totalPages; pageNumber += 1) {
          const pageUrl = pageNumber === 1 ? url : paginationUrl(url, pageNumber)
          routes.push({
            url: pageUrl,
            relativePath: urlToRelativeHtmlPath(pageUrl),
            target: {
              kind: 'collection',
              collectionId: collection.definition.collectionId,
            },
            locale,
            pageNumber,
          })
        }
      }

      for (const group of collection.groups) {
        if (group.meta.status !== 'published') {
          continue
        }
        const localeFile = group.locales[locale]
        if (!localeFile) {
          continue
        }
        const url = absoluteUrlForGroup(collection, group, locale)
        if (!url) {
          continue
        }
        const pageSize = listPageSize(localeFile.blocks)
        const sort = listSort(localeFile.blocks)
        const list = buildListData(model, {
          kind: 'group',
          collectionId: collection.definition.collectionId,
          groupId: group.meta.groupId,
          locale,
          mode: 'publish',
          pageNumber: 1,
          pageSize,
          sort,
        })
        for (let pageNumber = 1; pageNumber <= list.totalPages; pageNumber += 1) {
          const pageUrl = pageNumber === 1 ? url : paginationUrl(url, pageNumber)
          routes.push({
            url: pageUrl,
            relativePath: urlToRelativeHtmlPath(pageUrl),
            target: {
              kind: 'group',
              collectionId: collection.definition.collectionId,
              groupId: group.meta.groupId,
            },
            locale,
            pageNumber,
          })
        }
      }

      for (const item of collection.items) {
        if (item.meta.status !== 'published') {
          continue
        }
        if (!item.locales[locale]) {
          continue
        }
        const url = absoluteUrlForItem(collection, item, locale)
        if (!url) {
          continue
        }
        routes.push({
          url,
          relativePath: urlToRelativeHtmlPath(url),
          target: {
            kind: 'item',
            collectionId: collection.definition.collectionId,
            itemId: item.meta.itemId,
          },
          locale,
          pageNumber: 1,
        })
      }
    }
  }

  const seen = new Set<string>()
  for (const route of routes) {
    if (seen.has(route.relativePath)) {
      throw new Error(`公开 HTML 路径重复：${route.relativePath}`)
    }
    seen.add(route.relativePath)
  }

  return routes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
