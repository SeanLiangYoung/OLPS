import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { expect, it } from 'vitest'
import { readPackageArchive } from './package-install.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

async function themeFiles(): Promise<Record<string, Uint8Array>> {
  const directory = path.join(root, 'packages/builtin-themes/starter')
  const files: Record<string, Uint8Array> = {}
  async function readTree(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await readTree(absolute)
      else if (entry.isFile()) files[path.relative(directory, absolute).replaceAll('\\', '/')] = await fs.readFile(absolute)
    }
  }
  await readTree(directory)
  return files
}

it('真实ZIP安装前校验主题Schema和Liquid模板', async () => {
  const files = await themeFiles()
  const parsed = await readPackageArchive(Buffer.from(zipSync(files)), 'theme')
  expect(parsed.id).toBe('starter')
  expect(parsed.files.get('templates/page.liquid')!.toString()).toContain('{{ content }}')
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, 'templates/page.liquid': strToU8('{% if %}') })), 'theme')).rejects.toThrow()
  const invalid = { ...files, 'theme.json': strToU8('{}') }
  await expect(readPackageArchive(Buffer.from(zipSync(invalid)), 'theme')).rejects.toThrow()
})

it('拒绝ZIP路径越界、超量文件、超量字节和非法文件类型', async () => {
  const files = await themeFiles()
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, '../outside.css': strToU8('body{}') })), 'theme')).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync(files)), 'theme', { maxFiles: 2, maxBytes: 10_000_000 })).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync(files)), 'theme', { maxFiles: 100, maxBytes: 10 })).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, 'server.php': strToU8('<?php phpinfo();') })), 'theme')).rejects.toThrow()
})

it('真实isolate编译插件服务器脚本，拒绝语法错误', async () => {
  const manifest = { schemaVersion: 1, id: 'service-test', name: 'Service', version: '1.0.0', author: 'OLPS', description: '', requires: '1', settings: [], snippets: [], assets: [], server: { api: 'server/api.js' }, permissions: {} }
  const files = { 'plugin.json': strToU8(JSON.stringify(manifest)), 'server/api.js': strToU8('exports.handle=async function(request,ctx){return {status:200,headers:{},body:"ready"}}') }
  expect((await readPackageArchive(Buffer.from(zipSync(files)), 'plugin')).id).toBe('service-test')
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, 'server/api.js': strToU8('exports.handle = function( {') })), 'plugin')).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, 'plugin.json': strToU8('{}') })), 'plugin')).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, '../outside.js': strToU8('exports.test=1') })), 'plugin')).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync(files)), 'plugin', { maxFiles: 1, maxBytes: 10_000_000 })).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync(files)), 'plugin', { maxFiles: 100, maxBytes: 10 })).rejects.toThrow()
  await expect(readPackageArchive(Buffer.from(zipSync({ ...files, 'server.php': strToU8('<?php echo 1;') })), 'plugin')).rejects.toThrow()
})
