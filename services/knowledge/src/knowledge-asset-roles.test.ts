import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { readAssetMeta, writeAssetMeta, type AssetMetaRecord } from './asset-meta.js'
import {
  ASSET_ROLE_CONFIDENCE_THRESHOLD,
  finalizeAssetRoleAssignment,
  isKnowledgeAssetRole,
  KNOWLEDGE_ASSET_ROLES,
} from './asset-role.js'
import { collectPackageTextSummary } from './asset-role-identification.js'
import { loadKnowledgeAiConfig } from './ai-config.js'
import { listProjectAssets, rebuildAssetsCatalogMarkdown } from './assets-catalog.js'
import { writeFingerprintStore, type FingerprintStore } from './project-fingerprints.js'
import { readProjectReviews } from './project-reviews.js'
import { ensureKnowledgeProject } from './project-layout.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { ensureW2T3Fixtures } from './w2t3-fixture-builder.js'

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

function toBase64(bytes: Buffer): string {
  return bytes.toString('base64')
}

async function waitForImportCompleted(
  baseUrl: string,
  siteId: string,
  importId: string,
  timeoutMs = 240_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; error: string | null }
    if (body.status === 'completed') {
      return
    }
    if (body.status === 'failed') {
      throw new Error(`import failed: ${body.error ?? 'unknown'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`import ${importId} timeout`)
}

const hasAiKey = Boolean(loadKnowledgeAiConfig(process.env).apiKey.trim())

describe('collectPackageTextSummary（无模型）', () => {
  it('跳过 Office 锁文件与 fingerprint skipped，不因缺失 extracted JSON 抛错', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('role-summary-lock')
    const siteId = 'role-summary-lock'
    await ensureKnowledgeProject(knowledgeRoot, siteId)
    const projectDir = path.join(knowledgeRoot, siteId)

    const goodPath = 'raw/sources/ok/产品详情资料.docx'
    const lockPath = 'raw/sources/bad/~$产品详情资料.docx'
    const orphanTextPath = 'raw/sources/orphan/missing.docx'

    const extractedAbs = path.join(
      projectDir,
      '.olps-knowledge',
      'extracted',
      ...`${goodPath}.json`.split('/'),
    )
    await fs.mkdir(path.dirname(extractedAbs), { recursive: true })
    await fs.writeFile(
      extractedAbs,
      `${JSON.stringify({
        sourcePath: goodPath,
        text: '产品规格说明正文',
        importId: '00000000-0000-4000-8000-000000000099',
        fingerprint: 'c'.repeat(64),
      }, null, 2)}\n`,
      'utf8',
    )

    const store: FingerprintStore = {
      [goodPath]: { sha256: 'c'.repeat(64), kind: 'text', extractedRelativePath: `.olps-knowledge/extracted/${goodPath}.json` },
      [lockPath]: { sha256: 'd'.repeat(64), kind: 'skipped' },
      [orphanTextPath]: { sha256: 'e'.repeat(64), kind: 'text' },
    }
    await writeFingerprintStore(projectDir, store)

    const summary = await collectPackageTextSummary(
      projectDir,
      [lockPath, orphanTextPath, goodPath],
      store,
    )
    expect(summary).toContain('产品规格说明正文')
    expect(summary).toContain(goodPath)
    expect(summary).not.toContain('~$')
  })
})

describe('W3-T2 角色阈值（无模型）', () => {
  it('置信度不低于阈值时保留建议角色', () => {
    const result = finalizeAssetRoleAssignment({
      suggestedRole: 'product_image',
      confidence: ASSET_ROLE_CONFIDENCE_THRESHOLD,
      reason: '文件名含 product',
    })
    expect(result.role).toBe('product_image')
    expect(result.needsReview).toBe(false)
    expect(result.storedConfidence).toBe(ASSET_ROLE_CONFIDENCE_THRESHOLD)
  })

  it('置信度低于 0.55 时记为 other 并进入 review', () => {
    const result = finalizeAssetRoleAssignment({
      suggestedRole: 'logo',
      confidence: ASSET_ROLE_CONFIDENCE_THRESHOLD - 0.01,
      reason: '不确定',
    })
    expect(result.role).toBe('other')
    expect(result.needsReview).toBe(true)
    expect(result.reviewSuggestedRole).toBe('logo')
  })

  it('角色枚举与设计一致', () => {
    for (const role of [
      'logo',
      'partner_logo',
      'locale_icon',
      'product_image',
      'certificate',
      'background',
      'map_screenshot',
      'qr_code',
      'video_product',
      'document_scan',
      'other',
    ] as const) {
      expect(isKnowledgeAssetRole(role)).toBe(true)
      expect(KNOWLEDGE_ASSET_ROLES).toContain(role)
    }
  })
})

describe('W3-T2 assets 列表与 catalog（无模型）', () => {
  it('GET assets 可按 role 过滤', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t2-assets-filter')
    const siteId = 'w3t2-assets-filter'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      const projectDir = path.join(knowledgeRoot, siteId)
      const importId = '00000000-0000-4000-8000-000000000001'
      const base: Omit<AssetMetaRecord, 'assetId' | 'sourcePath' | 'role'> = {
        kind: 'image',
        mime: 'image/jpeg',
        sizeBytes: 100,
        width: 10,
        height: 10,
        importId,
        fingerprint: 'a'.repeat(64),
      }
      await writeAssetMeta(projectDir, {
        ...base,
        assetId: '11111111-1111-4111-8111-111111111111',
        sourcePath: 'raw/sources/a/product.jpg',
        role: 'product_image',
        roleConfidence: 0.9,
        roleReason: '测试',
      })
      await writeAssetMeta(projectDir, {
        ...base,
        assetId: '22222222-2222-4222-8222-222222222222',
        sourcePath: 'raw/sources/a/logo.jpg',
        role: 'logo',
        roleConfidence: 0.88,
        roleReason: '测试',
      })
      await rebuildAssetsCatalogMarkdown(projectDir)

      const allRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets`)
      expect(allRes.status).toBe(200)
      const allBody = (await allRes.json()) as { assets: Array<{ role: string }> }
      expect(allBody.assets).toHaveLength(2)

      const productRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets?role=product_image`)
      expect(productRes.status).toBe(200)
      const productBody = (await productRes.json()) as { assets: Array<{ role: string; assetId: string }> }
      expect(productBody.assets).toHaveLength(1)
      expect(productBody.assets[0]?.role).toBe('product_image')

      const badRole = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets?role=not_a_role`)
      expect(badRole.status).toBe(400)
    } finally {
      close()
    }
  })

  it('listProjectAssets 与磁盘元数据一致', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t2-list-local')
    const siteId = 'w3t2-list-local'
    await ensureKnowledgeProject(knowledgeRoot, siteId)
    const projectDir = path.join(knowledgeRoot, siteId)
    await writeAssetMeta(projectDir, {
      assetId: '33333333-3333-4333-8333-333333333333',
      sourcePath: 'raw/sources/x/y.jpg',
      kind: 'image',
      mime: 'image/jpeg',
      sizeBytes: 1,
      importId: '00000000-0000-4000-8000-000000000002',
      fingerprint: 'b'.repeat(64),
      role: 'other',
      roleConfidence: 0.2,
      roleReason: '低置信',
    })
    const listed = await listProjectAssets(projectDir)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.role).toBe('other')
  })
})

describe.skipIf(!hasAiKey)('W3-T2 素材角色识别（真实模型）', () => {
  beforeAll(async () => {
    await ensureW2T3Fixtures()
  })

  it('多 jpg 导入后至少一个非 other 或进入 review；catalog 与过滤可用', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t2-multi-jpg')
    const siteId = 'w3t2-multi-jpg'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: true,
    })
    try {
      const init = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      expect(init.status).toBe(200)
      const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'w2t3')
      const jpgA = await fs.readFile(path.join(fixtureDir, 'sample.jpg'))
      const jpgB = await fs.readFile(path.join(fixtureDir, 'sample.jpeg'))
      const docx = await fs.readFile(path.join(fixtureDir, 'sample.docx'))
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'multi-jpg-roles',
          files: [
            { relativePath: 'product/spec.docx', contentBase64: toBase64(docx) },
            { relativePath: 'product/gallery/product-photo-1.jpg', contentBase64: toBase64(jpgA) },
            { relativePath: 'product/gallery/product-photo-2.jpg', contentBase64: toBase64(jpgB) },
            { relativePath: 'brand/company-logo.jpg', contentBase64: toBase64(jpgA) },
          ],
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }
      await waitForImportCompleted(baseUrl, siteId, importId)

      const projectDir = path.join(knowledgeRoot, siteId)
      const catalog = await fs.readFile(path.join(projectDir, 'wiki', 'assets-catalog.md'), 'utf8')
      expect(catalog).toContain('product-photo-1')
      expect(catalog).toContain('company-logo')

      const assetsRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets`)
      expect(assetsRes.status).toBe(200)
      const { assets } = (await assetsRes.json()) as {
        assets: Array<{ assetId: string; role: string; sourcePath: string }>
      }
      expect(assets.length).toBeGreaterThanOrEqual(3)

      let nonOther = 0
      for (const item of assets) {
        const meta = await readAssetMeta(projectDir, item.assetId)
        expect(meta.role).toBeDefined()
        expect(isKnowledgeAssetRole(meta.role!)).toBe(true)
        if (meta.role !== 'other') {
          nonOther += 1
        }
      }

      const reviews = await readProjectReviews(projectDir)
      const roleReviews = reviews.filter((item) => item.kind === 'asset_role_low_confidence')
      const hasNonOtherOrReview = nonOther >= 1 || roleReviews.length >= 1
      expect(hasNonOtherOrReview).toBe(true)

      if (nonOther >= 1) {
        const withRole = assets.find((item) => item.role !== 'other')
        expect(withRole).toBeTruthy()
        const filtered = await authFetch(
          baseUrl,
          `/api/v1/projects/${siteId}/assets?role=${encodeURIComponent(withRole!.role)}`,
        )
        expect(filtered.status).toBe(200)
        const filteredBody = (await filtered.json()) as { assets: Array<{ role: string }> }
        expect(filteredBody.assets.length).toBeGreaterThanOrEqual(1)
        for (const row of filteredBody.assets) {
          expect(row.role).toBe(withRole!.role)
        }
      }

      if (roleReviews.length >= 1) {
        const low = roleReviews[0]!
        expect(low.assetId).toBeTruthy()
        const meta = await readAssetMeta(projectDir, low.assetId!)
        expect(meta.role).toBe('other')
      }
    } finally {
      close()
    }
  })
})