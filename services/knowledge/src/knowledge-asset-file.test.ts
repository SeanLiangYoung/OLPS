import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { writeAssetMeta, type AssetMetaRecord } from './asset-meta.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

/** 1×1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

it('GET assets/:assetId/file 返回素材二进制与 mime；缺失资产返回 404', async () => {
  const knowledgeRoot = await makeIsolatedKnowledgeRoot('w4t3-asset-file')
  const siteId = 'w4t3-asset-file'
  const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
  try {
    const create = await fetch(`${baseUrl}/api/v1/projects/${siteId}/project`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(create.status).toBe(200)

    const projectDir = path.join(knowledgeRoot, siteId)
    const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const sourcePath = 'raw/sources/product/hero.png'
    const abs = path.join(projectDir, ...sourcePath.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, TINY_PNG)

    const meta: AssetMetaRecord = {
      assetId,
      sourcePath,
      kind: 'image',
      mime: 'image/png',
      sizeBytes: TINY_PNG.length,
      width: 1,
      height: 1,
      importId: '00000000-0000-4000-8000-000000000010',
      fingerprint: 'a'.repeat(64),
      role: 'product_image',
    }
    await writeAssetMeta(projectDir, meta)

    const res = await fetch(`${baseUrl}/api/v1/projects/${siteId}/assets/${assetId}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/image\/png/)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(TINY_PNG)).toBe(true)

    const missing = await fetch(
      `${baseUrl}/api/v1/projects/${siteId}/assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/file`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('asset_not_found')
  } finally {
    close()
  }
})
