import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { classifyAssetsOnly } from './assets-only.js'
import { createArtifactManifest, compareArtifactManifests } from './artifact-manifest.js'

const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.intermediate/assets-only-tests')
let root: string
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }) })

it.each(['content', 'metadata', 'title', 'width', 'path', 'added', 'deleted', 'theme', 'page'])('资源发布判定：%s', async mode => {
  await fs.mkdir(parent, { recursive: true })
  root = await fs.mkdtemp(path.join(parent, 'case-'))
  const before = path.join(root, 'before')
  const after = path.join(root, 'after')
  for (const directory of [before, after]) {
    await fs.mkdir(path.join(directory, 'source/media'), { recursive: true })
    await fs.mkdir(path.join(directory, 'assets/uploads'), { recursive: true })
    await fs.writeFile(path.join(directory, 'assets/uploads/a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await fs.writeFile(path.join(directory, 'source/media/a.json'), JSON.stringify({ path: 'assets/uploads/a.svg', title: { en: 'Image' }, width: 960, size: 44 }))
  }
  await fs.writeFile(path.join(after, 'assets/uploads/a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>Image</title></svg>')
  if (mode === 'metadata') await fs.writeFile(path.join(after, 'source/media/a.json'), JSON.stringify({ path: 'assets/uploads/a.svg', title: { en: 'Image' }, width: 960, size: 75, uploadedAt: '2026-11-21', uploadedBy: 'user' }))
  if (['title', 'width', 'path'].includes(mode)) {
    const meta = JSON.parse(await fs.readFile(path.join(after, 'source/media/a.json'), 'utf8'))
    meta[mode] = mode === 'width' ? 480 : 'changed'
    await fs.writeFile(path.join(after, 'source/media/a.json'), JSON.stringify(meta))
  }
  if (mode === 'added') await fs.writeFile(path.join(after, 'assets/uploads/new.svg'), '<svg/>')
  if (mode === 'deleted') await fs.rm(path.join(after, 'assets/uploads/a.svg'))
  if (mode === 'theme' || mode === 'page') {
    const directory = mode === 'theme' ? 'themes' : 'source/pages'
    await fs.mkdir(path.join(after, directory), { recursive: true })
    await fs.writeFile(path.join(after, directory, 'changed.json'), '{}')
  }
  expect((await classifyAssetsOnly(before, after)).kind).toBe(['content', 'metadata'].includes(mode) ? 'assets_only' : 'full')
  const manifest = await createArtifactManifest(after)
  expect(compareArtifactManifests(manifest, manifest)).toEqual({ upload: [], remove: [] })
})
