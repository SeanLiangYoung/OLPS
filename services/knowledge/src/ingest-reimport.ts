import fs from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeAiConfig } from './ai-config.js'
import { completeJson } from './ai-client.js'
import type { FingerprintStore } from './project-fingerprints.js'
import { wikiPathForImportedSource } from './source-wiki-path.js'

export type ReimportAiDecision = {
  decision: 'create' | 'update' | 'skip'
  targetWikiPath: string | null
  reason: string
}

export type ReimportWritePlan = {
  action: 'create' | 'update' | 'skip'
  wikiPath: string
  rejectedForcedUpdate: boolean
}

export type WikiSourceCandidate = {
  wikiPath: string
  title: string
  sourcePath: string | null
  snippet: string
  fingerprint: string | null
}

function parseSourcePathFromWikiMarkdown(raw: string): string | null {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw.replace(/\r\n/g, '\n'))
  if (!match) {
    return null
  }
  for (const line of match[1].split('\n')) {
    if (line.startsWith('sourcePath:')) {
      const value = line.slice('sourcePath:'.length).trim()
      if (value.startsWith('"')) {
        return JSON.parse(value) as string
      }
      return value
    }
  }
  return null
}

function parseTitleFromWikiMarkdown(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n/.exec(normalized)
  if (match) {
    for (const line of match[1].split('\n')) {
      if (line.startsWith('title:')) {
        const value = line.slice('title:'.length).trim()
        if (value.startsWith('"')) {
          return (JSON.parse(value) as string).trim()
        }
        return value.trim()
      }
    }
  }
  const heading = /^# (.+)\n/m.exec(normalized)
  return heading?.[1]?.trim() ?? 'untitled'
}

function parseFingerprintFromWikiMarkdown(raw: string): string | null {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n/.exec(normalized)
  if (!match) {
    return null
  }
  for (const line of match[1].split('\n')) {
    if (line.startsWith('sourceFingerprint:')) {
      const value = line.slice('sourceFingerprint:'.length).trim()
      if (value.startsWith('"')) {
        return JSON.parse(value) as string
      }
      return value
    }
  }
  return null
}

async function listImportedWikiCandidates(projectDir: string): Promise<WikiSourceCandidate[]> {
  const root = path.join(projectDir, 'wiki', 'sources', 'files')
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  const out: WikiSourceCandidate[] = []
  for (const name of names.filter((item) => item.endsWith('.md')).sort()) {
    const wikiPath = `wiki/sources/files/${name}`
    const raw = await fs.readFile(path.join(projectDir, ...wikiPath.split('/')), 'utf8')
  const body = raw.replace(/^---\n[\s\S]*?\n---\n\n?/, '').trim()
    out.push({
      wikiPath,
      title: parseTitleFromWikiMarkdown(raw),
      sourcePath: parseSourcePathFromWikiMarkdown(raw),
      snippet: body.slice(0, 600),
      fingerprint: parseFingerprintFromWikiMarkdown(raw),
    })
  }
  return out
}

export async function collectReimportCandidates(
  projectDir: string,
  sourcePath: string,
  store: FingerprintStore,
): Promise<WikiSourceCandidate[]> {
  const all = await listImportedWikiCandidates(projectDir)
  const entry = store[sourcePath]
  const canonical = wikiPathForImportedSource(sourcePath)
  const related = all.filter((item) => {
    if (item.wikiPath === canonical) {
      return true
    }
    if (item.sourcePath === sourcePath) {
      return true
    }
    if (entry?.wikiPath && item.wikiPath === entry.wikiPath) {
      return true
    }
    return false
  })
  if (related.length > 0) {
    return related
  }
  return all.slice(0, 12)
}

function parseAiReimportDecision(payload: Record<string, unknown>): ReimportAiDecision {
  const decisionRaw = payload.decision
  const targetWikiPathRaw = payload.targetWikiPath
  const reasonRaw = payload.reason
  if (decisionRaw !== 'create' && decisionRaw !== 'update' && decisionRaw !== 'skip') {
    throw new Error(`非法 decision: ${String(decisionRaw)}`)
  }
  if (typeof reasonRaw !== 'string' || !reasonRaw.trim()) {
    throw new Error('缺少 reason')
  }
  let targetWikiPath: string | null = null
  if (targetWikiPathRaw === null) {
    targetWikiPath = null
  } else if (typeof targetWikiPathRaw === 'string' && targetWikiPathRaw.trim()) {
    targetWikiPath = targetWikiPathRaw.trim().replace(/\\/g, '/')
    if (targetWikiPath.startsWith('/')) {
      throw new Error('targetWikiPath 必须为相对路径')
    }
  }
  return {
    decision: decisionRaw,
    targetWikiPath,
    reason: reasonRaw.trim(),
  }
}

export async function decideReimportWithAi(
  ai: KnowledgeAiConfig,
  input: {
    sourcePath: string
    fingerprint: string
    extractedText: string
    candidates: WikiSourceCandidate[]
  },
): Promise<ReimportAiDecision> {
  if (input.candidates.length === 0) {
    return { decision: 'create', targetWikiPath: null, reason: '无已有 Wiki 页，新建' }
  }
  const payload = await completeJson(ai, {
    system:
      '你是知识库再次导入判定助手。根据新来源与已有 Wiki 对照，输出严格 JSON：decision 为 create|update|skip；targetWikiPath（update 时必填，为已有 wiki 相对路径）；reason（string）。同一 source_path 内容微调应选 update 并指向该来源已有页；指纹未变可 skip；明显无关主题不得 update 到其他来源页。不要输出 markdown 代码围栏。',
    user: JSON.stringify({
      sourcePath: input.sourcePath,
      fingerprint: input.fingerprint,
      extractedPreview: input.extractedText.slice(0, 12_000),
      candidates: input.candidates.map((item) => ({
        wikiPath: item.wikiPath,
        title: item.title,
        sourcePath: item.sourcePath,
        snippet: item.snippet,
        fingerprint: item.fingerprint,
      })),
    }),
  })
  return parseAiReimportDecision(payload)
}

export function finalizeReimportIngestDecision(input: {
  sourcePath: string
  canonicalWikiPath: string
  ai: ReimportAiDecision
  existingByPath: Map<string, WikiSourceCandidate>
}): ReimportWritePlan {
  const canonical = input.canonicalWikiPath
  if (input.ai.decision === 'skip') {
    return { action: 'skip', wikiPath: canonical, rejectedForcedUpdate: false }
  }
  if (input.ai.decision === 'create') {
    return { action: 'create', wikiPath: canonical, rejectedForcedUpdate: false }
  }
  const target = input.ai.targetWikiPath?.trim() || canonical
  const existing = input.existingByPath.get(target)
  if (!existing) {
    return { action: 'create', wikiPath: canonical, rejectedForcedUpdate: true }
  }
  const boundSource = existing.sourcePath
  if (boundSource && boundSource !== input.sourcePath) {
    return { action: 'create', wikiPath: canonical, rejectedForcedUpdate: true }
  }
  if (target !== canonical && boundSource === null) {
    return { action: 'create', wikiPath: canonical, rejectedForcedUpdate: true }
  }
  return { action: 'update', wikiPath: target, rejectedForcedUpdate: false }
}

export function buildExistingByPath(candidates: WikiSourceCandidate[]): Map<string, WikiSourceCandidate> {
  const map = new Map<string, WikiSourceCandidate>()
  for (const item of candidates) {
    map.set(item.wikiPath, item)
  }
  return map
}