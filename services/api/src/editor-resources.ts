import path from 'node:path'
import * as cssTree from 'css-tree'
import { openEditorWorkspace } from './editor-assets.js'
import { createPreviewToken, insertPreviewCapability, resolvePreviewCapability } from './preview-capability-store.js'
import { normalizePreviewSubPath } from './preview-serve.js'

function previewUrl(draftId: string, relative: string, token: string): string {
  const encoded = relative.split('/').map(encodeURIComponent).join('/')
  return `/api/drafts/${encodeURIComponent(draftId)}/editor-resources/${encoded}?token=${token}`
}

export async function listEditorResources(userId: string, sessionId: string, draftId: string) {
  const { workspace } = await openEditorWorkspace(userId, draftId)
  const rawToken = createPreviewToken()
  await insertPreviewCapability({ sessionId, userId, draftId, pageId: 'editor-resources', pageSlug: '', entryRoute: '', rawToken })
  const files = await workspace.listFiles('assets')
  return files.map(relative => ({ url: `/${relative}`, previewUrl: previewUrl(draftId, relative, rawToken) }))
}

function rewriteCss(css: string, relative: string, draftId: string, token: string): string {
  const tree = cssTree.parse(css, { onParseError(error) { throw error } })
  function resolve(value: string): string {
    if (!value.trim() || value.startsWith('#')) return value
    const url = new URL(value, `https://editor-resource.invalid/${relative}`)
    if (url.origin !== 'https://editor-resource.invalid') return value
    const resource = normalizePreviewSubPath(url.pathname)
    if (!resource.startsWith('assets/')) throw new Error('PREVIEW_FORBIDDEN')
    return previewUrl(draftId, resource, token) + url.hash
  }
  cssTree.walk(tree, node => {
    if (node.type === 'Url') node.value = resolve(node.value)
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude) {
      cssTree.walk(node.prelude, child => { if (child.type === 'String') child.value = resolve(child.value) })
    }
  })
  return cssTree.generate(tree)
}

export async function readEditorResource(draftId: string, rawPath: string, token: string) {
  const capability = await resolvePreviewCapability(token)
  if (!capability || capability.draftId !== draftId || capability.pageId !== 'editor-resources') throw new Error('FORBIDDEN')
  let relative: string
  try { relative = normalizePreviewSubPath(rawPath) }
  catch { throw new Error('FORBIDDEN') }
  if (!relative.startsWith('assets/')) throw new Error('FORBIDDEN')
  const { workspace } = await openEditorWorkspace(capability.userId, draftId)
  let content = await workspace.readFile(relative)
  const extension = path.posix.extname(relative).toLowerCase()
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  }
  if (extension === '.css') content = Buffer.from(rewriteCss(content.toString('utf8'), relative, draftId, token))
  return { content, contentType: types[extension] || 'application/octet-stream' }
}
