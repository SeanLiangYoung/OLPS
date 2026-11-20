import fs from 'node:fs'
import path from 'node:path'
import { gitOrThrow } from './git-exec.js'

export const BINARY_GITATTRIBUTES_LINES = [
  '*.png binary',
  '*.woff2 binary',
  '*.mp4 binary',
  '*.pdf binary',
] as const

export function binaryGitAttributesContent(): string {
  return `${BINARY_GITATTRIBUTES_LINES.join('\n')}\n`
}

export function applyRepoLocalLineEndingPolicy(repoPath: string): void {
  gitOrThrow(repoPath, ['config', 'core.autocrlf', 'false'])
  gitOrThrow(repoPath, ['config', 'core.eol', 'lf'])
  ensureBinaryGitAttributes(repoPath)
}

function ensureBinaryGitAttributes(repoPath: string): void {
  const attributesPath = path.join(repoPath, '.gitattributes')
  let existing = ''
  if (fs.existsSync(attributesPath)) {
    existing = fs.readFileSync(attributesPath, 'utf8')
  }
  const lines = existing.split(/\r?\n/)
  const missing = BINARY_GITATTRIBUTES_LINES.filter(
    (rule) => !lines.some((line) => line.trim() === rule),
  )
  if (missing.length === 0 && existing.length > 0) {
    return
  }
  const next =
    existing.trim().length === 0
      ? binaryGitAttributesContent()
      : `${existing.replace(/\s*$/, '')}\n${missing.join('\n')}\n`
  fs.writeFileSync(attributesPath, next, 'utf8')
}
