import path from 'node:path'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { Liquid } from 'liquidjs'
import { z } from 'zod'
import { assertValidSchema } from '@olps/domain'
import { compilePluginServerScripts } from '@olps/plugin-runtime'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { readResource, resourceLimit, writeResource } from './managed-resource-context.js'

export type PackageKind = 'theme' | 'plugin'
export type PackageManifest = { id: string; name: string; version: string; settings: Array<{ key: string; type: string; required: boolean; default?: unknown }>; permissions?: Record<string, unknown>; server?: { build?: string; api?: string }; [key: string]: unknown }
export type ParsedPackage = { id: string; manifest: PackageManifest; files: Map<string, Buffer> }
export type PackageLimits = { maxFiles: number; maxBytes: number }

function invalid(reason: string): ContentError {
  const error = new ContentError('VALIDATION_FAILED', { reason })
  error.message = `VALIDATION_FAILED: ${reason}`
  return error
}

function safePackagePath(name: string): void {
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.includes('\0')) throw invalid('压缩包路径无效')
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some(part => part === '..' || part === '.' || part === '' || part.toLowerCase() === '.git')) throw invalid('压缩包路径越界')
}

async function zipFiles(bytes: Buffer, limits: PackageLimits): Promise<Map<string, Buffer>> {
  if (bytes.length > limits.maxBytes) throw invalid('压缩包大小超过限制')
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, opened) => error ? reject(error) : resolve(opened)))
  const files = new Map<string, Buffer>()
  let totalBytes = 0
  return new Promise((resolve, reject) => {
    function fail(error: unknown): void { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('end', () => resolve(files))
    zip.on('entry', (entry: Entry) => {
      async function consume(): Promise<void> {
        safePackagePath(entry.fileName)
        if (entry.isEncrypted()) throw invalid('压缩包不允许加密文件')
        const kind = (entry.externalFileAttributes >>> 16) & 0o170000
        if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) throw invalid('压缩包不允许符号链接和特殊文件')
        if (entry.fileName.endsWith('/')) return
        if (files.has(entry.fileName)) throw invalid('压缩包包含重复路径')
        if (files.size >= limits.maxFiles || totalBytes + entry.uncompressedSize > limits.maxBytes) throw invalid('压缩包文件数量或解压大小超过限制')
        const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => zip.openReadStream(entry, (error, opened) => error ? rejectStream(error) : resolveStream(opened)))
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk)
          length += buffer.length
          if (totalBytes + length > limits.maxBytes) throw invalid('压缩包解压大小超过限制')
          chunks.push(buffer)
        }
        totalBytes += length
        files.set(entry.fileName, Buffer.concat(chunks))
      }
      void consume().then(() => zip.readEntry(), fail)
    })
    if (zip.entryCount > limits.maxFiles * 2) { fail(invalid('压缩包文件数量超过限制')); return }
    zip.readEntry()
  })
}

async function parsePackageArchive(bytes: Buffer, kind: PackageKind, limits: PackageLimits): Promise<ParsedPackage> {
  const unpacked = await zipFiles(bytes, limits)
  const manifestName = `${kind}.json`
  const candidates = [...unpacked.keys()].filter(name => name === manifestName || name.endsWith(`/${manifestName}`) && name.split('/').length === 2)
  if (candidates.length !== 1) throw invalid(`压缩包必须包含唯一的${manifestName}`)
  const prefix = candidates[0].slice(0, -manifestName.length)
  const files = new Map<string, Buffer>()
  const extensions = new Set(['.json', '.liquid', '.css', '.js', '.png', '.jpg', '.webp', '.svg', '.woff', '.woff2'])
  const liquid = new Liquid({ strictVariables: true })
  for (const [name, content] of unpacked) {
    if (!name.startsWith(prefix)) throw invalid('压缩包包含主题或插件目录之外的文件')
    const relative = name.slice(prefix.length)
    if (!extensions.has(path.posix.extname(relative).toLowerCase())) throw invalid(`压缩包文件类型无效：${relative}`)
    if (kind === 'theme' && relative.startsWith('server/')) throw invalid('主题不允许服务器脚本')
    if (relative.endsWith('.liquid')) liquid.parse(content.toString('utf8'))
    if (relative.endsWith('/section.json')) assertValidSchema('section', JSON.parse(content.toString('utf8')), relative)
    if (relative.startsWith('languages/') && relative.endsWith('.json')) {
      z.object({ schemaVersion: z.literal(1), strings: z.record(z.string().min(1), z.string()) }).strict().parse(JSON.parse(content.toString('utf8')))
    }
    files.set(relative, content)
  }
  const manifest = JSON.parse(files.get(manifestName)!.toString('utf8')) as PackageManifest
  assertValidSchema(kind, manifest, manifestName)
  if (manifest.requires !== '1') throw invalid('主题或插件需要的接口版本不受支持')
  if (kind === 'theme') {
    for (const template of ['page', 'collection', 'group', 'item']) if (!files.has(`templates/${template}.liquid`)) throw invalid(`主题缺少模板：${template}`)
  }
  const referenced = kind === 'theme'
    ? [...manifest.styles as string[], ...((manifest.templates as Array<{ id: string }>).map(template => `templates/page-${template.id}.liquid`))]
    : [...manifest.assets as string[], ...(manifest.snippets as Array<{ file: string }>).map(snippet => snippet.file), ...Object.values(manifest.server ?? {})]
  for (const file of referenced) { safePackagePath(file); if (!files.has(file)) throw invalid(`包内声明的文件不存在：${file}`) }
  if (kind === 'plugin') {
    await compilePluginServerScripts({ pluginId: manifest.id, scripts: [...files].filter(([file]) => file.startsWith('server/') && file.endsWith('.js')).map(([file, source]) => ({ path: file, source: source.toString('utf8') })) })
  }
  return { id: manifest.id, manifest, files }
}

export async function readPackageArchive(bytes: Buffer, kind: PackageKind, limits: PackageLimits = {
  maxFiles: resourceLimit(`${kind.toUpperCase()}_MAX_FILES`, 2000),
  maxBytes: resourceLimit(`${kind.toUpperCase()}_MAX_BYTES`, 100 * 1024 * 1024),
}): Promise<ParsedPackage> {
  try { return await parsePackageArchive(bytes, kind, limits) }
  catch (error) {
    if (error instanceof ContentError) throw error
    throw invalid(error instanceof Error ? error.message : '主题或插件文件无效')
  }
}

export function permissionIdentity(manifest: PackageManifest): string {
  return JSON.stringify({ server: Boolean(Object.keys(manifest.server ?? {}).length), store: manifest.permissions?.store === true, inquiries: manifest.permissions?.inquiries === true, fetch: [...(manifest.permissions?.fetch as string[] ?? [])].sort() })
}

export async function installPackage(context: ContentContext, bytes: Buffer, kind: PackageKind): Promise<{ id: string; version: string; previousVersion: string | null; permissionsChanged: boolean }> {
  const parsed = await readPackageArchive(bytes, kind)
  return withContentTransaction(context, true, async (_client, backups) => {
    const directory = `${kind === 'theme' ? 'themes' : 'plugins'}/${parsed.id}`
    const oldManifestBytes = await readResource(context, `${directory}/${kind}.json`)
    const oldManifest = oldManifestBytes ? JSON.parse(oldManifestBytes.toString('utf8')) as PackageManifest : null
    const permissionsChanged = kind === 'plugin' && (!oldManifest || permissionIdentity(oldManifest) !== permissionIdentity(parsed.manifest))
    for (const file of await context.workspace.listFiles(directory)) {
      if (!parsed.files.has(file.slice(directory.length + 1))) await writeResource(context, backups, file, null)
    }
    for (const [file, content] of parsed.files) await writeResource(context, backups, `${directory}/${file}`, content)
    if (kind === 'plugin') {
      const configBytes = await context.workspace.readFile('source/plugins.json')
      const config = JSON.parse(configBytes.toString('utf8')) as { plugins: Record<string, { enabled: boolean; permissionsAcceptedAt: string | null; permissionsAcceptedBy: string | null; settings: Record<string, unknown> }> }
      const old = config.plugins[parsed.id]
      config.plugins[parsed.id] = old ?? { enabled: false, permissionsAcceptedAt: null, permissionsAcceptedBy: null, settings: {} }
      if (permissionsChanged && Object.keys(parsed.manifest.server ?? {}).length) config.plugins[parsed.id] = { ...config.plugins[parsed.id], enabled: false, permissionsAcceptedAt: null, permissionsAcceptedBy: null }
      assertValidSchema('plugins', config, 'source/plugins.json')
      await writeResource(context, backups, 'source/plugins.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`))
    }
    return { id: parsed.id, version: parsed.manifest.version, previousVersion: oldManifest?.version ?? null, permissionsChanged }
  })
}
