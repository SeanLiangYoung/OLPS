import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const apiSrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

/** 允许在源码中出现 legacy tenant 语义的数据库迁移入口（与 tsconfig 生产 include 一致）。 */
const MIGRATION_TENANT_ALLOWLIST = new Set(['migrate.ts'])

export type RuntimeTenantViolation = {
  file: string
  line: number
  kind: 'tenantId_identifier' | 'tenant_id_identifier' | 'tenant_id_in_string'
  snippet: string
}

function listProductionSourceFiles(srcDir: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'test-support') {
          continue
        }
        walk(fullPath)
        continue
      }
      if (!entry.name.endsWith('.ts')) {
        continue
      }
      if (entry.name.endsWith('.test.ts')) {
        continue
      }
      files.push(fullPath)
    }
  }
  walk(srcDir)
  return files.sort()
}

function lineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function snippetAround(sourceFile: ts.SourceFile, node: ts.Node, maxLen = 96): string {
  const start = node.getStart(sourceFile)
  const end = node.getEnd()
  const raw = sourceFile.text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (raw.length <= maxLen) {
    return raw
  }
  return `${raw.slice(0, maxLen - 1)}…`
}

function stringChunkHasTenantIdColumn(text: string): boolean {
  return /tenant_id/i.test(text)
}

export function collectRuntimeTenantViolations(srcDir: string = apiSrcRoot): RuntimeTenantViolation[] {
  const violations: RuntimeTenantViolation[] = []

  for (const absPath of listProductionSourceFiles(srcDir)) {
    const baseName = path.basename(absPath)
    if (MIGRATION_TENANT_ALLOWLIST.has(baseName)) {
      continue
    }

    const relPath = path.relative(srcDir, absPath).replace(/\\/g, '/')
    const sourceText = fs.readFileSync(absPath, 'utf8')
    const sourceFile = ts.createSourceFile(
      absPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        if (node.text === 'tenantId') {
          violations.push({
            file: relPath,
            line: lineNumber(sourceFile, node),
            kind: 'tenantId_identifier',
            snippet: snippetAround(sourceFile, node),
          })
        }
        if (node.text === 'tenant_id') {
          violations.push({
            file: relPath,
            line: lineNumber(sourceFile, node),
            kind: 'tenant_id_identifier',
            snippet: snippetAround(sourceFile, node),
          })
        }
      }

      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (stringChunkHasTenantIdColumn(node.text)) {
          violations.push({
            file: relPath,
            line: lineNumber(sourceFile, node),
            kind: 'tenant_id_in_string',
            snippet: snippetAround(sourceFile, node),
          })
        }
      }

      if (ts.isTemplateExpression(node)) {
        if (stringChunkHasTenantIdColumn(node.head.text)) {
          violations.push({
            file: relPath,
            line: lineNumber(sourceFile, node),
            kind: 'tenant_id_in_string',
            snippet: snippetAround(sourceFile, node.head),
          })
        }
        for (const span of node.templateSpans) {
          if (stringChunkHasTenantIdColumn(span.literal.text)) {
            violations.push({
              file: relPath,
              line: lineNumber(sourceFile, span.literal),
              kind: 'tenant_id_in_string',
              snippet: snippetAround(sourceFile, span.literal),
            })
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return violations
}

function uniqueViolationsByFile(violations: RuntimeTenantViolation[]): Map<string, RuntimeTenantViolation[]> {
  const byFile = new Map<string, RuntimeTenantViolation[]>()
  for (const v of violations) {
    const list = byFile.get(v.file) ?? []
    list.push(v)
    byFile.set(v.file, list)
  }
  return byFile
}

describe('协作 API 生产源码不得携带 runtime tenant 模型', () => {
  it('除迁移入口外不得出现 tenantId、tenant_id 标识符或 SQL tenant_id 字面量', () => {
    const violations = collectRuntimeTenantViolations()
    const byFile = uniqueViolationsByFile(violations)
    const summary = [...byFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, items]) => {
        const lines = [...new Set(items.map((i) => i.line))].sort((a, b) => a - b)
        return `${file} (lines: ${lines.join(', ')})`
      })
      .join('\n')

    expect(
      violations,
      summary.length > 0 ? `runtime tenant 违规文件:\n${summary}` : undefined,
    ).toEqual([])
  })
})
