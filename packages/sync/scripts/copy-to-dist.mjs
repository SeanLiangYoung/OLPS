import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(packageRoot, 'scripts')
const destDir = path.join(packageRoot, 'dist', 'scripts')
fs.mkdirSync(destDir, { recursive: true })
for (const name of fs.readdirSync(srcDir)) {
  if (name === 'copy-to-dist.mjs') {
    continue
  }
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name))
}
