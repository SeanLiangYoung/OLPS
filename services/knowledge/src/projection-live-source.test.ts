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
