import fs from 'node:fs/promises'
import path from 'node:path'
import { createArtifactManifest } from './artifact-manifest.js'
import * as parse5 from 'parse5'
import * as cssTree from 'css-tree'
import { parseSrcset } from 'srcset'
import { createHash } from 'node:crypto'

const directories = ['source', 'themes', 'plugins', 'assets', 'public', 'server-config', 'tools']

function cssUrls(source: string, context: 'stylesheet' | 'declarationList' = 'stylesheet'): string[] {
  const urls: string[] = []
  const ast = cssTree.parse(source, { context })
  cssTree.walk(ast, node => {
    if (node.type === 'Url') urls.push(node.value)
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude) {
      cssTree.walk(node.prelude, child => { if (child.type === 'String') urls.push(child.value) })
    }
  })
  return urls
}

async function checkPublic(workspacePath: string): Promise<void> {
  const manifest = await createArtifactManifest(path.join(workspacePath, 'public'))
  let publicApiBaseUrl: URL | undefined
  let siteUrl: URL | undefined
  try {
    const config = JSON.parse(await fs.readFile(path.join(workspacePath, 'source/publish-config.json'), 'utf8')) as { publicApiBaseUrl?: string }
    if (config.publicApiBaseUrl) publicApiBaseUrl = new URL(config.publicApiBaseUrl)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  try {
    const settings = JSON.parse(await fs.readFile(path.join(workspacePath, 'source/site-settings.json'), 'utf8')) as { siteUrl?: string }
    if (settings.siteUrl) siteUrl = new URL(settings.siteUrl.endsWith('/') ? settings.siteUrl : `${settings.siteUrl}/`)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  for (const name of Object.keys(manifest)) {
    if (/\.(php|phtml|asp|aspx|ashx|asmx|jsp|jspx|cgi|pl|py|rb|shtml)$/i.test(name)) throw new Error(`禁止服务器脚本：${name}`)
    if (!name.endsWith('.html') && !name.endsWith('.css')) continue
    const source = await fs.readFile(path.join(workspacePath, 'public', name), 'utf8')
    const urls: string[] = []
    const walk = (node: parse5.DefaultTreeAdapterMap['node']): void => {
      if ('attrs' in node) for (const attr of node.attrs) {
        if (['href', 'src', 'poster', 'action'].includes(attr.name)) urls.push(attr.value)
        if (attr.name === 'srcset') urls.push(...parseSrcset(attr.value).map(candidate => candidate.url))
        if (attr.name === 'style') urls.push(...cssUrls(attr.value, 'declarationList'))
      }
      if ('tagName' in node && node.tagName === 'style' && 'childNodes' in node) {
        for (const child of node.childNodes) if ('value' in child) urls.push(...cssUrls(child.value))
      }
      if ('childNodes' in node) for (const child of node.childNodes) walk(child)
    }
    if (name.endsWith('.html')) walk(parse5.parse(source))
    else urls.push(...cssUrls(source))
    for (const value of urls) {
      if (!value || value.startsWith('#')) continue
      const url = new URL(value, `https://site.invalid/${name}`)
      const allowedApi = publicApiBaseUrl && url.origin === publicApiBaseUrl.origin && (url.pathname === publicApiBaseUrl.pathname || url.pathname.startsWith(publicApiBaseUrl.pathname.replace(/\/$/, '') + '/'))
      if (allowedApi) continue
      if (/\/(?:api\/(?:drafts|preview-access|auth|admin|editor-resources)|preview-access|editor-resources)(?:\/|$)/.test(url.pathname)) throw new Error(`内部地址：${name} ${value}`)
      let localPath: string
      if (url.origin === 'https://site.invalid') localPath = url.pathname.slice(1)
      else if (siteUrl && url.origin === siteUrl.origin && url.pathname.startsWith(siteUrl.pathname)) localPath = url.pathname.slice(siteUrl.pathname.length)
      else continue
      const relative = decodeURIComponent(localPath)
      if (!manifest[relative] && !manifest[path.posix.join(relative, 'index.html')]) throw new Error(`失效地址：${name} ${value}`)
    }
  }
}

async function directoryManifest(workspacePath: string, directory: string): Promise<unknown> {
  try { return await createArtifactManifest(path.join(workspacePath, directory)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
}

async function siteManifestDigest(workspacePath: string): Promise<string | null> {
  try { return createHash('sha256').update(await fs.readFile(path.join(workspacePath, 'olps.manifest.json'))).digest('hex') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

export async function verifySite(workspacePath: string): Promise<void> {
  await checkPublic(workspacePath)
  const expected = JSON.parse(await fs.readFile(path.join(workspacePath, '.olps-build.json'), 'utf8'))
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new Error('构建摘要格式无效')
  if (expected.siteManifest !== await siteManifestDigest(workspacePath)) throw new Error('构建文件不一致：olps.manifest.json')
  for (const directory of directories) {
    if (!expected[directory] || typeof expected[directory] !== 'object' || Array.isArray(expected[directory])) throw new Error(`构建摘要格式无效：${directory}`)
    const actual = await directoryManifest(workspacePath, directory)
    const stable = (value: object) => JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    if (stable(actual as object) !== stable(expected[directory])) throw new Error(`构建文件不一致：${directory}`)
  }
}

export async function recordBuildVerification(workspacePath: string): Promise<void> {
  const result: Record<string, unknown> = { siteManifest: await siteManifestDigest(workspacePath) }
  for (const directory of directories) result[directory] = await directoryManifest(workspacePath, directory)
  await fs.writeFile(path.join(workspacePath, '.olps-build.json'), JSON.stringify(result))
}
