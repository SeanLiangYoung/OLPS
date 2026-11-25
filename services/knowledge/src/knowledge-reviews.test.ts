import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { writeAssetMeta, type AssetMetaRecord } from './asset-meta.js'
import { rebuildAssetsCatalogMarkdown } from './assets-catalog.js'
import { appendAssetRoleReview, readProjectReviews } from './project-reviews.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

function sampleAssetMeta(overrides: Partial<AssetMetaRecord> & Pick<AssetMetaRecord, 'assetId' | 'sourcePath'>): AssetMetaRecord {
  return {
    kind: 'image',
    mime: 'image/png',
    sizeBytes: 68,
    width: 1,
    height: 1,
    importId: '00000000-0000-4000-8000-000000000010',
    fingerprint: 'c'.repeat(64),
    role: 'other',
    roleConfidence: 0.2,
    roleReason: '低置信测试',
    ...overrides,
  }
}

it('resolve 后 status=open 列表减少 1；已 resolved 与非法 id 有明确错误码', async () => {
  const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t4-resolve')
  const siteId = 'w3t4-resolve'
  const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
  try {
    await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
    const projectDir = path.join(knowledgeRoot, siteId)
    const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await writeAssetMeta(
      projectDir,
      sampleAssetMeta({ assetId, sourcePath: 'raw/sources/product/uncertain.png' }),
    )
    const review = await appendAssetRoleReview(projectDir, {
      importId: '00000000-0000-4000-8000-000000000010',
      assetId,
      sourcePath: 'raw/sources/product/uncertain.png',
      suggestedRole: 'product_image',
      confidence: 0.2,
      reason: '文件名模糊',
    })
    await appendAssetRoleReview(projectDir, {
      importId: '00000000-0000-4000-8000-000000000010',
      assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourcePath: 'raw/sources/product/other.png',
      suggestedRole: 'logo',
      confidence: 0.1,
      reason: '另一条待审',
    })

    const openBefore = await authFetch(baseUrl, `/api/v1/projects/${siteId}/reviews?status=open`)
    expect(openBefore.status).toBe(200)
    const beforeBody = (await openBefore.json()) as { reviews: Array<{ id: string }> }
    expect(beforeBody.reviews).toHaveLength(2)

    const resolveRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/reviews/${review.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(resolveRes.status).toBe(200)
    const resolvedBody = (await resolveRes.json()) as { review: { id: string; status: string } }
    expect(resolvedBody.review.id).toBe(review.id)
    expect(resolvedBody.review.status).toBe('resolved')

    const openAfter = await authFetch(baseUrl, `/api/v1/projects/${siteId}/reviews?status=open`)
    expect(openAfter.status).toBe(200)
    const afterBody = (await openAfter.json()) as { reviews: Array<{ id: string }> }
    expect(afterBody.reviews).toHaveLength(1)
    expect(afterBody.reviews[0]?.id).not.toBe(review.id)

    const again = await authFetch(baseUrl, `/api/v1/projects/${siteId}/reviews/${review.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: string }).error).toBe('review_already_resolved')

    const missing = await authFetch(
      baseUrl,
      `/api/v1/projects/${siteId}/reviews/00000000-0000-4000-8000-ffffffffffff/resolve`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('review_not_found')

    const onDisk = await readProjectReviews(projectDir)
    expect(onDisk.find((item) => item.id === review.id)?.status).toBe('resolved')
  } finally {
    close()
  }
})

it('PATCH asset 改角色后 meta 与 assets-catalog 一致；非法 role 返回 invalid_role', async () => {
  const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t4-patch-role')
  const siteId = 'w3t4-patch-role'
  const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
  try {
    await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
    const projectDir = path.join(knowledgeRoot, siteId)
    const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await writeAssetMeta(
      projectDir,
      sampleAssetMeta({
        assetId,
        sourcePath: 'raw/sources/brand/mark.png',
        role: 'other',
      }),
    )
    await rebuildAssetsCatalogMarkdown(projectDir)

    const bad = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'not_a_role' }),
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_role')

    const ok = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'logo', caption: '主品牌 Logo' }),
    })
    expect(ok.status).toBe(200)
    const okBody = (await ok.json()) as { asset: { assetId: string; role: string; caption?: string } }
    expect(okBody.asset.assetId).toBe(assetId)
    expect(okBody.asset.role).toBe('logo')
    expect(okBody.asset.caption).toBe('主品牌 Logo')

    const catalog = await fs.readFile(path.join(projectDir, 'wiki', 'assets-catalog.md'), 'utf8')
    expect(catalog).toContain(assetId)
    expect(catalog).toMatch(/\| logo \|/)

    const listed = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets?role=logo`)
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()) as { assets: Array<{ assetId: string; role: string }> }
    expect(listedBody.assets.some((item) => item.assetId === assetId && item.role === 'logo')).toBe(true)

    const missingAsset = await authFetch(
      baseUrl,
      `/api/v1/projects/${siteId}/assets/dddddddd-dddd-4ddd-8ddd-dddddddddddd`,
      { method: 'PATCH', body: JSON.stringify({ role: 'logo' }) },
    )
    expect(missingAsset.status).toBe(404)
    expect(((await missingAsset.json()) as { error: string }).error).toBe('asset_not_found')
  } finally {
    close()
  }
})
