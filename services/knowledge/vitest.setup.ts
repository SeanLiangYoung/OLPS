import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const envCandidates = [
  path.resolve(packageDir, '../../.env'),
  path.resolve(packageDir, '../../../.env'),
]

for (const envPath of envCandidates) {
  if (!fs.existsSync(envPath)) {
    continue
  }
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
  break
}