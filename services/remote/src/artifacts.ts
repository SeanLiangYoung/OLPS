import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import archiver from 'archiver'
import { parseAllRedirects } from '@netlify/redirect-parser'
import { assertDirectoryTreeSafe } from './safe-fs.js'
import { releasePublicDir, releaseServerConfigDir } from './site-store.js'
import { assertSafePublicRelativePath } from './validation.js'

export type PublishedArtifact = { path: string; sha256: string; size: number }
export type PublishedRedirect = { from: string; to: string; status: 301 | 404 }
export type ReleaseLocation = { dataRoot: string; remoteSiteId: string; deploymentId: string }

function roots(location: ReleaseLocation): Array<{ prefix: string; root: string }> {
  return [
    { prefix: 'public', root: releasePublicDir(location.dataRoot, location.remoteSiteId, location.deploymentId) },
    { prefix: 'server-config', root: releaseServerConfigDir(location.dataRoot, location.remoteSiteId, location.deploymentId) },
  ]
}

async function isPresent(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function listPublishedArtifacts(location: ReleaseLocation): Promise<PublishedArtifact[]> {
  const files: PublishedArtifact[] = []
  for (const { prefix, root } of roots(location)) {
    if (!(await isPresent(root))) {
      if (prefix === 'public') throw new Error('发布目录不存在')
      continue
    }
    const stat = await fs.lstat(root)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('发布目录类型无效')
    await assertDirectoryTreeSafe(root)
    async function walk(current: string): Promise<void> {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name)
        if (entry.isDirectory()) await walk(absolute)
        else if (entry.isFile()) {
          const content = await fs.readFile(absolute)
          files.push({ path: `${prefix}/${path.relative(root, absolute).replace(/\\/g, '/')}`, sha256: createHash('sha256').update(content).digest('hex'), size: content.length })
        }
      }
    }
    await walk(root)
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function readPublishedArtifact(location: ReleaseLocation, relativePath: string): Promise<Buffer | null> {
  assertSafePublicRelativePath(relativePath)
  const selected = roots(location).find(entry => relativePath.startsWith(`${entry.prefix}/`))
  if (!selected) return null
  const segments = relativePath.slice(selected.prefix.length + 1).split('/')
  if (segments.some(segment => segment === '' || segment === '.')) return null
  let target = selected.root
  for (const segment of ['', ...segments]) {
    target = path.join(target, segment)
    if (!(await isPresent(target))) return null
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) throw new Error('发布文件不允许符号链接')
  }
  if (!(await fs.stat(target)).isFile()) return null
  return fs.readFile(target)
}

export async function zipPublishedArtifacts(location: ReleaseLocation): Promise<Buffer> {
  const files = await listPublishedArtifacts(location)
  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
    archive.on('warning', reject)
  })
  for (const file of files) {
    const content = await readPublishedArtifact(location, file.path)
    if (!content) throw new Error(`发布文件不存在：${file.path}`)
    archive.append(content, { name: file.path, date: new Date(0) })
  }
  await archive.finalize()
  return completed
}

export async function readPublishedRedirects(directory: string): Promise<PublishedRedirect[]> {
  const file = path.join(directory, '_redirects')
  if (!(await isPresent(file))) return []
  const stat = await fs.lstat(file)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('跳转配置类型无效')
  const parsed = await parseAllRedirects({ redirectsFiles: [file], configRedirects: [], minimal: true })
  if (parsed.errors.length) throw new Error(`跳转配置无效：${parsed.errors.map(error => String(error)).join('；')}`)
  const parsedRules = parsed.redirects as Array<{ from: string; to: string; status: number; conditions?: object; query?: object }>
  const notFoundRule = parsedRules.find(rule => rule.status === 404 && rule.from.endsWith('/*'))
  const basePath = notFoundRule ? notFoundRule.from.slice(0, -2) : ''
  const withoutBasePath = (value: string): string => {
    const normalized = new URL(value, 'https://redirect.invalid')
    const pathname = basePath && normalized.pathname.startsWith(`${basePath}/`) ? normalized.pathname.slice(basePath.length) : normalized.pathname
    assertSafePublicRelativePath(decodeURIComponent(pathname.slice(1)))
    return `${pathname}${normalized.search}${normalized.hash}`
  }
  return parsedRules.map(redirect => {
    if (!redirect.from.startsWith('/') || redirect.from.startsWith('//') || !redirect.to.startsWith('/') || redirect.to.startsWith('//')) throw new Error('跳转配置只允许站内地址')
    if (redirect.status !== 301 && redirect.status !== 404) throw new Error(`跳转状态无效：${redirect.status}`)
    if (redirect.conditions && Object.keys(redirect.conditions).length || redirect.query && Object.keys(redirect.query).length) throw new Error('跳转配置不支持条件规则')
    if (redirect.status === 301 && /[*:]/.test(redirect.from)) throw new Error('301 跳转只允许完整地址')
    return { from: withoutBasePath(redirect.from), to: withoutBasePath(redirect.to), status: redirect.status }
  })
}
