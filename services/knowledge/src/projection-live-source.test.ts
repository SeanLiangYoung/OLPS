import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectImportedSourceProjectionDocs } from './projection-sync.js'
import { makeIsolatedKnowledgeRoot } from './test-harness.js'

describe('collectImportedSourceProjectionDocs', () => {
  it('有 wikiPath 时按 wiki 正文生成 wiki_page 投影行', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('proj-live-wiki')
    const projectDir = path.join(knowledgeRoot, 'site-a')
    const sourcePath = 'raw/sources/docs/intro.md'
    const wikiPath = 'wiki/sources/files/intro.md'
    const extractedRel = `.olps-knowledge/extracted/${sourcePath}.json`
    await fs.mkdir(path.join(projectDir, path.dirname(sourcePath)), { recursive: true })
    await fs.mkdir(path.join(projectDir, path.dirname(wikiPath)), { recursive: true })
    await fs.mkdir(path.join(projectDir, path.dirname(extractedRel)), { recursive: true })
    await fs.writeFile(path.join(projectDir, sourcePath), 'raw source\n', 'utf8')
    await fs.writeFile(
      path.join(projectDir, wikiPath),
      '---\ntitle: "产品简介"\n---\n\n这是投影正文\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(projectDir, extractedRel),
      `${JSON.stringify({ sourcePath, text: 'raw source\n', importId: 'imp-1', fingerprint: 'abc' }, null, 2)}\n`,
      'utf8',
    )

    const docs = await collectImportedSourceProjectionDocs(projectDir, sourcePath, {
      kind: 'text',
      wikiPath,
    })
    expect(docs).toEqual([
      {
        title: '产品简介',
        content: '这是投影正文',
        fingerprint: 'abc',
        kind: 'wiki_page',
        wikiPath,
      },
    ])
  })

  it('aliasOfWikiPath 时投影内容取 canonical 正文', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('proj-live-alias')
    const projectDir = path.join(knowledgeRoot, 'site-alias')
    const sourcePath = 'raw/sources/产品1/产品详情资料.docx'
    const aliasWikiPath = 'wiki/sources/files/alias.md'
    const canonicalWikiPath = 'wiki/sources/files/canonical.md'
    const extractedRel = `.olps-knowledge/extracted/${sourcePath}.json`
    await fs.mkdir(path.join(projectDir, path.dirname(aliasWikiPath)), { recursive: true })
    await fs.mkdir(path.join(projectDir, path.dirname(extractedRel)), { recursive: true })
    // 历史上的 stub：只有跳转链接
    await fs.writeFile(
      path.join(projectDir, aliasWikiPath),
      '---\ntitle: "Cummins 1500kW"\nkind: imported_source_alias\n---\n\n本页对应原始路径。\n\n请阅读完整摘要：[Cummins 1500kW](canonical.md)\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(projectDir, canonicalWikiPath),
      '---\ntitle: "Cummins 1500kW"\n---\n\n## 产品概述\n\n这是完整摘要正文。\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(projectDir, extractedRel),
      `${JSON.stringify({ sourcePath, text: 'raw\n', importId: 'imp-alias', fingerprint: 'alias-fp' }, null, 2)}\n`,
      'utf8',
    )

    const docs = await collectImportedSourceProjectionDocs(projectDir, sourcePath, {
      kind: 'text',
      wikiPath: aliasWikiPath,
      aliasOfWikiPath: canonicalWikiPath,
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe('Cummins 1500kW')
    expect(docs[0]!.content).toContain('内容指纹与已有摘要相同，未再次调用 AI 解析。')
    expect(docs[0]!.content).toContain('## 产品概述')
    expect(docs[0]!.content).toContain('这是完整摘要正文。')
    expect(docs[0]!.content).not.toContain('请阅读完整摘要')
    expect(docs[0]!.content).not.toMatch(/\]\([^)]+\.md\)/)
  })

  it('无 wiki 时回退为 imported_text', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('proj-live-extracted')
    const projectDir = path.join(knowledgeRoot, 'site-b')
    const sourcePath = 'raw/sources/pack/note.txt'
    const extractedRel = `.olps-knowledge/extracted/${sourcePath}.json`
    await fs.mkdir(path.join(projectDir, path.dirname(extractedRel)), { recursive: true })
    await fs.writeFile(
      path.join(projectDir, extractedRel),
      `${JSON.stringify({ sourcePath, text: '权威正文\n', importId: 'imp-2', fingerprint: 'def' }, null, 2)}\n`,
      'utf8',
    )

    const docs = await collectImportedSourceProjectionDocs(projectDir, sourcePath, {
      kind: 'text',
    })
    expect(docs).toEqual([
      {
        title: 'note',
        content: '权威正文\n',
        fingerprint: 'def',
        kind: 'imported_text',
        wikiPath: null,
      },
    ])
  })

  it('runIngestPipeline 在成功写入后调用 projectSource', async () => {
    const { runIngestPipeline } = await import('./ingest-service.js')
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('proj-live-hook')
    const projectDir = path.join(knowledgeRoot, 'site-c')
    const sourcePath = 'raw/sources/docs/a.md'
    const wikiPath = 'wiki/sources/files/a.md'
    await fs.mkdir(path.join(projectDir, '.olps-knowledge', 'imports', 'imp-hook'), { recursive: true })
    await fs.mkdir(path.join(projectDir, path.dirname(sourcePath)), { recursive: true })
    await fs.mkdir(path.join(projectDir, path.dirname(wikiPath)), { recursive: true })
    await fs.writeFile(path.join(projectDir, sourcePath), 'hello\n', 'utf8')
    await fs.writeFile(path.join(projectDir, wikiPath), '---\ntitle: "A"\n---\n\nbody\n', 'utf8')
    await fs.writeFile(
      path.join(projectDir, '.olps-knowledge', 'fingerprints.json'),
      `${JSON.stringify(
        {
          [sourcePath]: {
            sha256: 'hash-a',
            kind: 'text',
            wikiPath,
            ingestedSha256: 'hash-a',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(projectDir, '.olps-knowledge', 'imports', 'imp-hook', 'ingest-progress.json'),
      `${JSON.stringify({ importId: 'imp-hook', completedSourcePaths: [], failedSourcePaths: [], metaPagesUpdated: false }, null, 2)}\n`,
      'utf8',
    )

    const projected: string[] = []
    await runIngestPipeline({
      projectDir,
      importId: 'imp-hook',
      writtenPaths: [sourcePath],
      projectSource: async (next) => {
        projected.push(next)
      },
    })
    expect(projected).toEqual([sourcePath])
  })
})
