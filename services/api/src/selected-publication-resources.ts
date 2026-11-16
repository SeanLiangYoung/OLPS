import path from 'node:path'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import * as cssTree from 'css-tree'
import { parseSrcset } from 'srcset'
import type { SyncWorkspace } from '@olps/sync'
import { listPublicRoutes } from '@olps/site-builder'
import type { StoredPageJson } from './page-sandbox.js'
import type { PublicationIssue } from './selected-publication.js'

type Reference = { url: string; kind: 'asset' | 'link' | 'page'; path: string }
function cssReferences(css: string, context: 'stylesheet' | 'declarationList', location: string): Reference[] {
  const references: Reference[] = []
  const tree = cssTree.parse(css, { context, onParseError(error) { throw error } })
  cssTree.walk(tree, (node) => {
    if (node.type === 'Url') references.push({ url: node.value, kind: 'asset', path: location })
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude) {
      cssTree.walk(node.prelude, (item) => { if (item.type === 'String') references.push({ url: item.value, kind: 'asset', path: location }) })
    }
  })
  return references
}
export function collectPageReferences(page: StoredPageJson): Reference[] {
  const references: Reference[] = []
  function inspect(html: string, location: string) {
    function visit(node: DefaultTreeAdapterMap['node']) {
      if ('attrs' in node) {
        const attrs = new Map(node.attrs.map((attr) => [attr.name, attr.value]))
        if (node.tagName === 'base') throw new Error('页面包含无法确认的 base 地址')
        for (const attr of ['src', 'poster', 'background', 'data']) {
          if (attrs.has(attr)) references.push({ url: attrs.get(attr)!, kind: 'asset', path: `${location}:${node.tagName}[${attr}]` })
        }
        if (attrs.has('data-olps-page-link')) references.push({ url: attrs.get('data-olps-page-link')!, kind: 'page', path: `${location}:${node.tagName}[data-olps-page-link]` })
        else if (attrs.has('href')) references.push({ url: attrs.get('href')!, kind: node.tagName === 'a' ? 'link' : 'asset', path: `${location}:${node.tagName}[href]` })
        for (const attr of ['srcset', 'imagesrcset']) if (attrs.has(attr)) for (const item of parseSrcset(attrs.get(attr)!, { strict: true })) references.push({ url: item.url, kind: 'asset', path: `${location}:${node.tagName}[${attr}]` })
        if (attrs.has('style')) references.push(...cssReferences(attrs.get('style')!, 'declarationList', `${location}:${node.tagName}[style]`))
        if (node.tagName === 'style') references.push(...cssReferences(node.childNodes.filter((child) => child.nodeName === '#text').map((child) => (child as DefaultTreeAdapterMap['textNode']).value).join(''), 'stylesheet', `${location}:style`))
        if (node.tagName === 'template') for (const child of (node as DefaultTreeAdapterMap['template']).content.childNodes) visit(child)
      }
      if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    }
    visit(parse(html))
  }
  inspect(page.body.html, 'body.html')
  for (const screen of page.body.ads?.screens ?? []) inspect(screen.html, `screens.${screen.screenId}`)
  if (page.seo.image) references.push({ url: page.seo.image, kind: 'asset', path: 'seo.image' })
  return references
}
function localUrl(value: string, parent = '/', publicUrl?: string) {
  if (!value.trim() || value.startsWith('#')) return null
  const normalized = value.startsWith('assets/') || value.startsWith('./assets/') ? `/${value.replace(/^\.\//, '')}` : value
  const url = new URL(normalized, `https://publication.invalid${parent}`)
  const site = publicUrl ? new URL(publicUrl) : null
  if (url.origin !== 'https://publication.invalid' && url.origin !== site?.origin) return null
  const prefix = site?.pathname.replace(/\/+$/, '')
  if (prefix && url.pathname.startsWith(`${prefix}/`)) return decodeURIComponent(url.pathname.slice(prefix.length))
  if (url.origin !== 'https://publication.invalid') return null
  return decodeURIComponent(url.pathname)
}
export async function preparePublicationResources(input: { source: SyncWorkspace; candidate: SyncWorkspace; pages: StoredPageJson[]; selectedPageIds: string[]; publicUrl?: string }): Promise<PublicationIssue[]> {
  const issues: PublicationIssue[] = []
  const needed = new Set<string>()
  const selectedNeeded = new Set<string>()
  const pageIds = new Set(input.pages.map((page) => page.pageId))
  const routes = new Set(listPublicRoutes(input.pages, {}).map((route) => `/${route.routeSlug.replace(/^\/+|\/+$/g, '')}/`))
  const visiting = new Set<string>()
  async function asset(url: string, pageId: string, location: string, selected: boolean, parent = '/') {
    const local = localUrl(url, parent, input.publicUrl)
    if (!local) return
    if (!local.startsWith('/assets/')) {
      issues.push({ code: 'LOCAL_RESOURCE_UNRESOLVED', message: `无法确认本地资源：${url}`, pageId, path: location })
      return
    }
    const relative = local.slice(1)
    needed.add(relative)
    if (selected) selectedNeeded.add(relative)
    const key = `${selected}:${relative}`
    if (visiting.has(key)) return
    visiting.add(key)
    const workspace = selected ? input.source : input.candidate
    let content: Buffer
    try { content = await workspace.readFile(relative) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      issues.push({ code: 'RESOURCE_MISSING', message: `本地资源不存在：${relative}`, pageId, path: location })
      return
    }
    if (selected) {
      const already = new Set(await input.candidate.listFiles('assets'))
      if (already.has(relative)) {
        const online = await input.candidate.readFile(relative)
        if (!online.equals(content)) {
          issues.push({ code: 'RESOURCE_VERSION_CONFLICT', message: `资源已经被线上页面使用，请上传新的图片：${relative}`, pageId, path: location })
          return
        }
      } else await input.candidate.writeFile(relative, content)
    }
    const extension = path.posix.extname(relative).toLowerCase()
    if (extension === '.css') for (const ref of cssReferences(content.toString('utf8'), 'stylesheet', relative)) await asset(ref.url, pageId, ref.path, selected, local)
    if (extension === '.js' || extension === '.mjs' || extension === '.html' || extension === '.svg') issues.push({ code: 'RESOURCE_DEPENDENCIES_UNRESOLVED', message: `资源依赖需要明确声明：${relative}`, pageId, path: location })
  }
  for (const page of input.pages) {
    try {
      for (const reference of collectPageReferences(page)) {
        if (reference.kind === 'asset') await asset(reference.url, page.pageId, reference.path, input.selectedPageIds.includes(page.pageId))
        else if (reference.kind === 'page') {
          if (!pageIds.has(reference.url)) issues.push({ code: 'PAGE_REFERENCE_MISSING', message: '本站目标页面尚未发布，请选择目标页面', pageId: page.pageId, path: reference.path })
        } else {
          const local = localUrl(reference.url, `/${page.slug}/`, input.publicUrl)
          if (local && local !== '/' && !routes.has(`${local.replace(/\/+$/, '')}/`)) issues.push({ code: 'PAGE_REFERENCE_MISSING', message: `本站目标页面不存在：${reference.url}`, pageId: page.pageId, path: reference.path })
        }
      }
      for (const [screenId, node] of Object.entries(page.body.ads?.guide.nodes ?? {})) for (const option of node.options) {
        if (option.action === 'link_page' && (!option.pageId || !pageIds.has(option.pageId))) issues.push({ code: 'GUIDE_PAGE_MISSING', message: 'Guide 目标页面尚未发布', pageId: page.pageId, path: `guide.nodes.${screenId}.${option.id}` })
      }
    } catch (error) {
      issues.push({ code: 'RESOURCE_PARSE_FAILED', message: error instanceof Error ? error.message : String(error), pageId: page.pageId })
    }
  }
  for (const file of await input.candidate.listFiles('assets')) if (!needed.has(file)) await input.candidate.deleteFile(file)
  const recorded = new Set<string>()
  for (const file of await input.candidate.listFiles('source/editor-assets')) {
    if (!file.endsWith('.json')) continue
    const record = JSON.parse((await input.candidate.readFile(file)).toString('utf8')) as { url?: string; digest?: string }
    const relative = record.url?.replace(/^\//, '') ?? (record.digest ? `assets/${record.digest}.webp` : '')
    if (!needed.has(relative)) await input.candidate.deleteFile(file)
    else recorded.add(relative)
  }
  for (const file of await input.source.listFiles('source/editor-assets')) {
    if (!file.endsWith('.json')) continue
    const content = await input.source.readFile(file)
    const record = JSON.parse(content.toString('utf8')) as { url?: string; digest?: string }
    const relative = record.url?.replace(/^\//, '') ?? (record.digest ? `assets/${record.digest}.webp` : '')
    if (selectedNeeded.has(relative) && !recorded.has(relative)) {
      await input.candidate.writeFile(file, content)
      recorded.add(relative)
    }
  }
  return issues
}
